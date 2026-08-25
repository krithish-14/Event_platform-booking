/**
 * Shared notification inbox — unread badge, 5s toasts, and live booking alerts.
 */
window.JodInbox = (() => {
	"use strict";

	const READ_KEY = "jod_notif_read_ids";
	const CLEARED_KEY = "jod_notif_cleared_ids";
	const KNOWN_KEY = "jod_notif_known_ids";
	const PREFS_KEY = "jod_notif_prefs";
	const POLL_MS = 15000;

	function scopedInboxKey(base) {
		if (window.JodAuth && typeof window.JodAuth.scopedKey === "function") {
			return window.JodAuth.scopedKey(base) || null;
		}
		return null;
	}

	function inboxKeyAliases(base) {
		if (window.JodAuth && typeof window.JodAuth.scopedKeyAliases === "function") {
			return window.JodAuth.scopedKeyAliases(base) || [];
		}
		const key = scopedInboxKey(base);
		return key ? [key] : [];
	}

	let started = false;
	let pollTimer = null;
	let stateSyncTimer = null;
	let serverStateLoaded = false;

	function apiBase() {
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
		try {
			if (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function") return window.JodAuth.isLoggedIn();
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			return !!(raw && raw !== "null");
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
			const aliases = inboxKeyAliases(key);
			for (const storageKey of aliases) {
				const raw = localStorage.getItem(storageKey);
				if (raw) return JSON.parse(raw);
			}
		} catch (_) {}
		return fallback;
	}

	function writeJson(key, value) {
		const aliases = inboxKeyAliases(key);
		if (!aliases.length) return;
		const payload = JSON.stringify(value);
		aliases.forEach((storageKey) => {
			try { localStorage.setItem(storageKey, payload); } catch (_) {}
		});
		scheduleStateSync();
	}

	function mergeIdLists(localList, serverList) {
		return [...new Set([...(localList || []), ...(serverList || [])].map(String))];
	}

	async function hydrateStateFromServer() {
		if (!isLoggedIn() || serverStateLoaded) return;
		try {
			const res = await authFetch(`${apiBase()}/api/notifications/state`);
			if (!res.ok) return;
			const data = await res.json();
			const localRead = readJson(READ_KEY, []);
			const localCleared = readJson(CLEARED_KEY, []);
			writeJson(READ_KEY, mergeIdLists(localRead, data.read_ids || []));
			writeJson(CLEARED_KEY, mergeIdLists(localCleared, data.cleared_ids || []));
			serverStateLoaded = true;
		} catch (_) {}
	}

	function scheduleStateSync() {
		if (!isLoggedIn()) return;
		if (stateSyncTimer) clearTimeout(stateSyncTimer);
		stateSyncTimer = setTimeout(pushStateToServer, 400);
	}

	async function pushStateToServer() {
		if (!isLoggedIn()) return;
		try {
			await authFetch(`${apiBase()}/api/notifications/state`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					read_ids: readJson(READ_KEY, []),
					cleared_ids: readJson(CLEARED_KEY, []),
				}),
			});
		} catch (_) {}
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
		if (sec < -86400) return `In ${Math.ceil(Math.abs(sec) / 86400)} days`;
		if (sec < -3600) return `In ${Math.ceil(Math.abs(sec) / 3600)} hours`;
		if (sec < 0) return "Soon";
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

	function isFlagTrue(value) {
		return value === true || value === 1 || String(value || "").toLowerCase() === "true";
	}

	function sortMillis(iso, extra) {
		const t = new Date(iso || 0).getTime();
		return (Number.isNaN(t) ? 0 : t) + (Number(extra) || 0);
	}

	function ticketHref(bookingId) {
		return bookingId ? `ticket-details.html?id=${encodeURIComponent(bookingId)}` : "orders.html";
	}

	function eventHref(eventId) {
		return eventId ? `event-details.html?id=${encodeURIComponent(eventId)}` : "index.html";
	}

	function reminderLabels(days) {
		if (days === 0) return { when: "today", time: "Today" };
		if (days === 1) return { when: "tomorrow", time: "Tomorrow" };
		return { when: `in ${days} days`, time: `In ${days} days` };
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
		const label = n === 1 ? "1 unread notification" : `${n} unread notifications`;
		document.querySelectorAll(".profile-notif-badge").forEach((badge) => {
			badge.textContent = n > 99 ? "99+" : String(n);
			badge.classList.toggle("is-visible", n > 0);
			badge.hidden = n <= 0;
			badge.setAttribute("aria-hidden", n <= 0 ? "true" : "false");
			badge.setAttribute("aria-label", label);
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
				const list = Array.isArray(bookings) ? bookings : [];
				const cancelMap = {};
				const missingIds = [...new Set(list
					.filter((b) => b && b.event_id && b.event_is_cancelled == null)
					.map((b) => String(b.event_id)))];
				await Promise.all(missingIds.map(async (id) => {
					try {
						const evRes = await authFetch(`${apiBase()}/api/events/${encodeURIComponent(id)}`);
						if (evRes.status === 404) {
							cancelMap[id] = true;
							return;
						}
						if (!evRes.ok) return;
						const ev = await evRes.json();
						cancelMap[id] = isFlagTrue(ev.is_cancelled);
					} catch (_) {}
				}));
				list.forEach((b) => {
					const bookingId = String(b.booking_id || "");
					const eventId = String(b.event_id || "");
					const title = b.event_title || "your event";
					const qty = b.quantity || 1;
					const type = b.ticket_type || "ticket";
					const status = String(b.status || "").toUpperCase();
					const ticketStatus = String(b.ticket_status || "").toUpperCase();
					const eventCancelled = isFlagTrue(b.event_is_cancelled) || isFlagTrue(cancelMap[eventId]);
					const bookingCancelled = status === "CANCELLED";
					const liveCancelled = eventCancelled || bookingCancelled;

					if (prefs.bookingEmails && liveCancelled) {
						const id = eventCancelled
							? `event-cancelled-${eventId || bookingId}`
							: `booking-cancelled-${bookingId}`;
						if (!clearedIds.has(id)) {
							const cancelAt = b.event_updated_at || b.booked_at;
							const plain = eventCancelled
								? `${title} was cancelled by the host.`
								: `Your ${type} for ${title} was cancelled.`;
							items.push({
								id,
								kind: eventCancelled ? "event_cancelled" : "booking_cancelled",
								icon: "🚫",
								title: eventCancelled ? "Event cancelled" : "Booking cancelled",
								time: timeAgo(cancelAt),
								unread: !readIds.has(id),
								href: "orders.html",
								plain,
								html: eventCancelled
									? `<strong>${escapeHtml(title)}</strong> was cancelled by the host. Your booking is in <span style="color:var(--primary);font-weight:600;">Your Orders</span>.`
									: `Your ${escapeHtml(type)} for <strong>${escapeHtml(title)}</strong> was cancelled.`,
								sort: sortMillis(cancelAt, 2),
							});
						}
					} else if (prefs.bookingEmails) {
						const id = `booking-confirmed-${bookingId}`;
						if (!clearedIds.has(id)) {
							const plain = `Your ${qty} × ${type} for ${title} is confirmed.`;
							items.push({
								id,
								kind: "booking_confirmed",
								icon: "🎟️",
								title: "Booking confirmed",
								time: timeAgo(b.booked_at),
								unread: !readIds.has(id),
								href: "orders.html",
								plain,
								html: `Your ${escapeHtml(String(qty))} × ${escapeHtml(type)} for <strong>${escapeHtml(title)}</strong> ${qty > 1 ? "are" : "is"} confirmed. E-tickets are in <span style="color:var(--primary);font-weight:600;">Your Orders</span>.`,
								sort: sortMillis(b.booked_at),
							});
						}
					}

					if (!liveCancelled && ticketStatus === "USED") {
						const id = `booking-checkedin-${bookingId}`;
						if (!clearedIds.has(id)) {
							const plain = `You're checked in for ${title}.`;
							items.push({
								id,
								kind: "booking_checkedin",
								icon: "✅",
								title: "Checked in successfully",
								time: timeAgo(b.used_at || b.booked_at),
								unread: !readIds.has(id),
								href: ticketHref(bookingId),
								plain,
								html: `You're checked in for <strong>${escapeHtml(title)}</strong>. Enjoy the event!`,
								sort: sortMillis(b.used_at || b.booked_at, 20000),
							});
						}
					}

					if (
						prefs.eventReminders
						&& !liveCancelled
						&& ticketStatus !== "USED"
						&& b.event_start_date
					) {
						const days = daysUntil(b.event_start_date);
						if (days != null && days >= 0 && days <= 7) {
							const id = `remind-${bookingId}`;
							if (!clearedIds.has(id)) {
								const labels = reminderLabels(days);
								const venue = b.event_venue ? ` at ${b.event_venue}` : "";
								const plain = `${title} starts ${labels.when}${venue}.`;
								items.push({
									id,
									kind: "event_reminder",
									icon: "✨",
									title: "Upcoming event reminder",
									time: labels.time,
									unread: !readIds.has(id),
									href: eventHref(eventId),
									plain,
									html: `<strong>${escapeHtml(title)}</strong> starts ${labels.when}${b.event_venue ? " at " + escapeHtml(b.event_venue) : ""}.`,
									sort: sortMillis(b.event_start_date),
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
						if (isFlagTrue(ev.is_cancelled)) return;
						const eventId = ev.id || ev.event_id;
						const id = `offer-${eventId || ev.title}`;
						if (clearedIds.has(id)) return;
						const title = ev.title || "a new event";
						items.push({
							id,
							kind: "event_offer",
							icon: "🎁",
							title: "Event recommendation",
							time: timeAgo(ev.start_date || ev.created_at),
							unread: !readIds.has(id),
							href: eventHref(eventId),
							plain: `You might like ${title}.`,
							html: `You might like <strong>${escapeHtml(title)}</strong>${ev.venue ? " at " + escapeHtml(ev.venue) : ""}.`,
							sort: sortMillis(ev.start_date || ev.created_at),
						});
					});
				}
			} catch (_) {}
		}

		try {
			const res = await authFetch(`${apiBase()}/api/notifications/inbox`);
			if (res.ok) {
				const rows = await res.json();
				(Array.isArray(rows) ? rows : []).forEach((row) => {
					const id = String(row.id || "");
					if (!id || clearedIds.has(id)) return;
					const place = row.location || "your city";
					const message = row.message || `A new event is upcoming in ${place}.`;
					items.push({
						id,
						kind: row.kind || "event_published",
						icon: "📍",
						title: row.title || "New upcoming event",
						time: timeAgo(row.created_at),
						unread: !readIds.has(id),
						href: row.href || eventHref(row.event_id) || "index.html#upcoming",
						plain: message,
						html: escapeHtml(message).replace(
							escapeHtml(place),
							`<strong>${escapeHtml(place)}</strong>`
						),
						sort: sortMillis(row.created_at, 5000),
					});
				});
			}
		} catch (_) {}

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
		try {
			window.dispatchEvent(new CustomEvent("jod:inbox-updated", { detail: { items } }));
		} catch (_) {}

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
			serverStateLoaded = false;
			const params = new URLSearchParams(window.location.search || "");
			const bookingId = params.get("id") || params.get("booking_id");
			if (bookingId && /ticket-details\.html/i.test(window.location.pathname || "")) {
				markRead(`booking-confirmed-${bookingId}`);
				markRead(`booking-cancelled-${bookingId}`);
				markRead(`booking-checkedin-${bookingId}`);
				markRead(`remind-${bookingId}`);
			}
			hydrateStateFromServer().then(() => refresh({ toastNew: true }));
			if (pollTimer) clearInterval(pollTimer);
			pollTimer = setInterval(() => refresh({ toastNew: true }), POLL_MS);

			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "visible" && isLoggedIn()) {
					refresh({ toastNew: true });
				}
			});
			window.addEventListener("focus", () => {
				if (isLoggedIn()) refresh({ toastNew: true });
			});
			window.addEventListener("jod:inbox-refresh", () => {
				if (isLoggedIn()) refresh({ toastNew: true });
			});
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
