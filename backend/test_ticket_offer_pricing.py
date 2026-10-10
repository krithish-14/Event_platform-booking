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

    def test_package_pdf_names_buyer_then_guests(self):
        from Services.ticket_pdf import attendee_display_name
        self.assertEqual(attendee_display_name("Asha", 0), "Asha")
        self.assertEqual(attendee_display_name("Asha", 1), "Asha (guest)")
        self.assertEqual(attendee_display_name("Asha", 2), "Asha (guest)")

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
