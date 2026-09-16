from pathlib import Path
import re
import zipfile

root = Path(r"d:/JOD-Events/frontend")


def bump(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    path.write_text(re.sub(pattern, replacement, text), encoding="utf-8")


bump(root / "ticket-details.html", r"css/ticket-details\.css\?v=[^\s\"']+", "css/ticket-details.css?v=23")
bump(root / "ticket-details.html", r"js/ticket-details\.js\?v=[^\s\"']+", "js/ticket-details.js?v=28")

ticket_js = (root / "js/ticket-details.js").read_text(encoding="utf-8")
assert "btnDownloadAllTickets" in ticket_js
assert "renderTicketMultiNav" in ticket_js
assert "downloadAll" in ticket_js

ticket_css = (root / "css/ticket-details.css").read_text(encoding="utf-8")
assert ".ticket-multi-nav" in ticket_css
assert ".mticket-attendee-block" in ticket_css

ticket_html = (root / "ticket-details.html").read_text(encoding="utf-8")
assert "ticket-details.js?v=28" in ticket_html
assert "ticket-details.css?v=23" in ticket_html
assert "btnDownloadAllTickets" in ticket_html

out = root / "jod-frontend-full-v68.zip"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() == ".zip" or ".git" in path.parts:
            continue
        archive.write(path, path.relative_to(root).as_posix())

print("ok", out.name, out.stat().st_size)
