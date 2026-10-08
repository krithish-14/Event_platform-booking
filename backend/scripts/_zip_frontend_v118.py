from pathlib import Path
import zipfile

root = Path(r"d:/JOD-Events/frontend")
dash = (root / "organizer-dashboard.html").read_text(encoding="utf-8")
css = (root / "css/organizer-dashboard.css").read_text(encoding="utf-8")
canvas = (root / "js/ticket-canvas.js").read_text(encoding="utf-8")
assert "organizer-dashboard.css?v=89" in dash
assert "ticket-canvas.js?v=23" in dash
assert "phone: { x: 5, y: 50" in canvas
assert 'data-type="phone"] .tc-el-row' in css
hide = css[css.find(".ticket-live-card.style-midnight .tc-node[data-type=\"poster\"]"):css.find("display: none !important")]
assert "phone" not in hide and "email" not in hide

out = root / "jod-frontend-full-v118.zip"
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
