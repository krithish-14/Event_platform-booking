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


if __name__ == "__main__":
    unittest.main()
