from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]

CRITICAL_OLD = re.compile(
	r'<style id="jod-header-logo-critical">.*?</style>\s*'
	r'<link rel="preload" as="image" href="/images/JOD%20Events%20Logo\.png"[^>]*>\s*'
	r'(?:<link rel="stylesheet" href="css/fonts\.css\?v=\d+"\s*/>\s*)?',
	re.DOTALL,
)

CRITICAL_NEW = """<style id="jod-header-logo-critical">
:root{--header-logo-height:4.25rem;--site-header-height:4.6rem}
#header:empty{min-height:4.6rem;display:block}
.site-header .brand-logo-slot{display:flex;align-items:center;height:4.25rem!important;max-height:4.25rem!important;max-width:11.2rem!important;overflow:hidden;flex-shrink:0}
.site-header .brand-logo,.site-header .brand img.brand-logo{height:4.25rem!important;max-height:4.25rem!important;width:auto!important;max-width:11.2rem!important;min-height:0!important;min-width:0!important;object-fit:contain!important;object-position:left center!important;display:block!important}
@media (max-width:1100px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:3.85rem!important;max-height:3.85rem!important;max-width:10.15rem!important}}
@media (max-width:800px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:3.5rem!important;max-height:3.5rem!important;max-width:9.2rem!important}}
@media (max-width:520px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:3.1rem!important;max-height:3.1rem!important;max-width:8.2rem!important}}
.site-header .nav-inner{min-height:0;padding:.2rem 0;align-items:center}
.site-header .desktop-nav>a,.site-header .nav-auth>a.button{white-space:nowrap}
</style>
<link rel="preload" as="image" href="/images/JOD%20Events%20Logo.png" fetchpriority="high" />
<link rel="stylesheet" href="css/fonts.css?v=2" />
"""

reps = [
	("css/style.css?v=70", "css/style.css?v=71"),
	("css/responsive.css?v=62", "css/responsive.css?v=63"),
	("js/theme.js?v=23", "js/theme.js?v=24"),
	("js/include.js?v=50", "js/include.js?v=51"),
	("components/header.html?v=34", "components/header.html?v=35"),
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
		new2, n = CRITICAL_OLD.subn(CRITICAL_NEW, new, count=1)
		if n:
			new = new2
			html_count += 1
	for old, nxt in reps:
		new = new.replace(old, nxt)
	if new != text:
		path.write_text(new, encoding="utf-8", newline="\n")

print("html critical updated", html_count)
