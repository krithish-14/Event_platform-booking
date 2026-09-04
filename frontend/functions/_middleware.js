/**
 * Cloudflare Pages middleware — inject event Open Graph tags for share previews.
 * Runs before static assets so WhatsApp/Facebook crawlers receive event meta
 * (hero image, about text, canonical URL) without executing JavaScript.
 */
const API_ORIGIN = "https://api.jodevents.com";
const SITE_ORIGIN = "https://jodevents.com";
const FALLBACK_IMAGE = "https://assets.jodevents.com/images/hero-event.jpg";

function escapeHtml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function absoluteMediaUrl(raw) {
	const text = String(raw || "").trim();
	if (!text) return FALLBACK_IMAGE;
	if (/^https?:\/\//i.test(text)) return text;
	if (text.startsWith("//")) return `https:${text}`;
	if (text.startsWith("/")) return `${SITE_ORIGIN}${text}`;
	if (text.startsWith("images/") || text.startsWith("uploads/")) {
		return `https://assets.jodevents.com/${text.replace(/^\/+/, "")}`;
	}
	return `${SITE_ORIGIN}/${text.replace(/^\.\//, "")}`;
}

function clipDescription(text, title) {
	const cleaned = String(text || "")
		.replace(/\s+/g, " ")
		.trim();
	if (cleaned) return cleaned.slice(0, 220);
	return `Book tickets for ${title} on JOD Events.`;
}

function upsertMeta(html, attr, key, content) {
	const safe = escapeHtml(content);
	const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*>`, "i");
	const tag = `<meta ${attr}="${key}" content="${safe}" />`;
	if (re.test(html)) return html.replace(re, tag);
	return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
}

function upsertCanonical(html, href) {
	const safe = escapeHtml(href);
	const re = /<link[^>]+rel=["']canonical["'][^>]*>/i;
	const tag = `<link rel="canonical" href="${safe}" />`;
	if (re.test(html)) return html.replace(re, tag);
	return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
}

function injectEventMeta(html, event, pageUrl) {
	const title = String(event.title || "Event Details").trim() || "Event Details";
	const description = clipDescription(event.description, title);
	const image = absoluteMediaUrl(event.image_url || event.card_image || "");
	const docTitle = `${title} — JOD Events`;

	let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(docTitle)}</title>`);
	out = upsertMeta(out, "name", "description", description);
	out = upsertMeta(out, "property", "og:type", "website");
	out = upsertMeta(out, "property", "og:site_name", "JOD Events");
	out = upsertMeta(out, "property", "og:title", title);
	out = upsertMeta(out, "property", "og:description", description);
	out = upsertMeta(out, "property", "og:url", pageUrl);
	out = upsertMeta(out, "property", "og:image", image);
	out = upsertMeta(out, "property", "og:image:alt", title);
	out = upsertMeta(out, "name", "twitter:card", "summary_large_image");
	out = upsertMeta(out, "name", "twitter:title", title);
	out = upsertMeta(out, "name", "twitter:description", description);
	out = upsertMeta(out, "name", "twitter:image", image);
	out = upsertCanonical(out, pageUrl);
	return out;
}

async function fetchEvent(eventId) {
	const res = await fetch(`${API_ORIGIN}/api/events/public/${encodeURIComponent(eventId)}`, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) return null;
	return res.json();
}

async function loadEventDetailsHtml(context, url) {
	const assetUrl = new URL("/event-details.html", url.origin);
	if (context.env && context.env.ASSETS && typeof context.env.ASSETS.fetch === "function") {
		const res = await context.env.ASSETS.fetch(assetUrl.toString());
		if (res && res.ok) return res;
	}
	return context.next();
}

export async function onRequest(context) {
	const url = new URL(context.request.url);
	const path = url.pathname.replace(/\/$/, "") || "/";
	const isEventDetails =
		path === "/event-details" ||
		path === "/event-details.html";

	if (!isEventDetails) {
		return context.next();
	}

	const eventId = (url.searchParams.get("id") || "").trim();
	const pageUrl = eventId
		? `${SITE_ORIGIN}/event-details?id=${encodeURIComponent(eventId)}`
		: `${SITE_ORIGIN}/event-details`;

	const assetRes = await loadEventDetailsHtml(context, url);
	if (!assetRes || !assetRes.ok) {
		return assetRes || context.next();
	}

	let html = await assetRes.text();
	if (eventId) {
		try {
			const event = await fetchEvent(eventId);
			if (event) html = injectEventMeta(html, event, pageUrl);
		} catch (_) {
			/* keep SPA HTML */
		}
	}

	const headers = new Headers(assetRes.headers);
	headers.set("content-type", "text/html; charset=utf-8");
	headers.set("cache-control", "public, max-age=60, s-maxage=60");
	return new Response(html, {
		status: 200,
		headers,
	});
}
