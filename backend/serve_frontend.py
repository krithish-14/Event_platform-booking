"""Serve frontend/ with pretty URLs: /about → about.html.

Local-only: inject event Open Graph tags on /event-details?id=…
so view-source matches what Cloudflare Functions do in production.
"""
from __future__ import annotations

import html as html_lib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("JOD_FRONTEND_HOST", "127.0.0.1")
PORT = int(os.environ.get("JOD_FRONTEND_PORT", "5500"))
API_ORIGIN = os.environ.get("JOD_API_ORIGIN", "http://127.0.0.1:8001").rstrip("/")
FALLBACK_IMAGE = "https://assets.jodevents.com/images/hero-event.jpg"


def _frontend_root() -> str:
	"""Always serve the frontend package, even if the process cwd is the repo root."""
	here = os.path.dirname(os.path.abspath(__file__))
	candidate = os.path.abspath(os.path.join(here, "..", "frontend"))
	if os.path.isdir(candidate):
		return candidate
	return os.getcwd()


def _clip_description(text: str, title: str) -> str:
	cleaned = re.sub(r"<[^>]+>", " ", str(text or ""))
	cleaned = html_lib.unescape(cleaned)
	cleaned = re.sub(r"\s+", " ", cleaned).strip()
	if cleaned:
		return cleaned[:220]
	return "Book tickets for %s on JOD Events." % title


def _absolute_media_url(raw: str, site_origin: str) -> str:
	text = str(raw or "").strip()
	if not text:
		return FALLBACK_IMAGE
	if re.match(r"^https?://", text, re.I):
		return text
	if text.startswith("//"):
		return "https:" + text
	if text.startswith("/"):
		if text.startswith("/uploads") or text.startswith("/media") or text.startswith("/api/"):
			return API_ORIGIN + text
		return site_origin + text
	if text.startswith("images/"):
		return "https://assets.jodevents.com/" + text
	if text.startswith("uploads/"):
		return API_ORIGIN + "/" + text
	return site_origin + "/" + text.lstrip("./")


def _fetch_public_event(event_id: str) -> dict | None:
	urls = [
		"%s/api/events/public/%s" % (API_ORIGIN, urllib.parse.quote(event_id, safe="")),
		"%s/api/events/public" % API_ORIGIN,
	]
	for url in urls:
		req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "JOD-Events-OG-local/1.0"})
		try:
			with urllib.request.urlopen(req, timeout=4) as res:
				if res.status != 200:
					continue
				data = json.loads(res.read().decode("utf-8", errors="replace"))
		except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
			continue
		if isinstance(data, dict) and (data.get("title") or data.get("image_url") or data.get("description")):
			if str(data.get("id") or "") == event_id or str(data.get("event_id") or "") == event_id:
				return data
			continue
		if isinstance(data, list):
			for row in data:
				if not isinstance(row, dict):
					continue
				if str(row.get("id") or "") == event_id or str(row.get("event_id") or "") == event_id:
					return row
	return None


def _replace_meta(doc: str, attr: str, key: str, value: str) -> str:
	escaped = html_lib.escape(value, quote=True)
	pattern = re.compile(
		r'(<meta\b[^>]*\b%s=["\']%s["\'][^>]*\bcontent=["\'])(.*?)(["\'])' % (re.escape(attr), re.escape(key)),
		re.I | re.S,
	)
	if pattern.search(doc):
		return pattern.sub(lambda m: m.group(1) + escaped + m.group(3), doc, count=1)
	return doc


def _inject_event_og(doc: str, event: dict, page_url: str, site_origin: str) -> str:
	title = str(event.get("title") or "Event Details").strip() or "Event Details"
	description = _clip_description(str(event.get("description") or ""), title)
	image = _absolute_media_url(str(event.get("image_url") or event.get("card_image") or ""), site_origin)
	doc_title = "%s — JOD Events" % title
	replacements = {
		("name", "description"): description,
		("property", "og:title"): title,
		("property", "og:description"): description,
		("property", "og:url"): page_url,
		("property", "og:image"): image,
		("property", "og:image:alt"): title,
		("name", "twitter:title"): title,
		("name", "twitter:description"): description,
		("name", "twitter:image"): image,
	}
	for (attr, key), value in replacements.items():
		doc = _replace_meta(doc, attr, key, value)
	escaped_title = html_lib.escape(doc_title)
	doc = re.sub(r"(<title>)(.*?)(</title>)", lambda m: m.group(1) + escaped_title + m.group(3), doc, count=1, flags=re.I | re.S)
	escaped_url = html_lib.escape(page_url, quote=True)
	doc = re.sub(
		r'(<link\b[^>]*\brel=["\']canonical["\'][^>]*\bhref=["\'])(.*?)(["\'])',
		lambda m: m.group(1) + escaped_url + m.group(3),
		doc,
		count=1,
		flags=re.I | re.S,
	)
	if "jod-og:event" not in doc:
		doc = re.sub(r"</head>", "<!-- jod-og:event -->\n</head>", doc, count=1, flags=re.I)
	return doc


class PrettyHTMLHandler(SimpleHTTPRequestHandler):
	def _site_origin(self) -> str:
		host = self.headers.get("Host") or ("%s:%d" % (HOST, PORT))
		return "http://%s" % host

	def _serve_event_details_og(self, event_id: str) -> None:
		fs_path = self.translate_path("/event-details.html")
		try:
			with open(fs_path, "r", encoding="utf-8") as handle:
				doc = handle.read()
		except OSError:
			self.send_error(404, "File not found")
			return
		event = _fetch_public_event(event_id)
		if event:
			page_url = "%s/event-details?id=%s" % (self._site_origin(), urllib.parse.quote(event_id))
			doc = _inject_event_og(doc, event, page_url, self._site_origin())
		payload = doc.encode("utf-8")
		self.send_response(200)
		self.send_header("Content-Type", "text/html; charset=utf-8")
		self.send_header("Content-Length", str(len(payload)))
		self.send_header("Cache-Control", "no-store")
		self.end_headers()
		self.wfile.write(payload)

	def _map_pretty_path(self) -> None:
		parsed = urllib.parse.urlsplit(self.path)
		path = parsed.path or "/"
		query = ("?" + parsed.query) if parsed.query else ""
		if "/components/" in path:
			if not os.path.splitext(path)[1]:
				candidate = path.rstrip("/") + ".html"
				fs_path = self.translate_path(candidate)
				if os.path.isfile(fs_path):
					self.path = candidate + query
			return
		ext = os.path.splitext(path)[1].lower()
		if ext == ".html":
			if path.endswith("/index.html") or path == "/index.html":
				self.path = "/" + query
				self.send_response(301)
				self.send_header("Location", self.path)
				self.end_headers()
				raise _Redirected()
			pretty = path[: -5]
			if pretty == "":
				pretty = "/"
			self.send_response(301)
			self.send_header("Location", pretty + query)
			self.end_headers()
			raise _Redirected()
		if ext:
			return
		if path == "/":
			return
		candidate = path.rstrip("/") + ".html"
		fs_path = self.translate_path(candidate)
		if os.path.isfile(fs_path):
			self.path = candidate + query

	def do_GET(self) -> None:
		try:
			self._map_pretty_path()
		except _Redirected:
			return
		parsed = urllib.parse.urlsplit(self.path)
		pathname = (parsed.path or "/").rstrip("/") or "/"
		if pathname in ("/event-details", "/event-details.html"):
			event_id = (urllib.parse.parse_qs(parsed.query).get("id") or [""])[0].strip()
			if event_id:
				return self._serve_event_details_og(event_id)
		return SimpleHTTPRequestHandler.do_GET(self)

	def do_HEAD(self) -> None:
		try:
			self._map_pretty_path()
		except _Redirected:
			return
		return SimpleHTTPRequestHandler.do_HEAD(self)


class _Redirected(Exception):
	pass


def main() -> None:
	root = _frontend_root()
	os.chdir(root)
	httpd = ThreadingHTTPServer((HOST, PORT), PrettyHTMLHandler)
	httpd.allow_reuse_address = True
	print("Serving %s on http://%s:%d" % (root, HOST, PORT), flush=True)
	httpd.serve_forever()


if __name__ == "__main__":
	main()
