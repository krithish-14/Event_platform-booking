/**
 * Single API origin for every page.
 * Production (nginx same origin): "" so fetch("/api/...") and fetch("/health") work.
 * Local split (Live Server / start_servers on :5500): http://127.0.0.1:8001
 * Override: window.JOD_API_BASE_OVERRIDE
 */
(function (global) {
	"use strict";

	function stripSlash(value) {
		return String(value || "").replace(/\/$/, "");
	}

	function isLocalSplitFrontend() {
		if (!global.location) return false;
		const loc = global.location;
		if (loc.protocol === "file:") return true;
		const host = loc.hostname || "";
		const port = String(loc.port || "");
		const localHost = host === "localhost" || host === "127.0.0.1";
		if (!localHost) return false;
		return port === "5500" || port === "5501" || port === "5173";
	}

	function getApiOrigin() {
		if (global.JOD_API_BASE_OVERRIDE) return stripSlash(global.JOD_API_BASE_OVERRIDE);
		if (isLocalSplitFrontend()) return "http://127.0.0.1:8001";
		return "";
	}

	function getApiBase() {
		const origin = getApiOrigin();
		return origin ? origin + "/api" : "/api";
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function safeMediaUrl(url, fallback) {
		const placeholder = fallback || "images/hero-event.jpg";
		if (!url) return placeholder;
		const trimmed = String(url).trim();
		const lower = trimmed.toLowerCase();
		if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
			return placeholder;
		}
		if (lower.startsWith("https://")) return trimmed;
		if (lower.startsWith("http://")) {
			try {
				const parsed = new URL(trimmed);
				if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return trimmed;
			} catch (_) {}
			return placeholder;
		}
		if (trimmed.startsWith("/") || trimmed.startsWith("images/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
			return trimmed;
		}
		return placeholder;
	}

	function readCookie(name) {
		try {
			const parts = ("; " + document.cookie).split("; " + name + "=");
			if (parts.length < 2) return "";
			return decodeURIComponent(parts.pop().split(";").shift() || "");
		} catch (_) {
			return "";
		}
	}

	try {
		localStorage.removeItem("jod_access_token");
		sessionStorage.removeItem("jod_access_token");
	} catch (_) {}

	const nativeFetch = global.fetch ? global.fetch.bind(global) : null;
	if (nativeFetch) {
		global.fetch = function (input, init) {
			const initObj = Object.assign({}, init || {});
			let url = "";
			if (typeof input === "string") url = input;
			else if (input && typeof input.url === "string") url = input.url;
			const origin = getApiOrigin();
			const isApi = url.startsWith("/") ||
				url.startsWith(origin + "/") ||
				url.indexOf("/api/") !== -1 ||
				/127\.0\.0\.1:8001|localhost:8001/.test(url);
			if (isApi) {
				initObj.credentials = initObj.credentials || "include";
				const method = String(
					initObj.method ||
					(typeof input !== "string" && input && input.method) ||
					"GET"
				).toUpperCase();
				if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
					const csrf = readCookie("jod_csrf");
					if (csrf) {
						const headers = new Headers(initObj.headers || {});
						if (!headers.has("X-CSRF-Token") && !headers.has("x-csrf-token")) {
							headers.set("X-CSRF-Token", csrf);
						}
						initObj.headers = headers;
					}
				}
			}
			return nativeFetch(input, initObj);
		};
	}

	global.JodConfig = {
		getApiOrigin: getApiOrigin,
		getApiBase: getApiBase,
		escapeHtml: escapeHtml,
		safeMediaUrl: safeMediaUrl,
	};
	global.escHtml = escapeHtml;
	global.getApiBaseUrl = getApiOrigin;
})(typeof window !== "undefined" ? window : this);
