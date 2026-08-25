"""
Lightweight email helper. Uses SMTP when configured.
Never logs message bodies or one-time codes.
"""

import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional, Tuple

from Services.runtime_env import smtp_configured


def _safe_print(msg: str) -> None:
    try:
        print(msg, flush=True)
    except Exception:
        pass


def send_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    attachments: Optional[List[Tuple[str, bytes, str]]] = None,
) -> bool:
    """Send email via SMTP if SMTP_HOST is set. Returns True if SMTP succeeded."""
    to_email = (to_email or "").strip()
    if not to_email:
        return False
    if not smtp_configured():
        _safe_print("[EMAIL] skipped: SMTP_HOST is not configured")
        return False

    host = (os.getenv("SMTP_HOST") or "").strip()
    port = int(os.getenv("SMTP_PORT") or "587")
    from Services.runtime_env import smtp_user
    user = smtp_user()
    password = os.getenv("SMTP_PASSWORD") or ""
    from_addr = (os.getenv("SMTP_FROM") or os.getenv("EMAIL_FROM") or user or "noreply@jodevents.local").strip()
    use_tls = (os.getenv("SMTP_TLS") or "1").strip() not in ("0", "false", "False")

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body or "", "plain", "utf-8"))
    if html_body:
        alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alt)
    for filename, content, mime in attachments or []:
        if not content:
            continue
        subtype = (mime or "application/pdf").split("/")[-1] or "pdf"
        part = MIMEApplication(content, _subtype=subtype)
        part.add_header("Content-Disposition", "attachment", filename=filename or "ticket.pdf")
        msg.attach(part)

    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.sendmail(from_addr, [to_email], msg.as_string())
        _safe_print("[EMAIL] delivered")
        return True
    except Exception:
        _safe_print("[EMAIL] SMTP delivery failed")
        return False
