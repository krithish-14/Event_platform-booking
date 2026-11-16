#!/usr/bin/env python3
"""
Send one real Zoho CPaaS booking-confirmation WhatsApp template message.

Env (preferred):
  ZOHO_CPAAS_HOST
  ZOHO_CPAAS_AGENT_ALIAS
  ZOHO_CPAAS_API_KEY
  ZOHO_CPAAS_WHATSAPP_FROM
  ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY
  ZOHO_CPAAS_WHATSAPP_TEST_TO

Usage (on EC2, from backend/ with venv active):
  python scripts/send_whatsapp_demo.py
  python scripts/send_whatsapp_demo.py --to 917200499369 --name "Demo Guest"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env")

from Services.whatsapp import (  # noqa: E402
    send_booking_confirmation_whatsapp,
    upload_cpaas_file,
    whatsapp_template_configured,
    zoho_cpaas_api_key,
    zoho_cpaas_ticket_template_key,
    zoho_cpaas_whatsapp_from,
    zoho_cpaas_whatsapp_test_to,
    zepto_whatsapp_api_base,
)


def _cfg_status() -> None:
    checks = {
        "ZOHO_CPAAS_API_KEY": bool(zoho_cpaas_api_key()),
        "ZOHO_CPAAS_WHATSAPP_FROM": bool(zoho_cpaas_whatsapp_from()),
        "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY": bool(zoho_cpaas_ticket_template_key()),
    }
    for name, ok in checks.items():
        print(f"{name}: set={ok}")
    print(f"api_base={zepto_whatsapp_api_base()}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a live WhatsApp booking-confirmation demo.")
    parser.add_argument(
        "--to",
        default="",
        help="Recipient mobile. Defaults to ZOHO_CPAAS_WHATSAPP_TEST_TO.",
    )
    parser.add_argument("--name", default="Demo Guest")
    parser.add_argument("--event", default="JOD Events Demo Booking")
    parser.add_argument("--date", default="15 Nov 2026, 6:00 PM")
    parser.add_argument("--ticket", default="General Admission")
    parser.add_argument("--booking-id", default="demo-00000001")
    parser.add_argument(
        "--file-key",
        default="",
        help="Optional Zoho uploaded document file_key for DOCUMENT header templates",
    )
    parser.add_argument(
        "--upload-demo-pdf",
        action="store_true",
        help="Upload a tiny real PDF to Zoho File Cache and attach it (tests DOCUMENT header).",
    )
    args = parser.parse_args()

    if not whatsapp_template_configured():
        print("ERROR: WhatsApp template is not configured.")
        print("Set these in backend/.env:")
        print("  ZOHO_CPAAS_API_KEY")
        print("  ZOHO_CPAAS_WHATSAPP_FROM")
        print("  ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY")
        _cfg_status()
        return 1

    to_phone = (args.to or zoho_cpaas_whatsapp_test_to()).strip()
    if not to_phone:
        print("ERROR: pass --to or set ZOHO_CPAAS_WHATSAPP_TEST_TO in backend/.env")
        return 1

    key = zoho_cpaas_ticket_template_key()
    sender = zoho_cpaas_whatsapp_from()
    print(f"Configured template_key={key[:8]}… from={sender} to={to_phone}")
    print(f"api_base={zepto_whatsapp_api_base()}")

    file_key = (args.file_key or "").strip() or None
    if args.upload_demo_pdf and not file_key:
        # Prefer a real generated PDF. Zoho UE_104 can reject tiny/hand-rolled
        # PDFs as "empty content" even when the multipart body is present.
        demo_pdf = b""
        try:
            from fpdf import FPDF

            from fpdf.enums import XPos, YPos

            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 18)
            pdf.cell(
                0,
                12,
                "JOD Events - WhatsApp ticket test",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            pdf.set_font("Helvetica", size=12)
            for i in range(40):
                pdf.cell(
                    0,
                    7,
                    f"Ticket PDF line {i + 1} - {args.event}",
                    new_x=XPos.LMARGIN,
                    new_y=YPos.NEXT,
                )
            demo_pdf = bytes(pdf.output())
            print(f"demo_pdf_source=fpdf bytes={len(demo_pdf)}")
        except Exception as exc:
            print(f"demo_pdf_source=fpdf_failed ({exc}); using ticket_pdf assembler")
            from Services.ticket_pdf import _assemble_pdf

            stream = b"BT /F1 18 Tf 72 720 Td (JOD LIVE TICKET PDF TEST) Tj ET"
            objects = [
                b"<< /Type /Catalog /Pages 2 0 R >>",
                b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                (
                    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                    b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
                ),
                f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
                + stream
                + b"\nendstream",
                b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            ]
            demo_pdf = _assemble_pdf(objects)
            print(f"demo_pdf_source=ticket_pdf bytes={len(demo_pdf)}")
        file_key = upload_cpaas_file(demo_pdf, "JOD-LIVE-TEST.pdf")
        print(f"uploaded_demo_file_key={file_key or 'FAILED'}")
        if not file_key:
            return 3

    sent, channel, link, message_id = send_booking_confirmation_whatsapp(
        to_phone,
        name=args.name,
        event_name=args.event,
        event_date=args.date,
        ticket_type=args.ticket,
        booking_id=args.booking_id,
        attachment_file_key=file_key,
    )
    print(f"sent={sent} channel={channel} message_id={message_id} file_key={file_key or 'none'}")
    if link:
        print(f"wa_me_fallback={link}")
    return 0 if sent else 2


if __name__ == "__main__":
    raise SystemExit(main())
