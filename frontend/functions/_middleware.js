/**
 * Cloudflare Pages middleware for /event-details.
 * `_routes.json` must include this path; otherwise Pages serves the static HTML
 * and WhatsApp/Facebook never see event title, description, or hero image.
 */
const API_ORIGIN = "https://api.jodevents.com";
const SITE_ORIGIN = "https://jodevents.com";
const FALLBACK_IMAGE = "https://assets.jodevents.com/images/hero-event.jpg";

function clipDescription(text, title) {
	const cleaned = String(text || "").replace(/\s+/g, " ").trim();
	if (cleaned) return cleaned.slice(0, 220);
	return `Book tickets for ${title} on JOD Events.`;
}

function absoluteMediaUrl(raw, apiOrigin = API_ORIGIN, siteOrigin = SITE_ORIGIN) {
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

function isEventDetailsPath(pathname) {
	const path = String(pathname || "").replace(/\/$/, "") || "/";
	return path === "/event-details" || path === "/event-details.html";
}

async function fetchEvent(eventId, apiOrigin = API_ORIGIN) {
	const urls = [
		`${apiOrigin}/api/events/public/${encodeURIComponent(eventId)}`,
		`${apiOrigin}/api/events/${encodeURIComponent(eventId)}`,
	];
	for (const url of urls) {
		try {
			const res = await fetch(url, {
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

function rewriteEventHtml(response, event, pageUrl, apiOrigin = API_ORIGIN, siteOrigin = SITE_ORIGIN) {
	const title = String(event.title || "Event Details").trim() || "Event Details";
	const description = clipDescription(event.description, title);
	const image = absoluteMediaUrl(event.image_url || event.card_image || "", apiOrigin, siteOrigin);
	const docTitle = `${title} — JOD Events`;
	const tags = {
		description,
		"og:type": "website",
		"og:site_name": "JOD Events",
		"og:title": title,
		"og:description": description,
		"og:url": pageUrl,
		"og:image": image,
		"og:image:alt": title,
		"twitter:card": "summary_large_image",
		"twitter:title": title,
		"twitter:description": description,
		"twitter:image": image,
	};

	return new HTMLRewriter()
		.on("title", {
			element(el) {
				el.setInnerContent(docTitle);
			},
		})
		.on("meta", {
			element(el) {
				const key = el.getAttribute("property") || el.getAttribute("name");
				if (key && tags[key]) el.setAttribute("content", tags[key]);
			},
		})
		.on('link[rel="canonical"]', {
			element(el) {
				el.setAttribute("href", pageUrl);
			},
		})
		.on("head", {
			element(el) {
				el.append(`\n<!-- jod-og:event -->\n`, { html: true });
			},
		})
		.transform(response);
}

function isLocalRequest(url) {
	const host = String(url.hostname || "");
	return host === "127.0.0.1" || host === "localhost";
}

export async function onRequest(context) {
	const url = new URL(context.request.url);
	if (!isEventDetailsPath(url.pathname)) {
		return context.next();
	}

	const local = isLocalRequest(url);
	const apiOrigin = local ? `${url.protocol}//127.0.0.1:8001` : API_ORIGIN;
	const siteOrigin = local ? url.origin : SITE_ORIGIN;
	const eventId = (url.searchParams.get("id") || "").trim();
	const pageUrl = eventId
		? `${siteOrigin}/event-details?id=${encodeURIComponent(eventId)}`
		: `${siteOrigin}/event-details`;

	const assetRes = await context.next();
	if (!assetRes || !assetRes.ok) return assetRes;

	const headers = new Headers(assetRes.headers);
	headers.set("content-type", "text/html; charset=utf-8");
	headers.set("cache-control", "public, max-age=60, must-revalidate");
	const htmlRes = new Response(assetRes.body, { status: 200, headers });

	if (!eventId) return htmlRes;

	try {
		const event = await fetchEvent(eventId, apiOrigin);
		if (!event) return htmlRes;
		return rewriteEventHtml(htmlRes, event, pageUrl, apiOrigin, siteOrigin);
	} catch (_) {
		return htmlRes;
	}
}
