/* Shared helpers for the movie pages (theatre dashboard, movies, seat booking, ticket). */
(function (global) {
	"use strict";

	function origin() {
		return (((global.JodHealth && global.JodHealth.getApiBaseUrl && global.JodHealth.getApiBaseUrl())
			|| (global.JodConfig && global.JodConfig.getApiOrigin && global.JodConfig.getApiOrigin())
			|| (global.JodAuth && global.JodAuth.API_BASE) || global.JOD_API_BASE_OVERRIDE || "")).replace(/\/$/, "");
	}

	function fetcher() {
		return global.JodAuth && typeof global.JodAuth.fetchAuth === "function" ? global.JodAuth.fetchAuth : global.fetch.bind(global);
	}

	function errorText(data, status) {
		const d = data && data.detail;
		if (typeof d === "string" && d.trim()) return d;
		if (d && typeof d === "object" && !Array.isArray(d) && d.message) return d.message;
		if (Array.isArray(d) && d.length) return d.map((x) => (x && x.msg) || String(x)).join(" ");
		if (status === 401) return "Please log in again.";
		if (status === 404) return "Not found. If this keeps happening, the server may still be updating.";
		return "Something went wrong. Please try again.";
	}

	async function api(path, options) {
		const opts = Object.assign({ method: "GET" }, options || {});
		const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
		if (opts.json !== undefined) {
			headers["Content-Type"] = "application/json";
			opts.body = JSON.stringify(opts.json);
			delete opts.json;
		}
		opts.headers = headers;
		const res = await fetcher()(origin() + path, opts);
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const err = new Error(errorText(data, res.status));
			err.status = res.status;
			err.data = data;
			throw err;
		}
		return data;
	}

	function esc(value) {
		return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	}

	function money(value) {
		const n = Number(value) || 0;
		return "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
	}

	function asDate(iso) {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function time(iso) {
		const d = asDate(iso);
		return d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
	}

	function day(iso) {
		const d = asDate(iso);
		return d ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "";
	}

	function istDateKey(iso) {
		const d = asDate(iso);
		if (!d) return "";
		const ist = new Date(d.getTime() + 330 * 60000);
		return ist.toISOString().slice(0, 10);
	}

	function resolveMedia(url) {
		if (!url) return "";
		if (/^https?:\/\//i.test(url)) return url;
		return origin() + url;
	}

	function param(name) {
		return new URLSearchParams(global.location.search).get(name);
	}

	function loggedIn() {
		return Boolean(global.JodAuth && typeof global.JodAuth.isLoggedIn === "function" && global.JodAuth.isLoggedIn());
	}

	function askLogin(title, message) {
		const target = global.location.pathname.replace(/^\//, "") + global.location.search;
		if (global.JodAuth && typeof global.JodAuth.openGuestAuthModal === "function") {
			global.JodAuth.openGuestAuthModal({ title, message, targetUrl: target, badge: "\uD83C\uDFAC Movies" });
		} else {
			global.location.href = "login.html?redirect=" + encodeURIComponent(target);
		}
	}

	function toast(message, tone) {
		let el = document.getElementById("cinemaToast");
		if (!el) {
			el = document.createElement("div");
			el.id = "cinemaToast";
			el.className = "cinema-toast";
			el.setAttribute("role", "status");
			document.body.appendChild(el);
		}
		el.textContent = message;
		el.className = "cinema-toast is-on" + (tone ? " is-" + tone : "");
		clearTimeout(el._t);
		el._t = setTimeout(() => { el.className = "cinema-toast"; }, 4200);
	}

	/* Must accept the same links as Services/movie_details.py youtube_id. */
	const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
	function youtubeId(text) {
		let raw = String(text == null ? "" : text).trim();
		if (!raw) return null;
		if (VIDEO_ID.test(raw)) return raw;
		if (raw.indexOf("://") === -1) raw = "https://" + raw;
		let url;
		try { url = new URL(raw); } catch (_) { return null; }
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
		const parts = url.pathname.split("/").filter(Boolean);
		let id = null;
		if (host === "youtu.be") id = parts[0] || null;
		else if (host === "youtube.com" || host === "youtube-nocookie.com") {
			if (parts[0] === "watch") id = url.searchParams.get("v");
			else if (parts.length >= 2 && ["shorts", "embed", "live", "v", "e"].indexOf(parts[0]) !== -1) id = parts[1];
		}
		return id && VIDEO_ID.test(id) ? id : null;
	}

	function youtubeThumb(id) {
		return "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg";
	}

	function youtubeEmbed(id) {
		return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
	}

	/* Same as _norm() in APIs/movies.py: the movie page key is "<title>-<language>", letters and digits only. */
	function norm(text) {
		return Array.from(String(text == null ? "" : text).toLowerCase()).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join("");
	}

	function movieKey(title, language) {
		return norm(title) + "-" + norm(language);
	}

	function initials(name) {
		return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
	}

	global.JodCinema = { origin, api, esc, money, time, day, istDateKey, resolveMedia, param, loggedIn, askLogin, toast, youtubeId, youtubeThumb, youtubeEmbed, initials, movieKey };
})(window);
