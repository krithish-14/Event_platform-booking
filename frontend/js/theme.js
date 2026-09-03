/**
 * Pretty page URLs: /about instead of /about.html (status-bar hover + address bar).
 * Files stay *.html; Cloudflare + the local static server map extensionless paths.
 */
(function initJodUrls(global) {
	"use strict";

	function currentPageFile() {
		var path = String((global.location && global.location.pathname) || "/").replace(/\/+$/, "") || "/";
		var pop = path.split("/").pop().toLowerCase();
		if (!pop || pop === "index" || pop === "index.html") return "index.html";
		if (pop.slice(-5) === ".html") return pop;
		return pop + ".html";
	}

	function prettyHref(href) {
		if (typeof href !== "string") return href;
		var s = href.trim();
		if (!s || s.charAt(0) === "#") return href;
		if (/^(mailto:|tel:|javascript:)/i.test(s)) return href;
		if (s.indexOf("components/") !== -1) return href;
		if (!/\.html(?=[?#]|$)/i.test(s)) return href;
		var url;
		try {
			url = new URL(s, "https://jodevents.com/");
		} catch (_) {
			return href;
		}
		if (/^https?:\/\//i.test(s)) {
			var host = String(url.hostname || "").toLowerCase();
			if (host !== "jodevents.com" && host !== "www.jodevents.com" && host !== "localhost" && host !== "127.0.0.1") {
				return href;
			}
		}
		var path = url.pathname || "/";
		if (/\/index\.html$/i.test(path)) path = "/";
		else path = path.replace(/\.html$/i, "");
		if (!path) path = "/";
		return path + url.search + url.hash;
	}

	function pageFileFromHref(href) {
		var pretty = prettyHref(href);
		var path = String(pretty || "").split("?")[0].split("#")[0];
		if (!path || path === "/") return "index.html";
		var pop = path.split("/").pop().toLowerCase();
		if (!pop || pop === "index") return "index.html";
		if (pop.slice(-5) === ".html") return pop;
		return pop + ".html";
	}

	function isLoginOrSignupHref(href) {
		var file = pageFileFromHref(href);
		return file === "login.html" || file === "signup.html";
	}

	function rewriteAnchor(a) {
		if (!a || !a.getAttribute) return;
		var href = a.getAttribute("href");
		var next = prettyHref(href);
		if (next && next !== href) a.setAttribute("href", next);
	}

	function rewriteLinks(root) {
		var scope = root || document;
		if (!scope || !scope.querySelectorAll) {
			if (scope && scope.tagName === "A") rewriteAnchor(scope);
			return;
		}
		if (scope.tagName === "A") rewriteAnchor(scope);
		var nodes = scope.querySelectorAll("a[href]");
		for (var i = 0; i < nodes.length; i++) rewriteAnchor(nodes[i]);
	}

	function watchPrettyLinks() {
		rewriteLinks(document);
		if (typeof MutationObserver === "undefined" || global.__jodPrettyLinksWatched) return;
		global.__jodPrettyLinksWatched = true;
		new MutationObserver(function (mutations) {
			for (var i = 0; i < mutations.length; i++) {
				var m = mutations[i];
				if (m.type === "attributes" && m.target && m.target.tagName === "A") {
					rewriteAnchor(m.target);
					continue;
				}
				var added = m.addedNodes || [];
				for (var j = 0; j < added.length; j++) {
					var node = added[j];
					if (!node || node.nodeType !== 1) continue;
					rewriteLinks(node);
				}
			}
		}).observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["href"],
		});
	}

	global.JodUrls = {
		currentPageFile: currentPageFile,
		prettyHref: prettyHref,
		pageFileFromHref: pageFileFromHref,
		isLoginOrSignupHref: isLoginOrSignupHref,
		rewriteLinks: rewriteLinks,
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", watchPrettyLinks);
	} else {
		watchPrettyLinks();
	}
})(window);

/**
 * JOD Events — Light / Dark theme.
 * Guests and logged-in users can both toggle. Guest choice is stored as
 * "guest"; a logged-in user's choice is stored under their account.
 * Login / signup pages stay forced light.
 */
(function initJodTheme(global) {
	"use strict";

	var LEGACY_KEY = "jod_theme";
	var PREFS_KEY = "jod_theme_prefs";
	var EVENT_NAME = "jod-theme-change";
	var DARK_CSS_ID = "jod-theme-dark-css";
	var DARK_CSS_HREF = "css/theme-dark.css?v=11";
	var AUTH_PAGES = {
		"login.html": 1,
		"signup.html": 1,
		"verify-email.html": 1,
		"thank-you.html": 1,
	};
	var SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
	var MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>';
	var GUEST_KEY = "guest";
	var clickBound = false;

	(function injectLogoLockCss() {
		if (document.getElementById("jod-logo-lock-css")) return;
		var el = document.createElement("style");
		el.id = "jod-logo-lock-css";
		el.textContent = "#header:empty{min-height:4.6rem;display:block}"
			+ ".site-header .brand-logo-slot{display:flex;align-items:center;height:4.25rem!important;max-height:4.25rem!important;max-width:11.2rem!important;overflow:hidden;flex-shrink:0}"
			+ ".site-header .brand-logo,.site-header .brand img.brand-logo{height:4.25rem!important;max-height:4.25rem!important;width:auto!important;max-width:11.2rem!important;min-height:0!important;min-width:0!important;object-fit:contain!important;object-position:left center!important;display:block!important}"
			+ "@media (max-width:1100px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:3.85rem!important;max-height:3.85rem!important;max-width:10.15rem!important}}"
			+ "@media (max-width:800px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:3.5rem!important;max-height:3.5rem!important;max-width:9.2rem!important}}"
			+ "@media (max-width:520px){.site-header .brand-logo-slot,.site-header .brand-logo,.site-header .brand img.brand-logo{height:3.1rem!important;max-height:3.1rem!important;max-width:8.2rem!important}}"
			+ ".site-header .nav-inner{min-height:0;padding:.2rem 0;align-items:center}"
			+ ".site-header .desktop-nav>a,.site-header .nav-auth>a.button{white-space:nowrap}";
		(document.head || document.documentElement).appendChild(el);
	})();

	function normalize(value) {
		return value === "dark" ? "dark" : "light";
	}

	function pageFile() {
		if (global.JodUrls && typeof global.JodUrls.currentPageFile === "function") {
			return global.JodUrls.currentPageFile();
		}
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
		return key || GUEST_KEY;
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
		var canToggle = !isForcedLightPage();
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

	var LIGHT_LOGO = "/images/JOD Events Logo.png";
	var DARK_LOGO = "/images/Jod_log_Dark.webp";

	function publicImage(path) {
		var raw = String(path || LIGHT_LOGO).trim();
		if (/^https?:\/\//i.test(raw)) return raw;
		var rel = raw.replace(/^\/+/, "").replace(/^images\//, "");
		if (!rel) rel = "JOD Events Logo.png";
		return "/images/" + rel.split("/").map(encodeURIComponent).join("/");
	}

	function logoPathKey(url) {
		var s = String(url || "").split("?")[0].split("#")[0];
		try {
			s = decodeURIComponent(s);
		} catch (_) {}
		return s.replace(/\/+$/, "").toLowerCase();
	}

	function bindLogoFallback(img) {
		if (img.dataset.logoBound === "1") return;
		img.dataset.logoBound = "1";
		img.addEventListener("error", function () {
			img.style.display = "none";
			var fallback = img.parentElement && img.parentElement.querySelector(".brand-fallback");
			if (fallback) fallback.hidden = false;
		});
	}

	function syncBrandLogos() {
		var theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
		document.querySelectorAll(".site-header .brand-logo, .site-footer .brand-logo").forEach(function (img) {
			bindLogoFallback(img);
			var lightPath = img.getAttribute("data-logo-light") || LIGHT_LOGO;
			var darkPath = img.getAttribute("data-logo-dark") || DARK_LOGO;
			var next = publicImage(theme === "dark" ? darkPath : lightPath);
			if (logoPathKey(img.getAttribute("src")) !== logoPathKey(next)) {
				img.setAttribute("src", next);
			}
		});
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
		syncBrandLogos();
		paintToggles(next);
		return next;
	}

	function resolveTheme() {
		var key = userKey();
		if (isForcedLightPage()) {
			dropLegacyGlobal();
			return "light";
		}
		var stored = readStoredTheme(key);
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
		if (isForcedLightPage()) {
			return sync();
		}
		var key = userKey();
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
		syncBrandLogos();
		paintToggles(resolveTheme());
	});

	global.addEventListener("includesLoaded", function () {
		syncBrandLogos();
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
		if (global.JodUrls && typeof global.JodUrls.currentPageFile === "function") {
			return global.JodUrls.currentPageFile();
		}
		return (global.location.pathname.split("/").pop() || "index.html").toLowerCase();
	}

	function pretty(href) {
		return (global.JodUrls && typeof global.JodUrls.prettyHref === "function")
			? global.JodUrls.prettyHref(href)
			: href;
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
		if (page === "forgot-password.html") return pretty("login.html");
		if (page === "signup.html") return pretty("login.html");
		if (page === "ticket-details.html") return pretty("orders.html");
		if (page === "agenda.html") {
			return pretty(eventId ? "event-details.html?id=" + encodeURIComponent(eventId) : "orders.html");
		}
		if (page === "payment.html" || page === "published-form.html") {
			return pretty(eventId ? "event-details.html?id=" + encodeURIComponent(eventId) : "index.html");
		}
		if (page === "verify-email.html" || page === "account-setup.html") return pretty("host-your-event.html");
		if (page === "orders.html" || page === "settings.html" || page === "notifications.html") return pretty("dashboard.html");
		if (page === "volunteer-scanner.html") return pretty("volunteer-portal.html");
		return pretty("index.html");
	}

	function isVolunteerLeavePage(page) {
		return page === "volunteer-portal.html" || page === "volunteer-invite.html";
	}

	function goBack(btn) {
		var page = pageFile();
		var leaveSite = (btn && btn.getAttribute("data-back-leave-site") === "true") || isVolunteerLeavePage(page);
		if (leaveSite) {
			if (global.history.length > 1) {
				global.history.back();
				return;
			}
			try {
				global.close();
			} catch (_) {}
			return;
		}
		if (sameOriginReferrer() && global.history.length > 1) {
			try {
				var refFile = global.JodUrls && typeof global.JodUrls.pageFileFromHref === "function"
					? global.JodUrls.pageFileFromHref(document.referrer)
					: (new URL(document.referrer).pathname.split("/").pop() || "").toLowerCase();
				if (refFile !== "login.html" && refFile !== "signup.html" && refFile !== "forgot-password.html") {
					global.history.back();
					return;
				}
			} catch (_) {}
		}
		global.location.href = pretty(fallbackHref(btn));
	}

	document.addEventListener("click", function (event) {
		var btn = event.target && event.target.closest ? event.target.closest("[data-header-back]") : null;
		if (!btn) return;
		event.preventDefault();
		goBack(btn);
	});

	global.JodGoBack = goBack;
})(window);
