"""Inject api-config.js after theme.js and neutralize leftover :8001 production fallbacks."""
from __future__ import annotations

import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
TAG = '<script src="js/api-config.js?v=1"></script>'

GET_API_FALLBACK = '''function getApiBase() {
		if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		if (window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			return window.JodConfig.getApiOrigin();
		}
		if (window.JodAuth && window.JodAuth.API_BASE) return window.JodAuth.API_BASE;
		if (window.JOD_API_BASE_OVERRIDE) return String(window.JOD_API_BASE_OVERRIDE).replace(/\\/$/, "");
		return "";
	}'''


def inject_html(path: str) -> bool:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if "js/api-config.js" in text:
        return False
    if "js/theme.js" not in text:
        return False
    updated, n = re.subn(
        r'(<script src="js/theme\.js[^"]*"></script>)',
        r"\1\n\t\t" + TAG,
        text,
        count=1,
    )
    if n:
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(updated)
        return True
    return False


def main() -> None:
    html_changed = 0
    for name in os.listdir(ROOT):
        if name.endswith(".html"):
            if inject_html(os.path.join(ROOT, name)):
                html_changed += 1
                print("html", name)
    print("html_updated", html_changed)


if __name__ == "__main__":
    main()
