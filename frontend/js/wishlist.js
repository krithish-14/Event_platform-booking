/**
 * JOD Events — Wishlist hearts
 * Red = saved. White outline = not saved. Click toggles.
 */
(function (global) {
	"use strict";

	const ids = new Set();
	let loaded = false;
	let inflight = new Set();

	function getApiBase() {
		if (typeof window !== "undefined" && window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			return window.JodConfig.getApiOrigin();
		}
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		if (window.JOD_API_BASE_OVERRIDE) return String(window.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
		return "";
	}

	function isLoggedIn() {
		return Boolean(global.JodAuth && typeof global.JodAuth.isLoggedIn === "function" && global.JodAuth.isLoggedIn());
	}

	function storageKey() {
		const user = global.JodAuth && typeof global.JodAuth.getUser === "function" ? global.JodAuth.getUser() : null;
		const ident = (user && (user.customer_id || user.email || user.id)) || "guest";
		return "jod_wishlist_ids_" + String(ident).toLowerCase();
	}

	function readLocal() {
		try {
			const raw = localStorage.getItem(storageKey());
			const list = raw ? JSON.parse(raw) : [];
			return Array.isArray(list) ? list.map(String) : [];
		} catch (_) {
			return [];
		}
	}

	function writeLocal() {
		try {
			localStorage.setItem(storageKey(), JSON.stringify(Array.from(ids)));
		} catch (_) {}
	}

	function requireLogin(eventId) {
		const target = "event-details.html?id=" + encodeURIComponent(eventId || "");
		if (global.JodAuth && typeof global.JodAuth.openGuestAuthModal === "function") {
			global.JodAuth.openGuestAuthModal({
				title: "Sign in to save events",
				message: "Create an account or log in to add this event to your wishlist.",
				targetUrl: target,
				badge: "♡ Wishlist"
			});
			return;
		}
		try { sessionStorage.setItem("jod_redirect_after_login", target); } catch (_) {}
		global.location.href = "login.html?redirect=" + encodeURIComponent(target);
	}

	function paintButton(btn) {
		if (!btn) return;
		const id = String(btn.getAttribute("data-wishlist-event") || "");
		const saved = Boolean(id && ids.has(id));
		btn.classList.toggle("is-saved", saved);
		btn.setAttribute("aria-pressed", saved ? "true" : "false");
		btn.setAttribute("aria-label", saved ? "Remove from wishlist" : "Add to wishlist");
		btn.title = saved ? "Remove from wishlist" : "Add to wishlist";
	}

	function refreshButtons(root) {
		const scope = root || document;
		scope.querySelectorAll("[data-wishlist-event]").forEach(paintButton);
	}

	function applyIds(list) {
		ids.clear();
		(list || []).forEach((id) => {
			if (id) ids.add(String(id));
		});
		loaded = true;
		writeLocal();
		refreshButtons();
	}

	async function loadIds() {
		if (!isLoggedIn()) {
			ids.clear();
			loaded = true;
			refreshButtons();
			return [];
		}
		readLocal().forEach((id) => ids.add(id));
		refreshButtons();
		try {
			const fetchFn = global.JodAuth && typeof global.JodAuth.fetchAuth === "function"
				? global.JodAuth.fetchAuth
				: fetch;
			const res = await fetchFn(getApiBase() + "/api/wishlist/ids", { cache: "no-store" });
			if (!res.ok) return Array.from(ids);
			const data = await res.json();
			applyIds(data.event_ids || []);
		} catch (_) {}
		return Array.from(ids);
	}

	async function listItems() {
		if (!isLoggedIn()) return [];
		try {
			const fetchFn = global.JodAuth && typeof global.JodAuth.fetchAuth === "function"
				? global.JodAuth.fetchAuth
				: fetch;
			const res = await fetchFn(getApiBase() + "/api/wishlist/items", { cache: "no-store" });
			if (!res.ok) return [];
			const data = await res.json();
			return Array.isArray(data) ? data : [];
		} catch (_) {
			return [];
		}
	}

	function toast(message) {
		if (typeof global.showToast === "function") {
			global.showToast(message);
			return;
		}
		let el = document.getElementById("toastMsg");
		if (!el) {
			el = document.createElement("div");
			el.id = "toastMsg";
			el.className = "toast-msg";
			document.body.appendChild(el);
		}
		el.textContent = message;
		el.classList.add("show");
		setTimeout(() => el.classList.remove("show"), 2200);
	}

	async function toggleFromButton(btn) {
		const eventId = String(btn.getAttribute("data-wishlist-event") || "");
		if (!eventId) return;
		if (!isLoggedIn()) {
			requireLogin(eventId);
			return;
		}
		if (inflight.has(eventId)) return;
		inflight.add(eventId);

		const next = !ids.has(eventId);
		if (next) ids.add(eventId);
		else ids.delete(eventId);
		writeLocal();
		refreshButtons();

		try {
			const fetchFn = global.JodAuth && typeof global.JodAuth.fetchAuth === "function"
				? global.JodAuth.fetchAuth
				: fetch;
			const res = await fetchFn(getApiBase() + "/api/wishlist/toggle", {
				method: "POST",
				headers: { "Content-Type": "application/json", "Accept": "application/json" },
				body: JSON.stringify({ event_id: eventId }),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.wishlisted) ids.add(eventId);
				else ids.delete(eventId);
				writeLocal();
				refreshButtons();
				toast(data.wishlisted ? "Added to wishlist" : "Removed from wishlist");
			} else if (res.status === 401) {
				if (next) ids.delete(eventId);
				else ids.add(eventId);
				writeLocal();
				refreshButtons();
				requireLogin(eventId);
			} else {
				toast("Could not update wishlist. Please try again.");
			}
		} catch (_) {
			toast(next ? "Saved on this device" : "Removed on this device");
		} finally {
			inflight.delete(eventId);
		}
	}

	document.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-wishlist-event]");
		if (!btn || btn.tagName !== "BUTTON") return;
		e.preventDefault();
		e.stopPropagation();
		if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
		toggleFromButton(btn);
	}, true);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", loadIds);
	} else {
		loadIds();
	}

	global.addEventListener("jod:events-loaded", () => refreshButtons());

	global.JodWishlist = {
		loadIds,
		listItems,
		refreshButtons,
		isSaved: (id) => ids.has(String(id || "")),
		toggleFromButton,
	};
})(window);
