/**
 * JOD Events — BookMyShow-Style M-Ticket & Invoice Controller
 * Dynamic data rendering, QR code generation, collapsible details toggle, print/download, and ticket cancellation.
 */

(function initTicketDetailsPage() {
	"use strict";

	function getApiBase() {
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		const host = (window.location && window.location.hostname && window.location.hostname !== "localhost") ? window.location.hostname : "127.0.0.1";
		return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;
	}

	function getQueryParam(name) {
		const params = new URLSearchParams(window.location.search);
		return params.get(name) || "";
	}

	function getLocalBookingsCache() {
		try {
			const key = window.JodAuth && typeof window.JodAuth.bookingsCacheKey === "function"
				? window.JodAuth.bookingsCacheKey()
				: null;
			if (!key) return [];
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : [];
		} catch (_) {
			return [];
		}
	}

	function saveLocalBookingCache(booking) {
		if (!booking || !booking.booking_id) return;
		try {
			const key = window.JodAuth && typeof window.JodAuth.bookingsCacheKey === "function"
				? window.JodAuth.bookingsCacheKey()
				: null;
			if (!key) return;
			const cache = getLocalBookingsCache();
			const idx = cache.findIndex(b => b.booking_id === booking.booking_id);
			if (idx >= 0) {
				cache[idx] = { ...cache[idx], ...booking };
			} else {
				cache.unshift(booking);
			}
			localStorage.setItem(key, JSON.stringify(cache));
		} catch (_) {}
	}

	function formatDateFull(dateStr) {
		if (!dateStr) return "Date TBA";
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return "Date TBA";
			return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
		} catch (_) {
			return "Date TBA";
		}
	}

	async function loadBookingData(bookingId) {
		if (!bookingId) return null;
		const apiBase = getApiBase();
		const token = window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));

		if (!token) return { _error: "signin" };

		try {
			const res = await fetch(`${apiBase}/api/bookings/${bookingId}`, {
				headers: { "Authorization": `Bearer ${token}` },
				cache: "no-store"
			});
			if (res.ok) {
				const data = await res.json();
				saveLocalBookingCache(data);
				return data;
			}
			if (res.status === 401) return { _error: "signin" };
			if (res.status === 403) return { _error: "forbidden" };
			if (res.status === 404) return { _error: "notfound" };
		} catch (_) {}

		return { _error: "unavailable" };
	}

	function showTicketUnavailable(kind) {
		const messages = {
			signin: "Please sign in to view this ticket.",
			forbidden: "This ticket belongs to another account.",
			notfound: "This ticket could not be found.",
			unavailable: "This ticket is not available."
		};
		const area = document.getElementById("printableTicketArea");
		if (area) {
			area.innerHTML = `<div style="padding:2.75rem 1.5rem;text-align:center;">
				<h2 style="margin:0 0 .75rem;font-size:1.25rem;">Ticket unavailable</h2>
				<p style="margin:0 0 1.25rem;color:var(--muted);">${messages[kind] || messages.unavailable}</p>
				<a class="button button-primary button-sm" href="orders.html">Back to your orders</a>
			</div>`;
		}
	}

	function resolveTicketImage(url) {
		if (!url) return "";
		if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:") || url.startsWith("data:")) return url;
		if (url.startsWith("/api/media") || url.startsWith("/uploads/") || url.startsWith("uploads/")) {
			const base = getApiBase().replace(/\/$/, "");
			return `${base}/${url.replace(/^\//, "")}`;
		}
		return url;
	}

	function renderTicketDOM(data) {
		if (!data) return;

		const isCancelled = (data.status || "").toUpperCase() === "CANCELLED";
		const isCheckedIn = !isCancelled && String(data.ticket_status || "").toUpperCase() === "USED";
		const ticketCard = document.getElementById("printableTicketArea");
		if (ticketCard) {
			ticketCard.classList.toggle("is-cancelled", isCancelled);
			ticketCard.classList.toggle("is-checked-in", isCheckedIn);
		}

		// Status Badge & Header ID
		const statusBadge = document.getElementById("ticketStatusBadge");
		const orderIdCode = document.getElementById("ticketOrderIdCode");
		const statusVal = document.getElementById("ticketStatusVal");

		const shortId = (data.booking_id || "00000000").substring(0, 8).toUpperCase();
		if (orderIdCode) orderIdCode.textContent = `#JOD-${shortId}`;

		if (statusBadge) {
			if (isCancelled) {
				statusBadge.textContent = "CANCELLED";
				statusBadge.className = "status-badge badge-cancelled";
			} else if (isCheckedIn) {
				statusBadge.textContent = "CHECKED IN";
				statusBadge.className = "status-badge badge-checkedin";
			} else {
				statusBadge.textContent = "CONFIRMED";
				statusBadge.className = "status-badge badge-confirmed";
			}
		}

		if (statusVal) {
			if (isCancelled) {
				statusVal.textContent = "Cancelled / Refund Processed";
				statusVal.className = "info-val status-text-cancelled";
			} else if (isCheckedIn) {
				statusVal.textContent = "Checked in at the venue";
				statusVal.className = "info-val status-text-checkedin";
			} else {
				statusVal.textContent = "Active / Valid for Entry";
				statusVal.className = "info-val status-text-confirmed";
			}
		}

		// BookMyShow Style Header Section
		const titleEl = document.getElementById("ticketEventTitle");
		const formatLangEl = document.getElementById("ticketFormatLang");
		const dateTimeEl = document.getElementById("ticketEventDateTime");
		const venueEl = document.getElementById("ticketEventVenue");
		const catBadge = document.getElementById("ticketCategoryBadge");
		const imgEl = document.getElementById("ticketEventImg");

		if (titleEl) titleEl.textContent = data.event_title || "Event Booking";
		if (formatLangEl) formatLangEl.textContent = `${data.language || "English"}, ${data.event_format || "Live Event"}`;
		if (dateTimeEl) dateTimeEl.textContent = formatDateFull(data.event_start_date);
		if (venueEl) venueEl.textContent = `${data.event_venue || "Venue details at location"}`;
		if (catBadge) catBadge.textContent = `🎟️ ${data.ticket_type || "Standard Access"}`;
		const ticketImg = data.card_image || data.image_url;
		if (imgEl) {
			if (ticketImg) {
				imgEl.src = resolveTicketImage(ticketImg);
				imgEl.onerror = function onTicketImgError() {
					this.onerror = null;
					this.src = "images/hero-event.jpg";
				};
			} else {
				imgEl.src = "images/hero-event.jpg";
			}
		}

		const countVal = document.getElementById("ticketCountVal");
		const catVal = document.getElementById("ticketCategoryVal");
		const idVal = document.getElementById("ticketIdVal");
		const bookedTimeVal = document.getElementById("ticketBookedTimeVal");

		const bookingIdDisplay = `#JOD-${shortId}`;
		if (idVal) idVal.textContent = bookingIdDisplay;
		if (catVal) catVal.textContent = data.ticket_type || "Standard Access Pass";
		if (countVal) countVal.textContent = `${data.quantity || 1} Ticket(s)`;
		if (bookedTimeVal) bookedTimeVal.textContent = formatDateFull(data.booked_at);

		// Booking ID & Secure QR Code Block
		const bookingIdText = document.getElementById("ticketBookingIdText");
		const qrImg = document.getElementById("ticketQrCodeImg");
		const qrToken = data.qr_token || "";

		if (bookingIdText) bookingIdText.textContent = `BOOKING ID: ${bookingIdDisplay}`;
		if (qrImg && qrToken) {
			qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrToken)}`;
		}

		// Bill & Pricing Summary
		const qty = max(1, data.quantity || 1);
		const totalPrice = Number(data.total_price || 0);
		const unitPrice = Math.round(totalPrice / qty);
		const gstAmount = Number(data.gst_amount || Math.round(totalPrice * 0.18));

		const unitPriceEl = document.getElementById("billUnitPrice");
		const qtyEl = document.getElementById("billQty");
		const subtotalEl = document.getElementById("billSubtotal");
		const gstEl = document.getElementById("billGst");
		const totalEl = document.getElementById("billTotal");
		const paymentIdEl = document.getElementById("billPaymentId");
		const paymentModeEl = document.getElementById("billPaymentMode");

		if (unitPriceEl) unitPriceEl.textContent = `₹${unitPrice.toLocaleString("en-IN")}`;
		if (qtyEl) qtyEl.textContent = `x${qty}`;
		if (subtotalEl) subtotalEl.textContent = `Rs.${(totalPrice - gstAmount).toLocaleString("en-IN")}`;
		if (gstEl) gstEl.textContent = `Rs.${gstAmount.toLocaleString("en-IN")}`;
		if (totalEl) totalEl.textContent = `Rs.${totalPrice.toLocaleString("en-IN")}`;
		if (paymentIdEl) paymentIdEl.textContent = data.payment_id || `PAY-JOD-${shortId}`;
		if (paymentModeEl) paymentModeEl.textContent = data.payment_mode || "UPI / Credit Card";

		// Receiver Details
		const recName = document.getElementById("receiverName");
		const recEmail = document.getElementById("receiverEmail");
		const recPhone = document.getElementById("receiverPhone");

		if (recName) recName.textContent = data.receiver_name || data.user_name || "Guest Customer";
		if (recEmail) recEmail.textContent = data.receiver_email || data.user_email || "customer@jodevents.com";
		if (recPhone) recPhone.textContent = data.receiver_phone || "+91 98765 43210";

		renderAgendaBack(data);
		window.requestAnimationFrame(syncFlipHeight);
	}

	function escapeHtml(str) {
		if (window.JodAgenda && typeof window.JodAgenda.escapeHtml === "function") {
			return window.JodAgenda.escapeHtml(str);
		}
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function renderAgendaBack(data) {
		const title = data.event_title || "Event Agenda";
		const venue = data.event_venue || "";
		const startLabel = formatDateFull(data.event_start_date);
		const endLabel = formatDateFull(data.event_end_date);
		const titleEl = document.getElementById("ticketAgendaTitle");
		const metaEl = document.getElementById("ticketAgendaMeta");
		if (titleEl) titleEl.textContent = title;
		if (metaEl) metaEl.textContent = [startLabel, venue].filter(Boolean).join(" · ");
		if (window.JodAgenda && typeof window.JodAgenda.renderRoadmap === "function") {
			window.JodAgenda.renderRoadmap(document.getElementById("ticketAgendaRoadmap"), data.agenda, {
				eventTitle: title,
				startLabel,
				endLabel,
				venue
			});
		}
	}

	function syncFlipHeight() {
		const front = document.getElementById("printableTicketArea");
		const inner = document.getElementById("ticketFlipInner");
		const back = document.getElementById("ticketAgendaCard");
		if (!front || !inner) return;
		const height = Math.max(front.offsetHeight || 0, 560);
		inner.style.minHeight = `${height}px`;
		if (back) back.style.minHeight = `${height}px`;
	}

	function bindTicketFlip() {
		const scene = document.getElementById("ticketFlipScene");
		const inner = document.getElementById("ticketFlipInner");
		const hint = document.getElementById("ticketFlipHint");
		if (!scene || !inner || scene.dataset.flipBound === "1") return;
		scene.dataset.flipBound = "1";
		scene.addEventListener("click", (event) => {
			if (event.target.closest("a, button, input, textarea, select, label")) return;
			inner.classList.toggle("is-flipped");
			const flipped = inner.classList.contains("is-flipped");
			if (hint) hint.textContent = flipped ? "Tap ticket to view front" : "Tap ticket to view agenda";
		});
	}

	function max(a, b) { return a > b ? a : b; }

	function buildPrintAgendaHtml(bookingData) {
		const eventTitle = (bookingData && bookingData.event_title) || "Event Agenda";
		const venue = (bookingData && bookingData.event_venue) || "";
		const startLabel = formatDateFull(bookingData && bookingData.event_start_date);
		const endLabel = (bookingData && bookingData.event_end_date) ? formatDateFull(bookingData.event_end_date) : "";
		const meta = { eventTitle, startLabel, endLabel, venue };
		if (window.JodAgenda && typeof window.JodAgenda.printDocumentHtml === "function") {
			return window.JodAgenda.printDocumentHtml(bookingData && bookingData.agenda, meta);
		}
		return `<section class="ticket-print-agenda-page" style="max-width:640px;margin:24px auto 0;page-break-before:always;break-before:page;color:#111827;font-family:Outfit,Inter,system-ui,sans-serif;">
			<p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ff7508;">Event roadmap</p>
			<h1 style="margin:0 0 6px;font-size:26px;">${escapeHtml(eventTitle)}</h1>
			<p style="margin:0 0 12px;color:#6b7280;">${escapeHtml([startLabel, venue].filter(Boolean).join(" · "))}</p>
			<p>Agenda details will be shared at the venue.</p>
		</section>`;
	}

	function printTicketCardOnly(bookingData, options) {
		const includeAgenda = Boolean(options && options.includeAgenda);
		const source = document.getElementById("printableTicketArea");
		if (!source) {
			window.print();
			return;
		}

		const collapsibleContent = document.getElementById("collapsibleTicketDetails");
		if (collapsibleContent) collapsibleContent.classList.remove("collapsed");

		const shortId = ((bookingData && bookingData.booking_id) || "ticket").substring(0, 8).toUpperCase();
		const eventTitle = (bookingData && bookingData.event_title) || "JOD Ticket";
		const printTitle = includeAgenda ? `JOD-Ticket-Agenda-${shortId}` : `JOD-Ticket-${shortId}`;
		const agendaHtml = includeAgenda ? buildPrintAgendaHtml(bookingData) : "";

		const iframe = document.createElement("iframe");
		iframe.setAttribute("aria-hidden", "true");
		iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;";
		document.body.appendChild(iframe);

		const doc = iframe.contentDocument || iframe.contentWindow.document;
		const clone = source.cloneNode(true);
		clone.querySelectorAll(".mticket-toggle-btn, .mticket-support-row, .mticket-notch").forEach((n) => n.remove());
		const collapsed = clone.querySelector(".mticket-collapsible-content");
		if (collapsed) collapsed.classList.remove("collapsed");

		doc.open();
		doc.write(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8" />
	<title>${printTitle}</title>
	<style>
		@page { size: A4 portrait; margin: 12mm; }
		html, body {
			margin: 0;
			padding: 0;
			background: #ffffff !important;
			color: #111827;
			font-family: Outfit, Inter, system-ui, sans-serif;
		}
		body { display: block; padding: 8px; }
		.print-ticket-page {
			display: flex;
			justify-content: center;
			${includeAgenda ? "page-break-after: always; break-after: page;" : ""}
		}
		#printableTicketArea, .mticket-card {
			width: 100%;
			max-width: 480px;
			margin: 0 auto;
			background: #ffffff;
			color: #0f172a;
			border: 1px solid #d1d5db;
			border-radius: 16px;
			overflow: visible;
			height: auto !important;
			min-height: 0 !important;
			box-shadow: none !important;
		}
		.mticket-header-section, .mticket-seating-block, .mticket-qr-block,
		.mticket-price-summary { padding: 1rem 1.1rem; }
		.mticket-poster img, #ticketEventImg { width: 88px; height: 110px; object-fit: cover; border-radius: 8px; }
		.mticket-header-section { display: flex; gap: 0.85rem; align-items: flex-start; }
		.mticket-event-details h1, #ticketEventTitle { font-size: 1.15rem; margin: 0 0 0.35rem; }
		.mticket-qr-frame img, #ticketQrCodeImg { width: 180px; height: 180px; }
		.mticket-qr-block { text-align: center; }
		.mticket-stub-divider { border-top: 1px dashed #cbd5e1; margin: 0.25rem 0; }
		.mticket-item-row, .mticket-total-row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.35rem 0; }
		.mticket-watermark { display: none; }
		.mticket-collapsible-content.collapsed { max-height: none !important; opacity: 1 !important; overflow: visible !important; }
		.ticket-print-agenda-page, .ticket-print-agenda-page * {
			visibility: visible !important;
		}
	</style>
</head>
<body>
	<div class="print-ticket-page"></div>
</body>
</html>`);
		doc.close();

		const ticketPage = doc.querySelector(".print-ticket-page");
		if (ticketPage) ticketPage.appendChild(clone);
		if (agendaHtml) {
			const wrap = doc.createElement("div");
			wrap.innerHTML = agendaHtml.trim();
			if (wrap.firstElementChild) doc.body.appendChild(wrap.firstElementChild);
		}
		const prevTitle = document.title;
		document.title = `${eventTitle} — ${printTitle}`;

		const images = Array.from(doc.images || []);
		const waitForImages = Promise.all(images.map((img) => {
			if (img.complete) return Promise.resolve();
			return new Promise((resolve) => {
				img.onload = resolve;
				img.onerror = resolve;
				setTimeout(resolve, 1200);
			});
		}));

		waitForImages.then(() => {
			setTimeout(() => {
				iframe.contentWindow.focus();
				iframe.contentWindow.print();
				document.title = prevTitle;
				setTimeout(() => {
					if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
				}, 800);
			}, 150);
		});
	}

	function bindActions(bookingData) {
		const btnDownloadTicket = document.getElementById("btnDownloadTicket");
		const btnDownloadInvoice = document.getElementById("btnDownloadInvoice");
		const btnToggleDetails = document.getElementById("btnToggleDetails");
		const btnContactSupport = document.getElementById("btnContactSupport");
		const collapsibleContent = document.getElementById("collapsibleTicketDetails");
		const toggleText = document.getElementById("toggleDetailsText");

		let isCollapsed = false;

		btnToggleDetails?.addEventListener("click", () => {
			isCollapsed = !isCollapsed;
			if (collapsibleContent) {
				if (isCollapsed) {
					collapsibleContent.classList.add("collapsed");
					if (toggleText) toggleText.textContent = "Tap to show details ▼";
				} else {
					collapsibleContent.classList.remove("collapsed");
					if (toggleText) toggleText.textContent = "Tap to hide details ▲";
				}
				window.requestAnimationFrame(syncFlipHeight);
			}
		});

		btnContactSupport?.addEventListener("click", () => {
			alert(`JOD Events 24/7 Helpline & Support:\n\n📞 Phone: +91 1800-JOD-EVENTS (+91 1800-563-383)\n✉️ Email: support@jodevents.com\n💬 Booking ID: #${(bookingData.booking_id || "00000000").substring(0,8).toUpperCase()}`);
		});

		btnDownloadTicket?.addEventListener("click", () => {
			printTicketCardOnly(bookingData, { includeAgenda: true });
		});

		btnDownloadInvoice?.addEventListener("click", () => {
			printTicketCardOnly(bookingData, { includeAgenda: false });
		});
	}

	document.addEventListener("DOMContentLoaded", async () => {
		const bookingId = getQueryParam("id") || getQueryParam("booking_id");
		if (bookingId && window.JodInbox) {
			window.JodInbox.markRead(`booking-confirmed-${bookingId}`);
			window.JodInbox.markRead(`booking-cancelled-${bookingId}`);
			window.JodInbox.markRead(`remind-${bookingId}`);
		}
		const bookingData = await loadBookingData(bookingId);
		if (!bookingData || bookingData._error) {
			showTicketUnavailable(bookingData && bookingData._error);
			return;
		}
		renderTicketDOM(bookingData);
		bindActions(bookingData);
		bindTicketFlip();
		window.requestAnimationFrame(syncFlipHeight);

		if (bookingId && String(bookingData.ticket_status || "").toUpperCase() !== "USED") {
			const pollCheckin = window.setInterval(async () => {
				const latest = await loadBookingData(bookingId);
				if (!latest || latest._error) return;
				if (String(latest.ticket_status || "").toUpperCase() === "USED") {
					renderTicketDOM(latest);
					if (window.JodInbox && typeof window.JodInbox.refresh === "function") {
						window.JodInbox.refresh({ toastNew: true });
					} else {
						window.dispatchEvent(new Event("jod:inbox-refresh"));
					}
					window.clearInterval(pollCheckin);
				}
			}, 8000);
		}
	});

})();
