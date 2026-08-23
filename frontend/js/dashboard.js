/**
 * JOD Events — customer dashboard
 * Loads profile, stats, wishlist, catalog, and bookings over the cookie session.
 */
(function () {
	"use strict";

	function apiOrigin() {
		if (window.JodAuth && window.JodAuth.API_BASE) return window.JodAuth.API_BASE;
		if (window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			return window.JodConfig.getApiOrigin();
		}
		if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		return "https://api.jodevents.com";
	}

	function authFetch(url, options) {
		if (window.JodAuth && typeof window.JodAuth.fetchAuth === "function") {
			return window.JodAuth.fetchAuth(url, options || {});
		}
		return fetch(url, Object.assign({ credentials: "include" }, options || {}));
	}

	function getUser() {
		try {
			if (window.JodAuth && typeof window.JodAuth.getUser === "function") {
				return window.JodAuth.getUser();
			}
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			return raw ? JSON.parse(raw) : null;
		} catch (_) {
			return null;
		}
	}

	function saveUser(data) {
		if (!data) return;
		try {
			localStorage.setItem("jod_user", JSON.stringify(data));
			sessionStorage.setItem("jod_user", JSON.stringify(data));
		} catch (_) {}
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function setText(id, text) {
		const el = document.getElementById(id);
		if (el) el.textContent = text;
	}

	function getInitials(user) {
		if (!user) return "?";
		const name = user.full_name || user.username || "";
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
		return "?";
	}

	function eventMs(iso) {
		if (!iso) return null;
		const ms = new Date(iso).getTime();
		return Number.isFinite(ms) ? ms : null;
	}

	function isCancelled(row) {
		const status = String(row && row.status || "").toUpperCase();
		return status === "CANCELLED" || status === "CANCELED" || status === "REFUNDED";
	}

	function isPending(row) {
		return String(row && (row.order_kind || "")).toLowerCase() === "pending"
			|| String(row && row.status || "").toUpperCase() === "PAYMENT_PENDING";
	}

	function isCheckedIn(row) {
		if (row && row.used_at) return true;
		return /used|checked.?in/i.test(String(row && row.ticket_status || ""));
	}

	function isUpcomingRow(row) {
		if (isCancelled(row) || isCheckedIn(row)) return false;
		const endMs = eventMs(row.event_end_date) || eventMs(row.event_start_date);
		if (endMs == null) return true;
		return endMs >= Date.now();
	}

	function isAttendedRow(row) {
		if (isCancelled(row) || isPending(row)) return false;
		if (isCheckedIn(row)) return true;
		const endMs = eventMs(row.event_end_date) || eventMs(row.event_start_date);
		return endMs != null && endMs < Date.now();
	}

	function uniqueEventCount(list) {
		const ids = new Set();
		(list || []).forEach((row) => {
			const key = String(row.event_id || row.event_title || row.booking_id || "").trim().toLowerCase();
			if (key) ids.add(key);
		});
		return ids.size;
	}

	function avatarStorageKey() {
		if (window.JodAuth && typeof window.JodAuth.avatarCacheKey === "function") {
			return window.JodAuth.avatarCacheKey();
		}
		const user = getUser();
		const id = user && (user.customer_id || user.id || user.email);
		return id ? `jod_profile_avatar_${String(id).toLowerCase()}` : null;
	}

	function readBookingsCache() {
		try {
			if (window.JodAuth && typeof window.JodAuth.readScopedCache === "function") {
				const raw = window.JodAuth.readScopedCache("jod_user_bookings");
				const parsed = raw ? JSON.parse(raw) : [];
				return Array.isArray(parsed) ? parsed : [];
			}
			const key = window.JodAuth && typeof window.JodAuth.bookingsCacheKey === "function"
				? window.JodAuth.bookingsCacheKey()
				: null;
			if (!key) return [];
			const raw = localStorage.getItem(key);
			const parsed = raw ? JSON.parse(raw) : [];
			return Array.isArray(parsed) ? parsed : [];
		} catch (_) {
			return [];
		}
	}

	function writeBookingsCache(list) {
		try {
			const payload = JSON.stringify(list || []);
			if (window.JodAuth && typeof window.JodAuth.writeScopedCache === "function") {
				window.JodAuth.writeScopedCache("jod_user_bookings", payload);
				return;
			}
			const key = window.JodAuth && typeof window.JodAuth.bookingsCacheKey === "function"
				? window.JodAuth.bookingsCacheKey()
				: null;
			if (key) localStorage.setItem(key, payload);
		} catch (_) {}
	}

	async function readJson(path) {
		const res = await authFetch(apiOrigin() + path, {
			cache: "no-store",
			headers: { Accept: "application/json" }
		});
		if (!res || !res.ok) return null;
		return res.json();
	}

	function paintProfile(user) {
		if (!user) return;
		const name = user.full_name || user.username || "User";
		setText("dashUserName", "Welcome, " + name + "!");
		setText("dashUserEmail", user.email || "");
		if (typeof window.updateProfileLocation === "function") {
			window.updateProfileLocation({
				city: user.city || "",
				location_pincode: user.location_pincode || user.location_pin || user.pincode || ""
			});
		}
	}

	function renderDashboardAvatar() {
		const avatarEl = document.getElementById("dashboardAvatar");
		if (!avatarEl) return;
		const saved = (window.JodProfile && typeof window.JodProfile.getSavedAvatar === "function")
			? window.JodProfile.getSavedAvatar()
			: (function () {
				const key = avatarStorageKey();
				return key ? localStorage.getItem(key) : null;
			})();
		const user = getUser();
		const remote = user && user.avatar_url;
		const src = saved || remote;
		const rm = document.getElementById("removePhotoBtn");
		if (src) {
			avatarEl.innerHTML = `<img src="${escapeHtml(src)}" alt="Profile picture" />`;
			if (rm) rm.classList.add("visible");
		} else {
			avatarEl.textContent = getInitials(user);
			if (rm) rm.classList.remove("visible");
		}
	}

	function bindAvatarUpload() {
		const avatarEl = document.getElementById("dashboardAvatar");
		if (avatarEl) {
			avatarEl.addEventListener("click", () => {
				const input = document.getElementById("avatarFileInput");
				if (input) input.click();
			});
		}

		const fileInput = document.getElementById("avatarFileInput");
		if (fileInput) {
			fileInput.addEventListener("change", (e) => {
				const file = e.target.files && e.target.files[0];
				if (!file) return;
				if (window.JodCropModal) {
					window.JodCropModal.open(file, () => renderDashboardAvatar());
				} else {
					const reader = new FileReader();
					reader.onload = (ev) => {
						const dataUrl = ev.target.result;
						if (window.JodProfile) {
							window.JodProfile.setProfilePicture(dataUrl);
						} else {
							const key = avatarStorageKey();
							if (key) localStorage.setItem(key, dataUrl);
						}
						renderDashboardAvatar();
					};
					reader.readAsDataURL(file);
				}
				e.target.value = "";
			});
		}

		const removeBtn = document.getElementById("removePhotoBtn");
		if (removeBtn) {
			removeBtn.addEventListener("click", () => {
				if (window.JodProfile) {
					window.JodProfile.removeProfilePicture();
				} else {
					const key = avatarStorageKey();
					if (key) localStorage.removeItem(key);
				}
				renderDashboardAvatar();
			});
		}
	}

	function isLiveUpcomingEvent(event) {
		const EP = window.JodEventsPublic;
		if (EP && typeof EP.getEventPhase === "function") {
			const phase = EP.getEventPhase(event);
			return phase === "upcoming" || phase === "live" || phase === "unknown";
		}
		if (!event || !event.start_date) return true;
		const endMs = event.end_date ? eventMs(event.end_date) : null;
		if (endMs && endMs < Date.now()) return false;
		return true;
	}

	async function loadLiveUpcoming() {
		const upcomingVal = document.getElementById("upcomingEventsVal");
		const container = document.getElementById("liveUpcomingContainer");
		try {
			const EP = window.JodEventsPublic;
			let events = [];
			if (EP && typeof EP.fetchPublishedEvents === "function") {
				events = await EP.fetchPublishedEvents({ limit: "50" });
			} else {
				const res = await fetch(apiOrigin() + "/api/events/public?limit=50", {
					cache: "no-store",
					headers: { Accept: "application/json" }
				});
				if (!res.ok) throw new Error("events");
				events = await res.json();
			}
			const list = (Array.isArray(events) ? events : []).filter(isLiveUpcomingEvent);
			if (upcomingVal) upcomingVal.textContent = String(list.length);
			if (!container) return list;
			if (!list.length) {
				container.innerHTML = `
					<div class="empty-state">
						<div class="empty-icon">📅</div>
						<p>No upcoming events right now.<br>
						<a href="index.html#upcoming" style="color:var(--primary);font-weight:600">Browse the event calendar &rarr;</a></p>
					</div>`;
				return list;
			}
			const resolveImg = EP && EP.resolveImage
				? EP.resolveImage.bind(EP)
				: (url) => (window.JodConfig && window.JodConfig.safeMediaUrl
					? window.JodConfig.safeMediaUrl(url, "images/hero-event.jpg")
					: (url || "https://assets.jodevents.com/images/hero-event.jpg"));
			const heroFb = (window.JodConfig && window.JodConfig.assetUrl)
				? window.JodConfig.assetUrl("images/hero-event.jpg")
				: "https://assets.jodevents.com/images/hero-event.jpg";
			const formatDate = EP && EP.formatDateIST ? EP.formatDateIST.bind(EP) : (iso) => iso || "Date TBA";
			const detailsUrl = EP && EP.eventDetailsUrl
				? EP.eventDetailsUrl.bind(EP)
				: (ev) => `event-details.html?id=${encodeURIComponent(ev.id)}`;
			container.innerHTML = `<div class="dash-event-grid">${list.map((ev) => {
				const url = detailsUrl(ev);
				const img = resolveImg(ev.card_image || ev.image_url);
				const title = escapeHtml(ev.title || "Untitled Event");
				const venue = escapeHtml(ev.venue || ev.location || "Venue TBA");
				const when = escapeHtml(formatDate(ev.start_date));
				return `<a class="dash-event-card" href="${url}">
					<img src="${escapeHtml(img)}" alt="${title}" onerror="this.src='${escapeHtml(heroFb)}'" />
					<div class="dash-event-body">
						<h3>${title}</h3>
						<p class="dash-event-meta">${when} · ${venue}</p>
						<span class="dash-event-cta">View details →</span>
					</div>
				</a>`;
			}).join("")}</div>`;
			return list;
		} catch (_) {
			if (upcomingVal) upcomingVal.textContent = "0";
			if (container) {
				container.innerHTML = `
					<div class="empty-state">
						<div class="empty-icon">📅</div>
						<p>Could not load upcoming events.<br>
						<a href="index.html#upcoming" style="color:var(--primary);font-weight:600">Try the home page &rarr;</a></p>
					</div>`;
			}
			return [];
		}
	}

	async function loadWishlistCount() {
		const el = document.getElementById("wishlistItemsVal");
		if (!el) return 0;
		try {
			if (window.JodWishlist && typeof window.JodWishlist.loadIds === "function") {
				const ids = await window.JodWishlist.loadIds();
				const count = (ids && ids.length) || 0;
				el.textContent = String(count);
				if (count) return count;
			}
			const data = await readJson("/api/wishlist/ids");
			const ids = data && Array.isArray(data.event_ids) ? data.event_ids : [];
			el.textContent = String(ids.length);
			return ids.length;
		} catch (_) {
			el.textContent = "0";
			return 0;
		}
	}

	function normalizePending(row) {
		return {
			booking_id: "",
			event_id: row.event_id,
			event_title: row.event_title || "Event",
			event_venue: row.event_venue,
			event_start_date: row.event_start_date,
			ticket_type: row.ticket_type || "Ticket",
			quantity: Number(row.quantity || 1),
			total_price: Number(row.price || 0),
			status: row.status || "PAYMENT_PENDING",
			order_kind: "pending",
			image_url: row.image_url
		};
	}

	function mergeActivity(bookings, pending) {
		const list = [];
		const seenEvents = new Set();
		(bookings || []).forEach((row) => {
			list.push(row);
			const key = String(row.event_id || "").trim().toLowerCase().replace(/-/g, "");
			if (key) seenEvents.add(key);
		});
		(pending || []).forEach((row) => {
			const key = String(row.event_id || "").trim().toLowerCase().replace(/-/g, "");
			if (key && seenEvents.has(key)) return;
			list.push(normalizePending(row));
		});
		return list;
	}

	function renderBookingsTable(list) {
		const container = document.getElementById("recentBookingsContainer");
		if (!container) return;
		if (!list.length) {
			container.innerHTML = `
				<div class="empty-state">
					<div class="empty-icon">🎟️</div>
					<p>You haven't booked any events yet.<br>
					<a href="index.html#upcoming" style="color:var(--primary);font-weight:600">Explore upcoming events &rarr;</a></p>
				</div>`;
			return;
		}

		const rows = list.slice(0, 8).map((b) => {
			const cancelled = isCancelled(b);
			const pending = isPending(b);
			const upcomingRow = isUpcomingRow(b);
			let statusClass = "completed";
			let statusLabel = "Completed";
			if (cancelled) {
				statusClass = "cancelled";
				statusLabel = "Cancelled";
			} else if (pending) {
				statusClass = "pending";
				statusLabel = "Awaiting ticket";
			} else if (isCheckedIn(b)) {
				statusClass = "completed";
				statusLabel = "Checked in";
			} else if (upcomingRow) {
				statusClass = "upcoming";
				statusLabel = "Upcoming";
			}
			const eventId = encodeURIComponent(b.event_id || "");
			const bookingId = encodeURIComponent(b.booking_id || "");
			const href = b.booking_id
				? `ticket-details.html?id=${bookingId}`
				: (eventId ? `event-details.html?id=${eventId}` : "orders.html");
			const actionLabel = b.booking_id ? "View" : "Open";
			return `
				<tr class="${cancelled ? "is-cancelled" : ""}">
					<td style="font-weight:600;color:var(--foreground);">${escapeHtml(b.event_title || "Event")}</td>
					<td>${escapeHtml(b.ticket_type || "Ticket")} (x${Number(b.quantity || 1)})</td>
					<td style="font-weight:700;color:#16a34a;">₹${Number(b.total_price || 0).toLocaleString("en-IN")}</td>
					<td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
					<td><a class="view-booking-btn" href="${href}">${actionLabel}</a></td>
				</tr>`;
		}).join("");

		container.innerHTML = `
			<div style="overflow-x:auto;">
			<table class="bookings-table">
				<thead>
					<tr>
						<th>Event</th>
						<th>Ticket / Qty</th>
						<th>Amount</th>
						<th>Status</th>
						<th></th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table></div>`;
	}

	async function loadMyBookings() {
		const totalVal = document.getElementById("totalBookingsVal");
		const attendedVal = document.getElementById("eventsAttendedVal");
		let bookings = readBookingsCache();
		let pending = [];

		try {
			const [remoteBookings, remotePending] = await Promise.all([
				readJson("/api/bookings/my-bookings?include_all=true"),
				readJson("/api/bookings/my-pending")
			]);
			if (Array.isArray(remoteBookings)) bookings = remoteBookings;
			if (Array.isArray(remotePending)) pending = remotePending;
			if (Array.isArray(remoteBookings) && remoteBookings.length) {
				writeBookingsCache(remoteBookings);
			}
		} catch (_) {}

		const list = mergeActivity(bookings, pending);
		const active = list.filter((b) => !isCancelled(b));
		const attended = active.filter(isAttendedRow);

		if (totalVal) totalVal.textContent = String(uniqueEventCount(active));
		if (attendedVal) attendedVal.textContent = String(uniqueEventCount(attended));
		renderBookingsTable(list);
		return list;
	}

	async function hydrateProfileFromApi() {
		try {
			const data = await readJson("/api/users/me");
			if (data) saveUser(data);
			return data || getUser();
		} catch (_) {
			return getUser();
		}
	}

	async function hydrate() {
		paintProfile(getUser());
		renderDashboardAvatar();
		const freshUser = await hydrateProfileFromApi();
		paintProfile(freshUser || getUser());
		renderDashboardAvatar();
		await Promise.all([
			loadLiveUpcoming(),
			loadMyBookings(),
			loadWishlistCount()
		]);
	}

	async function boot() {
		const currentTarget = window.location.pathname + window.location.search + window.location.hash;
		if (!(window.JodAuth && typeof window.JodAuth.requireAuthOrRedirect === "function")) {
			try { sessionStorage.setItem("jod_redirect_after_login", currentTarget); } catch (_) {}
			window.location.replace(`login.html?redirect=${encodeURIComponent(currentTarget)}`);
			return;
		}
		const authed = await window.JodAuth.requireAuthOrRedirect({ redirectTo: currentTarget });
		if (!authed) return;
		bindAvatarUpload();
		await hydrate();
	}

	function start() {
		boot().catch(() => {});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
