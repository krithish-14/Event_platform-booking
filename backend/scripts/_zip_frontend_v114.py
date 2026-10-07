from pathlib import Path
import zipfile

root = Path(r"d:/JOD-Events/frontend")
dash = (root / "organizer-dashboard.html").read_text(encoding="utf-8")
css = (root / "css/organizer-dashboard.css").read_text(encoding="utf-8")
canvas = (root / "js/ticket-canvas.js").read_text(encoding="utf-8")
assert "organizer-dashboard.css?v=86" in dash
assert "ticket-canvas.js?v=19" in dash
assert "--ticket-inset-accent" in css
assert "tlc-face" in css and "tlc-face" in canvas
assert "style-minimal .tlc-accent" in css
assert "width: 88px" in css
assert "LAYOUT_VERSION = 4" in canvas

out = root / "jod-frontend-full-v114.zip"
count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() == ".zip" or ".git" in path.parts:
            continue
        rel = path.relative_to(root)
        if rel.parts[:1] == ("videos",):
            continue
        archive.write(path, rel.as_posix())
        count += 1
print("ok", out.name, out.stat().st_size, "files", count)
