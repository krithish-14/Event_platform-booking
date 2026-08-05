"""
Test script for customer_id, auth, and booking workflow.
"""

import os
import sys

# Ensure backend folder is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from Models.base import create_tables, get_session_factory
from Models.user import User
from Models.event import Event
from Models.booking import Booking
from Services.auth_service import get_password_hash
from Authentication.jwt_handler import create_access_token, decode_access_token
from APIs.auth import _serialize_user

def test_full_workflow():
    print("--- STEP 1: Creating database tables & running migrations ---")
    create_tables()
    
    SessionLocal = get_session_factory()
    db = SessionLocal()
    
    try:
        print("\n--- STEP 2: Verifying existing users have backfilled customer_id ---")
        users = db.query(User).all()
        for u in users:
            print(f"User: id={u.id}, customer_id={u.customer_id}, email={u.email}")
            assert u.customer_id is not None and u.customer_id.startswith("CUST-"), f"User {u.email} missing valid CUST-<number> customer_id!"
        
        print("\n--- STEP 3: Creating a new user ---")
        test_email = "test_cust_user@example.com"
        existing = db.query(User).filter(User.email == test_email).first()
        if existing:
            db.delete(existing)
            db.commit()

        new_user = User(
            email=test_email,
            username="test_cust_user",
            full_name="Test Customer User",
            hashed_password=get_password_hash("Password123!"),
            city="Chennai"
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        print(f"Created New User: customer_id={new_user.customer_id}, id={new_user.id}")
        assert new_user.customer_id.startswith("CUST-")

        print("\n--- STEP 4: Creating JWT token with customer_id, email & username payload ---")
        token = create_access_token({
            "sub": str(new_user.customer_id),
            "customer_id": str(new_user.customer_id),
            "email": new_user.email,
            "username": new_user.username,
        })
        payload = decode_access_token(token)
        print(f"Decoded token payload: {payload}")
        assert payload.get("customer_id") == new_user.customer_id
        assert payload.get("email") == new_user.email
        assert payload.get("username") == new_user.username


        print("\n--- STEP 5: Creating a Ticket Booking for User ---")
        event = db.query(Event).first()
        assert event is not None, "No demo event found!"
        
        booking = Booking(
            customer_id=new_user.customer_id,
            event_id=event.id,
            ticket_type="Gold VIP",
            quantity=2,
            total_price=event.price * 2,
            status="CONFIRMED"
        )
        db.add(booking)
        db.commit()
        db.refresh(booking)
        print(f"Created Booking: booking_id={booking.booking_id}, customer_id={booking.customer_id}, event={event.title}, total=INR {booking.total_price}")


        print("\n--- STEP 6: Verifying Host Tracking Query ---")
        host_bookings = db.query(Booking).filter(Booking.customer_id == new_user.customer_id).all()
        assert len(host_bookings) > 0
        print(f"Host Tracking confirmed {len(host_bookings)} bookings for Customer ID {new_user.customer_id}!")

        print("\nALL TESTS PASSED SUCCESSFULLY!")

    finally:
        db.close()

if __name__ == "__main__":
    test_full_workflow()
