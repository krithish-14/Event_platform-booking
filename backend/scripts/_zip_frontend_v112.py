from pathlib import Path
import zipfile

root = Path(r"d:/JOD-Events/frontend")
signup = (root / "signup.html").read_text(encoding="utf-8")
login = (root / "login.html").read_text(encoding="utf-8")
auth_js = (root / "js/auth.js").read_text(encoding="utf-8")
assert "js/auth.js?v=54" in signup and "js/auth.js?v=54" in login
assert "css/auth.css?v=33" in signup
assert "phone-email-rules.js" in login
assert "openGoogleCompleteProfile" in auth_js
assert "google/complete-profile" in auth_js

out = root / "jod-frontend-full-v112.zip"
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
