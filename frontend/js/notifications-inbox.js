/**
 * Shared notification inbox — unread badge, 5s toasts, and live booking alerts.
 */
window.JodInbox = (() => {
	"use strict";

	const READ_KEY = "jod_notif_read_ids";
	const CLEARED_KEY = "jod_notif_cleared_ids";
	const KNOWN_KEY = "jod_notif_known_ids";
	const PREFS_KEY = "jod_notif_prefs";
	const POLL_MS = 45000;

	let started = false;
	let pollTimer = null;

	function apiBase() {
		if (window.JodAuth && window.JodAuth.API_BASE) return window.JodAuth.API_BASE;
		if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") return window.JodHealth.getApiBaseUrl();
		const host = (window.location && window.location.hostname && window.location.hostname !== "localhost")
			? window.location.hostname : "127.0.0.1";
		return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;
	}

	function isLoggedIn() {
		try {
			if (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function") return window.JodAuth.isLoggedIn();
			return !!(localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));
		} catch (_) { return false; }
	}

	function authFetch(url) {
		const fetchFn = (window.JodAuth && typeof window.JodAuth.fetchAuth === "function")
			? window.JodAuth.fetchAuth
			: fetch;
		return fetchFn(url);
	}

	function readJson(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : fallback;
		} catch (_) { return fallback; }
	}

	function writeJson(key, value) {
		try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
	}

	function loadPrefs() {
		return Object.assign(
			{ bookingEmails: true, eventReminders: true, offers: false },
			readJson(PREFS_KEY, {})
		);
	}

	function escapeHtml(value) {
		return String(value || "").replace(/[&<>"']/g, (ch) => ({
			"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
		}[ch]));
	}

	function timeAgo(iso) {
		if (!iso) return "";
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return "";
		const sec = Math.round((Date.now() - date.getTime()) / 1000);
		if (sec < 60) return "Just now";
		if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
		if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
		if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} days ago`;
		return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
	}

	function daysUntil(iso) {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return null;
		return Math.ceil((date.getTime() - Date.now()) / 86400000);
	}

	function injectStyles() {
		if (document.getElementById("jod-inbox-style")) return;
		const style = document.createElement("style");
		style.id = "jod-inbox-style";
		style.textContent = `
.jod-inbox-stack {
	position: fixed;
	right: 1.1rem;
	bottom: 1.1rem;
	z-index: 12000;
	display: flex;
	flex-direction: column-reverse;
	gap: .65rem;
	width: min(360px, calc(100vw - 1.6rem));
	pointer-events: none;
}
.jod-inbox-toast {
	pointer-events: auto;
	display: flex;
	align-items: flex-start;
	gap: .75rem;
	padding: .9rem 1rem;
	background: #fff;
	border: 1px solid #fed7aa;
	border-radius: 16px;
	box-shadow: 0 18px 40px rgba(15,23,42,.18);
	animation: jodInboxIn .28s ease-out;
	cursor: pointer;
}
.jod-inbox-toast.is-leaving { animation: jodInboxOut .25s ease-in forwards; }
.jod-inbox-toast-icon {
	width: 2.2rem; height: 2.2rem;
	border-radius: 10px;
	background: #fff7ed;
	display: grid; place-items: center;
	flex-shrink: 0;
	font-size: 1.05rem;
}
.jod-inbox-toast strong {
	display: block;
	font-size: .88rem;
	color: #1c1917;
	margin: 0 0 .15rem;
}
.jod-inbox-toast p {
	margin: 0;
	font-size: .78rem;
	color: #78716c;
	line-height: 1.4;
}
@keyframes jodInboxIn {
	from { opacity: 0; transform: translateY(12px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes jodInboxOut {
	to { opacity: 0; transform: translateY(10px); }
}
@media (max-width: 640px) {
	.jod-inbox-stack { right: .75rem; bottom: .75rem; }
}
`;
		document.head.appendChild(style);
	}

	function stackEl() {
		let el = document.getElementById("jodInboxStack");
		if (!el) {
			el = document.createElement("div");
			el.id = "jodInboxStack";
			el.className = "jod-inbox-stack";
			document.body.appendChild(el);
		}
		return el;
	}

	function showToast(item) {
		injectStyles();
		const toast = document.createElement("div");
		toast.className = "jod-inbox-toast";
		toast.innerHTML = `<div class="jod-inbox-toast-icon">${item.icon || "🔔"}</div>
			<div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.plain || "")}</p></div>`;
		toast.addEventListener("click", () => {
			markRead(item.id);
			if (item.href) window.location.href = item.href;
		});
		stackEl().appendChild(toast);
		setTimeout(() => {
			toast.classList.add("is-leaving");
			setTimeout(() => toast.remove(), 260);
		}, 5000);
	}

	function unreadCount(items) {
		const list = items || [];
		return list.filter((row) => row.unread).length;
	}

	function updateBadge(count) {
		const n = Math.max(0, Number(count) || 0);
		document.querySelectorAll(".profile-notif-badge").forEach((badge) => {
			badge.textContent = n > 99 ? "99+" : String(n);
			badge.classList.toggle("is-visible", n > 0);
			badge.hidden = n <= 0;
		});
	}

	function markRead(id) {
		if (!id) return;
		const read = new Set(readJson(READ_KEY, []));
		read.add(String(id));
		writeJson(READ_KEY, [...read]);
		collectItems().then((items) => updateBadge(unreadCount(items)));
	}

	function markAllRead(ids) {
		const read = new Set(readJson(READ_KEY, []));
		(ids || []).forEach((id) => read.add(String(id)));
		writeJson(READ_KEY, [...read]);
		updateBadge(0);
	}

	function clearAll(ids) {
		const cleared = new Set(readJson(CLEARED_KEY, []));
		(ids || []).forEach((id) => cleared.add(String(id)));
		writeJson(CLEARED_KEY, [...cleared]);
		updateBadge(0);
	}

	async function collectItems() {
		const prefs = loadPrefs();
		const readIds = new Set(readJson(READ_KEY, []));
		const clearedIds = new Set(readJson(CLEARED_KEY, []));
		const items = [];

		try {
			const res = await authFetch(`${apiBase()}/api/bookings/my-bookings`);
			if (res.ok) {
				const bookings = await res.json();
				(Array.isArray(bookings) ? bookings : []).forEach((b) => {
					const bookingId = String(b.booking_id || "");
					const title = b.event_title || "your event";
					const qty = b.quantity || 1;
					const type = b.ticket_type || "ticket";
					const status = String(b.status || "").toUpperCase();
					const href = bookingId ? `ticket-details.html?id=${encodeURIComponent(bookingId)}` : "orders.html";

					if (prefs.bookingEmails) {
						if (status === "CANCELLED") {
							const id = `booking-cancelled-${bookingId}`;
							if (!clearedIds.has(id)) {
								const plain = `Your ${type} for ${title} was cancelled.`;
								items.push({
									id,
									icon: "🎟️",
									title: "Booking cancelled",
									time: timeAgo(b.booked_at),
									unread: !readIds.has(id),
									href,
									plain,
									html: `Your ${escapeHtml(type)} for <strong>${escapeHtml(title)}</strong> was cancelled.`,
									sort: new Date(b.booked_at || 0).getTime() + 1,
								});
							}
						} else {
							const id = `booking-confirmed-${bookingId}`;
							if (!clearedIds.has(id)) {
								const plain = `Your ${qty} × ${type} for ${title} is confirmed.`;
								items.push({
									id,
									icon: "🎟️",
									title: "Booking confirmed",
									time: timeAgo(b.booked_at),
									unread: !readIds.has(id),
									href,
									plain,
									html: `Your ${escapeHtml(String(qty))} × ${escapeHtml(type)} for <strong>${escapeHtml(title)}</strong> ${qty > 1 ? "are" : "is"} confirmed. E-tickets are in <span style="color:var(--primary);font-weight:600;">Your Orders</span>.`,
									sort: new Date(b.booked_at || 0).getTime(),
								});
							}
						}
					}

					if (prefs.eventReminders && status !== "CANCELLED" && b.event_start_date) {
						const days = daysUntil(b.event_start_date);
						if (days != null && days >= 0 && days <= 7) {
							const id = `remind-${bookingId}`;
							if (!clearedIds.has(id)) {
								const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
								const venue = b.event_venue ? ` at ${b.event_venue}` : "";
								const plain = `${title} starts ${when}${venue}.`;
								items.push({
									id,
									icon: "✨",
									title: "Upcoming event reminder",
									time: timeAgo(b.event_start_date),
									unread: !readIds.has(id),
									href,
									plain,
									html: `<strong>${escapeHtml(title)}</strong> starts ${when}${b.event_venue ? " at " + escapeHtml(b.event_venue) : ""}.`,
									sort: Date.now() + (7 - days),
								});
							}
						}
					}
				});
			}
		} catch (_) {}

		if (prefs.offers) {
			try {
				const res = await authFetch(`${apiBase()}/api/events/public?limit=6`);
				if (res.ok) {
					const events = await res.json();
					const list = Array.isArray(events) ? events : (events.items || events.events || []);
					list.slice(0, 2).forEach((ev) => {
						const id = `offer-${ev.id || ev.event_id || ev.title}`;
						if (clearedIds.has(id)) return;
						const title = ev.title || "a new event";
						items.push({
							id,
							icon: "🎁",
							title: "Event recommendation",
							time: timeAgo(ev.start_date || ev.created_at),
							unread: !readIds.has(id),
							href: ev.id ? `event-details.html?id=${encodeURIComponent(ev.id)}` : "index.html",
							plain: `You might like ${title}.`,
							html: `You might like <strong>${escapeHtml(title)}</strong>${ev.venue ? " at " + escapeHtml(ev.venue) : ""}.`,
							sort: new Date(ev.start_date || ev.created_at || 0).getTime(),
						});
					});
				}
			} catch (_) {}
		}

		items.sort((a, b) => (b.sort || 0) - (a.sort || 0));
		return items;
	}

	async function refresh(opts) {
		opts = opts || {};
		if (!isLoggedIn()) {
			updateBadge(0);
			return [];
		}
		const items = await collectItems();
		updateBadge(unreadCount(items));

		if (opts.toastNew) {
			const known = readJson(KNOWN_KEY, null);
			const ids = items.map((row) => row.id);
			if (!Array.isArray(known)) {
				writeJson(KNOWN_KEY, ids);
			} else {
				const knownSet = new Set(known);
				const fresh = items.filter((row) => !knownSet.has(row.id));
				fresh.slice(0, 3).forEach(showToast);
				writeJson(KNOWN_KEY, [...new Set(known.concat(ids))]);
			}
		}
		return items;
	}

		function start() {
			if (started || !isLoggedIn()) return;
			started = true;
			const params = new URLSearchParams(window.location.search || "");
			const bookingId = params.get("id") || params.get("booking_id");
			if (bookingId && /ticket-details\.html/i.test(window.location.pathname || "")) {
				markRead(`booking-confirmed-${bookingId}`);
				markRead(`booking-cancelled-${bookingId}`);
				markRead(`remind-${bookingId}`);
			}
			refresh({ toastNew: true });
			if (pollTimer) clearInterval(pollTimer);
			pollTimer = setInterval(() => refresh({ toastNew: true }), POLL_MS);
		}

	return {
		start,
		refresh,
		collectItems,
		markRead,
		markAllRead,
		clearAll,
		unreadCount,
		showToast,
		updateBadge,
	};
})();
