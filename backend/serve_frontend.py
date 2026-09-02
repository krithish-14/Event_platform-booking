"""Serve frontend/ with pretty URLs: /about → about.html."""
from __future__ import annotations

import os
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("JOD_FRONTEND_HOST", "127.0.0.1")
PORT = int(os.environ.get("JOD_FRONTEND_PORT", "5500"))


class PrettyHTMLHandler(SimpleHTTPRequestHandler):
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
	httpd = ThreadingHTTPServer((HOST, PORT), PrettyHTMLHandler)
	httpd.allow_reuse_address = True
	print("Serving on http://%s:%d" % (HOST, PORT), flush=True)
	httpd.serve_forever()


if __name__ == "__main__":
	main()
