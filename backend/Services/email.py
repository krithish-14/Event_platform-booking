"""
Lightweight email helper. Uses SMTP when configured.
Never logs message bodies or one-time codes.
Every outbound message ends with the JOD Events logo and Help & Support footer.
"""

import html
import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional, Tuple

from Services.runtime_env import smtp_configured

SITE_URL = (os.getenv("PUBLIC_SITE_URL") or "https://jodevents.com").rstrip("/")
LOGO_URL = (
	os.getenv("EMAIL_LOGO_URL")
	or f"{SITE_URL}/images/JOD%20Events%20Logo.png"
)
SUPPORT_PHONE = (os.getenv("SUPPORT_PHONE") or "+91 91509 04455").strip()
SUPPORT_EMAIL = (os.getenv("SUPPORT_EMAIL") or "contact@jodevents.com").strip()
SUPPORT_HELP_URL = f"{SITE_URL}/help"


def _safe_print(msg: str) -> None:
	try:
		print(msg, flush=True)
	except Exception:
		pass


def support_footer_text() -> str:
	return (
		"\n\n"
		"——————————————\n"
		"JOD Events\n"
		"Help & Support\n"
		f"Phone: {SUPPORT_PHONE}\n"
		f"Email: {SUPPORT_EMAIL}\n"
		f"Help centre: {SUPPORT_HELP_URL}\n"
		"——————————————\n"
	)


def brand_footer_html() -> str:
	phone_href = "tel:" + "".join(ch for ch in SUPPORT_PHONE if ch.isdigit() or ch == "+")
	return (
		'<div style="margin-top:28px;padding-top:20px;border-top:1px solid #eadfce;'
		'font-family:Arial,Helvetica,sans-serif;color:#5c534a;font-size:13px;line-height:1.55;">'
		f'<a href="{html.escape(SITE_URL)}" style="text-decoration:none;display:inline-block;margin:0 0 14px;">'
		f'<img src="{html.escape(LOGO_URL)}" alt="JOD Events" width="140" '
		'style="display:block;max-width:140px;height:auto;border:0;" />'
		"</a>"
		'<p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#201d19;">Help &amp; Support</p>'
		f'<p style="margin:0;">Phone: <a href="{html.escape(phone_href)}" style="color:#FF7508;text-decoration:none;">'
		f"{html.escape(SUPPORT_PHONE)}</a></p>"
		f'<p style="margin:4px 0 0;">Email: <a href="mailto:{html.escape(SUPPORT_EMAIL)}" '
		f'style="color:#FF7508;text-decoration:none;">{html.escape(SUPPORT_EMAIL)}</a></p>'
		f'<p style="margin:4px 0 0;">Help centre: <a href="{html.escape(SUPPORT_HELP_URL)}" '
		f'style="color:#FF7508;text-decoration:none;">{html.escape(SUPPORT_HELP_URL.replace("https://", ""))}</a></p>'
		"</div>"
	)


def wrap_html_body(inner_html: str) -> str:
	body = (inner_html or "").strip()
	# Avoid double-wrapping if a caller already branded the message.
	if 'alt="JOD Events"' in body and "Help &amp; Support" in body:
		return body
	return (
		'<div style="margin:0;padding:0;background:#f6f1e8;">'
		'<div style="max-width:560px;margin:0 auto;padding:24px 20px 28px;'
		'font-family:Arial,Helvetica,sans-serif;color:#201d19;font-size:15px;line-height:1.55;'
		'background:#ffffff;border:1px solid #eadfce;border-radius:12px;">'
		f'<div>{body}</div>'
		f"{brand_footer_html()}"
		"</div></div>"
	)


def wrap_text_body(text_body: str) -> str:
	body = (text_body or "").rstrip()
	if "Help & Support" in body and SUPPORT_PHONE in body:
		return body
	return f"{body}{support_footer_text()}"


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

	plain = wrap_text_body(text_body or "")
	if html_body and html_body.strip():
		rich = wrap_html_body(html_body)
	else:
		# Build a simple HTML version from plain text when callers only send text.
		escaped = html.escape(text_body or "").replace("\n", "<br>")
		rich = wrap_html_body(f"<p style=\"margin:0;\">{escaped}</p>")

	msg = MIMEMultipart("mixed")
	msg["Subject"] = subject
	msg["From"] = from_addr
	msg["To"] = to_email
	alt = MIMEMultipart("alternative")
	alt.attach(MIMEText(plain, "plain", "utf-8"))
	alt.attach(MIMEText(rich, "html", "utf-8"))
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
