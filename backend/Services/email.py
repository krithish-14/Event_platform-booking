"""
Lightweight email helper. Uses SMTP when configured.
Never logs message bodies or one-time codes.
Every outbound message ends with the JOD Events logo and Help & Support footer.
"""

import html
import json
import os
import smtplib
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.policy import SMTP as SMTP_POLICY
from email.utils import parseaddr
from typing import List, Optional, Tuple

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


def _env_unquote(value: str) -> str:
	text = (value or "").strip()
	if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
		return text[1:-1]
	return text


def smtp_password(value: str) -> str:
	"""Normalize a mailbox password. Gmail app passwords are 16 letters shown with spaces."""
	text = _env_unquote(value or "")
	compact = "".join(text.split())
	if compact.isalnum() and len(compact) >= 8 and compact != text:
		return compact
	return text


_last_send_detail = ""


def last_send_detail() -> str:
	return _last_send_detail


def zepto_authorization(token: str) -> str:
	"""Zepto's India API accepts the Send Mail token only with this prefix."""
	text = (token or "").strip()
	if text.lower().startswith("zoho-enczapikey"):
		return text
	return f"Zoho-enczapikey {text}" if text else ""


def zepto_api_url(host: str) -> str:
	if "zeptomail.in" in (host or "").lower():
		return "https://api.zeptomail.in/v1.1/email"
	return "https://api.zeptomail.com/v1.1/email"


def zepto_send_failure(status_code: int, body: str) -> str:
	text = body or ""
	if "LE_102" in text or "Credit exhausted" in text:
		return "Zepto Mail has no credits left. Add credits in the Zepto Mail agent, then try again."
	if status_code in (401, 403) or "Invalid API Token" in text:
		return "Zepto Mail rejected the Send Mail token. Copy a new token from the agent's SMTP/API tab."
	return "Could not send the verification email. Try again later."


def smtp_login_users(user: str, username: str, host: str = "") -> list:
	"""Logins to try. Zepto Mail uses the literal username emailapikey, not an email address."""
	found = []
	for item in (user, username):
		text = _env_unquote(item or "")
		if not text:
			continue
		low = text.lower()
		if "example.com" in low or "yourdomain" in low or "changeme" in low:
			continue
		if text.startswith("AKIA"):
			continue
		if text not in found:
			found.append(text)
	if "zeptomail" in (host or "").lower():
		zepto = [item for item in found if item.lower() == "emailapikey"]
		return zepto or ["emailapikey"]
	return found


def _backend_env_file() -> str:
	return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _read_env_file(path: str) -> dict:
	try:
		from dotenv import dotenv_values
		raw = dotenv_values(path) or {}
	except Exception:
		raw = {}
	return {str(key): "" if value is None else str(value) for key, value in raw.items()}


def _smtp_file_values() -> dict:
	"""backend/.env wins, except a Zepto host in .env.production replaces a Gmail host."""
	backend_values = _read_env_file(_backend_env_file())
	production_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env.production"))
	production_values = _read_env_file(production_path)
	merged = dict(production_values)
	merged.update({key: value for key, value in backend_values.items() if str(value or "").strip()})
	backend_host = (backend_values.get("SMTP_HOST") or "").lower()
	production_host = (production_values.get("SMTP_HOST") or "").lower()
	if "zeptomail" in production_host and "zeptomail" not in backend_host:
		for key in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TLS"):
			if str(production_values.get(key) or "").strip():
				merged[key] = production_values[key]
	return merged


def _smtp_setting(values: dict, key: str) -> str:
	"""backend/.env wins over a stale process environment."""
	file_value = _env_unquote((values or {}).get(key) or "")
	if file_value:
		return file_value
	return _env_unquote(os.getenv(key) or "")


def envelope_address(header_value: str) -> str:
	"""Bare address for SMTP MAIL FROM. Display names are header-only."""
	_display, addr = parseaddr(header_value or "")
	return (addr or "").strip()


def smtp_message_bytes(msg: MIMEMultipart) -> bytes:
	"""ASCII-safe SMTP payload. Non-ASCII subjects (em dash) stay in the header encoding."""
	policy = SMTP_POLICY.clone(cte_type="7bit")
	return msg.as_bytes(policy=policy)


def _send_via_zepto(
	*,
	host: str,
	token: str,
	from_header: str,
	to_email: str,
	subject: str,
	text_body: str,
	html_body: str,
	attachments: Optional[List[Tuple[str, bytes, str]]] = None,
) -> bool:
	"""Send through Zepto's HTTP API. The India token is rejected by SMTP login."""
	global _last_send_detail
	auth = zepto_authorization(token)
	if not auth:
		_last_send_detail = "Zepto Mail rejected the Send Mail token. Copy a new token from the agent's SMTP/API tab."
		_safe_print("[EMAIL] Zepto token missing")
		return False
	display, address = parseaddr(from_header or "")
	address = (address or from_header or "").strip()
	payload = {
		"from": {"address": address, "name": display or "JOD Events"},
		"to": [{"email_address": {"address": to_email}}],
		"subject": subject or "JOD Events",
		"textbody": text_body or "",
		"htmlbody": html_body or "",
	}
	files = []
	for filename, content, mime in attachments or []:
		if not content:
			continue
		import base64
		files.append({
			"name": filename or "ticket.pdf",
			"mime_type": mime or "application/pdf",
			"content": base64.b64encode(content).decode("ascii"),
		})
	if files:
		payload["attachments"] = files
	req = Request(zepto_api_url(host), data=json.dumps(payload).encode("utf-8"), method="POST")
	req.add_header("Accept", "application/json")
	req.add_header("Content-Type", "application/json")
	req.add_header("Authorization", auth)
	try:
		with urlopen(req, timeout=20) as resp:
			if 200 <= resp.status < 300:
				_safe_print("[EMAIL] delivered")
				return True
			body = resp.read().decode("utf-8", "replace")
			_last_send_detail = zepto_send_failure(resp.status, body)
			_safe_print(f"[EMAIL] Zepto send failed status={resp.status}")
			return False
	except HTTPError as exc:
		body = exc.read().decode("utf-8", "replace")
		_last_send_detail = zepto_send_failure(exc.code, body)
		_safe_print(f"[EMAIL] Zepto send failed status={exc.code} detail={_last_send_detail}")
		return False
	except URLError as exc:
		_last_send_detail = "Could not send the verification email. Try again later."
		_safe_print(f"[EMAIL] Zepto send failed: {type(exc).__name__}")
		return False
	except Exception as exc:
		_last_send_detail = "Could not send the verification email. Try again later."
		_safe_print(f"[EMAIL] Zepto send failed: {type(exc).__name__}")
		return False


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

	file_values = _smtp_file_values()
	host = _smtp_setting(file_values, "SMTP_HOST") or (os.getenv("SMTP_HOST") or "").strip()
	if not host:
		_safe_print("[EMAIL] skipped: SMTP_HOST is not configured")
		return False
	port = int(_smtp_setting(file_values, "SMTP_PORT") or os.getenv("SMTP_PORT") or "587")
	password = smtp_password(_smtp_setting(file_values, "SMTP_PASSWORD"))
	login_users = smtp_login_users(
		_smtp_setting(file_values, "SMTP_USER"),
		_smtp_setting(file_values, "SMTP_USERNAME"),
		host,
	)
	user = login_users[0] if login_users else ""
	from_header = _env_unquote(
		_smtp_setting(file_values, "SMTP_FROM")
		or _smtp_setting(file_values, "EMAIL_FROM")
		or user
		or "noreply@jodevents.local"
	)
	from_addr = envelope_address(from_header) or from_header
	use_tls = (_smtp_setting(file_values, "SMTP_TLS") or os.getenv("SMTP_TLS") or "1").strip() not in ("0", "false", "False")

	plain = wrap_text_body(text_body or "")
	if html_body and html_body.strip():
		rich = wrap_html_body(html_body)
	else:
		# Build a simple HTML version from plain text when callers only send text.
		escaped = html.escape(text_body or "").replace("\n", "<br>")
		rich = wrap_html_body(f"<p style=\"margin:0;\">{escaped}</p>")

	msg = MIMEMultipart("mixed")
	msg["Subject"] = subject
	msg["From"] = from_header if envelope_address(from_header) else from_addr
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

	global _last_send_detail
	_last_send_detail = ""
	if "zeptomail" in host.lower():
		return _send_via_zepto(
			host=host,
			token=password,
			from_header=msg["From"],
			to_email=to_email,
			subject=subject,
			text_body=plain,
			html_body=rich,
			attachments=attachments,
		)

	payload = smtp_message_bytes(msg)
	attempts = login_users or [""]
	for login_user in attempts:
		try:
			if int(port) == 465:
				client = smtplib.SMTP_SSL(host, port, timeout=20)
			else:
				client = smtplib.SMTP(host, port, timeout=20)
			with client as smtp:
				smtp.ehlo()
				if use_tls and int(port) != 465:
					smtp.starttls()
					smtp.ehlo()
				if login_user:
					smtp.login(login_user, password)
				smtp.sendmail(from_addr, [to_email], payload)
			_safe_print("[EMAIL] delivered")
			return True
		except smtplib.SMTPAuthenticationError as exc:
			server_msg = exc.smtp_error.decode("utf-8", "replace") if isinstance(exc.smtp_error, bytes) else str(exc.smtp_error or "")
			server_msg = " ".join(server_msg.split())[:180]
			_safe_print(
				f"[EMAIL] SMTP login rejected user={login_user or '(none)'} host={host} port={port} "
				f"password_len={len(password)} code={exc.smtp_code} server={server_msg}"
			)
			_last_send_detail = "Could not send the verification email. Try again later."
			continue
		except Exception as exc:
			code = getattr(exc, "smtp_code", None)
			detail = f" code={code}" if code else ""
			_safe_print(f"[EMAIL] SMTP delivery failed: {type(exc).__name__}{detail}")
			return False
	return False
