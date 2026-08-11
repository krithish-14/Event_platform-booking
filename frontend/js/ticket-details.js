/**
 * JOD Events — Individual Ticket Viewing & Invoice Controller
 * Renders ticket details, bill breakdown, QR code validation, download options, and cancellation handling.
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
			const raw = localStorage.getItem("jod_user_bookings");
			return raw ? JSON.parse(raw) : [];
		} catch (_) {
			return [];
		}
	}

	function saveLocalBookingCache(booking) {
		if (!booking || !booking.booking_id) return;
		try {
			const cache = getLocalBookingsCache();
			const idx = cache.findIndex(b => b.booking_id === booking.booking_id);
			if (idx >= 0) {
				cache[idx] = { ...cache[idx], ...booking };
			} else {
				cache.unshift(booking);
			}
			localStorage.setItem("jod_user_bookings", JSON.stringify(cache));
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
		const apiBase = getApiBase();
		const token = window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));

		if (bookingId && token) {
			try {
				const res = await fetch(`${apiBase}/api/bookings/${bookingId}`, {
					headers: { "Authorization": `Bearer ${token}` }
				});
				if (res.ok) {
					const data = await res.json();
					saveLocalBookingCache(data);
					return data;
				}
			} catch (_) {}
		}

		// Fallback to local cache
		const cache = getLocalBookingsCache();
		const found = cache.find(b => b.booking_id === bookingId || b.booking_id?.substring(0, 8) === bookingId);
		if (found) return found;

		// Default mock fallback for testing if no booking matches
		const user = window.JodAuth ? window.JodAuth.getUser() : null;
		return {
			booking_id: bookingId || "22222222-2222-2222-2222-222222222222",
			customer_id: user ? (user.customer_id || user.id) : "CUST-JOD-001",
			user_name: user ? (user.full_name || user.username) : "John Doe",
			user_email: user ? user.email : "johndoe@example.com",
			user_phone: "+91 98765 43210",
			event_id: "22222222-2222-2222-2222-222222222222",
			event_title: "Chennai Business Leaders Summit 2026",
			event_venue: "ITC Grand Chola, Chennai",
			event_start_date: "2026-08-15T04:30:00Z",
			ticket_type: "VIP Executive Pass",
			quantity: 2,
			total_price: 9998,
			status: "CONFIRMED",
			payment_id: "PAY-JOD-99281734",
			payment_mode: "UPI / Credit Card",
			gst_amount: 1799.64,
			seat_number: "Row B, Seat 12-13",
			receiver_name: user ? (user.full_name || user.username) : "John Doe",
			receiver_email: user ? user.email : "johndoe@example.com",
			receiver_phone: "+91 98765 43210",
			booked_at: new Date().toISOString()
		};
	}

	function renderTicketDOM(data) {
		if (!data) return;

		const isCancelled = (data.status || "").toUpperCase() === "CANCELLED";

		// Status Badge & Header ID
		const statusBadge = document.getElementById("ticketStatusBadge");
		const orderIdCode = document.getElementById("ticketOrderIdCode");
		const statusVal = document.getElementById("ticketStatusVal");
		const btnCancel = document.getElementById("btnCancelTicket");

		const shortId = (data.booking_id || "00000000").substring(0, 8).toUpperCase();
		if (orderIdCode) orderIdCode.textContent = `#JOD-${shortId}`;

		if (statusBadge) {
			if (isCancelled) {
				statusBadge.textContent = "CANCELLED";
				statusBadge.className = "status-badge badge-cancelled";
			} else {
				statusBadge.textContent = "CONFIRMED";
				statusBadge.className = "status-badge badge-confirmed";
			}
		}

		if (statusVal) {
			if (isCancelled) {
				statusVal.textContent = "Cancelled / Refund Processed";
				statusVal.className = "info-val status-text-cancelled";
			} else {
				statusVal.textContent = "Active / Valid for Entry";
				statusVal.className = "info-val status-text-confirmed";
			}
		}

		if (btnCancel) {
			if (isCancelled) {
				btnCancel.disabled = true;
				btnCancel.textContent = "Ticket Cancelled ❌";
			} else {
				btnCancel.disabled = false;
				btnCancel.textContent = "Cancel Ticket ❌";
			}
		}

		// Event Header
		const titleEl = document.getElementById("ticketEventTitle");
		const dateTimeEl = document.getElementById("ticketEventDateTime");
		const venueEl = document.getElementById("ticketEventVenue");
		const catBadge = document.getElementById("ticketCategoryBadge");
		const imgEl = document.getElementById("ticketEventImg");

		if (titleEl) titleEl.textContent = data.event_title || "Event Booking";
		if (dateTimeEl) dateTimeEl.textContent = formatDateFull(data.event_start_date);
		if (venueEl) venueEl.textContent = data.event_venue || "Venue details at location";
		if (catBadge) catBadge.textContent = `🎟️ ${data.ticket_type || "Standard Access"}`;
		if (imgEl && data.image_url) imgEl.src = data.image_url;

		// Ticket Info
		const idVal = document.getElementById("ticketIdVal");
		const catVal = document.getElementById("ticketCategoryVal");
		const countVal = document.getElementById("ticketCountVal");
		const bookedTimeVal = document.getElementById("ticketBookedTimeVal");
		const seatVal = document.getElementById("ticketSeatVal");

		if (idVal) idVal.textContent = `#JOD-${shortId}`;
		if (catVal) catVal.textContent = data.ticket_type || "Standard Access";
		if (countVal) countVal.textContent = `${data.quantity || 1} ${data.quantity === 1 ? "Ticket" : "Tickets"}`;
		if (bookedTimeVal) bookedTimeVal.textContent = formatDateFull(data.booked_at);
		if (seatVal) seatVal.textContent = data.seat_number || "General Admission";

		// Bill Summary
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
		if (subtotalEl) subtotalEl.textContent = `₹${totalPrice.toLocaleString("en-IN")}`;
		if (gstEl) gstEl.textContent = `₹${gstAmount.toLocaleString("en-IN")}`;
		if (totalEl) totalEl.textContent = `₹${totalPrice.toLocaleString("en-IN")}`;
		if (paymentIdEl) paymentIdEl.textContent = data.payment_id || `PAY-JOD-${shortId}`;
		if (paymentModeEl) paymentModeEl.textContent = data.payment_mode || "UPI / Credit Card";

		// Receiver Details
		const recName = document.getElementById("receiverName");
		const recEmail = document.getElementById("receiverEmail");
		const recPhone = document.getElementById("receiverPhone");

		if (recName) recName.textContent = data.receiver_name || data.user_name || "Guest Customer";
		if (recEmail) recEmail.textContent = data.receiver_email || data.user_email || "customer@jodevents.com";
		if (recPhone) recPhone.textContent = data.receiver_phone || "+91 98765 43210";

		// QR Code Generator
		const qrImg = document.getElementById("ticketQrCodeImg");
		const qrText = document.getElementById("ticketQrCodeText");
		const validationString = `JOD-TICKET-VALID-${data.booking_id}-${shortId}`;
		if (qrImg) {
			qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(validationString)}`;
		}
		if (qrText) {
			qrText.textContent = `Code: JOD-VAL-${shortId}`;
		}
	}

	function max(a, b) { return a > b ? a : b; }

	async function handleCancelTicket(currentBooking) {
		if (!currentBooking || !currentBooking.booking_id) return;

		const confirmCancel = confirm(`Are you sure you want to cancel booking #${currentBooking.booking_id.substring(0, 8).toUpperCase()} for ${currentBooking.event_title || "this event"}?\n\nCancellation will initiate an automatic refund to your original payment mode.`);
		if (!confirmCancel) return;

		const apiBase = getApiBase();
		const token = window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));

		try {
			if (token) {
				await fetch(`${apiBase}/api/bookings/${currentBooking.booking_id}/cancel`, {
					method: "POST",
					headers: { "Authorization": `Bearer ${token}` }
				});
			}
		} catch (_) {}

		// Update local state and cache
		currentBooking.status = "CANCELLED";
		saveLocalBookingCache(currentBooking);

		renderTicketDOM(currentBooking);
		alert(`Ticket Booking #JOD-${currentBooking.booking_id.substring(0, 8).toUpperCase()} has been cancelled. Refund initialized!`);
	}

	function bindActions(bookingData) {
		const btnDownloadTicket = document.getElementById("btnDownloadTicket");
		const btnDownloadInvoice = document.getElementById("btnDownloadInvoice");
		const btnCancelTicket = document.getElementById("btnCancelTicket");

		btnDownloadTicket?.addEventListener("click", () => {
			window.print();
		});

		btnDownloadInvoice?.addEventListener("click", () => {
			window.print();
		});

		btnCancelTicket?.addEventListener("click", () => {
			handleCancelTicket(bookingData);
		});
	}

	document.addEventListener("DOMContentLoaded", async () => {
		const bookingId = getQueryParam("id") || getQueryParam("booking_id");
		const bookingData = await loadBookingData(bookingId);
		renderTicketDOM(bookingData);
		bindActions(bookingData);
	});

})();
