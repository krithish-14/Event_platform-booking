/**
 * Event agenda page — roadmap for a purchased booking.
 */
(function initAgendaPage() {
	"use strict";

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

	function getQueryParam(name) {
		return new URLSearchParams(window.location.search).get(name) || "";
	}

	function formatDateFull(dateStr) {
		if (!dateStr) return "";
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return "";
			return d.toLocaleDateString("en-US", {
				weekday: "short",
				month: "short",
				day: "numeric",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			});
		} catch (_) {
			return "";
		}
	}

	function showUnavailable(message) {
		const title = document.getElementById("agendaEventTitle");
		const meta = document.getElementById("agendaEventMeta");
		const roadmap = document.getElementById("agendaRoadmap");
		if (title) title.textContent = "Agenda unavailable";
		if (meta) meta.textContent = message || "This agenda could not be loaded.";
		if (roadmap) {
			roadmap.innerHTML = `<p class="agenda-empty"><a class="button button-primary button-sm" href="orders.html">Back to your orders</a></p>`;
		}
	}

	async function authFetch(url, options) {
		const opts = Object.assign({ cache: "no-store" }, options || {});
		opts.headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
		if (window.JodAuth && typeof window.JodAuth.fetchAuth === "function") {
			return window.JodAuth.fetchAuth(url, opts);
		}
		return fetch(url, Object.assign({ credentials: "include" }, opts));
	}

	function isSignedIn() {
		if (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function") {
			return window.JodAuth.isLoggedIn();
		}
		try {
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			return Boolean(raw && raw !== "null" && raw !== "undefined");
		} catch (_) {
			return false;
		}
	}

	async function loadBooking(bookingId) {
		if (!bookingId) return { _error: "notfound" };
		try {
			if (window.JodAuth && typeof window.JodAuth.validateSession === "function") {
				const sessionUser = await window.JodAuth.validateSession();
				if (!sessionUser && !isSignedIn()) return { _error: "signin" };
			} else if (!isSignedIn()) {
				return { _error: "signin" };
			}
			const res = await authFetch(`${getApiBase()}/api/bookings/${bookingId}`);
			if (res.ok) return await res.json();
			if (res.status === 401) return { _error: "signin" };
			if (res.status === 403) return { _error: "forbidden" };
			if (res.status === 404) return { _error: "notfound" };
		} catch (_) {}
		return { _error: "unavailable" };
	}

	async function loadPublicEvent(eventId) {
		if (!eventId) return null;
		try {
			const res = await fetch(`${getApiBase()}/api/events/public/${encodeURIComponent(eventId)}`, { cache: "no-store" });
			if (res.ok) return await res.json();
		} catch (_) {}
		return null;
	}

	function renderAgenda(data) {
		const title = data.event_title || data.title || "Event Agenda";
		const venue = data.event_venue || data.venue || data.location || "";
		const startLabel = formatDateFull(data.event_start_date || data.start_date);
		const endLabel = formatDateFull(data.event_end_date || data.end_date);
		const bookingId = data.booking_id || "";
		const eventId = data.event_id || data.id || "";

		const titleEl = document.getElementById("agendaEventTitle");
		const metaEl = document.getElementById("agendaEventMeta");
		if (titleEl) titleEl.textContent = title;
		if (metaEl) {
			metaEl.textContent = [startLabel, venue].filter(Boolean).join(" · ");
		}

		if (bookingId) {
			const ticketLink = document.getElementById("agendaViewTicket");
			const backLink = document.getElementById("agendaBackLink");
			if (ticketLink) ticketLink.href = `ticket-details.html?id=${encodeURIComponent(bookingId)}`;
			if (backLink) backLink.href = "orders.html";
		}
		if (eventId) {
			const eventLink = document.getElementById("agendaViewEvent");
			if (eventLink) eventLink.href = `event-details.html?id=${encodeURIComponent(eventId)}`;
		}

		document.title = `${title} — Agenda | JOD Events`;

		if (window.JodAgenda && typeof window.JodAgenda.renderRoadmap === "function") {
			window.JodAgenda.renderRoadmap(document.getElementById("agendaRoadmap"), data.agenda, {
				eventTitle: title,
				startLabel,
				endLabel,
				venue
			});
		}
	}

	document.addEventListener("DOMContentLoaded", async () => {
		const bookingId = getQueryParam("id") || getQueryParam("booking_id");
		const eventId = getQueryParam("eventId") || getQueryParam("event");

		if (bookingId) {
			const booking = await loadBooking(bookingId);
			if (!booking || booking._error) {
				const messages = {
					signin: "Please sign in to view this agenda.",
					forbidden: "This agenda belongs to another account.",
					notfound: "This ticket could not be found.",
					unavailable: "This agenda is not available."
				};
				showUnavailable(messages[booking && booking._error] || messages.unavailable);
				return;
			}
			if ((!Array.isArray(booking.agenda) || !booking.agenda.length) && booking.event_id) {
				const event = await loadPublicEvent(booking.event_id);
				if (event && Array.isArray(event.agenda)) booking.agenda = event.agenda;
			}
			renderAgenda(booking);
			return;
		}

		if (eventId) {
			const event = await loadPublicEvent(eventId);
			if (!event) {
				showUnavailable("This event agenda could not be found.");
				return;
			}
			renderAgenda(event);
			return;
		}

		showUnavailable("No ticket or event was selected.");
	});
})();
