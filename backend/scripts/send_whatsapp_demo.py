#!/usr/bin/env python3
"""
Send one real Zoho CPaaS booking-confirmation WhatsApp template message.

Usage (on EC2, from backend/ with venv active):
  python scripts/send_whatsapp_demo.py --to 9876543210
  python scripts/send_whatsapp_demo.py --to +919876543210 --name "Demo Guest"
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env")

from Services.whatsapp import (  # noqa: E402
    send_booking_confirmation_whatsapp,
    whatsapp_template_configured,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a live WhatsApp booking-confirmation demo.")
    parser.add_argument("--to", required=True, help="Recipient mobile (10-digit India or +E.164)")
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
    args = parser.parse_args()

    if not whatsapp_template_configured():
        print("ERROR: WhatsApp template is not configured.")
        print("Set ZEPTO_WHATSAPP_API_KEY, ZEPTO_WHATSAPP_FROM, and WHATSAPP_TEMPLATE_KEY in backend/.env")
        return 1

    key = (os.getenv("WHATSAPP_TEMPLATE_KEY") or "").strip()
    sender = (os.getenv("ZEPTO_WHATSAPP_FROM") or "").strip()
    print(f"Configured template_key={key[:8]}… from={sender} to={args.to}")

    sent, channel, link, message_id = send_booking_confirmation_whatsapp(
        args.to,
        name=args.name,
        event_name=args.event,
        event_date=args.date,
        ticket_type=args.ticket,
        booking_id=args.booking_id,
        attachment_file_key=(args.file_key or None),
    )
    print(f"sent={sent} channel={channel} message_id={message_id}")
    if link:
        print(f"wa_me_fallback={link}")
    return 0 if sent else 2


if __name__ == "__main__":
    raise SystemExit(main())
