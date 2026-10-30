/* Live seat booking: seat map (refreshed every few seconds), 8-minute hold, Razorpay payment. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const SM = window.JodSeatMap;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;
	const showId = C.param("show");
	const POLL_MS = 5000;
	const state = { data: null, selected: new Set(), hold: null, paying: false, timer: null, poll: null, clockSkew: 0 };

	if (!showId) {
		$("sbStatus").textContent = "Pick a show from the Movies page first.";
		return;
	}

	function priceOf(seatId) {
		const info = SM.enumerate(state.data.layout);
		const seat = info.seats.find((s) => s.id === seatId);
		return seat ? Number(state.data.prices[seat.category] || 0) : 0;
	}

	function renderHeader() {
		const d = state.data;
		const m = d.movie || {};
		$("sbTitle").textContent = m.title || "Movie";
		$("sbMeta").textContent = [m.certificate, m.language, d.format].filter(Boolean).join(" \u00b7 ");
		$("sbWhen").textContent = `${C.day(d.starts_at)}, ${C.time(d.starts_at)}`;
		$("sbWhere").textContent = [d.theatre.name, d.screen_name, d.theatre.district].filter(Boolean).join(" \u00b7 ");
		$("sbPoster").innerHTML = m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="">` : `<span>${esc((m.title || "M").slice(0, 1))}</span>`;
		document.title = `${m.title || "Movie"} \u2014 Book seats | JOD Events`;
		$("sbLegend").innerHTML = SM.legendHtml(d.layout, d.prices);
	}

	function renderMap() {
		const states = {};
		Object.entries(state.data.seats || {}).forEach(([id, s]) => { states[id] = s === "mine" ? "selected" : s; });
		SM.render($("sbMap"), state.data.layout, {
			mode: state.hold || state.paying || !state.data.booking_open ? "view" : "book",
			states,
			selected: state.selected,
			prices: state.data.prices,
			onSeat: toggleSeat
		});
		renderSummary();
	}

	function toggleSeat(seat) {
		if (!seat || state.hold) return;
		if (state.selected.has(seat.id)) state.selected.delete(seat.id);
		else {
			if (state.selected.size >= state.data.max_per_booking) {
				C.toast(`You can book up to ${state.data.max_per_booking} seats at a time.`, "bad");
				return;
			}
			state.selected.add(seat.id);
		}
		renderMap();
	}

	function renderSummary() {
		const seats = Array.from(state.selected).sort();
		const total = seats.reduce((n, id) => n + priceOf(id), 0);
		$("sbSeats").textContent = seats.length ? seats.join(", ") : "No seats selected";
		$("sbTotal").textContent = C.money(state.hold ? state.hold.amount : total);
		$("sbProceed").hidden = Boolean(state.hold);
		$("sbProceed").disabled = !seats.length || !state.data.booking_open;
		$("sbHoldBox").hidden = !state.hold;
		$("sbAvail").textContent = `${state.data.available} of ${state.data.seat_count} seats available`;
		if (!state.data.booking_open) $("sbStatus").textContent = "Booking has closed for this show.";
	}

	async function refresh(silent) {
		try {
			const data = await C.api(`/api/movies/shows/${encodeURIComponent(showId)}`);
			const serverNow = new Date(data.server_time).getTime();
			if (!Number.isNaN(serverNow)) state.clockSkew = serverNow - Date.now();
			const lost = [];
			if (!state.hold) {
				state.selected.forEach((id) => {
					if (data.seats[id] === "booked" || data.seats[id] === "held") { lost.push(id); state.selected.delete(id); }
				});
			}
			state.data = data;
			if (data.my_hold && !state.hold && !state.paying) startHold(data.my_hold);
			if (lost.length) C.toast(`${lost.join(", ")} just got taken by someone else.`, "bad");
			if (!silent) renderHeader();
			renderMap();
			$("sbLoading").hidden = true;
			$("sbApp").hidden = false;
		} catch (err) {
			if (!silent) {
				$("sbLoading").hidden = true;
				$("sbStatus").textContent = err.message;
			}
		}
	}

	function startHold(hold) {
		state.hold = hold;
		state.selected = new Set((hold.seats || []).map((s) => s.id));
		$("sbHoldSeats").textContent = state.selected.size + (state.selected.size === 1 ? " seat" : " seats") + ": " + Array.from(state.selected).sort().join(", ");
		$("sbPay").textContent = `Pay ${C.money(hold.amount)}`;
		clearInterval(state.timer);
		const tick = () => {
			const left = new Date(hold.hold_expires_at).getTime() - (Date.now() + state.clockSkew);
			if (left <= 0) {
				clearInterval(state.timer);
				endHold("Your seat hold expired. Pick your seats again.");
				return;
			}
			const m = Math.floor(left / 60000);
			const s = Math.floor((left % 60000) / 1000);
			$("sbCountdown").textContent = `${m}:${String(s).padStart(2, "0")}`;
			$("sbHoldBox").classList.toggle("is-urgent", left < 60000);
		};
		tick();
		state.timer = setInterval(tick, 1000);
		renderMap();
	}

	function endHold(message) {
		state.hold = null;
		state.paying = false;
		state.selected = new Set();
		clearInterval(state.timer);
		if (message) C.toast(message, "bad");
		refresh(true);
	}

	$("sbProceed").addEventListener("click", async () => {
		if (!C.loggedIn()) {
			C.askLogin("Log in to book your seats", "Sign up or log in to hold these seats and pay. Your seats are kept for 8 minutes once you continue.");
			return;
		}
		const btn = $("sbProceed");
		btn.disabled = true;
		btn.textContent = "Holding your seats\u2026";
		try {
			const hold = await C.api(`/api/movies/shows/${encodeURIComponent(showId)}/hold`, { method: "POST", json: { seats: Array.from(state.selected) } });
			startHold(hold);
			C.toast(`Seats held for ${state.data.hold_minutes} minutes. Complete payment to confirm.`, "ok");
		} catch (err) {
			const taken = err.data && err.data.detail && err.data.detail.taken;
			if (Array.isArray(taken)) taken.forEach((id) => state.selected.delete(id));
			C.toast(err.message, "bad");
			refresh(true);
		} finally {
			btn.textContent = "Continue";
			btn.disabled = false;
		}
	});

	$("sbChange").addEventListener("click", async () => {
		if (!state.hold) return;
		try { await C.api(`/api/movies/bookings/${encodeURIComponent(state.hold.booking_code)}`, { method: "DELETE" }); } catch (_) {}
		endHold("");
	});

	function loadRazorpay() {
		if (typeof window.Razorpay === "function") return Promise.resolve();
		return new Promise((resolve, reject) => {
			const s = document.createElement("script");
			s.src = "https://checkout.razorpay.com/v1/checkout.js";
			s.onload = resolve;
			s.onerror = () => reject(new Error("Payment window could not load. Check your connection and try again."));
			document.head.appendChild(s);
		});
	}

	function goToTicket(code) {
		clearInterval(state.timer);
		clearInterval(state.poll);
		window.location.href = "movie-ticket.html?code=" + encodeURIComponent(code);
	}

	$("sbPay").addEventListener("click", async () => {
		if (!state.hold) return;
		const code = state.hold.booking_code;
		const btn = $("sbPay");
		btn.disabled = true;
		state.paying = true;
		try {
			const order = await C.api(`/api/movies/bookings/${encodeURIComponent(code)}/order`, { method: "POST" });
			if (order.local_bypass) {
				await C.api(`/api/movies/bookings/${encodeURIComponent(code)}/local-confirm`, { method: "POST" });
				goToTicket(code);
				return;
			}
			await loadRazorpay();
			const user = (window.JodAuth && window.JodAuth.getUser && window.JodAuth.getUser()) || {};
			const rzp = new window.Razorpay({
				key: order.key_id,
				amount: order.amount,
				currency: order.currency || "INR",
				name: "JOD Events",
				description: `${state.data.movie ? state.data.movie.title : "Movie"} \u00b7 ${Array.from(state.selected).join(", ")}`,
				order_id: order.order_id,
				prefill: { name: user.full_name || "", email: user.email || "", contact: user.phone || "" },
				theme: { color: "#ff7508" },
				modal: { ondismiss: () => { state.paying = false; btn.disabled = false; } },
				handler: async (response) => {
					btn.textContent = "Confirming your seats\u2026";
					try {
						await C.api(`/api/movies/bookings/${encodeURIComponent(code)}/verify`, { method: "POST", json: response });
						goToTicket(code);
					} catch (err) {
						state.paying = false;
						btn.disabled = false;
						btn.textContent = `Pay ${C.money(state.hold ? state.hold.amount : 0)}`;
						$("sbStatus").textContent = err.message + ` Booking code: ${code}.`;
						C.toast(err.message, "bad");
					}
				}
			});
			rzp.on("payment.failed", (resp) => {
				const desc = resp && resp.error && (resp.error.description || resp.error.reason);
				C.toast(desc || "Payment failed. Your seats are still held; try again.", "bad");
			});
			rzp.open();
		} catch (err) {
			state.paying = false;
			btn.disabled = false;
			if (err.status === 410) endHold(err.message);
			else C.toast(err.message, "bad");
		}
	});

	await refresh(false);
	state.poll = setInterval(() => { if (!state.paying && !document.hidden) refresh(true); }, POLL_MS);
	document.addEventListener("visibilitychange", () => { if (!document.hidden && !state.paying) refresh(true); });
});
