/**
 * Event agenda page — roadmap for a purchased booking.
 */
(function initAgendaPage() {
	"use strict";

	function getApiBase() {
		if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		const host = (window.location.hostname && window.location.hostname !== "localhost")
			? window.location.hostname : "127.0.0.1";
		return `http://${host}:8001`;
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

	async function loadBooking(bookingId) {
		const token = window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));
		if (!token) return { _error: "signin" };
		try {
			const res = await fetch(`${getApiBase()}/api/bookings/${bookingId}`, {
				headers: { Authorization: `Bearer ${token}` },
				cache: "no-store"
			});
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
