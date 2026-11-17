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
    upload_cpaas_file,
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
            booking_id="7c9df206-3fcb-48da-a800-c9c51afd7c04",
            ticket_url="https://jodevents.com/ticket-details.html?token=abc123",
            ticket_type="VIP",
        )
        self.assertEqual(
            {k: merge[k] for k in BOOKING_TEMPLATE_MERGE_KEYS},
            {
                "name": "Krithish B R",
                "event_name": "Shaurya Samman 2026",
                "event_date": "15 Nov 2026, 6:00 PM",
                "booking_ref": "JOD-7C9DF206",
            },
        )
        self.assertEqual(merge["ticket_url"], "https://jodevents.com/ticket-details.html?token=abc123")
        self.assertEqual(merge["ticket_token"], "abc123")

    def test_payload_uses_template_key_and_merge_info(self):
        payload = build_zepto_template_payload(
            to_phone="9876543210",
            from_phone="+919876500000",
            template_key=TEST_TEMPLATE_KEY,
            merge_info=booking_confirmation_merge_info(
                name="Guest",
                event_name="Demo Event",
                event_date="TBA",
                booking_id="abc",
            ),
            client_reference="JOD-ABC00000",
        )
        self.assertEqual(payload["from"], "+919876500000")
        self.assertEqual(payload["to"], "+919876543210")
        self.assertEqual(payload["template_key"], TEST_TEMPLATE_KEY)
        self.assertNotIn("template_alias", payload)
        self.assertNotIn("file_key", payload)
        self.assertNotIn("attachment", payload)
        self.assertNotIn("attachments", payload)
        self.assertEqual(payload["client_reference"], "JOD-ABC00000")
        self.assertEqual(payload["merge_info"]["event_name"], "Demo Event")
        self.assertEqual(payload["merge_info"]["booking_ref"], "JOD-ABC")

    def test_payload_can_include_base64_attachment(self):
        payload = build_zepto_template_payload(
            to_phone="9876543210",
            from_phone="+919876500000",
            template_key=TEST_TEMPLATE_KEY,
            attachment_bytes=b"%PDF-1.4 demo",
            attachment_filename="ticket.pdf",
            include_base64_attachment=True,
        )
        att = payload["attachments"][0]
        self.assertEqual(att["mime_type"], "application/pdf")
        self.assertEqual(att["name"], "ticket.pdf")
        self.assertTrue(att["content"])

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
                "ZOHO_CPAAS_API_KEY": "tok",
                "ZOHO_CPAAS_WHATSAPP_FROM": "+919876500000",
                "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY": TEST_TEMPLATE_KEY,
            },
            clear=True,
        ):
            self.assertTrue(whatsapp_template_configured())

    def test_host_normalizes_to_v1_1_base(self):
        from Services.whatsapp import zepto_whatsapp_api_base

        with patch.dict(
            os.environ,
            {"ZOHO_CPAAS_HOST": "https://cpaas.zoho.com"},
            clear=True,
        ):
            self.assertEqual(zepto_whatsapp_api_base(), "https://cpaas.zoho.com/v1.1")
        with patch.dict(
            os.environ,
            {"ZOHO_CPAAS_HOST": "cpaas.zoho.in"},
            clear=True,
        ):
            self.assertEqual(zepto_whatsapp_api_base(), "https://cpaas.zoho.in/v1.1")

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
                "ZOHO_CPAAS_API_KEY": "tok",
                "ZOHO_CPAAS_WHATSAPP_FROM": "+919876500000",
                "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY": TEST_TEMPLATE_KEY,
                "ZOHO_CPAAS_HOST": "https://cpaas.zoho.com",
                "ZOHO_CPAAS_AGENT_ALIAS": "jod-agent",
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
        self.assertEqual(kwargs["headers"]["agent-alias"], "jod-agent")
        body = kwargs["json"]
        self.assertEqual(body["template_key"], TEST_TEMPLATE_KEY)
        self.assertEqual(body["merge_info"]["name"], "Krithish")
        self.assertEqual(body["merge_info"]["booking_ref"], "JOD-7C9DF206")
        self.assertTrue(set(BOOKING_TEMPLATE_MERGE_KEYS).issubset(set(body["merge_info"].keys())))

    @patch("Services.whatsapp.httpx.post")
    def test_upload_cpaas_file_returns_cache_key(self, mock_post):
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_res.text = '{"data":{"file_cache_key":"fc-ticket-123"},"message":"OK"}'
        mock_res.content = b'{"data":{"file_cache_key":"fc-ticket-123"}}'
        mock_res.json.return_value = {"data": {"file_cache_key": "fc-ticket-123"}, "message": "OK"}
        mock_post.return_value = mock_res
        pdf_bytes = b"%PDF-1.4 ticket-bytes-long-enough"
        with patch.dict(
            os.environ,
            {
                "ZOHO_CPAAS_API_KEY": "tok",
                "ZOHO_CPAAS_HOST": "https://cpaas.zoho.in",
                "ZOHO_CPAAS_AGENT_ALIAS": "jod-agent",
            },
            clear=True,
        ):
            key = upload_cpaas_file(pdf_bytes, "JOD-ABC.pdf")
        self.assertEqual(key, "fc-ticket-123")
        args, kwargs = mock_post.call_args
        self.assertTrue(str(args[0]).startswith("https://cpaas.zoho.in/v1.1/files?name="))
        self.assertIn("JOD-ABC.pdf", str(args[0]))
        self.assertEqual(kwargs["headers"]["Authorization"], "Zoho-enczapikey tok")
        self.assertEqual(kwargs["headers"]["agent-alias"], "jod-agent")
        self.assertEqual(kwargs["headers"]["Content-Type"], "application/pdf")
        self.assertEqual(kwargs["content"], pdf_bytes)
        self.assertEqual(kwargs["headers"]["Content-Length"], str(len(pdf_bytes)))

    @patch("Services.whatsapp.httpx.post")
    def test_booking_send_does_not_use_static_sample_file_key(self, mock_post):
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_res.text = '{"status":"success"}'
        mock_res.json.return_value = {"status": "success", "data": {"message_id": "mid-1"}}
        mock_post.return_value = mock_res
        with patch.dict(
            os.environ,
            {
                "ZOHO_CPAAS_API_KEY": "tok",
                "ZOHO_CPAAS_WHATSAPP_FROM": "+919876500000",
                "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY": TEST_TEMPLATE_KEY,
                "WHATSAPP_TEMPLATE_FILE_KEY": "sample-zepto-pdf-key",
            },
            clear=True,
        ):
            send_booking_confirmation_whatsapp(
                "9876543210",
                name="Guest",
                event_name="Event",
                event_date="TBA",
                ticket_type="GA",
                booking_id="abc",
            )
        body = mock_post.call_args.kwargs["json"]
        self.assertNotIn("attachment", body)
        self.assertNotIn("file_key", body)
        self.assertNotIn("file_cache_key", body)

    @patch("Services.whatsapp.httpx.post")
    def test_send_template_tries_base64_then_text(self, mock_post):
        fail = MagicMock()
        fail.status_code = 500
        fail.text = '{"error":{"code":"TM_99999"}}'
        fail.json.return_value = {"error": {"code": "TM_99999"}}
        ok = MagicMock()
        ok.status_code = 200
        ok.text = '{"status":"success"}'
        ok.json.return_value = {"status": "success", "data": {"message_id": "mid-doc"}}
        mock_post.side_effect = [fail, ok]
        with patch.dict(
            os.environ,
            {
                "ZOHO_CPAAS_API_KEY": "tok",
                "ZOHO_CPAAS_WHATSAPP_FROM": "+919876500000",
                "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY": TEST_TEMPLATE_KEY,
            },
            clear=True,
        ):
            sent, _channel, _link, message_id = send_whatsapp_template(
                "9876543210",
                merge_info={"Name": "A"},
                attachment_bytes=b"%PDF-1.4 demo",
            )
        self.assertTrue(sent)
        self.assertEqual(message_id, "mid-doc")
        self.assertEqual(mock_post.call_count, 2)
        first = mock_post.call_args_list[0].kwargs["json"]
        second = mock_post.call_args_list[1].kwargs["json"]
        self.assertIn("attachments", first)
        self.assertNotIn("attachments", second)

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
                "ZOHO_CPAAS_API_KEY": "tok",
                "ZOHO_CPAAS_WHATSAPP_FROM": "+919876500000",
                "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY": "bad-key",
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
