import struct
import zlib

from Services.ticket_pdf import (
    _decode_png_rgb,
    build_ticket_pdf_bytes,
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
    test_invoice_pdf_omits_qr_and_booking_id()
    print("ticket pdf ok")
