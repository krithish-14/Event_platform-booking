import struct
import zlib

from Services.ticket_pdf import (
    _assemble_pdf_from_page_chunks,
    _decode_png_rgb,
    _resolve_per_ticket_context,
    build_combined_mticket_pdf_from_booking,
    build_mticket_pdf_bytes,
    build_ticket_pdf_bytes,
    guest_label_for_index,
    ticket_pdf_filename,
)


def _make_png_rgb(width: int, height: int, rgb: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b""
    stride = width * 3
    for y in range(height):
        raw += b"\x00" + rgb[y * stride : (y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def test_png_poster_decodes_to_rgb():
    png = _make_png_rgb(2, 1, bytes([255, 0, 0, 0, 255, 0]))
    decoded = _decode_png_rgb(png)
    assert decoded is not None
    rgb, width, height = decoded
    assert (width, height) == (2, 1)
    assert rgb == bytes([255, 0, 0, 0, 255, 0])



def test_mticket_pdf_without_qr():
    pdf = build_ticket_pdf_bytes(
        booking_id="323560f3-aaaa-bbbb-cccc-ddddeeeeffff",
        event_name="Makeup & Boutique Workshop",
        event_date="2026-09-25T10:00:00",
        qr_token="",
        venue="Express Avenue, Chennai",
        ticket_type="Silver Access",
        quantity=1,
        total_price=499,
        gst_amount=89.82,
        seat_number="General Admission",
        payment_mode="UPI",
    )
    assert pdf is not None
    assert pdf.startswith(b"%PDF")
    assert b"Makeup" in pdf
    assert b"Boutique Workshop" in pdf or b"Makeup & Boutique Workshop" in pdf
    assert b"BOOKING ID: #JOD-323560F3" in pdf
    assert b"E-Ticket" in pdf
    assert b"24h" not in pdf
    assert b"Cancellation available" not in pdf
    assert b"1 0.46 0.03 rg" not in pdf
    assert b"saved" not in pdf.lower()
    assert ticket_pdf_filename("323560f3") == "JOD-Ticket-323560F3.pdf"


def test_guest_labels_and_filenames():
    assert guest_label_for_index(0) == ""
    assert guest_label_for_index(1) == "Guest 1"
    assert guest_label_for_index(2) == "Guest 2"
    assert ticket_pdf_filename("323560f3-aaaa-bbbb-cccc-ddddeeeeffff", ticket_index=1) == "JOD-Ticket-323560F3-Guest1.pdf"


def test_mticket_pdf_renders_guest_label_and_contact_rows():
    pdf = build_mticket_pdf_bytes(
        booking_id="323560f3-aaaa-bbbb-cccc-ddddeeeeffff",
        event_name="Makeup & Boutique Workshop",
        event_date="2026-09-25T10:00:00",
        qr_token="guest-token-1",
        venue="Express Avenue, Chennai",
        ticket_type="Silver Access",
        quantity=1,
        total_price=166.33,
        gst_amount=29.94,
        seat_number="General Admission",
        payment_mode="UPI",
        attendee_name="Priya Sharma",
        attendee_email="contact@jodevents.com",
        attendee_phone="+91 91509 04455",
        attendee_guest_label="Guest 1",
    )
    assert pdf is not None
    assert pdf.startswith(b"%PDF")
    assert b"Priya Sharma" in pdf
    assert b"Guest 1" in pdf
    assert b"Name" in pdf
    assert b"Phone" in pdf
    assert b"Email" in pdf
    assert b"contact@jodevents.com" in pdf
    assert ticket_pdf_filename("323560f3", ticket_index=-1) == "JOD-Ticket-323560F3-All.pdf"


def test_multipage_pdf_assembly():
    chunk_a = build_mticket_pdf_bytes(
        booking_id="323560f3-aaaa-bbbb-cccc-ddddeeeeffff",
        event_name="Run Marathon",
        event_date="2026-09-25T10:00:00",
        qr_token="token-a",
        attendee_name="Test ananda",
        attendee_email="test@gmail.com",
        attendee_phone="9890989090",
        _return_page_chunk=True,
    )
    chunk_b = build_mticket_pdf_bytes(
        booking_id="323560f3-aaaa-bbbb-cccc-ddddeeeeffff",
        event_name="Run Marathon",
        event_date="2026-09-25T10:00:00",
        qr_token="token-b",
        attendee_name="Test ananda",
        attendee_email="test@gmail.com",
        attendee_phone="9890989090",
        attendee_guest_label="Guest 1",
        _return_page_chunk=True,
    )
    assert isinstance(chunk_a, dict)
    assert isinstance(chunk_b, dict)
    pdf = _assemble_pdf_from_page_chunks([chunk_a, chunk_b])
    assert pdf is not None
    assert pdf.startswith(b"%PDF")
    assert pdf.count(b"/Type /Page") >= 2


def test_combined_pdf_from_multi_ticket_booking():
    booking = _FakeBooking(
        qty=2,
        tickets=[_FakeTicket("tok-a", "2026-01-01"), _FakeTicket("tok-b", "2026-01-02")],
    )
    pdf = build_combined_mticket_pdf_from_booking(booking)
    assert pdf is not None
    assert pdf.startswith(b"%PDF")
    assert pdf.count(b"/Type /Page") >= 2


class _FakeTicket:
    def __init__(self, token, created_at=None):
        self.qr_token = token
        self.ticket_id = token
        self.created_at = created_at or "2026-01-01T00:00:00"


class _FakeBooking:
    def __init__(self, qty=3, tickets=None):
        self.quantity = qty
        self.total_price = 499.0
        self.gst_amount = 89.82
        self.tickets = tickets or []


def test_resolve_per_ticket_context_splits_multi_ticket_booking():
    booking = _FakeBooking(
        qty=3,
        tickets=[_FakeTicket("tok-a", "2026-01-01"), _FakeTicket("tok-b", "2026-01-02"), _FakeTicket("tok-c", "2026-01-03")],
    )
    ctx = _resolve_per_ticket_context(booking, qr_token="tok-b")
    assert ctx["ticket_index"] == 1
    assert ctx["guest_label"] == "Guest 1"
    assert ctx["quantity"] == 1
    assert abs(ctx["total_price"] - (499.0 / 3)) < 0.01
    assert abs(ctx["gst_amount"] - (89.82 / 3)) < 0.01


def test_invoice_pdf_omits_qr_and_booking_id():
    pdf = build_ticket_pdf_bytes(
        booking_id="323560f3-aaaa-bbbb-cccc-ddddeeeeffff",
        event_name="Makeup & Boutique Workshop",
        event_date="2026-09-25T10:00:00",
        qr_token="should-not-appear",
        venue="Express Avenue, Chennai",
        ticket_type="Silver Access",
        quantity=1,
        total_price=499,
        gst_amount=89.82,
        seat_number="General Admission",
        payment_mode="UPI",
        include_qr=False,
    )
    assert pdf is not None
    assert pdf.startswith(b"%PDF")
    assert b"Invoice" in pdf
    assert b"BOOKING ID:" not in pdf
    assert b"QR pending" not in pdf
    assert ticket_pdf_filename("323560f3", kind="invoice") == "JOD-Invoice-323560F3.pdf"


if __name__ == "__main__":
    test_png_poster_decodes_to_rgb()
    test_mticket_pdf_without_qr()
    test_guest_labels_and_filenames()
    test_mticket_pdf_renders_guest_label_and_contact_rows()
    test_multipage_pdf_assembly()
    test_combined_pdf_from_multi_ticket_booking()
    test_resolve_per_ticket_context_splits_multi_ticket_booking()
    test_invoice_pdf_omits_qr_and_booking_id()
    print("ticket pdf ok")
