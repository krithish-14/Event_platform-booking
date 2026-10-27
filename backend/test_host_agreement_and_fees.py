"""Host fee math and the agreement acceptance record. No database or network calls."""
import unittest
from datetime import datetime
from types import SimpleNamespace

from APIs.host_events_api import _host_ticket_fee_breakdown
from Services.host_agreement import (
    HOST_AGREEMENT_ACCEPT_TEXT,
    HOST_AGREEMENT_VERSION,
    agreement_record_filename,
    agreement_record_payload,
    build_agreement_record_pdf_bytes,
)


def booking(total, qty=1, ticket_type="General"):
    return SimpleNamespace(total_price=total, quantity=qty, ticket_type=ticket_type)


class HostFeeTests(unittest.TestCase):
    def test_gst_is_charged_on_platform_fee_only(self):
        fees = _host_ticket_fee_breakdown([booking(100000, qty=100)])
        self.assertEqual(fees["gross"], 100000)
        self.assertEqual(fees["platform_fee"], 5000)
        self.assertEqual(fees["gst_fee"], 900)
        self.assertEqual(fees["net"], 94100)
        self.assertEqual(fees["gst_fee_basis"], "platform_fee")

    def test_single_ticket_matches_dashboard_calculator(self):
        fees = _host_ticket_fee_breakdown([booking(1000)])
        self.assertEqual(fees["platform_fee"], 50)
        self.assertEqual(fees["gst_fee"], 9)
        self.assertEqual(fees["net"], 941)


def host_account(**overrides):
    base = dict(
        accepted_agreement=True,
        org_name="Sample Events LLP",
        contact_full_name="Sample Host",
        email="host@example.com",
        agreement_accepted_email="host@example.com",
        host_id="HST-123456",
        customer_id="CUST-123456",
        agreement_version=HOST_AGREEMENT_VERSION,
        agreement_accept_text=HOST_AGREEMENT_ACCEPT_TEXT,
        agreement_accepted_at=datetime(2026, 10, 27, 7, 30, 0),
        agreement_otp_verified_at=datetime(2026, 10, 27, 7, 10, 0),
        agreement_accept_ip="203.0.113.10",
        agreement_accept_user_agent="Chrome",
        agreement_acceptance_ref="ACC-20261027-ABCD1234",
        status="submitted",
        verified_at=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class AgreementRecordTests(unittest.TestCase):
    def test_payload_reports_recorded_fields(self):
        record = agreement_record_payload(host_account())
        self.assertTrue(record["accepted"])
        self.assertEqual(record["agreement_version"], HOST_AGREEMENT_VERSION)
        self.assertEqual(record["accepted_at_utc"], "2026-10-27T07:30:00Z")
        self.assertEqual(record["ip_address"], "203.0.113.10")
        self.assertEqual(record["jod_approval"], "Pending review")

    def test_unstamped_account_is_not_accepted(self):
        record = agreement_record_payload(host_account(agreement_accepted_at=None))
        self.assertFalse(record["accepted"])

    def test_approved_host_pdf_says_approved(self):
        acc = host_account(status="verified", verified_at=datetime(2026, 10, 28, 9, 15, 0))
        record = agreement_record_payload(acc)
        self.assertTrue(record["approved"])
        self.assertEqual(record["approved_at_utc"], "2026-10-28T09:15:00Z")
        pdf = build_agreement_record_pdf_bytes(acc)
        self.assertIn(b"(Approved) Tj", pdf)
        self.assertIn(b"28 Oct 2026, 09:15:00 UTC", pdf)
        self.assertNotIn(b"(Accepted) Tj", pdf)

    def test_pending_host_pdf_is_not_marked_approved(self):
        pdf = build_agreement_record_pdf_bytes(host_account())
        self.assertIn(b"(Pending approval) Tj", pdf)
        self.assertNotIn(b"(Approved) Tj", pdf)

    def test_pdf_contains_reference_and_version(self):
        pdf = build_agreement_record_pdf_bytes(host_account())
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertIn(b"ACC-20261027-ABCD1234", pdf)
        self.assertIn(HOST_AGREEMENT_VERSION.encode(), pdf)
        self.assertIn(b"203.0.113.10", pdf)
        self.assertEqual(
            agreement_record_filename(agreement_record_payload(host_account())),
            "JOD-Host-Agreement-Acceptance-ACC-20261027-ABCD1234.pdf",
        )


class EticketDefaultDesignTests(unittest.TestCase):
    def test_eticket_style_survives_save_and_prints_total_amount(self):
        from Services.ticket_pdf import build_mticket_pdf_bytes
        from Services.ticket_templates import normalize_ticket_layout

        raw = {
            "canvas_mode": "custom",
            "orientation": "portrait",
            "card_style": "eticket",
            "frame": "reference",
            "layout_version": 11,
            "card_color": "#ffffff",
            "show_price": True,
            "show_attendee_name": True,
            "canvas_elements": [
                {"id": "title", "type": "title", "x": 28, "y": 3, "w": 60, "h": 6},
                {"id": "stub", "type": "stub", "x": 92, "y": 3, "w": 5, "h": 16, "text": "E-TICKET"},
                {"id": "name", "type": "name", "x": 22, "y": 41, "w": 56, "h": 4},
                {"id": "price", "type": "price", "x": 6, "y": 85, "w": 88, "h": 5},
                {"id": "jod_logo", "type": "jod_logo", "x": 35, "y": 92, "w": 30, "h": 7},
            ],
        }
        out = normalize_ticket_layout(raw, is_premium=True)
        self.assertEqual(out.get("card_style"), "eticket")
        self.assertEqual(out["orientation"], "portrait")
        plain = normalize_ticket_layout(dict(raw, card_style="fancy"), is_premium=True)
        self.assertNotIn("card_style", plain)

        pdf = build_mticket_pdf_bytes(
            booking_id="book-12345",
            event_name="Run Marathon",
            event_date="Wed, Sep 16, 2026, 06:30 AM",
            venue="Chennai",
            ticket_type="General Pass",
            ticket_layout=out,
            include_qr=False,
            attendee_name="Attendee Name",
            total_price=499,
        )
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertIn(b"/MediaBox [0 0 570.0 760.0]", pdf)
        self.assertIn(b"Total Amount", pdf)
        self.assertIn(b"E-TICKET", pdf)


if __name__ == "__main__":
    unittest.main()
