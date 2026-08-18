"""
Lightweight email helper. Uses SMTP when configured; always logs a fallback copy.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional


def _safe_print(msg: str) -> None:
    try:
        print(msg, flush=True)
    except Exception:
        pass


def send_email(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None) -> bool:
    """Send email via SMTP if SMTP_HOST is set. Always logs the message. Returns True if SMTP succeeded."""
    to_email = (to_email or "").strip()
    if not to_email:
        return False
    _safe_print(f"[EMAIL] to={to_email} subject={subject}")
    _safe_print(text_body)

    host = (os.getenv("SMTP_HOST") or "").strip()
    if not host:
        return False

    port = int(os.getenv("SMTP_PORT") or "587")
    user = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASSWORD") or ""
    from_addr = (os.getenv("SMTP_FROM") or os.getenv("EMAIL_FROM") or user or "noreply@jodevents.local").strip()
    use_tls = (os.getenv("SMTP_TLS") or "1").strip() not in ("0", "false", "False")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.attach(MIMEText(text_body or "", "plain", "utf-8"))
    if html_body:
        msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.sendmail(from_addr, [to_email], msg.as_string())
        _safe_print(f"[EMAIL] SMTP delivered to {to_email}")
        return True
    except Exception as exc:
        _safe_print(f"[EMAIL] SMTP failed for {to_email}: {exc}")
        return False
