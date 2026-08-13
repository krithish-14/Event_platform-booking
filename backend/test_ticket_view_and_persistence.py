"""
Verification test for Ticket Viewing Page (ticket-details.html), Ticket Cancellation, and Data Persistence.
"""
from pathlib import Path
import re

def test_ticket_view_and_persistence():
    print("--- Running Ticket View & Data Persistence Verification ---")

    root = Path(__file__).parent.parent
    ticket_html_path = root / "frontend" / "ticket-details.html"
    ticket_css_path = root / "frontend" / "css" / "ticket-details.css"
    ticket_js_path = root / "frontend" / "js" / "ticket-details.js"
    orders_html_path = root / "frontend" / "orders.html"
    event_details_js_path = root / "frontend" / "js" / "event-details.js"
    bookings_api_path = root / "backend" / "APIs" / "bookings.py"
    booking_model_path = root / "backend" / "Models" / "booking.py"

    # 1. Verify Ticket Details Files Existence
    assert ticket_html_path.exists(), "frontend/ticket-details.html does not exist"
    assert ticket_css_path.exists(), "frontend/css/ticket-details.css does not exist"
    assert ticket_js_path.exists(), "frontend/js/ticket-details.js does not exist"
    print("[OK] Ticket viewing page core files exist (ticket-details.html, ticket-details.css, ticket-details.js)")

    # 2. Verify ticket-details.html elements
    ticket_html = ticket_html_path.read_text(encoding="utf-8")
    assert 'id="ticketStatusBadge"' in ticket_html, "#ticketStatusBadge missing in ticket-details.html"
    assert 'id="ticketEventTitle"' in ticket_html, "#ticketEventTitle missing"
    assert 'id="ticketEventDateTime"' in ticket_html, "#ticketEventDateTime missing"
    assert 'id="ticketEventVenue"' in ticket_html, "#ticketEventVenue missing"
    assert 'id="ticketIdVal"' in ticket_html, "#ticketIdVal missing"
    assert 'id="ticketCategoryVal"' in ticket_html, "#ticketCategoryVal missing"
    assert 'id="ticketCountVal"' in ticket_html, "#ticketCountVal missing"
    assert 'id="ticketBookedTimeVal"' in ticket_html, "#ticketBookedTimeVal missing"
    assert 'id="ticketSeatVal"' in ticket_html, "#ticketSeatVal missing"
    assert 'id="ticketStatusVal"' in ticket_html, "#ticketStatusVal missing"
    assert 'id="billUnitPrice"' in ticket_html, "#billUnitPrice missing"
    assert 'id="billPaymentId"' in ticket_html, "#billPaymentId missing"
    assert 'id="billPaymentMode"' in ticket_html, "#billPaymentMode missing"
    assert 'id="billGst"' in ticket_html, "#billGst missing"
    assert 'id="billTotal"' in ticket_html, "#billTotal missing"
    assert 'id="receiverName"' in ticket_html, "#receiverName missing"
    assert 'id="receiverEmail"' in ticket_html, "#receiverEmail missing"
    assert 'id="receiverPhone"' in ticket_html, "#receiverPhone missing"
    assert 'id="ticketQrCodeImg"' in ticket_html, "#ticketQrCodeImg QR code element missing"
    assert 'id="btnDownloadTicket"' in ticket_html, "#btnDownloadTicket action button missing"
    assert 'id="btnDownloadInvoice"' in ticket_html, "#btnDownloadInvoice action button missing"
    assert 'id="btnCancelTicket"' in ticket_html, "#btnCancelTicket action button missing"
    print("[OK] ticket-details.html contains all required ticket breakdown, bill summary, receiver, QR code, and action controls")

    # 3. Verify orders.html navigation & persistence cache
    orders_html = orders_html_path.read_text(encoding="utf-8")
    assert 'ticket-details.html?id=' in orders_html, "orders.html order cards do not link to ticket-details.html"
    assert 'getLocalBookingsCache' in orders_html, "orders.html local cache fallback missing"
    assert 'saveLocalBookingsCache' in orders_html, "orders.html local cache persistence missing"
    print("[OK] orders.html links order cards to ticket-details.html and uses dual-cache persistence")

    # 4. Verify event-details.js local backup caching
    ed_js = event_details_js_path.read_text(encoding="utf-8")
    assert 'jod_user_bookings' in ed_js, "event-details.js missing jod_user_bookings local backup cache"
    print("[OK] event-details.js caches newly created bookings into jod_user_bookings")

    # 5. Verify backend Model & API endpoints
    booking_model = booking_model_path.read_text(encoding="utf-8")
    assert 'payment_id' in booking_model, "payment_id column missing in Booking model"
    assert 'payment_mode' in booking_model, "payment_mode column missing in Booking model"
    assert 'gst_amount' in booking_model, "gst_amount column missing in Booking model"
    assert 'seat_number' in booking_model, "seat_number column missing in Booking model"
    assert 'receiver_name' in booking_model, "receiver_name column missing in Booking model"

    bookings_api = bookings_api_path.read_text(encoding="utf-8")
    assert 'get_single_booking' in bookings_api, "get_single_booking GET /{booking_id} route missing in bookings.py"
    assert 'cancel_booking' in bookings_api, "cancel_booking POST /{booking_id}/cancel route missing in bookings.py"
    print("[OK] Backend Booking model and FastAPI endpoints for single ticket viewing and cancellation are present")

    print("\nALL TICKET VIEWING, CANCELLATION & PERSISTENCE CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_ticket_view_and_persistence()
