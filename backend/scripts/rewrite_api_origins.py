"""Replace leftover hardcoded API origins with JodConfig/JodHealth same-origin helpers."""
from __future__ import annotations

import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))

HELPER = """(window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || \"\""""

SKIP = {"api-config.js"}


def transform(text: str, rel: str) -> str:
    if rel.replace("\\", "/") in ("js/api-config.js",):
        return text
    text = re.sub(
        r'window\.location\.origin\.includes\("5500"\) \|\| window\.location\.origin\.includes\("127\.0\.0\.1"\)(?: \|\| window\.location\.hostname === "localhost")?\s*\?\s*"http://127\.0\.0\.1:8001(/api[^"]*)"\s*:\s*"[^"]*"',
        lambda m: f"(({HELPER}).replace(/\\/$/, '') + '{m.group(1)}')",
        text,
    )
    text = text.replace('return "http://127.0.0.1:8001";', f"return {HELPER};")
    text = text.replace("return `http://${host}:8001`;", f"return {HELPER};")
    text = text.replace("return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;", f"return {HELPER};")
    text = text.replace(
        '? "http://127.0.0.1:8001/api/organizers"',
        f"? (({HELPER}).replace(/\\/$/, '') + '/api/organizers')",
    )
    text = text.replace(
        '? "http://127.0.0.1:8001/api/host-events"',
        f"? (({HELPER}).replace(/\\/$/, '') + '/api/host-events')",
    )
    text = text.replace(
        '? "http://127.0.0.1:8001/api/volunteers"',
        f"? (({HELPER}).replace(/\\/$/, '') + '/api/volunteers')",
    )
    text = text.replace(
        '? "http://127.0.0.1:8001/api/location"',
        f"? (({HELPER}).replace(/\\/$/, '') + '/api/location')",
    )
    text = text.replace(
        '? "http://127.0.0.1:8001/api/forms"',
        f"? (({HELPER}).replace(/\\/$/, '') + '/api/forms')",
    )
    text = text.replace(
        'localDev ? "http://127.0.0.1:8001/api" : "/api"',
        f"(({HELPER}).replace(/\\/$/, '') + '/api')",
    )
    text = text.replace(
        '|| "http://127.0.0.1:8001").replace(/\\/$/, "")',
        f'|| {HELPER}).replace(/\\/$/, "")',
    )
    # location.js style
    text = re.sub(
        r'return \(window\.JOD_API_BASE_OVERRIDE\) \|\| `http://\$\{host\}:\$\{API_PORT\}`;',
        f"return {HELPER};",
        text,
    )
    return text


def main() -> None:
    changed = 0
    for dirpath, _, files in os.walk(ROOT):
        for name in files:
            if not name.endswith((".js", ".html")):
                continue
            if name in SKIP:
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as fh:
                original = fh.read()
            updated = transform(original, os.path.relpath(path, ROOT))
            if updated != original:
                with open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(updated)
                changed += 1
                print("updated", os.path.relpath(path, ROOT))
    print("files_changed", changed)


if __name__ == "__main__":
    main()
