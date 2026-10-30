"""
Movie booking for approved theatre partners.

CinemaScreen   seat layout of one auditorium (grid of seats, aisles and gaps).
CinemaMovie    a film the theatre is screening.
CinemaShow     one screening: screen + movie + start time + price per seat category.
CinemaShowSeat one row per held/booked seat; (show_id, seat_id) is unique, so two
               people can never hold or book the same seat at the same time.
CinemaBooking  a customer's seats for one show, from hold through payment.

No foreign keys to legacy tables (types differ between live and local databases);
links between these new tables use plain UUID columns plus application checks.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint

from Models.base import Base, GUID


class CinemaScreen(Base):
    __tablename__ = "cinema_screens"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    partner_id = Column(GUID, nullable=False, index=True)
    name = Column(String(60), nullable=False)
    screen_format = Column(String(20), nullable=True, default="2D")
    # {"rows", "cols", "screen": "top"|"bottom", "numbering": "ltr"|"rtl",
    #  "categories": [{"id","name","color"}], "cells": [[category_id or null, ...], ...]}
    layout_json = Column(Text, nullable=True)
    seat_count = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)


class CinemaMovie(Base):
    __tablename__ = "cinema_movies"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    partner_id = Column(GUID, nullable=False, index=True)
    title = Column(String(200), nullable=False)
    language = Column(String(40), nullable=False)
    certificate = Column(String(10), nullable=True)
    duration_min = Column(Integer, nullable=False)
    genres = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    poster_url = Column(String(500), nullable=True)
    release_date = Column(String(10), nullable=True)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)


class CinemaShow(Base):
    __tablename__ = "cinema_shows"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    partner_id = Column(GUID, nullable=False, index=True)
    screen_id = Column(GUID, nullable=False, index=True)
    movie_id = Column(GUID, nullable=False, index=True)
    starts_at = Column(DateTime, nullable=False, index=True)  # UTC
    ends_at = Column(DateTime, nullable=False)  # UTC, starts_at + runtime
    # {"category_id": price_in_rupees}
    prices_json = Column(Text, nullable=False)
    # Screen layout frozen when the show is created, so later edits never move booked seats.
    layout_json = Column(Text, nullable=False)
    seat_count = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="scheduled", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)


class CinemaShowSeat(Base):
    __tablename__ = "cinema_show_seats"
    __table_args__ = (UniqueConstraint("show_id", "seat_id", name="uq_cinema_show_seat"),)

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    show_id = Column(GUID, nullable=False, index=True)
    seat_id = Column(String(12), nullable=False)
    booking_id = Column(GUID, nullable=False, index=True)
    status = Column(String(10), nullable=False, default="held")  # held | booked
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)


class CinemaBooking(Base):
    __tablename__ = "cinema_bookings"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    booking_code = Column(String(20), nullable=False, unique=True, index=True)
    show_id = Column(GUID, nullable=False, index=True)
    partner_id = Column(GUID, nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    name = Column(String(200), nullable=True)
    phone = Column(String(20), nullable=True)
    seats_json = Column(Text, nullable=False)  # [{"id": "A5", "category": "prime", "price": 250}]
    seat_count = Column(Integer, nullable=False, default=0)
    amount_paise = Column(Integer, nullable=False, default=0)
    platform_fee_paise = Column(Integer, nullable=False, default=0)
    gst_paise = Column(Integer, nullable=False, default=0)
    payout_paise = Column(Integer, nullable=False, default=0)
    # held | confirmed | expired | released | payment_conflict
    status = Column(String(20), nullable=False, default="held", index=True)
    hold_expires_at = Column(DateTime, nullable=True)
    razorpay_order_id = Column(String(120), nullable=True, index=True)
    razorpay_payment_id = Column(String(120), nullable=True)
    qr_token = Column(String(64), nullable=True, unique=True, index=True)
    confirmed_at = Column(DateTime, nullable=True)
    checked_in_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
