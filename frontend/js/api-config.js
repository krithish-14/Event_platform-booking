/**
 * Single API origin + Cloudflare assets base for every page.
 * Production (Cloudflare frontend): https://api.jodevents.com
 * Local split (:5500): http://127.0.0.1:8001
 * Static images: https://assets.jodevents.com/images/...
 * Override: window.JOD_API_BASE_OVERRIDE / window.JOD_ASSETS_BASE_OVERRIDE
 */
(function (global) {
	"use strict";

	var PRODUCTION_API_ORIGIN = "https://api.jodevents.com";
	var DEFAULT_ASSETS_IMAGE_BASE = "https://assets.jodevents.com/images";

	function stripSlash(value) {
		return String(value || "").replace(/\/$/, "");
	}

	function isLocalSplitFrontend() {
		if (!global.location) return false;
		var loc = global.location;
		if (loc.protocol === "file:") return true;
		var host = loc.hostname || "";
		var port = String(loc.port || "");
		var localHost = host === "localhost" || host === "127.0.0.1";
		if (!localHost) return false;
		return port === "5500" || port === "5501" || port === "5173";
	}

	function getApiOrigin() {
		if (global.JOD_API_BASE_OVERRIDE) return stripSlash(global.JOD_API_BASE_OVERRIDE);
		if (isLocalSplitFrontend()) return "http://127.0.0.1:8001";
		return PRODUCTION_API_ORIGIN;
	}

	function isRelativeApiPath(url) {
		return (
			url === "/api" ||
			url.indexOf("/api/") === 0 ||
			url === "/health" ||
			url.indexOf("/health?") === 0 ||
			url.indexOf("/health/") === 0
		);
	}

	function getApiBase() {
		var origin = getApiOrigin();
		return origin ? origin + "/api" : "/api";
	}

	function getAssetsImageBase() {
		if (global.JOD_ASSETS_BASE_OVERRIDE) return stripSlash(global.JOD_ASSETS_BASE_OVERRIDE);
		return DEFAULT_ASSETS_IMAGE_BASE;
	}

	function isAppMediaPath(path) {
		var p = String(path || "");
		return (
			p.indexOf("/api/media") === 0 ||
			p.indexOf("api/media") === 0 ||
			p.indexOf("/uploads/") === 0 ||
			p.indexOf("uploads/") === 0
		);
	}

	function prefixApiPath(path) {
		var p = String(path || "").trim();
		if (!p) return "";
		if (!p.startsWith("/")) p = "/" + p;
		var origin = getApiOrigin();
		return origin ? origin + p : p;
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function encodePathSegments(relPath) {
		return String(relPath || "")
			.split("/")
			.map(function (seg) {
				if (!seg) return "";
				try {
					return encodeURIComponent(decodeURIComponent(seg));
				} catch (_) {
					return encodeURIComponent(seg);
				}
			})
			.join("/");
	}

	/**
	 * Map local static paths like images/foo.png → CDN URL.
	 * Leaves https://, /api/media, uploads, and other absolute app paths alone.
	 */
	function assetUrl(path) {
		var base = getAssetsImageBase();
		if (path == null || path === "") {
			return base + "/" + encodePathSegments("hero-event.jpg");
		}
		var trimmed = String(path).trim();
		if (!trimmed) return base + "/" + encodePathSegments("hero-event.jpg");

		var lower = trimmed.toLowerCase();
		if (
			lower.startsWith("javascript:") ||
			lower.startsWith("vbscript:") ||
			lower.startsWith("data:") ||
			lower.startsWith("blob:") ||
			lower.startsWith("file:")
		) {
			return base + "/" + encodePathSegments("hero-event.jpg");
		}

		if (/^https?:\/\//i.test(trimmed)) {
			try {
				var abs = new URL(trimmed);
				if (isAppMediaPath(abs.pathname)) return prefixApiPath(abs.pathname + abs.search);
				return trimmed;
			} catch (_) {
				return trimmed;
			}
		}

		var rel = trimmed.replace(/^\.\//, "");
		if (rel.startsWith("/api/") || rel.startsWith("api/")) {
			return prefixApiPath(rel.startsWith("/") ? rel : "/" + rel);
		}
		if (rel.startsWith("/uploads/") || rel.startsWith("uploads/")) {
			return prefixApiPath(rel.startsWith("/") ? rel : "/" + rel);
		}
		if (rel.indexOf("/api/media") !== -1) {
			var mediaPath = rel.indexOf("/api/media") >= 0 ? rel.slice(rel.indexOf("/api/media")) : "/api/media";
			return prefixApiPath(mediaPath);
		}

		if (rel.startsWith("/images/")) rel = rel.slice("/images/".length);
		else if (rel.startsWith("images/")) rel = rel.slice("images/".length);
		else if (rel.startsWith("/")) {
			// Other root-relative paths (CSS, pages) — do not CDN-prefix.
			return trimmed;
		}

		return base + "/" + encodePathSegments(rel);
	}

	function safeMediaUrl(url, fallback) {
		var placeholder = assetUrl(fallback || "images/hero-event.jpg");
		if (!url) return placeholder;
		var trimmed = String(url).trim();
		var lower = trimmed.toLowerCase();
		if (
			lower.startsWith("javascript:") ||
			lower.startsWith("vbscript:") ||
			lower.startsWith("data:") ||
			lower.startsWith("file:")
		) {
			return placeholder;
		}
		if (/^https?:\/\//i.test(trimmed)) {
			try {
				var parsed = new URL(trimmed);
				if (isAppMediaPath(parsed.pathname)) {
					return prefixApiPath(parsed.pathname + parsed.search);
				}
				if (lower.startsWith("https://")) return trimmed;
				if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return trimmed;
			} catch (_) {
				if (lower.startsWith("https://")) return trimmed;
			}
			return placeholder;
		}
		if (isAppMediaPath(trimmed) || trimmed.startsWith("/api/") || trimmed.startsWith("api/")) {
			var path = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
			return prefixApiPath(path);
		}
		if (
			trimmed.startsWith("/") ||
			trimmed.startsWith("images/") ||
			trimmed.startsWith("./") ||
			trimmed.startsWith("../")
		) {
			return assetUrl(trimmed);
		}
		return placeholder;
	}

	function rewriteAssetAttribute(el, attr) {
		if (!el || !el.getAttribute) return;
		if (el.getAttribute("data-no-cdn") === "1") return;
		var value = el.getAttribute(attr);
		if (!value) return;
		var trimmed = String(value).trim();
		if (
			trimmed.startsWith("images/") ||
			trimmed.startsWith("./images/") ||
			trimmed.startsWith("/images/")
		) {
			el.setAttribute(attr, assetUrl(trimmed));
		}
	}

	function rewriteAssetTree(root) {
		if (!root || !root.querySelectorAll) return;
		var nodes = root.querySelectorAll("[src], [href], [poster]");
		for (var i = 0; i < nodes.length; i++) {
			var el = nodes[i];
			rewriteAssetAttribute(el, "src");
			rewriteAssetAttribute(el, "href");
			rewriteAssetAttribute(el, "poster");
		}
	}

	function installAssetRewriter() {
		rewriteAssetTree(document);
		if (typeof MutationObserver === "undefined") return;
		var obs = new MutationObserver(function (mutations) {
			for (var i = 0; i < mutations.length; i++) {
				var m = mutations[i];
				if (m.type === "attributes" && m.target && m.attributeName) {
					if (m.attributeName === "src" || m.attributeName === "href" || m.attributeName === "poster") {
						rewriteAssetAttribute(m.target, m.attributeName);
					}
				}
				if (!m.addedNodes) continue;
				for (var j = 0; j < m.addedNodes.length; j++) {
					var node = m.addedNodes[j];
					if (node.nodeType !== 1) continue;
					rewriteAssetAttribute(node, "src");
					rewriteAssetAttribute(node, "href");
					rewriteAssetAttribute(node, "poster");
					rewriteAssetTree(node);
				}
			}
		});
		obs.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src", "href", "poster"],
		});
	}

	function readCookie(name) {
		try {
			var parts = ("; " + document.cookie).split("; " + name + "=");
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

	var nativeFetch = global.fetch ? global.fetch.bind(global) : null;
	if (nativeFetch) {
		global.fetch = function (input, init) {
			var initObj = Object.assign({}, init || {});
			var origin = getApiOrigin();
			var url = "";
			if (typeof input === "string") url = input;
			else if (input && typeof input.url === "string") url = input.url;
			if (typeof input === "string" && origin && isRelativeApiPath(url)) {
				url = origin + url;
				input = url;
			}
			var isApi =
				isRelativeApiPath(url) ||
				(origin && url.indexOf(origin + "/") === 0) ||
				url.indexOf("/api/") !== -1 ||
				/127\.0\.0\.1:8001|localhost:8001|api\.jodevents\.com/.test(url);
			if (isApi) {
				initObj.credentials = initObj.credentials || "include";
				var method = String(
					initObj.method || (typeof input !== "string" && input && input.method) || "GET"
				).toUpperCase();
				if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
					var csrf = readCookie("jod_csrf");
					if (csrf) {
						var headers = new Headers(initObj.headers || {});
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
		getAssetsImageBase: getAssetsImageBase,
		assetUrl: assetUrl,
		escapeHtml: escapeHtml,
		safeMediaUrl: safeMediaUrl,
		prefixApiPath: prefixApiPath,
	};
	global.escHtml = escapeHtml;
	global.getApiBaseUrl = getApiOrigin;
	global.jodAssetUrl = assetUrl;

	if (global.document) {
		// Observe immediately so <img>/<link> discovered during parse are rewritten
		// before the browser finishes fetching relative images/ paths.
		try {
			installAssetRewriter();
		} catch (_) {
			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", installAssetRewriter);
			}
		}
	}
})(typeof window !== "undefined" ? window : this);
