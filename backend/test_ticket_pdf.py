from Services.ticket_pdf import build_ticket_pdf_bytes, ticket_pdf_filename


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
    assert b"Makeup & Boutique Workshop" in pdf
    assert b"BOOKING ID: JOD-323560F3" in pdf
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
    assert b"INVOICE" in pdf
    assert b"BOOKING ID:" not in pdf
    assert b"QR pending" not in pdf
    assert ticket_pdf_filename("323560f3", kind="invoice") == "JOD-Invoice-323560F3.pdf"


if __name__ == "__main__":
    test_mticket_pdf_without_qr()
    test_invoice_pdf_omits_qr_and_booking_id()
    print("ticket pdf ok")
