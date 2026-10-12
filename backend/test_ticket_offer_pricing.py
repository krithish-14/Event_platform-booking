"""Ticket offer pricing. No database and no Razorpay calls."""
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from Services.ticket_pricing import (
    PriceQuote,
    assert_client_amount,
    normalize_offer,
    paise_to_rupees,
    quote_offer,
    rupees_to_paise,
)

IST = ZoneInfo("Asia/Kolkata")


def offer(**kwargs):
    base = {
        "offer_id": "offer-1",
        "name": "Early Bird",
        "pricing_type": "per_person",
        "unit_price": 499,
        "price": 499,
        "is_active": True,
        "max_per_order": 20,
    }
    base.update(kwargs)
    return base


class TicketOfferPricingTests(unittest.TestCase):
    def test_two_early_bird_tickets(self):
        quote = quote_offer(offer(), 2)
        self.assertEqual(quote.total_paise, 99800)
        self.assertEqual(quote.attendee_count, 2)
        self.assertEqual(paise_to_rupees(quote.total_paise), 998)

    def test_five_early_bird_tickets(self):
        quote = quote_offer(offer(), 5)
        self.assertEqual(quote.total_paise, 249500)
        self.assertEqual(quote.attendee_count, 5)

    def test_five_general_admission_tickets(self):
        quote = quote_offer(offer(name="General Admission", unit_price=599, price=599), 5)
        self.assertEqual(quote.total_paise, 299500)
        self.assertEqual(quote.attendee_count, 5)

    def test_one_group_of_three(self):
        quote = quote_offer(offer(
            name="Group of 3",
            pricing_type="package",
            package_quantity=3,
            package_price=1299,
            price=1299,
        ), 1)
        self.assertEqual(quote.total_paise, 129900)
        self.assertEqual(quote.purchase_quantity, 1)
        self.assertEqual(quote.attendee_count, 3)

    def test_two_group_of_three(self):
        quote = quote_offer(offer(
            name="Group of 3",
            pricing_type="package",
            package_quantity=3,
            package_price=1299,
        ), 2)
        self.assertEqual(quote.total_paise, 259800)
        self.assertEqual(quote.attendee_count, 6)

    def test_one_group_of_six(self):
        quote = quote_offer(offer(
            name="Group of 6",
            pricing_type="package",
            package_quantity=6,
            package_price=2499,
        ), 1)
        self.assertEqual(quote.total_paise, 249900)
        self.assertEqual(quote.attendee_count, 6)

    def test_one_group_of_ten(self):
        quote = quote_offer(offer(
            name="Group of 10",
            pricing_type="package",
            package_quantity=10,
            package_price=3999,
        ), 1)
        self.assertEqual(quote.total_paise, 399900)
        self.assertEqual(quote.attendee_count, 10)

    def test_invalid_quantity_inactive_and_expired(self):
        with self.assertRaises(HTTPException):
            quote_offer(offer(), 0)
        with self.assertRaises(HTTPException):
            quote_offer(offer(is_active=False), 1)
        with self.assertRaises(HTTPException):
            quote_offer(offer(max_per_order=2), 3)
        ended = offer(sales_end="2020-01-01T00:00:00+05:30")
        with self.assertRaises(HTTPException):
            quote_offer(ended, 1, now=datetime(2020, 1, 2, tzinfo=IST))

    def test_negative_price_rejected(self):
        with self.assertRaises(HTTPException):
            normalize_offer({"name": "Bad", "pricing_type": "per_person", "unit_price": -1})
        with self.assertRaises(HTTPException):
            normalize_offer({
                "name": "Bad package",
                "pricing_type": "package",
                "package_quantity": 1,
                "package_price": 100,
            })

    def test_client_amount_cannot_override_the_server_total(self):
        quote = quote_offer(offer(), 2)
        assert_client_amount(quote, 998)
        with self.assertRaises(HTTPException):
            assert_client_amount(quote, 1)

    def test_razorpay_paise(self):
        self.assertEqual(rupees_to_paise(499) * 2, 99800)
        self.assertEqual(rupees_to_paise("2499.00"), 249900)

    def test_historical_quote_is_a_snapshot(self):
        row = offer()
        quote = quote_offer(row, 2)
        row["unit_price"] = 1
        row["price"] = 1
        self.assertEqual(quote.total_paise, 99800)
        self.assertIsInstance(quote, PriceQuote)

    def test_legacy_percent_is_not_applied_to_typed_offers(self):
        typed = quote_offer(offer(), 5, legacy_percent=50)
        self.assertEqual(typed.total_paise, 249500)
        legacy = quote_offer({"name": "Old", "price": 100, "offer_id": "old"}, 4, legacy_percent=10)
        self.assertTrue(legacy.legacy)
        self.assertEqual(legacy.total_paise, 36000)

    def test_group_package_issues_one_ticket_per_person(self):
        from Services.ticket_pricing import seats_for_offer
        group3 = {"pricing_type": "package", "package_quantity": 3}
        group6 = {"pricing_type": "package", "package_quantity": 6}
        person = {"pricing_type": "per_person"}
        self.assertEqual(seats_for_offer(person, stored_quantity=1), 1)
        self.assertEqual(seats_for_offer(person, stored_quantity=3, attendee_count=3), 3)
        self.assertEqual(seats_for_offer(person, stored_quantity=6), 6)
        group10 = {"pricing_type": "package", "package_quantity": 10}
        group15 = {"pricing_type": "package", "package_quantity": 15}
        self.assertEqual(seats_for_offer(group3, stored_quantity=1), 3)
        self.assertEqual(seats_for_offer(group6, stored_quantity=1), 6)
        self.assertEqual(seats_for_offer(group10, stored_quantity=1), 10)
        self.assertEqual(seats_for_offer(group15, stored_quantity=1), 15)
        self.assertEqual(seats_for_offer(group10, stored_quantity=10, attendee_count=10, purchase_quantity=1), 10)
        self.assertEqual(seats_for_offer(group10, stored_quantity=1, purchase_quantity=2), 20)
        self.assertEqual(seats_for_offer(person, stored_quantity=10, attendee_count=10), 10)
        self.assertEqual(seats_for_offer(person, stored_quantity=12), 12)
        self.assertEqual(seats_for_offer(group3, stored_quantity=1, purchase_quantity=2), 6)
        self.assertEqual(seats_for_offer(group3, stored_quantity=3, attendee_count=3, purchase_quantity=1), 3)
        self.assertEqual(seats_for_offer(group3, stored_quantity=6), 6)
        self.assertEqual(seats_for_offer(None, stored_quantity=1), 1)
        with self.assertRaises(Exception):
            quote_offer(person, 0)

    def test_combined_pdf_page_count_matches_ticket_count(self):
        from Services.ticket_pdf import _assemble_pdf_from_page_chunks, pdf_page_count
        for count in (1, 3, 6, 10, 15):
            chunks = [{"ops": ["BT ET"], "xobjects": {}} for _ in range(count)]
            pdf = _assemble_pdf_from_page_chunks(chunks)
            self.assertTrue(pdf.startswith(b"%PDF"))
            self.assertEqual(pdf_page_count(pdf), count)

    def test_package_pdf_names_buyer_then_guests(self):
        from Services.ticket_pdf import attendee_display_name
        self.assertEqual(attendee_display_name("Krithish B R", 0), "Krithish B R")
        self.assertEqual(attendee_display_name("Krithish B R", 1), "Krithish B R (Guest)")
        self.assertEqual(attendee_display_name("Krithish B R", 2), "Krithish B R (Guest)")
        self.assertEqual(attendee_display_name("Krithish B R", 9), "Krithish B R (Guest)")

    def test_ticket_name_comes_from_the_form(self):
        from Services.ticket_pdf import registration_contact, ticket_attendee_name
        self.assertEqual(ticket_attendee_name("Form Asha", "Profile Asha"), "Form Asha")
        self.assertEqual(ticket_attendee_name("", "Saved Asha"), "Saved Asha")
        self.assertEqual(ticket_attendee_name("", ""), "Guest")
        name, email, phone = registration_contact(
            "Form Asha",
            "asha@example.com",
            "9000000000",
            "Profile Asha",
            "profile@example.com",
            "9111111111",
        )
        self.assertEqual((name, email, phone), ("Form Asha", "asha@example.com", "9000000000"))

    def test_canvas_pdf_uses_host_element_positions(self):
        from Services.ticket_pdf import (
            build_mticket_pdf_bytes,
            canvas_element_box,
            canvas_page_metrics,
        )
        x, y, w, h = canvas_element_box({"x": 10, "y": 20, "w": 40, "h": 10}, 0, 0, 200, 400)
        self.assertEqual((round(x, 1), round(y, 1), round(w, 1), round(h, 1)), (20.0, 280.0, 80.0, 40.0))
        midnight_w, midnight_h, *_rest = canvas_page_metrics("midnight")
        self.assertGreater(midnight_w, midnight_h)
        classic_w, classic_h, *_rest = canvas_page_metrics("classic")
        self.assertGreater(classic_h, classic_w)
        pdf = build_mticket_pdf_bytes(
            booking_id="abc",
            event_name="Canvas Workshop",
            ticket_layout={
                "template_id": "midnight",
                "event_id": "11111111-1111-1111-1111-111111111111",
                "canvas_elements": [
                    {"id": "title", "type": "title", "x": 4, "y": 13, "w": 46, "h": 7},
                    {"id": "name", "type": "name", "x": 4, "y": 21, "w": 40, "h": 12},
                ],
                "show_qr": False,
                "show_jod_logo": False,
            },
            include_qr=False,
            attendee_name="Form Asha",
        )
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertIn(b"/MediaBox [0 0 842.0 595.0]", pdf)
        self.assertIn(b"Canvas Workshop", pdf)
        self.assertIn(b"Form Asha", pdf)

    def test_canvas_pdf_keeps_full_name_email_and_guest_label(self):
        from Services.ticket_pdf import _split_to_width, build_mticket_pdf_bytes
        email = "satheesh.m1912@gmail.com"
        lines = _split_to_width(email, 12)
        self.assertEqual("".join(lines), email)
        pdf = build_mticket_pdf_bytes(
            booking_id="8c087eb7",
            event_name="Full Stack",
            venue="Lakshmi bhavan Sundaram Avenue, Anna Salai, Thousand Lights, Chennai, Tamil Nadu",
            ticket_type="General Pass Group of 3",
            ticket_layout={
                "template_id": "classic",
                "canvas_elements": [
                    {"id": "name", "type": "name", "x": 7, "y": 45, "w": 40, "h": 6},
                    {"id": "email", "type": "email", "x": 7, "y": 55, "w": 40, "h": 6},
                    {"id": "venue", "type": "venue", "x": 28, "y": 16, "w": 50, "h": 10},
                    {"id": "ticket_type", "type": "ticket_type", "x": 20, "y": 33, "w": 50, "h": 6},
                ],
                "show_qr": False,
                "show_jod_logo": False,
            },
            include_qr=False,
            attendee_name="SATHEESHKUMAR M",
            attendee_email=email,
            attendee_guest_label="Guest",
        )
        self.assertIn(b"SATHEESHKUMAR M", pdf)
        self.assertIn(b"\\(Guest\\)", pdf)
        self.assertIn(b"satheesh.m1912@gmail.com", pdf)
        self.assertIn(b"Tamil Nadu", pdf)
        self.assertIn(b"Group of 3", pdf)

    def test_ticket_layout_cannot_belong_to_another_event(self):
        from Services.ticket_pdf import layout_belongs_to_event
        this_event = "11111111-1111-1111-1111-111111111111"
        other_event = "22222222-2222-2222-2222-222222222222"
        self.assertTrue(layout_belongs_to_event({"event_id": this_event}, this_event))
        self.assertTrue(layout_belongs_to_event({"event_id": this_event.replace("-", "")}, this_event))
        self.assertFalse(layout_belongs_to_event({"event_id": other_event}, this_event))
        self.assertFalse(layout_belongs_to_event({"template_id": "classic"}, this_event))
        self.assertFalse(layout_belongs_to_event(None, this_event))

    def test_blank_max_per_order_does_not_cap_quantity(self):
        row = offer()
        row.pop("max_per_order")
        quote = quote_offer(row, 25)
        self.assertEqual(quote.total_paise, 499 * 100 * 25)
        self.assertEqual(quote.attendee_count, 25)
        saved = normalize_offer({"name": "General", "pricing_type": "per_person", "unit_price": 599, "max_per_order": ""})
        self.assertNotIn("max_per_order", saved)

    def test_date_only_end_is_exclusive_next_midnight_ist(self):
        row = offer(sales_start="2026-10-12", sales_end="2026-10-20")
        quote_offer(row, 1, now=datetime(2026, 10, 20, 23, 30, tzinfo=IST))
        with self.assertRaises(HTTPException):
            quote_offer(row, 1, now=datetime(2026, 10, 21, 0, 0, tzinfo=IST))
        with self.assertRaises(HTTPException):
            quote_offer(row, 1, now=datetime(2026, 10, 11, 23, 0, tzinfo=IST))


if __name__ == "__main__":
    unittest.main()
