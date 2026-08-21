/**
 * JOD Events — per-user Light / Dark theme.
 * Guests, login, and signup always use light. A logged-in user's choice
 * is stored under their account and restored on the next login.
 */
(function initJodTheme(global) {
	"use strict";

	var LEGACY_KEY = "jod_theme";
	var PREFS_KEY = "jod_theme_prefs";
	var EVENT_NAME = "jod-theme-change";
	var DARK_CSS_ID = "jod-theme-dark-css";
	var DARK_CSS_HREF = "css/theme-dark.css?v=8";
	var AUTH_PAGES = {
		"login.html": 1,
		"signup.html": 1,
		"verify-email.html": 1,
	};
	var SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
	var MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>';
	var clickBound = false;

	function normalize(value) {
		return value === "dark" ? "dark" : "light";
	}

	function pageFile() {
		return (global.location.pathname.split("/").pop() || "index.html").toLowerCase();
	}

	function isForcedLightPage() {
		return Boolean(AUTH_PAGES[pageFile()]);
	}

	function readSessionUser() {
		try {
			var raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			if (!raw || raw === "null" || raw === "undefined") return null;
			var user = JSON.parse(raw);
			if (!user || typeof user !== "object") return null;
			if (!(user.email || user.id || user.customer_id)) return null;
			return user;
		} catch (_) {
			return null;
		}
	}

	function userKey(user) {
		var source = user || readSessionUser() || {};
		var key = String(source.customer_id || source.id || source.email || "").trim().toLowerCase();
		return key || null;
	}

	function readPrefs() {
		try {
			var raw = localStorage.getItem(PREFS_KEY);
			if (!raw) return {};
			var parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch (_) {
			return {};
		}
	}

	function writePrefs(prefs) {
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(prefs || {}));
		} catch (_) {}
	}

	function dropLegacyGlobal() {
		try {
			localStorage.removeItem(LEGACY_KEY);
		} catch (_) {}
	}

	function readStoredTheme(key) {
		if (!key) return "light";
		var prefs = readPrefs();
		if (prefs[key] === "dark" || prefs[key] === "light") return prefs[key];
		try {
			var legacy = localStorage.getItem(LEGACY_KEY);
			if (legacy === "dark" || legacy === "light") {
				prefs[key] = legacy;
				writePrefs(prefs);
				dropLegacyGlobal();
				return legacy;
			}
		} catch (_) {}
		return "light";
	}

	function persistTheme(theme, key) {
		if (!key) return;
		var prefs = readPrefs();
		prefs[key] = normalize(theme);
		writePrefs(prefs);
		dropLegacyGlobal();
	}

	function darkStylesheetHref() {
		var scripts = document.getElementsByTagName("script");
		for (var i = scripts.length - 1; i >= 0; i--) {
			var src = scripts[i].src || "";
			if (/theme\.js/i.test(src)) {
				return src.replace(/js\/theme\.js(\?.*)?$/i, DARK_CSS_HREF);
			}
		}
		return DARK_CSS_HREF;
	}

	function ensureCriticalDarkVars() {
		var id = "jod-theme-critical";
		var el = document.getElementById(id);
		if (!el) {
			el = document.createElement("style");
			el.id = id;
			el.textContent = 'html[data-theme="dark"]{color-scheme:dark;background:#0e0c0a;color:#f6f0e8}html[data-theme="dark"] body{background:#0e0c0a!important;color:#f6f0e8!important}';
			(document.head || document.documentElement).appendChild(el);
		}
	}

	function ensureDarkStylesheet() {
		ensureCriticalDarkVars();
		var head = document.head;
		if (!head) return;
		var el = document.getElementById(DARK_CSS_ID);
		if (!el) {
			el = document.createElement("link");
			el.id = DARK_CSS_ID;
			el.rel = "stylesheet";
			el.href = darkStylesheetHref();
		}
		head.appendChild(el);
	}

	function paintToggles(theme) {
		var canToggle = Boolean(userKey()) && !isForcedLightPage();
		var nextLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
		var icon = theme === "dark" ? SUN_ICON : MOON_ICON;
		var buttons = document.querySelectorAll("[data-theme-toggle]");
		for (var i = 0; i < buttons.length; i++) {
			var btn = buttons[i];
			btn.hidden = !canToggle;
			btn.setAttribute("aria-label", nextLabel);
			btn.setAttribute("title", nextLabel);
			btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
			if (btn.innerHTML !== icon) btn.innerHTML = icon;
		}
	}

	function apply(theme) {
		var next = theme == null ? resolveTheme() : normalize(theme);
		var root = document.documentElement;
		root.setAttribute("data-theme", next);
		root.style.colorScheme = next;
		if (document.body) {
			document.body.setAttribute("data-theme", next);
		}
		ensureDarkStylesheet();
		paintToggles(next);
		return next;
	}

	function resolveTheme() {
		var key = userKey();
		if (!key) {
			dropLegacyGlobal();
			return "light";
		}
		var stored = readStoredTheme(key);
		if (isForcedLightPage()) return "light";
		return stored;
	}

	function sync() {
		var next = apply(resolveTheme());
		try {
			global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { theme: next } }));
		} catch (_) {}
		return next;
	}

	function set(theme) {
		var key = userKey();
		if (isForcedLightPage() || !key) {
			return sync();
		}
		var next = apply(theme);
		persistTheme(next, key);
		try {
			global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { theme: next } }));
		} catch (_) {}
		return next;
	}

	function toggle() {
		var current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
		return set(current === "dark" ? "light" : "dark");
	}

	function bindClicks() {
		if (clickBound) return;
		clickBound = true;
		document.addEventListener("click", function (event) {
			var btn = event.target && event.target.closest ? event.target.closest("[data-theme-toggle]") : null;
			if (!btn) return;
			event.preventDefault();
			toggle();
		});
	}

	ensureDarkStylesheet();
	apply(resolveTheme());
	bindClicks();

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () {
			sync();
		});
	} else {
		paintToggles(resolveTheme());
	}

	global.addEventListener("load", function () {
		ensureDarkStylesheet();
		paintToggles(resolveTheme());
	});

	global.addEventListener("storage", function (event) {
		if (event.key === PREFS_KEY || event.key === "jod_user" || event.key === "jod_access_token") {
			sync();
		}
	});

	global.JodTheme = {
		storageKey: PREFS_KEY,
		get: resolveTheme,
		set: set,
		toggle: toggle,
		apply: apply,
		sync: sync,
	};
})(window);

(function initJodHeaderBack(global) {
	"use strict";
	if (global.__jodHeaderBackBound) return;
	global.__jodHeaderBackBound = true;

	function pageFile() {
		return (global.location.pathname.split("/").pop() || "index.html").toLowerCase();
	}

	function sameOriginReferrer() {
		try {
			if (!document.referrer) return false;
			return new URL(document.referrer).origin === global.location.origin;
		} catch (_) {
			return false;
		}
	}

	function fallbackHref(btn) {
		var custom = btn && btn.getAttribute("data-back-fallback");
		if (custom) return custom;
		if (btn && btn.tagName === "A") {
			var href = btn.getAttribute("href");
			if (href && href !== "#") return href;
		}
		var page = pageFile();
		var params = new URLSearchParams(global.location.search);
		var eventId = params.get("id") || params.get("eventId") || params.get("event_id") || "";
		if (page === "forgot-password.html") return "login.html";
		if (page === "signup.html") return "login.html";
		if (page === "ticket-details.html") return "orders.html";
		if (page === "agenda.html") {
			return eventId ? "event-details.html?id=" + encodeURIComponent(eventId) : "orders.html";
		}
		if (page === "payment.html" || page === "published-form.html") {
			return eventId ? "event-details.html?id=" + encodeURIComponent(eventId) : "index.html";
		}
		if (page === "verify-email.html" || page === "account-setup.html") return "host-your-event.html";
		if (page === "orders.html" || page === "settings.html" || page === "notifications.html") return "dashboard.html";
		if (page === "volunteer-scanner.html") return "volunteer-portal.html";
		return "index.html";
	}

	function goBack(btn) {
		if (sameOriginReferrer() && global.history.length > 1) {
			try {
				var refPage = (new URL(document.referrer).pathname.split("/").pop() || "").toLowerCase();
				// Never history.back() into auth pages after a successful login redirect.
				if (refPage !== "login.html" && refPage !== "signup.html" && refPage !== "forgot-password.html") {
					global.history.back();
					return;
				}
			} catch (_) {}
		}
		global.location.href = fallbackHref(btn);
	}

	document.addEventListener("click", function (event) {
		var btn = event.target && event.target.closest ? event.target.closest("[data-header-back]") : null;
		if (!btn) return;
		event.preventDefault();
		goBack(btn);
	});

	global.JodGoBack = goBack;
})(window);
