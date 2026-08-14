"""initial_integrated_schema

Revision ID: 001_initial_integrated_schema
Revises: 
Create Date: 2026-08-13 11:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '001_initial_integrated_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. users
    op.create_table(
        'users',
        sa.Column('customer_id', sa.String(length=50), nullable=False),
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('username', sa.String(length=100), nullable=False),
        sa.Column('full_name', sa.String(length=200), nullable=True),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('avatar_url', sa.String(length=500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.text('true')),
        sa.Column('is_admin', sa.Boolean(), nullable=True, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('city', sa.String(length=150), nullable=True),
        sa.Column('location_pin', sa.String(length=20), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('customer_id'),
        sa.UniqueConstraint('id'),
        sa.UniqueConstraint('email'),
        sa.UniqueConstraint('username')
    )
    op.create_index('ix_users_customer_id', 'users', ['customer_id'])
    op.create_index('ix_users_id', 'users', ['id'])
    op.create_index('ix_users_email', 'users', ['email'])
    op.create_index('ix_users_username', 'users', ['username'])

    # 2. email_otps
    op.create_table(
        'email_otps',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('otp_code', sa.String(length=6), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('is_verified', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_email_otps_email', 'email_otps', ['email'])

    # 3. form_definitions
    op.create_table(
        'form_definitions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organizer_email', sa.String(length=255), nullable=False),
        sa.Column('event_id', sa.String(length=255), nullable=True),
        sa.Column('form_title', sa.String(length=255), nullable=False),
        sa.Column('form_description', sa.Text(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('is_published', sa.Boolean(), nullable=True),
        sa.Column('schema_json', sa.JSON(), nullable=False),
        sa.Column('theme_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # 4. form_submissions
    op.create_table(
        'form_submissions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('form_id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.String(length=255), nullable=True),
        sa.Column('user_email', sa.String(length=255), nullable=False),
        sa.Column('form_version', sa.Integer(), nullable=False),
        sa.Column('answers_json', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('submission_time', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # 5. organizer_accounts
    op.create_table(
        'organizer_accounts',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('org_name', sa.String(length=255), nullable=True),
        sa.Column('pan_number', sa.String(length=20), nullable=True),
        sa.Column('org_address', sa.Text(), nullable=True),
        sa.Column('has_gstin', sa.Boolean(), nullable=True),
        sa.Column('accepted_undertaking', sa.Boolean(), nullable=True),
        sa.Column('itr_filed', sa.Boolean(), nullable=True),
        sa.Column('state', sa.String(length=100), nullable=True),
        sa.Column('contact_full_name', sa.String(length=200), nullable=True),
        sa.Column('contact_email', sa.String(length=255), nullable=True),
        sa.Column('contact_mobile', sa.String(length=20), nullable=True),
        sa.Column('beneficiary_name', sa.String(length=200), nullable=True),
        sa.Column('account_type', sa.String(length=50), nullable=True),
        sa.Column('bank_name', sa.String(length=150), nullable=True),
        sa.Column('account_number', sa.String(length=50), nullable=True),
        sa.Column('bank_ifsc', sa.String(length=20), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('gstin_number', sa.Text(), nullable=True),
        sa.Column('pan_card_url', sa.String(length=500), nullable=True),
        sa.Column('cancelled_cheque_url', sa.String(length=500), nullable=True),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 6. host_registration_logs
    op.create_table(
        'host_registration_logs',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('org_name', sa.String(length=255), nullable=True),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 7. user_signups
    op.create_table(
        'user_signups',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('username', sa.String(length=100), nullable=False),
        sa.Column('full_name', sa.String(length=200), nullable=True),
        sa.Column('signup_at', sa.DateTime(), nullable=True),
        sa.Column('city', sa.String(length=150), nullable=True),
        sa.Column('location_pin', sa.String(length=20), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 8. user_logins
    op.create_table(
        'user_logins',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('ip_address', sa.String(length=50), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('login_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 9. events
    op.create_table(
        'events',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('location', sa.String(length=500), nullable=True),
        sa.Column('venue', sa.String(length=300), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('image_url', sa.String(length=500), nullable=True),
        sa.Column('start_date', sa.DateTime(), nullable=False),
        sa.Column('end_date', sa.DateTime(), nullable=True),
        sa.Column('price', sa.Float(), nullable=True),
        sa.Column('capacity', sa.Integer(), nullable=True),
        sa.Column('event_format', sa.String(length=100), nullable=True),
        sa.Column('duration', sa.String(length=100), nullable=True),
        sa.Column('age_limit', sa.String(length=50), nullable=True),
        sa.Column('language', sa.String(length=100), nullable=True),
        sa.Column('performers', sa.Text(), nullable=True),
        sa.Column('highlights', sa.Text(), nullable=True),
        sa.Column('ticket_types', sa.Text(), nullable=True),
        sa.Column('terms', sa.Text(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=True),
        sa.Column('is_cancelled', sa.Boolean(), nullable=True),
        sa.Column('organizer_id', sa.CHAR(36), nullable=True),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.ForeignKeyConstraint(['organizer_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_events_id', 'events', ['id'])

    # 10. event_management
    op.create_table(
        'event_management',
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('event_title', sa.String(length=300), nullable=False),
        sa.Column('event_category', sa.String(length=100), nullable=True),
        sa.Column('event_type', sa.String(length=100), nullable=True),
        sa.Column('event_mode', sa.String(length=100), nullable=True),
        sa.Column('event_start_date', sa.DateTime(), nullable=True),
        sa.Column('event_end_date', sa.DateTime(), nullable=True),
        sa.Column('event_start_time', sa.String(length=50), nullable=True),
        sa.Column('event_end_time', sa.String(length=50), nullable=True),
        sa.Column('venue', sa.String(length=300), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('organizer_name', sa.String(length=200), nullable=True),
        sa.Column('organizer_email', sa.String(length=255), nullable=False),
        sa.Column('organizer_phone', sa.String(length=50), nullable=True),
        sa.Column('event_status', sa.String(length=50), nullable=True),
        sa.Column('tickets_json', sa.JSON(), nullable=True),
        sa.Column('agenda_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.PrimaryKeyConstraint('event_id')
    )

    # 11. event_design
    op.create_table(
        'event_design',
        sa.Column('design_id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('banner_image', sa.String(length=500), nullable=True),
        sa.Column('logo', sa.String(length=500), nullable=True),
        sa.Column('theme_color', sa.String(length=50), nullable=True),
        sa.Column('font', sa.String(length=100), nullable=True),
        sa.Column('gallery_images', sa.JSON(), nullable=True),
        sa.Column('about_event', sa.Text(), nullable=True),
        sa.Column('highlights', sa.Text(), nullable=True),
        sa.Column('speaker_details', sa.JSON(), nullable=True),
        sa.Column('sponsor_details', sa.JSON(), nullable=True),
        sa.Column('social_links', sa.JSON(), nullable=True),
        sa.Column('custom_sections', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.PrimaryKeyConstraint('design_id')
    )

    # 12. event_registration_forms
    op.create_table(
        'event_registration_forms',
        sa.Column('form_id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('form_json', sa.JSON(), nullable=True),
        sa.Column('questions_json', sa.JSON(), nullable=True),
        sa.Column('required_fields', sa.JSON(), nullable=True),
        sa.Column('field_order', sa.JSON(), nullable=True),
        sa.Column('settings_json', sa.JSON(), nullable=True),
        sa.Column('published', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.PrimaryKeyConstraint('form_id')
    )

    # 13. event_registration_settings
    op.create_table(
        'event_registration_settings',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('registration_status', sa.String(length=50), nullable=True),
        sa.Column('registration_start_date', sa.Date(), nullable=True),
        sa.Column('registration_end_date', sa.Date(), nullable=True),
        sa.Column('max_capacity', sa.Integer(), nullable=True),
        sa.Column('allow_waitlist', sa.Boolean(), nullable=True),
        sa.Column('approval_required', sa.Boolean(), nullable=True),
        sa.Column('registration_type', sa.String(length=50), nullable=True),
        sa.Column('auto_confirmation', sa.Boolean(), nullable=True),
        sa.Column('confirmation_email', sa.Boolean(), nullable=True),
        sa.Column('cancellation_policy', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 14. event_registration_tickets
    op.create_table(
        'event_registration_tickets',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('settings_id', sa.CHAR(36), nullable=True),
        sa.Column('ticket_name', sa.String(length=255), nullable=False),
        sa.Column('ticket_type', sa.String(length=100), nullable=True),
        sa.Column('price', sa.Float(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=True),
        sa.Column('sales_start', sa.Date(), nullable=True),
        sa.Column('sales_end', sa.Date(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('available_seats', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.ForeignKeyConstraint(['settings_id'], ['event_registration_settings.id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 15. event_registrations
    op.create_table(
        'event_registrations',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('ticket_id', sa.CHAR(36), nullable=True),
        sa.Column('attendee_name', sa.String(length=255), nullable=False),
        sa.Column('attendee_email', sa.String(length=255), nullable=False),
        sa.Column('attendee_phone', sa.String(length=50), nullable=True),
        sa.Column('registration_number', sa.String(length=100), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('payment_status', sa.String(length=50), nullable=True),
        sa.Column('checkin_status', sa.String(length=50), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.ForeignKeyConstraint(['ticket_id'], ['event_registration_tickets.id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 16. event_communications
    op.create_table(
        'event_communications',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('audience', sa.String(length=100), nullable=True),
        sa.Column('channel', sa.String(length=100), nullable=True),
        sa.Column('subject', sa.String(length=255), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('attachment_url', sa.String(length=500), nullable=True),
        sa.Column('schedule_date', sa.Date(), nullable=True),
        sa.Column('schedule_time', sa.String(length=50), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('delivery_status', sa.String(length=100), nullable=True),
        sa.Column('failed_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 17. event_attendance_checkins
    op.create_table(
        'event_attendance_checkins',
        sa.Column('id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('registration_id', sa.CHAR(36), nullable=True),
        sa.Column('attendee_name', sa.String(length=255), nullable=True),
        sa.Column('attendee_email', sa.String(length=255), nullable=True),
        sa.Column('scan_method', sa.String(length=50), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.ForeignKeyConstraint(['registration_id'], ['event_registrations.id']),
        sa.PrimaryKeyConstraint('id')
    )

    # 18. event_entry_gates
    op.create_table(
        'event_entry_gates',
        sa.Column('gate_id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('gate_name', sa.String(length=150), nullable=False),
        sa.Column('gate_code', sa.String(length=50), nullable=True),
        sa.Column('gate_description', sa.String(length=300), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.PrimaryKeyConstraint('gate_id')
    )

    # 19. event_staff_scanners
    op.create_table(
        'event_staff_scanners',
        sa.Column('scanner_id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('gate_id', sa.CHAR(36), nullable=False),
        sa.Column('passcode', sa.String(length=100), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('scans_processed', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.ForeignKeyConstraint(['gate_id'], ['event_entry_gates.gate_id']),
        sa.PrimaryKeyConstraint('scanner_id')
    )

    # 20. exhibitors
    op.create_table(
        'exhibitors',
        sa.Column('exhibitor_id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=True),
        sa.Column('host_id', sa.String(length=50), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('company_name', sa.String(length=300), nullable=False),
        sa.Column('contact_name', sa.String(length=200), nullable=True),
        sa.Column('contact_email', sa.String(length=255), nullable=True),
        sa.Column('contact_phone', sa.String(length=50), nullable=True),
        sa.Column('website', sa.String(length=500), nullable=True),
        sa.Column('logo_url', sa.String(length=500), nullable=True),
        sa.Column('booth_number', sa.String(length=100), nullable=True),
        sa.Column('booth_type', sa.String(length=100), nullable=True),
        sa.Column('industry', sa.String(length=150), nullable=True),
        sa.Column('company_description', sa.Text(), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('social_links', sa.JSON(), nullable=True),
        sa.Column('category', sa.String(length=150), nullable=True),
        sa.Column('package', sa.String(length=100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_management.event_id']),
        sa.PrimaryKeyConstraint('exhibitor_id')
    )

    # 21. bookings
    op.create_table(
        'bookings',
        sa.Column('booking_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('ticket_type', sa.String(length=100), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=True),
        sa.Column('total_price', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('payment_id', sa.String(length=100), nullable=True),
        sa.Column('payment_mode', sa.String(length=100), nullable=True),
        sa.Column('gst_amount', sa.Float(), nullable=True),
        sa.Column('seat_number', sa.String(length=100), nullable=True),
        sa.Column('receiver_name', sa.String(length=200), nullable=True),
        sa.Column('receiver_email', sa.String(length=200), nullable=True),
        sa.Column('receiver_phone', sa.String(length=50), nullable=True),
        sa.Column('booked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('booking_id')
    )
    op.create_index('ix_bookings_booking_id', 'bookings', ['booking_id'])
    op.create_index('ix_bookings_customer_id', 'bookings', ['customer_id'])
    op.create_index('ix_bookings_event_id', 'bookings', ['event_id'])

    # 22. tickets
    op.create_table(
        'tickets',
        sa.Column('ticket_id', sa.CHAR(36), nullable=False),
        sa.Column('booking_id', sa.CHAR(36), nullable=False),
        sa.Column('event_id', sa.CHAR(36), nullable=False),
        sa.Column('customer_id', sa.String(length=50), nullable=False),
        sa.Column('ticket_type', sa.String(length=100), nullable=True),
        sa.Column('seat_number', sa.String(length=100), nullable=True),
        sa.Column('qr_token', sa.String(length=100), nullable=False),
        sa.Column('ticket_status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.Column('scanned_by', sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(['booking_id'], ['bookings.booking_id']),
        sa.ForeignKeyConstraint(['customer_id'], ['users.customer_id']),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('ticket_id'),
        sa.UniqueConstraint('qr_token')
    )
    op.create_index('ix_tickets_ticket_id', 'tickets', ['ticket_id'])
    op.create_index('ix_tickets_booking_id', 'tickets', ['booking_id'])
    op.create_index('ix_tickets_customer_id', 'tickets', ['customer_id'])
    op.create_index('ix_tickets_event_id', 'tickets', ['event_id'])
    op.create_index('ix_tickets_qr_token', 'tickets', ['qr_token'])
    op.create_index('ix_tickets_ticket_status', 'tickets', ['ticket_status'])


def downgrade() -> None:
    op.drop_table('tickets')
    op.drop_table('bookings')
    op.drop_table('exhibitors')
    op.drop_table('event_staff_scanners')
    op.drop_table('event_entry_gates')
    op.drop_table('event_attendance_checkins')
    op.drop_table('event_communications')
    op.drop_table('event_registrations')
    op.drop_table('event_registration_tickets')
    op.drop_table('event_registration_settings')
    op.drop_table('event_registration_forms')
    op.drop_table('event_design')
    op.drop_table('event_management')
    op.drop_table('events')
    op.drop_table('user_logins')
    op.drop_table('user_signups')
    op.drop_table('host_registration_logs')
    op.drop_table('organizer_accounts')
    op.drop_table('form_submissions')
    op.drop_table('form_definitions')
    op.drop_table('email_otps')
    op.drop_table('users')
