"""Unit tests for the Zepto / Zoho CPaaS WhatsApp booking-confirmation template."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from Services.whatsapp import (
    BOOKING_TEMPLATE_MERGE_KEYS,
    booking_confirmation_merge_info,
    build_zepto_template_payload,
    e164_whatsapp_number,
    format_booking_id,
    send_booking_confirmation_whatsapp,
    send_whatsapp_template,
    whatsapp_template_configured,
    zepto_whatsapp_auth_header,
)

# Stand-in UUID shaped like Zoho CPaaS template_key (replace via WHATSAPP_TEMPLATE_KEY in .env for live sends).
TEST_TEMPLATE_KEY = "d0109d00-b191-11f1-95b1-aaa8828ce996"
TEST_TEMPLATE_ALIAS = "jod_booking_confirmation"


class WhatsAppTemplateTests(unittest.TestCase):
    def test_booking_id_format(self):
        self.assertEqual(
            format_booking_id("7c9df206-3fcb-48da-a800-c9c51afd7c04"),
            "JOD-7C9DF206",
        )

    def test_e164_adds_india_country_code(self):
        self.assertEqual(e164_whatsapp_number("9876543210"), "+919876543210")
        self.assertEqual(e164_whatsapp_number("+91 98765 43210"), "+919876543210")

    def test_merge_info_matches_approved_template_variables(self):
        merge = booking_confirmation_merge_info(
            name="Krithish B R",
            event_name="Shaurya Samman 2026",
            event_date="15 Nov 2026, 6:00 PM",
            ticket_type="VIP",
            booking_id="7c9df206-3fcb-48da-a800-c9c51afd7c04",
        )
        self.assertEqual(tuple(merge.keys()), BOOKING_TEMPLATE_MERGE_KEYS)
        self.assertEqual(
            merge,
            {
                "Name": "Krithish B R",
                "Event_Name": "Shaurya Samman 2026",
                "Event_Date": "15 Nov 2026, 6:00 PM",
                "Ticket_Type": "VIP",
                "Booking_id": "JOD-7C9DF206",
            },
        )

    def test_payload_uses_template_key_and_merge_info(self):
        payload = build_zepto_template_payload(
            to_phone="9876543210",
            from_phone="+919876500000",
            template_key=TEST_TEMPLATE_KEY,
            merge_info=booking_confirmation_merge_info(
                name="Guest",
                event_name="Demo Event",
                event_date="TBA",
                ticket_type="General Admission",
                booking_id="abc",
            ),
            attachment_file_key="file-cache-key-1",
            client_reference="JOD-ABC00000",
        )
        self.assertEqual(payload["from"], "+919876500000")
        self.assertEqual(payload["to"], "+919876543210")
        self.assertEqual(payload["template_key"], TEST_TEMPLATE_KEY)
        self.assertNotIn("template_alias", payload)
        self.assertEqual(payload["attachment"], {"file_key": "file-cache-key-1"})
        self.assertEqual(payload["client_reference"], "JOD-ABC00000")
        self.assertEqual(payload["merge_info"]["Event_Name"], "Demo Event")

    def test_payload_uses_template_alias_when_key_absent(self):
        payload = build_zepto_template_payload(
            to_phone="9876543210",
            from_phone="+919876500000",
            template_alias=TEST_TEMPLATE_ALIAS,
            merge_info={"Name": "Guest"},
        )
        self.assertEqual(payload["template_alias"], TEST_TEMPLATE_ALIAS)
        self.assertNotIn("template_key", payload)

    def test_auth_header_prefixes_zoho_token(self):
        self.assertEqual(
            zepto_whatsapp_auth_header("abc123"),
            "Zoho-enczapikey abc123",
        )
        self.assertEqual(
            zepto_whatsapp_auth_header("Zoho-enczapikey already"),
            "Zoho-enczapikey already",
        )

    def test_configured_requires_key_sender_and_template(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(whatsapp_template_configured())
        with patch.dict(
            os.environ,
            {
                "ZEPTO_WHATSAPP_API_KEY": "tok",
                "ZEPTO_WHATSAPP_FROM": "+919876500000",
                "WHATSAPP_TEMPLATE_KEY": TEST_TEMPLATE_KEY,
            },
            clear=True,
        ):
            self.assertTrue(whatsapp_template_configured())

    @patch("Services.whatsapp.httpx.post")
    def test_send_template_success(self, mock_post):
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_res.text = '{"status":"success"}'
        mock_res.json.return_value = {
            "status": "success",
            "data": {"message_id": "1ba7d8d0-b680-11f1-91b5-d2a30e0412c2", "code": "MSG_101"},
        }
        mock_post.return_value = mock_res

        with patch.dict(
            os.environ,
            {
                "ZEPTO_WHATSAPP_API_KEY": "tok",
                "ZEPTO_WHATSAPP_FROM": "+919876500000",
                "WHATSAPP_TEMPLATE_KEY": TEST_TEMPLATE_KEY,
                "ZEPTO_WHATSAPP_API_BASE": "https://cpaas.zoho.com/v1.1",
            },
            clear=True,
        ):
            sent, channel, link, message_id = send_booking_confirmation_whatsapp(
                "9876543210",
                name="Krithish",
                event_name="Triennial conference",
                event_date="26 Oct 2026",
                ticket_type="General Admission",
                booking_id="7c9df206-3fcb-48da-a800-c9c51afd7c04",
            )

        self.assertTrue(sent)
        self.assertEqual(channel, "zepto-template")
        self.assertEqual(message_id, "1ba7d8d0-b680-11f1-91b5-d2a30e0412c2")
        self.assertIn("wa.me/919876543210", link)
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], "https://cpaas.zoho.com/v1.1/whatsapp")
        self.assertEqual(kwargs["headers"]["Authorization"], "Zoho-enczapikey tok")
        body = kwargs["json"]
        self.assertEqual(body["template_key"], TEST_TEMPLATE_KEY)
        self.assertEqual(body["merge_info"]["Name"], "Krithish")
        self.assertEqual(body["merge_info"]["Booking_id"], "JOD-7C9DF206")
        self.assertEqual(
            set(body["merge_info"].keys()),
            set(BOOKING_TEMPLATE_MERGE_KEYS),
        )

    @patch("Services.whatsapp.httpx.post")
    def test_send_template_failure_returns_false(self, mock_post):
        mock_res = MagicMock()
        mock_res.status_code = 401
        mock_res.text = '{"error":{"code":"WA_103","message":"Template is not valid"}}'
        mock_res.json.return_value = {"error": {"code": "WA_103"}}
        mock_post.return_value = mock_res

        with patch.dict(
            os.environ,
            {
                "ZEPTO_WHATSAPP_API_KEY": "tok",
                "ZEPTO_WHATSAPP_FROM": "+919876500000",
                "WHATSAPP_TEMPLATE_KEY": "bad-key",
            },
            clear=True,
        ):
            sent, channel, _link, message_id = send_whatsapp_template(
                "9876543210",
                merge_info={"Name": "A"},
            )
        self.assertFalse(sent)
        self.assertEqual(channel, "zepto-template")
        self.assertIsNone(message_id)


if __name__ == "__main__":
    unittest.main()
