/**
 * Shared event agenda / roadmap renderer for ticket back, print page 2, and agenda.html.
 */
(function (global) {
	"use strict";

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function normalize(items) {
		if (!Array.isArray(items)) return [];
		return items.map((row) => {
			if (!row || typeof row !== "object") return null;
			const title = String(row.title || row.session || row.name || "").trim();
			if (!title) return null;
			return {
				time: String(row.time || row.slot || "").trim(),
				title,
				speaker: String(row.speaker || row.host || "").trim()
			};
		}).filter(Boolean);
	}

	function fallbackItems(meta) {
		const title = (meta && (meta.eventTitle || meta.title)) || "Event";
		const time = (meta && meta.startLabel) || "";
		return [{ time, title, speaker: "Doors open" }];
	}

	function renderRoadmap(container, items, meta) {
		if (!container) return;
		const list = normalize(items);
		const rows = list.length ? list : fallbackItems(meta);
		const startLabel = (meta && meta.startLabel) || "";
		const endLabel = (meta && meta.endLabel) || "";
		const venue = (meta && meta.venue) || "";
		container.innerHTML = `
			<ol class="agenda-roadmap">
				<li class="agenda-milestone agenda-milestone-start">
					<span class="agenda-milestone-dot" aria-hidden="true"></span>
					<div class="agenda-milestone-copy">
						<strong>Start</strong>
						${startLabel ? `<span>${escapeHtml(startLabel)}</span>` : ""}
						${venue ? `<em>${escapeHtml(venue)}</em>` : ""}
					</div>
				</li>
				${rows.map((row, i) => `
					<li class="agenda-stop">
						<span class="agenda-stop-index">${i + 1}</span>
						<div class="agenda-stop-card">
							${row.time ? `<span class="agenda-stop-time">${escapeHtml(row.time)}</span>` : ""}
							<h3 class="agenda-stop-title">${escapeHtml(row.title)}</h3>
							${row.speaker ? `<p class="agenda-stop-speaker">${escapeHtml(row.speaker)}</p>` : ""}
						</div>
					</li>
				`).join("")}
				<li class="agenda-milestone agenda-milestone-end">
					<span class="agenda-milestone-dot" aria-hidden="true"></span>
					<div class="agenda-milestone-copy">
						<strong>Finish</strong>
						<span>${endLabel ? escapeHtml(endLabel) : "See you at the venue"}</span>
					</div>
				</li>
			</ol>
		`;
	}

	function printHtml(items, meta) {
		const wrap = document.createElement("div");
		renderRoadmap(wrap, items, meta);
		return wrap.innerHTML;
	}

	function printDocumentHtml(items, meta) {
		const eventTitle = (meta && (meta.eventTitle || meta.title)) || "Event Agenda";
		const startLabel = (meta && meta.startLabel) || "";
		const endLabel = (meta && meta.endLabel) || "";
		const venue = (meta && meta.venue) || "";
		const list = normalize(items);
		const rows = list.length ? list : fallbackItems(meta);
		const stops = rows.map((row, i) => `
			<li style="position:relative;display:flex;gap:12px;align-items:flex-start;padding:0 0 16px 0;list-style:none;">
				<span style="width:36px;height:36px;flex-shrink:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;background:#1d4ed8;border:3px solid #fff;box-shadow:0 0 0 3px #1d4ed8;">${i + 1}</span>
				<div style="flex:1;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;">
					${row.time ? `<div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:#1d4ed8;text-transform:uppercase;margin-bottom:2px;">${escapeHtml(row.time)}</div>` : ""}
					<div style="font-size:16px;font-weight:800;color:#111827;line-height:1.3;">${escapeHtml(row.title)}</div>
					${row.speaker ? `<div style="margin-top:4px;font-size:13px;color:#6b7280;">${escapeHtml(row.speaker)}</div>` : ""}
				</div>
			</li>
		`).join("");
		return `
			<section class="ticket-print-agenda-page" style="max-width:640px;margin:24px auto 0;color:#111827;font-family:Outfit,Inter,system-ui,sans-serif;page-break-before:always;break-before:page;">
				<p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ff7508;">Event roadmap</p>
				<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#111827;">${escapeHtml(eventTitle)}</h1>
				<p style="margin:0 0 20px;color:#6b7280;font-size:14px;">${escapeHtml([startLabel, venue].filter(Boolean).join(" · "))}</p>
				<ol style="list-style:none;margin:0;padding:0;position:relative;">
					<li style="position:relative;display:flex;gap:12px;align-items:flex-start;padding:0 0 16px 0;">
						<span style="width:18px;height:18px;margin:2px 0 0 9px;flex-shrink:0;border-radius:50%;background:#111827;border:3px solid #ff7508;"></span>
						<div>
							<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ff7508;font-weight:800;">Start</div>
							${startLabel ? `<div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(startLabel)}</div>` : ""}
							${venue ? `<div style="font-size:13px;color:#6b7280;">${escapeHtml(venue)}</div>` : ""}
						</div>
					</li>
					${stops}
					<li style="position:relative;display:flex;gap:12px;align-items:flex-start;padding:0;">
						<span style="width:18px;height:18px;margin:2px 0 0 9px;flex-shrink:0;border-radius:50%;background:#ff7508;border:3px solid #111827;"></span>
						<div>
							<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ff7508;font-weight:800;">Finish</div>
							<div style="font-size:14px;font-weight:700;color:#111827;">${endLabel ? escapeHtml(endLabel) : "See you at the venue"}</div>
						</div>
					</li>
				</ol>
			</section>
		`;
	}

	global.JodAgenda = {
		escapeHtml,
		normalize,
		renderRoadmap,
		printHtml,
		printDocumentHtml
	};
})(window);
