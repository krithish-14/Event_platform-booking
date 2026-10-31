/**
 * Cloudflare Pages worker for /event-details.
 * Injects event title, description, and image into Open Graph tags.
 * Always returns the real event-details.html for browsers.
 */
const API_ORIGIN = "https://api.jodevents.com";
const SITE_ORIGIN = "https://jodevents.com";
const FALLBACK_IMAGE = "https://assets.jodevents.com/images/hero-event.jpg";

function clipDescription(text, title) {
	const cleaned = String(text || "")
 .replace(/<\s*br\s*\/?\s*>/gi, " ")
 .replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote)\s*>/gi, " ")
 .replace(/<[^>]+>/g, " ")
 .replace(/&nbsp;/gi, " ")
 .replace(/&amp;/g, "&")
 .replace(/&lt;/g, "<")
 .replace(/&gt;/g, ">")
 .replace(/&quot;/g, '"')
 .replace(/\.([A-Za-z])/g, ". $1")
 .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
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

function isEventDetailsPath(pathname) {
	const path = String(pathname || "").replace(/\/$/, "") || "/";
	return path === "/event-details" || path === "/event-details.html";
}

function isLocalHost(hostname) {
	return hostname === "127.0.0.1" || hostname === "localhost";
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

function applyShareTags(html, event, pageUrl, apiOrigin, siteOrigin) {
	const title = String(event.title || "Event Details").trim() || "Event Details";
	return fillShareTags(html, {
 title,
 description: clipDescription(event.description, title),
 image: absoluteMediaUrl(event.image_url || event.card_image || "", apiOrigin, siteOrigin),
 imageAlt: title,
 pageUrl,
 docTitle: `${title} — JOD Events`,
 marker: "jod-og:event",
	});
}

/* Replaces the content of the page's existing meta tags; the page must ship default tags for each. */
function fillShareTags(html, tags) {
	const { title, description, image, imageAlt, pageUrl, docTitle, marker } = tags;
	const replacements = [
 ["name", "description", description],
 ["property", "og:title", title],
 ["property", "og:description", description],
 ["property", "og:url", pageUrl],
 ["property", "og:image", image],
 ["property", "og:image:alt", imageAlt || title],
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
	if (marker && !out.includes(marker)) {
 out = out.replace(/<\/head>/i, `<!-- ${marker} -->\n</head>`);
	}
	return out;
}

/* ── /movie?m=<key>: poster, title and details for WhatsApp / social link previews ── */
function isMoviePath(pathname) {
	const path = String(pathname || "").replace(/\/$/, "") || "/";
	return path === "/movie" || path === "/movie.html";
}

function runtimeText(minutes) {
	const n = Number(minutes) || 0;
	return n ? `${Math.floor(n / 60)}h ${n % 60}m` : "";
}

async function fetchJson(url, timeoutMs) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
 const res = await fetch(url, {
 headers: { Accept: "application/json", "User-Agent": "JOD-Events-OG/1.0" },
 signal: ctrl.signal,
 cf: { cacheTtl: 300, cacheEverything: true },
 });
 return res.ok ? await res.json() : null;
	} catch (_) {
 return null;
	} finally {
 clearTimeout(timer);
	}
}

async function fetchMovie(key, apiOrigin) {
	const direct = await fetchJson(`${apiOrigin}/api/movies/by-key/${encodeURIComponent(key)}`, 3000);
	if (direct && direct.title) return direct;
	const listing = await fetchJson(`${apiOrigin}/api/movies/now-showing`, 3000);
	return (listing && Array.isArray(listing.movies) ? listing.movies : []).find((m) => m.key === key) || null;
}

function movieShareTags(movie, pageUrl, apiOrigin, siteOrigin) {
	const name = `${movie.title}${movie.language ? ` (${movie.language})` : ""}`;
	const facts = [movie.certificate, movie.language, runtimeText(movie.duration_min), movie.genres].filter(Boolean).join(" · ");
	const about = clipDescription(movie.description, movie.title);
	const full = `${facts ? `${facts}. ` : ""}${about}`;
	const description = full.length > 200 ? `${full.slice(0, 200).replace(/\s+\S*$/, "")}…` : full;
	return {
 title: `${name} — Book tickets on JOD Events`,
 description,
 image: movie.poster_url ? absoluteMediaUrl(movie.poster_url, apiOrigin, siteOrigin) : FALLBACK_IMAGE,
 imageAlt: `${movie.title} poster`,
 pageUrl,
 docTitle: `${name} — Book tickets | JOD Events`,
 marker: "jod-og:movie",
	};
}

async function handleMovie(request, env) {
	const url = new URL(request.url);
	const local = isLocalHost(url.hostname);
	const apiOrigin = local ? `${url.protocol}//127.0.0.1:8001` : API_ORIGIN;
	const siteOrigin = local ? url.origin : SITE_ORIGIN;
	const key = (url.searchParams.get("m") || "").trim().toLowerCase();
	let assetRes = null;
	for (const path of ["/movie", "/movie.html"]) {
 const res = await env.ASSETS.fetch(new URL(path, url.origin).toString(), { method: "GET" });
 if (res && res.ok) {
 assetRes = res;
 break;
 }
	}
	if (!assetRes) return env.ASSETS.fetch(request);
	if (!key) return assetRes;
	try {
 const movie = await fetchMovie(key, apiOrigin);
 if (!movie) return assetRes;
 const pageUrl = `${siteOrigin}/movie?m=${encodeURIComponent(key)}`;
 const html = fillShareTags(await assetRes.text(), movieShareTags(movie, pageUrl, apiOrigin, siteOrigin));
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

async function loadEventDetailsHtml(env, origin) {
	if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
	const assetUrl = new URL("/event-details.html", origin).toString();
	const assetRes = await env.ASSETS.fetch(assetUrl, { method: "GET" });
	if (assetRes && assetRes.ok) return assetRes;
	return null;
}

async function handleEventDetails(request, env) {
	const url = new URL(request.url);
	const local = isLocalHost(url.hostname);
	const apiOrigin = local ? `${url.protocol}//127.0.0.1:8001` : API_ORIGIN;
	const siteOrigin = local ? url.origin : SITE_ORIGIN;
	const eventId = (url.searchParams.get("id") || "").trim();
	const pageUrl = eventId
 ? `${siteOrigin}/event-details?id=${encodeURIComponent(eventId)}`
 : `${siteOrigin}/event-details`;

	const assetRes = await loadEventDetailsHtml(env, url.origin);
	if (!assetRes) {
 if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
 return env.ASSETS.fetch(request);
 }
 return new Response("Event details unavailable.", { status: 503 });
	}

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

export default {
	async fetch(request, env) {
 const url = new URL(request.url);
 if (isEventDetailsPath(url.pathname)) {
 return handleEventDetails(request, env);
 }
 if (isMoviePath(url.pathname) && env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
 return handleMovie(request, env);
 }
 if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
 return env.ASSETS.fetch(request);
 }
 return new Response("Not found", { status: 404 });
	},
};
