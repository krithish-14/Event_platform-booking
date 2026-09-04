/**
 * Named Pages Function for /event-details.
 * Rewrites Open Graph tags on the real event-details.html. Never replaces the page.
 */
const API_ORIGIN = "https://api.jodevents.com";
const SITE_ORIGIN = "https://jodevents.com";
const FALLBACK_IMAGE = "https://assets.jodevents.com/images/hero-event.jpg";

function clipDescription(text, title) {
	const cleaned = String(text || "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
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
