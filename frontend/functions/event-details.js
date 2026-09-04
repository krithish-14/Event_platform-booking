/**
 * Named Pages Function for /event-details.
 * Used when `functions/` is deployed. `_worker.js` takes over if both exist.
 */
const API_ORIGIN = "https://api.jodevents.com";
const SITE_ORIGIN = "https://jodevents.com";
const FALLBACK_IMAGE = "https://assets.jodevents.com/images/hero-event.jpg";

function clipDescription(text, title) {
	const cleaned = String(text || "").replace(/\s+/g, " ").trim();
	if (cleaned) return cleaned.slice(0, 220);
	return `Book tickets for ${title} on JOD Events.`;
}

function escapeAttr(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;");
}

function absoluteMediaUrl(raw, apiOrigin, siteOrigin) {
	const text = String(raw || "").trim();
	if (!text) return FALLBACK_IMAGE;
	if (/^https?:\/\//i.test(text)) return text;
	if (text.startsWith("//")) return `https:${text}`;
	if (text.startsWith("/")) {
		if (text.startsWith("/uploads") || text.startsWith("/media") || text.startsWith("/api/")) {
			return `${apiOrigin}${text}`;
		}
		return `${siteOrigin}${text}`;
	}
	if (text.startsWith("images/")) return `https://assets.jodevents.com/${text}`;
	if (text.startsWith("uploads/")) return `${apiOrigin}/${text}`;
	return `${siteOrigin}/${text.replace(/^\.\//, "")}`;
}

function applyShareTags(html, event, pageUrl, apiOrigin, siteOrigin) {
	const title = String(event.title || "Event Details").trim() || "Event Details";
	const description = clipDescription(event.description, title);
	const image = absoluteMediaUrl(event.image_url || event.card_image || "", apiOrigin, siteOrigin);
	const docTitle = `${title} — JOD Events`;
	const replacements = [
		["name", "description", description],
		["property", "og:title", title],
		["property", "og:description", description],
		["property", "og:url", pageUrl],
		["property", "og:image", image],
		["property", "og:image:alt", title],
		["name", "twitter:title", title],
		["name", "twitter:description", description],
		["name", "twitter:image", image],
	];
	let out = String(html || "");
	for (const [attr, key, value] of replacements) {
		const escaped = escapeAttr(value);
		const re = new RegExp(
			`(<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*\\bcontent=["'])([^"']*)(["'])`,
			"i"
		);
		if (re.test(out)) out = out.replace(re, `$1${escaped}$3`);
	}
	out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(docTitle)}</title>`);
	out = out.replace(
		/(<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["'])([^"']*)(["'])/i,
		`$1${escapeAttr(pageUrl)}$3`
	);
	if (!out.includes("jod-og:event")) {
		out = out.replace(/<\/head>/i, "<!-- jod-og:event -->\n</head>");
	}
	return out;
}

function isShareBot(request) {
	const ua = String(request.headers.get("user-agent") || "");
	return /facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot/i.test(
		ua
	);
}

function ogOnlyPage(event, pageUrl, apiOrigin, siteOrigin) {
	const title = String(event.title || "Event Details").trim() || "Event Details";
	const description = clipDescription(event.description, title);
	const image = absoluteMediaUrl(event.image_url || event.card_image || "", apiOrigin, siteOrigin);
	const docTitle = `${title} — JOD Events`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeAttr(docTitle)}</title>
<meta name="description" content="${escapeAttr(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="JOD Events" />
<meta property="og:title" content="${escapeAttr(title)}" />
<meta property="og:description" content="${escapeAttr(description)}" />
<meta property="og:url" content="${escapeAttr(pageUrl)}" />
<meta property="og:image" content="${escapeAttr(image)}" />
<meta property="og:image:alt" content="${escapeAttr(title)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeAttr(title)}" />
<meta name="twitter:description" content="${escapeAttr(description)}" />
<meta name="twitter:image" content="${escapeAttr(image)}" />
<link rel="canonical" href="${escapeAttr(pageUrl)}" />
<!-- jod-og:event -->
</head>
<body>
<h1>${escapeAttr(title)}</h1>
<p>${escapeAttr(description)}</p>
<p><a href="${escapeAttr(pageUrl)}">Open event</a></p>
</body>
</html>`;
}

async function fetchEvent(eventId, apiOrigin) {
	const urls = [
		`${apiOrigin}/api/events/public/${encodeURIComponent(eventId)}`,
		`${apiOrigin}/api/events/${encodeURIComponent(eventId)}`,
	];
	for (const endpoint of urls) {
		try {
			const res = await fetch(endpoint, {
				headers: { Accept: "application/json", "User-Agent": "JOD-Events-OG/1.0" },
			});
			if (!res.ok) continue;
			const data = await res.json();
			if (data && (data.title || data.image_url || data.description)) return data;
		} catch (_) {
			/* try next */
		}
	}
	return null;
}

export async function onRequest(context) {
	const url = new URL(context.request.url);
	const host = String(url.hostname || "");
	const local = host === "127.0.0.1" || host === "localhost";
	const apiOrigin = local ? `${url.protocol}//127.0.0.1:8001` : API_ORIGIN;
	const siteOrigin = local ? url.origin : SITE_ORIGIN;
	const eventId = (url.searchParams.get("id") || "").trim();
	const pageUrl = eventId
		? `${siteOrigin}/event-details?id=${encodeURIComponent(eventId)}`
		: `${siteOrigin}/event-details`;

	const assetRes = await context.next();
	if (!assetRes || !assetRes.ok) return assetRes;
	if (!eventId) return assetRes;

	try {
		const event = await fetchEvent(eventId, apiOrigin);
		if (!event) return assetRes;
		if (isShareBot(context.request)) {
			return new Response(ogOnlyPage(event, pageUrl, apiOrigin, siteOrigin), {
				status: 200,
				headers: {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "public, max-age=60, must-revalidate",
				},
			});
		}
		const html = applyShareTags(await assetRes.text(), event, pageUrl, apiOrigin, siteOrigin);
		return new Response(html, {
			status: 200,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "public, max-age=60, must-revalidate",
			},
		});
	} catch (_) {
		return assetRes;
	}
}
