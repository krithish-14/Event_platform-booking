/**
 * Host ticket design canvas - template picker + live preview for Design tab.
 * JOD Events logo is locked on unless host has premium subscription.
 */
(function (global) {
	"use strict";

	const FALLBACK_TEMPLATES = [
		{ id: "classic", name: "Classic Clean", tagline: "Bright white card", preview: { bg: "#f4f6f8", card: "#ffffff", accent: "#2563eb", text: "#111827", muted: "#6b7280" } },
		{ id: "midnight", name: "Midnight Stage", tagline: "Dark navy nightlife", preview: { bg: "#0b1220", card: "#111827", accent: "#38bdf8", text: "#f8fafc", muted: "#94a3b8" } },
		{ id: "sunset", name: "Sunset Glow", tagline: "Warm festival strip", preview: { bg: "#fff7ed", card: "#fffbeb", accent: "#ea580c", text: "#1c1917", muted: "#78716c" } },
		{ id: "concert", name: "Concert Stripe", tagline: "Bold side stripe", preview: { bg: "#fafafa", card: "#ffffff", accent: "#dc2626", text: "#0f172a", muted: "#64748b" } },
		{ id: "minimal", name: "Paper Minimal", tagline: "Quiet editorial", preview: { bg: "#f8fafc", card: "#ffffff", accent: "#0f172a", text: "#0f172a", muted: "#64748b" } },
		{ id: "festival", name: "Festival Teal", tagline: "Outdoor teal frame", preview: { bg: "#ecfdf5", card: "#ffffff", accent: "#0d9488", text: "#134e4a", muted: "#5eead4" } },
		{ id: "vip_gold", name: "VIP Gold", tagline: "Charcoal + gold", preview: { bg: "#1c1917", card: "#292524", accent: "#d4a017", text: "#fafaf9", muted: "#a8a29e" } },
		{ id: "neon_night", name: "Neon Night", tagline: "Electric cyan", preview: { bg: "#020617", card: "#0f172a", accent: "#22d3ee", text: "#e2e8f0", muted: "#64748b" } },
	];

	const DEFAULT_LAYOUT = {
		template_id: "classic",
		accent_color: "#2563eb",
		show_jod_logo: true,
		show_venue: true,
		show_date: true,
		show_price: true,
		show_seat: true,
		show_qr: true,
		show_ticket_type: true,
		custom_footer: "",
		headline_override: "",
	};

	function cloneLayout(src) {
		return Object.assign({}, DEFAULT_LAYOUT, src || {});
	}

	function TicketCanvasController(opts) {
		this.root = opts.root;
		this.isPremium = !!opts.isPremium;
		this.templates = Array.isArray(opts.templates) && opts.templates.length ? opts.templates : FALLBACK_TEMPLATES;
		this.layout = cloneLayout(opts.layout);
		this.sample = Object.assign({
			title: "Your Event Title",
			date: "Sat, Apr 18, 2026, 06:30 PM",
			venue: "Chennai Trade Centre",
			ticketType: "General Admission",
			seat: "General Admission",
			price: "Rs. 999",
			bookingId: "JOD-A1B2C3D4",
		}, opts.sample || {});
		this.onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
		this._bound = false;
		this.mount();
	}

	TicketCanvasController.prototype.setPremium = function (premium) {
		this.isPremium = !!premium;
		if (!this.isPremium) this.layout.show_jod_logo = true;
		this.syncControls();
		this.renderPreview();
	};

	TicketCanvasController.prototype.setTemplates = function (list) {
		if (Array.isArray(list) && list.length) this.templates = list;
		this.renderTemplatePicker();
		this.renderPreview();
	};

	TicketCanvasController.prototype.setLayout = function (layout) {
		this.layout = cloneLayout(layout);
		if (!this.isPremium) this.layout.show_jod_logo = true;
		this.syncControls();
		this.renderTemplatePicker();
		this.renderPreview();
	};

	TicketCanvasController.prototype.setSample = function (sample) {
		this.sample = Object.assign({}, this.sample, sample || {});
		this.renderPreview();
	};

	TicketCanvasController.prototype.getLayout = function () {
		const out = cloneLayout(this.layout);
		if (!this.isPremium) out.show_jod_logo = true;
		return out;
	};

	TicketCanvasController.prototype.mount = function () {
		if (!this.root) return;
		this.root.innerHTML = [
			'<div class="ticket-design-studio">',
			'  <div class="ticket-template-grid" id="ticketTemplateGrid" role="listbox" aria-label="Ticket templates"></div>',
			'  <div class="ticket-canvas-workspace">',
			'    <div class="ticket-canvas-stage" id="ticketCanvasStage">',
			'      <div class="ticket-live-card" id="ticketLiveCard" aria-live="polite"></div>',
			'    </div>',
			'    <div class="ticket-canvas-controls">',
			'      <label class="ticket-ctrl"><span>Accent color</span><input type="color" id="ticketAccentColor" value="#2563eb" /></label>',
			'      <label class="ticket-ctrl"><span>Headline override</span><input type="text" id="ticketHeadlineOverride" maxlength="80" placeholder="Leave blank to use event title" /></label>',
			'      <label class="ticket-ctrl"><span>Footer note</span><input type="text" id="ticketCustomFooter" maxlength="120" placeholder="Optional short note on ticket" /></label>',
			'      <div class="ticket-toggle-grid">',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowDate" checked /> Date</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowVenue" checked /> Venue</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowType" checked /> Ticket type</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowSeat" checked /> Seat</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowPrice" checked /> Price</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowQr" checked /> QR code</label>',
			'        <label class="ticket-toggle ticket-toggle-premium" id="ticketLogoToggleWrap"><input type="checkbox" id="ticketShowJodLogo" checked /> JOD Events logo</label>',
			'      </div>',
			'      <p class="ticket-premium-hint" id="ticketPremiumHint">JOD Events logo stays on free plans. Upgrade to Premium to remove it.</p>',
			'    </div>',
			'  </div>',
			'</div>',
		].join("");
		this.bindEvents();
		this.syncControls();
		this.renderTemplatePicker();
		this.renderPreview();
	};

	TicketCanvasController.prototype.bindEvents = function () {
		if (this._bound || !this.root) return;
		this._bound = true;
		const self = this;
		const map = [
			["ticketAccentColor", "accent_color", "value"],
			["ticketHeadlineOverride", "headline_override", "value"],
			["ticketCustomFooter", "custom_footer", "value"],
			["ticketShowDate", "show_date", "checked"],
			["ticketShowVenue", "show_venue", "checked"],
			["ticketShowType", "show_ticket_type", "checked"],
			["ticketShowSeat", "show_seat", "checked"],
			["ticketShowPrice", "show_price", "checked"],
			["ticketShowQr", "show_qr", "checked"],
			["ticketShowJodLogo", "show_jod_logo", "checked"],
		];
		map.forEach(function (row) {
			const el = self.root.querySelector("#" + row[0]);
			if (!el) return;
			el.addEventListener("input", function () {
				if (row[0] === "ticketShowJodLogo" && !self.isPremium) {
					el.checked = true;
					self.layout.show_jod_logo = true;
					self.renderPreview();
					return;
				}
				self.layout[row[1]] = row[2] === "checked" ? !!el.checked : String(el.value || "");
				self.renderPreview();
				self.onChange(self.getLayout());
			});
			el.addEventListener("change", function () {
				el.dispatchEvent(new Event("input"));
			});
		});
	};

	TicketCanvasController.prototype.syncControls = function () {
		if (!this.root) return;
		const L = this.layout;
		const setVal = function (id, val) {
			const el = this.root.querySelector("#" + id);
			if (el) el.value = val;
		}.bind(this);
		const setChk = function (id, val) {
			const el = this.root.querySelector("#" + id);
			if (el) el.checked = !!val;
		}.bind(this);
		setVal("ticketAccentColor", L.accent_color || "#2563eb");
		setVal("ticketHeadlineOverride", L.headline_override || "");
		setVal("ticketCustomFooter", L.custom_footer || "");
		setChk("ticketShowDate", L.show_date !== false);
		setChk("ticketShowVenue", L.show_venue !== false);
		setChk("ticketShowType", L.show_ticket_type !== false);
		setChk("ticketShowSeat", L.show_seat !== false);
		setChk("ticketShowPrice", L.show_price !== false);
		setChk("ticketShowQr", L.show_qr !== false);
		setChk("ticketShowJodLogo", L.show_jod_logo !== false);

		const logoEl = this.root.querySelector("#ticketShowJodLogo");
		const wrap = this.root.querySelector("#ticketLogoToggleWrap");
		const hint = this.root.querySelector("#ticketPremiumHint");
		if (logoEl) {
			logoEl.disabled = !this.isPremium;
			if (!this.isPremium) logoEl.checked = true;
		}
		if (wrap) wrap.classList.toggle("is-locked", !this.isPremium);
		if (hint) {
			hint.textContent = this.isPremium
				? "Premium active — you can hide the JOD Events logo on attendee tickets."
				: "JOD Events logo stays on free plans. Upgrade to Premium to remove it.";
		}
	};

	TicketCanvasController.prototype.renderTemplatePicker = function () {
		const grid = this.root && this.root.querySelector("#ticketTemplateGrid");
		if (!grid) return;
		const self = this;
		grid.innerHTML = this.templates.map(function (t) {
			const p = t.preview || {};
			const active = (self.layout.template_id || "classic") === t.id;
			return [
				'<button type="button" class="ticket-template-chip' + (active ? " is-active" : "") + '" data-template-id="' + t.id + '" role="option" aria-selected="' + active + '">',
				'  <span class="ticket-template-swatch" style="background:' + (p.bg || "#f1f5f9") + ';border-color:' + (p.accent || "#2563eb") + '">',
				'    <span style="background:' + (p.card || "#fff") + ';color:' + (p.text || "#111") + '">' + (t.name || t.id).slice(0, 1) + '</span>',
				"  </span>",
				'  <span class="ticket-template-meta"><strong>' + (t.name || t.id) + '</strong><em>' + (t.tagline || "") + "</em></span>",
				"</button>",
			].join("");
		}).join("");

		grid.querySelectorAll("[data-template-id]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				const id = btn.getAttribute("data-template-id");
				const tmpl = self.templates.find(function (x) { return x.id === id; });
				self.layout.template_id = id;
				if (tmpl && tmpl.preview && tmpl.preview.accent) {
					self.layout.accent_color = tmpl.preview.accent;
				}
				self.syncControls();
				self.renderTemplatePicker();
				self.renderPreview();
				self.onChange(self.getLayout());
			});
		});
	};

	TicketCanvasController.prototype.currentTemplate = function () {
		const id = this.layout.template_id || "classic";
		return this.templates.find(function (t) { return t.id === id; }) || this.templates[0] || FALLBACK_TEMPLATES[0];
	};

	TicketCanvasController.prototype.renderPreview = function () {
		const stage = this.root && this.root.querySelector("#ticketCanvasStage");
		const card = this.root && this.root.querySelector("#ticketLiveCard");
		if (!stage || !card) return;
		const tmpl = this.currentTemplate();
		const p = tmpl.preview || {};
		const L = this.layout;
		const accent = L.accent_color || p.accent || "#2563eb";
		const s = this.sample;
		const title = (L.headline_override || "").trim() || s.title;
		const showLogo = this.isPremium ? L.show_jod_logo !== false : true;

		stage.style.background = p.bg || "#f4f6f8";
		card.className = "ticket-live-card style-" + (tmpl.id || "classic");
		card.style.background = p.card || "#fff";
		card.style.color = p.text || "#111827";
		card.style.setProperty("--ticket-accent", accent);
		card.style.setProperty("--ticket-muted", p.muted || "#6b7280");

		const rows = [];
		rows.push('<div class="tlc-accent" aria-hidden="true"></div>');
		rows.push('<div class="tlc-top">');
		rows.push('  <div class="tlc-poster" aria-hidden="true"></div>');
		rows.push('  <div class="tlc-meta">');
		rows.push('    <div class="tlc-badge">E-Ticket</div>');
		rows.push('    <h3 class="tlc-title">' + escapeHtml(title) + "</h3>");
		if (L.show_date !== false) rows.push('    <p class="tlc-line">' + escapeHtml(s.date) + "</p>");
		if (L.show_venue !== false) rows.push('    <p class="tlc-line muted">' + escapeHtml(s.venue) + "</p>");
		rows.push("  </div>");
		rows.push("</div>");

		if (L.show_ticket_type !== false || L.show_seat !== false) {
			rows.push('<div class="tlc-mid">');
			rows.push('  <div class="tlc-qty">1 Ticket</div>');
			if (L.show_ticket_type !== false) rows.push('  <div class="tlc-type">' + escapeHtml(s.ticketType) + "</div>");
			if (L.show_seat !== false) rows.push('  <div class="tlc-seat muted">' + escapeHtml(s.seat) + "</div>");
			rows.push("</div>");
		}

		if (L.show_qr !== false) {
			rows.push('<div class="tlc-qr-wrap"><div class="tlc-qr" aria-hidden="true"></div><div class="tlc-booking">BOOKING ID: #' + escapeHtml(s.bookingId) + "</div></div>");
		}

		if (L.show_price !== false) {
			rows.push('<div class="tlc-price"><span>Total Amount</span><strong>' + escapeHtml(s.price) + "</strong></div>");
		}

		if (showLogo || (L.custom_footer || "").trim()) {
			rows.push('<div class="tlc-brand">');
			if (showLogo) rows.push('  <div class="tlc-jod-logo">JOD Events</div>');
			if ((L.custom_footer || "").trim()) rows.push('  <div class="tlc-footer muted">' + escapeHtml(L.custom_footer) + "</div>");
			rows.push("</div>");
		}

		card.innerHTML = rows.join("");
	};

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	global.JodTicketCanvas = {
		DEFAULT_LAYOUT: DEFAULT_LAYOUT,
		FALLBACK_TEMPLATES: FALLBACK_TEMPLATES,
		create: function (opts) {
			return new TicketCanvasController(opts || {});
		},
	};
})(typeof window !== "undefined" ? window : globalThis);
