"""
Verification test suite for JOD Events Secure QR Ticket System.
Tests Ticket creation, cryptographically secure token generation, verification API,
atomic gate check-in, double check-in prevention, and cancellation logic.
"""

from pathlib import Path
import uuid
import secrets
from datetime import datetime

from Models.base import get_session_factory, create_tables
from Models.user import User
from Models.event import Event
from Models.booking import Booking
from Models.ticket import Ticket, generate_qr_token
from APIs.tickets import verify_ticket_token, checkin_ticket_entry, TokenVerificationRequest, TokenCheckinRequest
from APIs.bookings import cancel_booking, _serialize_booking


def test_qr_ticket_system():
    print("=== RUNNING JOD EVENTS SECURE QR TICKET SYSTEM TESTS ===")

    # 1. Initialize Tables & DB Session
    create_tables()
    SessionLocal = get_session_factory()
    db = SessionLocal()

    try:
        # 2. Setup Test Data (User & Event)
        cust_id = f"CUST-TEST-{random_int()}"
        user = User(
            customer_id=cust_id,
            email=f"testuser_{random_int()}@jodevents.com",
            username=f"testuser_{random_int()}",
            full_name="Test Ticket Customer",
            hashed_password="dummy_hash_pass",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        event = Event(
            title="Chennai Tech & AI Expo 2026",
            description="Leading AI and Technology conference",
            location="Trade Centre, Nandambakkam, Chennai",
            venue="Chennai Trade Centre",
            start_date=datetime(2026, 9, 20, 10, 0),
            price=1500.0,
            organizer_id=user.id,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        # 3. Create Booking & Associated Tickets
        booking = Booking(
            customer_id=user.customer_id,
            event_id=event.id,
            ticket_type="VIP Executive Pass",
            quantity=2,
            total_price=3000.0,
            status="CONFIRMED",
            seat_number="Row A, Seat 10-11",
            receiver_name="Test Ticket Customer",
            receiver_email=user.email,
        )
        db.add(booking)
        db.commit()
        db.refresh(booking)

        # Create 2 individual Ticket records
        t1_token = generate_qr_token()
        t2_token = generate_qr_token()

        assert t1_token.startswith("JOD-TKT-"), "QR token must start with JOD-TKT-"
        assert t2_token.startswith("JOD-TKT-"), "QR token must start with JOD-TKT-"
        assert t1_token != t2_token, "QR tokens must be unique per ticket"

        t1 = Ticket(
            booking_id=booking.booking_id,
            event_id=event.id,
            customer_id=user.customer_id,
            ticket_type=booking.ticket_type,
            seat_number="Row A, Seat 10",
            qr_token=t1_token,
            ticket_status="VALID",
        )
        t2 = Ticket(
            booking_id=booking.booking_id,
            event_id=event.id,
            customer_id=user.customer_id,
            ticket_type=booking.ticket_type,
            seat_number="Row A, Seat 11",
            qr_token=t2_token,
            ticket_status="VALID",
        )
        db.add_all([t1, t2])
        db.commit()

        print("[OK] Booking & 2 Ticket records created with secure QR tokens (JOD-TKT-...)")

        # 4. Test Verification Endpoint (/api/tickets/verify)
        verify_req = TokenVerificationRequest(qr_token=t1_token)
        v_res = verify_ticket_token(verify_req, db=db)

        assert v_res["valid"] is True, f"Expected valid=True, got {v_res}"
        assert v_res["status"] == "VALID", f"Expected status=VALID, got {v_res['status']}"
        assert v_res["event"] == "Chennai Tech & AI Expo 2026"
        assert v_res["ticket_type"] == "VIP Executive Pass"
        assert v_res["customer_name"] == "Test Ticket Customer"
        print("[OK] POST /api/tickets/verify correctly validates valid ticket token")

        # 5. Test Gate Check-in Endpoint (/api/tickets/checkin) — First Scan
        checkin_req = TokenCheckinRequest(qr_token=t1_token, scanned_by="Gate Staff #1")
        c_res = checkin_ticket_entry(checkin_req, db=db, current_user=user)

        assert c_res["valid"] is True, f"Expected checkin valid=True, got {c_res}"
        assert c_res["status"] == "USED", f"Expected status=USED, got {c_res['status']}"
        assert c_res["scanned_by"] == "Gate Staff #1"
        assert c_res["used_at"] is not None
        print("[OK] POST /api/tickets/checkin successfully marks ticket as USED with timestamp & staff ID")

        # 6. Test Double Check-in Prevention (Second Scan of Same Ticket)
        c_res_2 = checkin_ticket_entry(checkin_req, db=db, current_user=user)
        assert c_res_2["valid"] is False, "Second check-in must NOT succeed"
        assert c_res_2["status"] == "ALREADY_USED", f"Expected ALREADY_USED, got {c_res_2['status']}"
        print("[OK] Atomic check-in prevents double entry — Second scan returned ALREADY_USED")

        # 7. Test Verification of Already Used Ticket
        v_res_used = verify_ticket_token(verify_req, db=db)
        assert v_res_used["valid"] is False
        assert v_res_used["status"] == "ALREADY_USED"
        print("[OK] Verification endpoint flags ALREADY_USED tickets")

        # 8. Test Cancellation of Ticket 2
        cancel_booking(str(booking.booking_id), db=db, current_user=user)
        
        v_res_cancelled = verify_ticket_token(TokenVerificationRequest(qr_token=t2_token), db=db)
        assert v_res_cancelled["valid"] is False
        assert v_res_cancelled["status"] == "CANCELLED"
        print("[OK] Cancelled booking invalidates associated QR tickets (status=CANCELLED)")

        # 9. Verify Frontend Scanner & Ticket Details files
        root = Path(__file__).parent.parent
        scanner_html = root / "frontend" / "scanner.html"
        scanner_js = root / "frontend" / "js" / "scanner.js"
        ticket_html = root / "frontend" / "ticket-details.html"
        ticket_js = root / "frontend" / "js" / "ticket-details.js"

        assert scanner_html.exists(), "frontend/scanner.html missing"
        assert scanner_js.exists(), "frontend/js/scanner.js missing"
        assert ticket_html.exists(), "frontend/ticket-details.html missing"
        assert ticket_js.exists(), "frontend/js/ticket-details.js missing"
        print("[OK] All required Staff Scanner & E-Ticket frontend files exist")

        print("\nALL SECURE QR TICKET SYSTEM TESTS PASSED SUCCESSFULLY!")

    finally:
        db.close()


def random_int():
    return secrets.randbelow(899999) + 100000


if __name__ == "__main__":
    test_qr_ticket_system()
