/* Movie ticket with entry QR, or the list of the customer's movie tickets. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;
	const code = C.param("code");

	if (!C.loggedIn()) {
		window.location.replace("login.html?redirect=" + encodeURIComponent("movie-ticket.html" + window.location.search));
		return;
	}

	function ticketHtml(b) {
		const sh = b.show || {};
		const m = sh.movie || {};
		const t = sh.theatre || {};
		const seats = (b.seats || []).map((s) => s.id).join(", ");
		const qr = b.qr_token ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(b.qr_token)}` : "";
		return `
			<article class="mt-ticket">
				<div class="mt-top">
					<div class="mv-poster">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="">` : `<span>${esc((m.title || "M").slice(0, 1))}</span>`}</div>
					<div><p class="mt-kicker">${b.status === "confirmed" ? "Booking confirmed" : b.status === "payment_conflict" ? "Needs attention" : esc(b.status)}</p>
						<h1>${esc(m.title || "Movie")}</h1>
						<p class="mt-meta">${esc([m.certificate, m.language, sh.format].filter(Boolean).join(" \u00b7 "))}</p></div>
				</div>
				<dl class="mt-facts">
					<div><dt>Date</dt><dd>${esc(C.day(sh.starts_at))}</dd></div>
					<div><dt>Time</dt><dd>${esc(C.time(sh.starts_at))}</dd></div>
					<div><dt>Screen</dt><dd>${esc(sh.screen_name || "")}</dd></div>
					<div><dt>Seats</dt><dd>${esc(seats)}</dd></div>
					<div class="is-wide"><dt>Theatre</dt><dd>${esc(t.name || "")}<small>${esc([t.address, t.district, t.pincode].filter(Boolean).join(", "))}</small></dd></div>
				</dl>
				<div class="mt-cut" aria-hidden="true"></div>
				${b.status === "confirmed" ? `
				<div class="mt-qr"><img src="${qr}" alt="Entry QR for booking ${esc(b.booking_code)}" width="220" height="220">
					<p>Show this QR at the theatre entrance.</p></div>` : `<p class="mt-warn">This booking is not confirmed. If money was debited, contact support with booking code ${esc(b.booking_code)}.</p>`}
				<div class="mt-foot"><span>Booking code <strong>${esc(b.booking_code)}</strong></span><span>Paid <strong>${C.money(b.amount)}</strong></span></div>
				${b.checked_in_at ? '<p class="mt-used">Checked in at the theatre</p>' : ""}
			</article>`;
	}

	try {
		if (code) {
			const b = await C.api(`/api/movies/bookings/${encodeURIComponent(code)}`);
			$("mtBody").innerHTML = ticketHtml(b) + '<div class="mt-actions"><button type="button" class="td-btn" onclick="window.print()">Print / save PDF</button><a class="td-btn is-ghost" href="movie-ticket.html">All my movie tickets</a></div>';
		} else {
			const data = await C.api("/api/movies/bookings/mine");
			const rows = data.bookings || [];
			$("mtBody").innerHTML = `<h1 class="mt-list-title">My movie tickets</h1>` + (rows.length
				? rows.map((b) => {
					const sh = b.show || {};
					return `<a class="mt-row" href="movie-ticket.html?code=${encodeURIComponent(b.booking_code)}"><strong>${esc(sh.movie ? sh.movie.title : "Movie")}</strong><span>${esc(C.day(sh.starts_at))}, ${esc(C.time(sh.starts_at))} \u00b7 ${esc(sh.theatre ? sh.theatre.name : "")}</span><span>${esc((b.seats || []).map((s) => s.id).join(", "))} \u00b7 ${esc(b.booking_code)}</span></a>`;
				}).join("")
				: '<p class="td-empty">No movie tickets yet. <a href="movies.html">Find a movie</a></p>');
		}
	} catch (err) {
		$("mtBody").innerHTML = `<p class="td-empty">${esc(err.message)}</p>`;
	}
});
