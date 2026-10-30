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

	global.JodCinema = { origin, api, esc, money, time, day, istDateKey, resolveMedia, param, loggedIn, askLogin, toast };
})(window);
