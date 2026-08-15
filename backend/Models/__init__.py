"""
Models package initialization — exports all 22 integrated SQLAlchemy models.
"""

from Models.base import Base, get_db, get_engine, get_session_factory, create_tables
from Models.user import User
from Models.event import Event
from Models.booking import Booking
from Models.ticket import Ticket
from Models.email_otp import EmailOTP
from Models.organizer_accounts import OrganizerAccount
from Models.event_management import EventManagement
from Models.event_design import EventDesign
from Models.event_registration_forms import EventRegistrationForm
from Models.event_registration_settings import EventRegistrationSetting
from Models.event_registration_tickets import EventRegistrationTicket
from Models.event_registrations import EventRegistration
from Models.event_communications import EventCommunication
from Models.event_attendance_checkins import EventAttendanceCheckin
from Models.event_entry_gates import EventEntryGate
from Models.event_staff_scanners import EventStaffScanner
from Models.exhibitors import Exhibitor
from Models.form_definitions import FormDefinition
from Models.form_submissions import FormSubmission
from Models.host_registration_logs import HostRegistrationLog
from Models.user_signups import UserSignup
from Models.user_logins import UserLogin
from Models.wishlist import WishlistItem

__all__ = [
    "Base",
    "get_db",
    "get_engine",
    "get_session_factory",
    "create_tables",
    "User",
    "Event",
    "Booking",
    "Ticket",
    "EmailOTP",
    "OrganizerAccount",
    "EventManagement",
    "EventDesign",
    "EventRegistrationForm",
    "EventRegistrationSetting",
    "EventRegistrationTicket",
    "EventRegistration",
    "EventCommunication",
    "EventAttendanceCheckin",
    "EventEntryGate",
    "EventStaffScanner",
    "Exhibitor",
    "FormDefinition",
    "FormSubmission",
    "HostRegistrationLog",
    "UserSignup",
    "UserLogin",
    "WishlistItem",
]
