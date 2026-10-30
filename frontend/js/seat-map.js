/* Seat map renderer shared by the layout editor, theatre seat view and the
 * customer booking page. Numbering mirrors Services/cinema_booking.py:
 * rows with seats get letters from the screen side (A nearest the screen),
 * seats are numbered across the row (left-to-right or right-to-left), gaps skipped. */
(function (global) {
	"use strict";

	function rowLabel(index) {
		let label = "";
		let n = index + 1;
		while (n) {
			const rem = (n - 1) % 26;
			label = String.fromCharCode(65 + rem) + label;
			n = Math.floor((n - 1) / 26);
		}
		return label;
	}

	function enumerate(layout) {
		const rows = layout.rows;
		const cols = layout.cols;
		const cells = layout.cells || [];
		const labels = {};
		let next = 0;
		const order = [];
		for (let r = 0; r < rows; r++) order.push(r);
		if (layout.screen === "bottom") order.reverse();
		order.forEach((r) => {
			if ((cells[r] || []).some(Boolean)) labels[r] = rowLabel(next++);
		});
		const byCell = {};
		const seats = [];
		for (let r = 0; r < rows; r++) {
			if (!labels[r]) continue;
			let number = 0;
			const columns = [];
			for (let c = 0; c < cols; c++) columns.push(c);
			if (layout.numbering === "rtl") columns.reverse();
			columns.forEach((c) => {
				const category = cells[r][c];
				if (!category) return;
				number += 1;
				const seat = { id: labels[r] + number, row: labels[r], number, category, r, c };
				byCell[r + "," + c] = seat;
				seats.push(seat);
			});
		}
		return { seats, byCell, labels };
	}

	function categoryMap(layout) {
		const map = {};
		(layout.categories || []).forEach((c) => { map[c.id] = c; });
		return map;
	}

	function esc(v) {
		return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	}

	/* opts: { mode: "book"|"view"|"edit", states: {seatId: "booked"|"held"|"mine"}, selected: Set,
	 *         prices: {cat: rupees}, onSeat(seat), onCell(r, c, event) } */
	function render(container, layout, opts) {
		opts = opts || {};
		const mode = opts.mode || "view";
		const states = opts.states || {};
		const selected = opts.selected || new Set();
		const cats = categoryMap(layout);
		const info = enumerate(layout);
		const screenHtml = '<div class="seatmap-screen" aria-hidden="true"><span>Screen this way</span></div>';
		let grid = `<div class="seatmap-grid" style="--seat-cols:${layout.cols}" role="grid" aria-label="Seat layout">`;
		for (let r = 0; r < layout.rows; r++) {
			const label = info.labels[r] || "";
			grid += `<div class="seatmap-row" role="row"><span class="seatmap-label" ${mode === "edit" ? `data-row="${r}" title="Paint the whole row"` : ""}>${esc(label)}</span>`;
			for (let c = 0; c < layout.cols; c++) {
				const seat = info.byCell[r + "," + c];
				if (mode === "edit") {
					const cat = seat ? cats[seat.category] : null;
					grid += `<button type="button" class="seatmap-cell${seat ? " is-seat" : " is-gap"}" data-r="${r}" data-c="${c}" style="${cat ? `--cat:${cat.color}` : ""}" title="${seat ? esc(seat.id + " · " + (cat ? cat.name : "")) : "Aisle / gap"}">${seat ? seat.number : ""}</button>`;
					continue;
				}
				if (!seat) {
					grid += '<span class="seatmap-gap" aria-hidden="true"></span>';
					continue;
				}
				const cat = cats[seat.category] || { color: "#64748b", name: seat.category };
				const state = selected.has(seat.id) ? "selected" : (states[seat.id] || "free");
				const price = opts.prices && opts.prices[seat.category] != null ? ` · \u20B9${opts.prices[seat.category]}` : "";
				const unavailable = state === "booked" || state === "held";
				const label = `${seat.id} ${cat.name}${price}${state === "booked" ? " · booked" : state === "held" ? " · being booked" : ""}`;
				grid += `<button type="button" class="seatmap-seat is-${state}" data-seat="${esc(seat.id)}" style="--cat:${cat.color}" aria-label="${esc(label)}" title="${esc(label)}" ${unavailable || mode !== "book" ? "disabled" : ""} aria-pressed="${state === "selected" || state === "mine"}">${seat.number}</button>`;
			}
			grid += `<span class="seatmap-label">${esc(label)}</span></div>`;
		}
		grid += "</div>";
		container.innerHTML = `<div class="seatmap ${layout.screen === "bottom" ? "is-screen-bottom" : ""}">` +
			(layout.screen === "bottom" ? grid + screenHtml : screenHtml + grid) + "</div>";
		if (opts.onSeat) {
			container.querySelectorAll("[data-seat]").forEach((btn) => {
				btn.addEventListener("click", () => opts.onSeat(info.seats.find((s) => s.id === btn.getAttribute("data-seat"))));
			});
		}
		return info;
	}

	function legendHtml(layout, prices) {
		return (layout.categories || []).map((c) =>
			`<span class="seatmap-legend-item"><i style="--cat:${c.color}"></i>${esc(c.name)}${prices && prices[c.id] != null ? ` <strong>\u20B9${prices[c.id]}</strong>` : ""}</span>`
		).join("") +
			'<span class="seatmap-legend-item"><i class="is-selected"></i>Selected</span>' +
			'<span class="seatmap-legend-item"><i class="is-held"></i>Being booked</span>' +
			'<span class="seatmap-legend-item"><i class="is-booked"></i>Sold</span>';
	}

	global.JodSeatMap = { rowLabel, enumerate, render, legendHtml, categoryMap };
})(window);
