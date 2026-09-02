from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]

CRITICAL_OLD = re.compile(
	r'<style id="jod-header-logo-critical">.*?</style>\s*'
	r'<link rel="preload" as="image" href="/images/JOD%20Events%20Logo\.png"\s*/>\s*',
	re.DOTALL,
)

CRITICAL_NEW = """<style id="jod-header-logo-critical">
:root{--header-logo-height:6.5rem;--site-header-height:6.75rem}
#header:empty{min-height:6.75rem;display:block}
.site-header .brand-logo-slot{display:flex;align-items:center;height:6.5rem!important;max-height:6.5rem!important;max-width:17.125rem!important;overflow:hidden;flex-shrink:0}
.site-header .brand-logo,.site-header .brand img.brand-logo{height:6.5rem!important;max-height:6.5rem!important;width:auto!important;max-width:17.125rem!important;min-height:0!important;min-width:0!important;object-fit:contain!important;object-position:left center!important;display:block!important}
@media (max-width:1100px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:5.75rem!important;max-height:5.75rem!important;max-width:15.125rem!important}}
@media (max-width:800px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:5rem!important;max-height:5rem!important;max-width:13.125rem!important}}
@media (max-width:520px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:4.25rem!important;max-height:4.25rem!important;max-width:11.125rem!important}}
.site-header .nav-inner{min-height:0;padding:.2rem 0;align-items:center}
.site-header .desktop-nav>a,.site-header .nav-auth>a.button{white-space:nowrap}
</style>
<link rel="preload" as="image" href="/images/JOD%20Events%20Logo.png" fetchpriority="high" />
<link rel="stylesheet" href="css/fonts.css?v=2" />
"""

reps = [
    ("css/style.css?v=65", "css/style.css?v=66"),
    ("css/responsive.css?v=58", "css/responsive.css?v=59"),
    ("js/theme.js?v=22", "js/theme.js?v=23"),
    ("js/include.js?v=48", "js/include.js?v=49"),
    ("components/header.html?v=33", "components/header.html?v=34"),
    ("components/header.html?v=34", "components/header.html?v=34"),
]

skip_names = {
    "header.html",
    "footer.html",
    "privacy-policy-body.html",
    "refund-policy-body.html",
}

html_count = 0
for path in root.rglob("*.html"):
    if path.name in skip_names or "components" in path.parts or "scripts" in path.parts:
        continue
    text = path.read_text(encoding="utf-8")
    new = text
    if 'id="jod-header-logo-critical"' in new:
        new = CRITICAL_OLD.sub(CRITICAL_NEW, new, count=1)
        html_count += 1
    for old, nxt in reps:
        new = new.replace(old, nxt)
    if new != text:
        path.write_text(new, encoding="utf-8", newline="\n")

print("html updated", html_count)
