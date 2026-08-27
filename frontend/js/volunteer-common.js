window.JodVolunteer = (() => {
	"use strict";

	const PORTAL_TOKEN_KEY = "jod_volunteer_portal_token";

	function apiRoot() {
		if (window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			return String(window.JodConfig.getApiOrigin()).replace(/\/$/, "");
		}
		if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return String(window.JodHealth.getApiBaseUrl()).replace(/\/$/, "");
		}
		if (window.JodAuth && window.JodAuth.API_BASE) return String(window.JodAuth.API_BASE).replace(/\/$/, "");
		if (window.JOD_API_BASE_OVERRIDE) return String(window.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
		const host = (window.location && window.location.hostname) || "";
		if (host === "localhost" || host === "127.0.0.1") return "http://127.0.0.1:8001";
		return "https://api.jodevents.com";
	}

	function apiBase() {
		return `${String(apiRoot() || "").replace(/\/$/, "")}/api/volunteers`;
	}

	function prettyPage(raw) {
		return (window.JodUrls && window.JodUrls.prettyHref) ? window.JodUrls.prettyHref(raw) : raw;
	}

	function volunteerUrls(path) {
		const p = path.startsWith("/") ? path : `/${path}`;
		const root = String(apiRoot() || "").replace(/\/$/, "");
		const urls = [];
		if (root) {
			urls.push(`${root}/api/volunteers${p}`);
			urls.push(`${root}${p}`);
		} else {
			urls.push(`/api/volunteers${p}`);
			urls.push(p);
		}
		return urls;
	}

	function isMissingRoute(status, data) {
		if (status !== 404) return false;
		const detail = data && data.detail;
		return !detail || detail === "Not Found";
	}

	function authHeaders(extra) {
		const token = window.JodAuth && typeof window.JodAuth.getToken === "function"
			? window.JodAuth.getToken()
			: null;
		const headers = Object.assign({}, extra || {});
		if (token) headers.Authorization = `Bearer ${token}`;
		return headers;
	}

	function isLoggedIn() {
		return Boolean(window.JodAuth && window.JodAuth.isLoggedIn && window.JodAuth.isLoggedIn());
	}

	function currentUser() {
		return window.JodAuth && window.JodAuth.getUser ? window.JodAuth.getUser() : null;
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function formatTime(iso) {
		if (!iso) return "";
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return "";
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	function apiError(data, fallback) {
		if (!data) return fallback;
		const detail = data.detail;
		if (typeof detail === "string" && detail.trim()) return detail;
		if (Array.isArray(detail) && detail.length) {
			return detail.map((item) => (item && item.msg) ? item.msg : String(item)).join(" ");
		}
		if (data.message) return data.message;
		return fallback;
	}

	function pageRedirectUrl() {
		return window.location.pathname + window.location.search;
	}

	function loginUrl(next) {
		const target = next || pageRedirectUrl();
		return prettyPage(`login.html?redirect=${encodeURIComponent(target)}`);
	}

	function signupUrl(next) {
		const target = next || pageRedirectUrl();
		return prettyPage(`signup.html?redirect=${encodeURIComponent(target)}`);
	}

	function requireAuth(next) {
		if (isLoggedIn()) return true;
		window.location.href = loginUrl(next);
		return false;
	}

	function getPortalToken() {
		const params = new URLSearchParams(window.location.search);
		let fromUrl = (params.get("token") || "").trim();
		if (!fromUrl && window.location.hash) {
			const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
			fromUrl = (hashParams.get("token") || "").trim();
		}
		if (fromUrl) {
			try { sessionStorage.setItem(PORTAL_TOKEN_KEY, fromUrl); } catch (_) {}
			try {
				params.delete("token");
				const next = params.toString();
				const clean = window.location.pathname + (next ? `?${next}` : "");
				window.history.replaceState({}, document.title, clean);
			} catch (_) {}
			return fromUrl;
		}
		try { return sessionStorage.getItem(PORTAL_TOKEN_KEY) || ""; } catch (_) { return ""; }
	}

	function portalUrl(token) {
		const t = token || getPortalToken();
		const raw = t ? `volunteer-portal.html#token=${encodeURIComponent(t)}` : "volunteer-portal.html";
		return prettyPage(raw);
	}

	function scannerUrl(token) {
		const t = token || getPortalToken();
		const raw = t ? `volunteer-scanner.html#token=${encodeURIComponent(t)}` : "volunteer-scanner.html";
		return prettyPage(raw);
	}

	async function request(path, options) {
		const opts = options || {};
		const headers = authHeaders(opts.headers || {});
		if (opts.json) headers["Content-Type"] = "application/json";
		const urls = volunteerUrls(path);
		let res = null;
		let data = {};
		for (let i = 0; i < urls.length; i++) {
			res = await fetch(urls[i], Object.assign({}, opts, {
				headers,
				body: opts.json ? JSON.stringify(opts.json) : opts.body,
				cache: opts.cache || "default",
				credentials: "include"
			}));
			data = {};
			try { data = await res.json(); } catch (_) {}
			if (res.ok) break;
			if (!isMissingRoute(res.status, data) || i === urls.length - 1) break;
		}

		if (res && res.status === 401) {
			if (window.JodAuth && typeof window.JodAuth.clearAuth === "function") {
				window.JodAuth.clearAuth();
			}
			if (!opts.allowUnauthorized) {
				window.location.href = loginUrl();
			}
		}

		return { ok: Boolean(res && res.ok), status: res ? res.status : 0, data };
	}

	async function fetchPortal() {
		const token = getPortalToken();
		if (!token) {
			return {
				ok: false,
				status: 400,
				data: { detail: "Open the volunteer link from your invitation email to continue." }
			};
		}
		return request(`/portal/${encodeURIComponent(token)}`, {
			allowUnauthorized: true,
			cache: "no-store"
		});
	}

	async function acceptPortal() {
		const token = getPortalToken();
		if (!token) {
			return { ok: false, status: 400, data: { detail: "Missing volunteer access link." } };
		}
		return request(`/portal/${encodeURIComponent(token)}/accept`, {
			method: "POST",
			allowUnauthorized: true
		});
	}

	async function verifyPortalTicket(json) {
		const token = getPortalToken();
		if (!token) {
			return { ok: false, status: 400, data: { detail: "Missing volunteer access link." } };
		}
		return request(`/portal/${encodeURIComponent(token)}/verify-ticket`, {
			method: "POST",
			json,
			allowUnauthorized: true
		});
	}

	async function logout() {
		try {
			if (window.JodAuth && typeof window.JodAuth.logout === "function") {
				await window.JodAuth.logout();
			} else {
				localStorage.removeItem("jod_access_token");
				sessionStorage.removeItem("jod_access_token");
				localStorage.removeItem("jod_user");
				sessionStorage.removeItem("jod_user");
			}
		} catch (_) {}
		window.location.href = prettyPage("login.html");
	}

	return {
		apiBase,
		authHeaders,
		isLoggedIn,
		currentUser,
		escapeHtml,
		formatTime,
		apiError,
		loginUrl,
		signupUrl,
		requireAuth,
		request,
		logout,
		pageRedirectUrl,
		getPortalToken,
		portalUrl,
		scannerUrl,
		fetchPortal,
		acceptPortal,
		verifyPortalTicket
	};
})();
