/**
 * Host ticket design canvas - drag, remove, and add elements on the live preview.
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

	const ELEMENT_DEFS = [
		{ type: "poster", label: "Poster", flag: null, w: 22, h: 18, locked: false },
		{ type: "title", label: "Event title", flag: null, w: 58, h: 8, locked: false },
		{ type: "badge", label: "E-Ticket badge", flag: null, w: 18, h: 4, locked: false },
		{ type: "date", label: "Date", flag: "show_date", w: 58, h: 5, locked: false },
		{ type: "venue", label: "Venue", flag: "show_venue", w: 70, h: 8, locked: false },
		{ type: "qty", label: "Ticket count", flag: null, w: 30, h: 4, locked: false },
		{ type: "ticket_type", label: "Ticket type", flag: "show_ticket_type", w: 55, h: 6, locked: false },
		{ type: "seat", label: "Seat", flag: "show_seat", w: 55, h: 5, locked: false },
		{ type: "name", label: "Name", flag: "show_attendee_name", w: 70, h: 5, locked: false },
		{ type: "phone", label: "Phone number", flag: "show_attendee_phone", w: 70, h: 5, locked: false },
		{ type: "email", label: "Email", flag: "show_attendee_email", w: 70, h: 5, locked: false },
		{ type: "qr", label: "QR code", flag: "show_qr", w: 34, h: 22, locked: false },
		{ type: "booking_id", label: "Booking ID", flag: null, w: 55, h: 4, locked: false },
		{ type: "price", label: "Price", flag: "show_price", w: 80, h: 6, locked: false },
		{ type: "jod_logo", label: "JOD Events logo", flag: "show_jod_logo", w: 40, h: 5, locked: true },
		{ type: "footer", label: "Footer note", flag: null, w: 70, h: 5, locked: false },
	];

	const DEFAULT_ELEMENTS = [
		{ type: "poster", x: 4, y: 4, w: 22, h: 18 },
		{ type: "badge", x: 78, y: 4, w: 18, h: 4 },
		{ type: "title", x: 30, y: 5, w: 46, h: 8 },
		{ type: "date", x: 30, y: 14, w: 58, h: 5 },
		{ type: "venue", x: 30, y: 19, w: 58, h: 8 },
		{ type: "qty", x: 35, y: 30, w: 30, h: 4 },
		{ type: "ticket_type", x: 22, y: 34, w: 55, h: 6 },
		{ type: "seat", x: 22, y: 40, w: 55, h: 5 },
		{ type: "name", x: 15, y: 47, w: 70, h: 5 },
		{ type: "phone", x: 15, y: 52, w: 70, h: 5 },
		{ type: "email", x: 15, y: 57, w: 70, h: 5 },
		{ type: "qr", x: 33, y: 63, w: 34, h: 18 },
		{ type: "booking_id", x: 22, y: 82, w: 55, h: 4 },
		{ type: "price", x: 10, y: 87, w: 80, h: 5 },
		{ type: "jod_logo", x: 30, y: 93, w: 40, h: 5 },
	];

	const FLAG_BY_TYPE = {};
	ELEMENT_DEFS.forEach(function (d) {
		FLAG_BY_TYPE[d.type] = d.flag;
	});

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
		show_attendee_name: true,
		show_attendee_email: true,
		show_attendee_phone: true,
		custom_footer: "",
		headline_override: "",
		canvas_elements: DEFAULT_ELEMENTS.map(function (e) { return Object.assign({}, e); }),
	};

	function cloneElements(list) {
		return (Array.isArray(list) ? list : []).map(function (e) {
			return {
				type: String(e.type || ""),
				x: clampNum(e.x, 0, 92, 4),
				y: clampNum(e.y, 0, 94, 4),
				w: clampNum(e.w, 10, 96, 40),
				h: clampNum(e.h, 3, 40, 6),
			};
		}).filter(function (e) { return !!FLAG_BY_TYPE[e.type] || ELEMENT_DEFS.some(function (d) { return d.type === e.type; }); });
	}

	function clampNum(v, min, max, fallback) {
		const n = Number(v);
		if (!Number.isFinite(n)) return fallback;
		return Math.max(min, Math.min(max, n));
	}

	function cloneLayout(src) {
		const out = Object.assign({}, DEFAULT_LAYOUT, src || {});
		out.canvas_elements = cloneElements((src && src.canvas_elements) || DEFAULT_ELEMENTS);
		return out;
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function TicketCanvasController(opts) {
		this.root = opts.root;
		this.isPremium = !!opts.isPremium;
		this.templates = Array.isArray(opts.templates) && opts.templates.length ? opts.templates : FALLBACK_TEMPLATES;
		this.layout = cloneLayout(opts.layout);
		this.formFields = Object.assign({ name: true, email: true, phone: true }, opts.formFields || {});
		this.sample = Object.assign({
			title: "Your Event Title",
			date: "Sat, Apr 18, 2026, 06:30 PM",
			venue: "Chennai Trade Centre",
			ticketType: "General Admission",
			seat: "General Admission",
			price: "Rs. 999",
			bookingId: "JOD-A1B2C3D4",
			attendeeName: "Priya Sharma",
			attendeeEmail: "priya@email.com",
			attendeePhone: "+91 98765 43210",
		}, opts.sample || {});
		this.onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
		this.selectedType = null;
		this._drag = null;
		this._bound = false;
		this.mount();
	}

	TicketCanvasController.prototype.emitChange = function () {
		this.syncFlagsFromElements();
		this.onChange(this.getLayout());
	};

	TicketCanvasController.prototype.syncFlagsFromElements = function () {
		const present = {};
		(this.layout.canvas_elements || []).forEach(function (el) { present[el.type] = true; });
		ELEMENT_DEFS.forEach(function (def) {
			if (!def.flag) return;
			if (def.type === "booking_id") return;
			this.layout[def.flag] = !!present[def.type] || (def.type === "jod_logo" && !this.isPremium);
		}.bind(this));
		if (!this.isPremium) this.layout.show_jod_logo = true;
		if (present.qr || present.booking_id) this.layout.show_qr = true;
		else if (!present.qr && !present.booking_id) this.layout.show_qr = false;
	};

	TicketCanvasController.prototype.setPremium = function (premium) {
		this.isPremium = !!premium;
		if (!this.isPremium) {
			this.layout.show_jod_logo = true;
			if (!this.hasElement("jod_logo")) this.addElement("jod_logo", true);
		}
		this.syncControls();
		this.renderPreview();
		this.renderPalette();
	};

	TicketCanvasController.prototype.setFormFields = function (fields) {
		this.formFields = Object.assign({ name: true, email: true, phone: true }, fields || {});
		this.renderPreview();
	};

	TicketCanvasController.prototype.setTemplates = function (list) {
		if (Array.isArray(list) && list.length) this.templates = list;
		this.renderTemplatePicker();
		this.renderPreview();
	};

	TicketCanvasController.prototype.setLayout = function (layout) {
		this.layout = cloneLayout(layout);
		if (!this.isPremium) {
			this.layout.show_jod_logo = true;
			if (!this.hasElement("jod_logo")) this.addElement("jod_logo", true);
		}
		this.applyFlagsToElements();
		this.syncControls();
		this.renderTemplatePicker();
		this.renderPalette();
		this.renderPreview();
	};

	TicketCanvasController.prototype.applyFlagsToElements = function () {
		const L = this.layout;
		const keep = [];
		const seen = {};
		(L.canvas_elements || []).forEach(function (el) {
			const def = ELEMENT_DEFS.find(function (d) { return d.type === el.type; });
			if (!def) return;
			if (def.flag && L[def.flag] === false && !(def.type === "jod_logo" && !this.isPremium)) return;
			if (seen[el.type]) return;
			seen[el.type] = true;
			keep.push(el);
		}.bind(this));
		ELEMENT_DEFS.forEach(function (def) {
			if (seen[def.type]) return;
			const shouldShow = !def.flag || L[def.flag] !== false || (def.type === "jod_logo" && !this.isPremium);
			if (!shouldShow) return;
			const base = DEFAULT_ELEMENTS.find(function (e) { return e.type === def.type; }) || { type: def.type, x: 20, y: 20, w: def.w, h: def.h };
			keep.push(Object.assign({}, base));
		}.bind(this));
		this.layout.canvas_elements = keep;
	};

	TicketCanvasController.prototype.setSample = function (sample) {
		this.sample = Object.assign({}, this.sample, sample || {});
		this.renderPreview();
	};

	TicketCanvasController.prototype.getLayout = function () {
		this.syncFlagsFromElements();
		const out = cloneLayout(this.layout);
		if (!this.isPremium) out.show_jod_logo = true;
		return out;
	};

	TicketCanvasController.prototype.hasElement = function (type) {
		return (this.layout.canvas_elements || []).some(function (e) { return e.type === type; });
	};

	TicketCanvasController.prototype.addElement = function (type, silent) {
		if (this.hasElement(type)) return;
		const def = ELEMENT_DEFS.find(function (d) { return d.type === type; });
		if (!def) return;
		const base = DEFAULT_ELEMENTS.find(function (e) { return e.type === type; });
		const next = Object.assign({ type: type, x: 18, y: 20, w: def.w, h: def.h }, base || {});
		this.layout.canvas_elements = (this.layout.canvas_elements || []).concat([next]);
		if (def.flag) this.layout[def.flag] = true;
		this.selectedType = type;
		this.renderPalette();
		this.renderPreview();
		this.syncControls();
		if (!silent) this.emitChange();
	};

	TicketCanvasController.prototype.removeElement = function (type) {
		const def = ELEMENT_DEFS.find(function (d) { return d.type === type; });
		if (def && def.locked && !this.isPremium && type === "jod_logo") return;
		this.layout.canvas_elements = (this.layout.canvas_elements || []).filter(function (e) { return e.type !== type; });
		if (def && def.flag) this.layout[def.flag] = false;
		if (this.selectedType === type) this.selectedType = null;
		this.renderPalette();
		this.renderPreview();
		this.syncControls();
		this.emitChange();
	};

	TicketCanvasController.prototype.mount = function () {
		if (!this.root) return;
		this.applyFlagsToElements();
		this.root.innerHTML = [
			'<div class="ticket-design-studio">',
			'  <div class="ticket-template-grid" id="ticketTemplateGrid" role="listbox" aria-label="Ticket templates"></div>',
			'  <div class="ticket-canvas-workspace">',
			'    <div class="ticket-canvas-stage" id="ticketCanvasStage">',
			'      <div class="ticket-canvas-hint">Drag elements to move. Use × to remove, or uncheck in the list. Add elements from the palette.</div>',
			'      <div class="ticket-live-card is-canvas" id="ticketLiveCard" aria-live="polite"></div>',
			'    </div>',
			'    <div class="ticket-canvas-controls">',
			'      <label class="ticket-ctrl"><span>Accent color</span><input type="color" id="ticketAccentColor" value="#2563eb" /></label>',
			'      <label class="ticket-ctrl"><span>Headline override</span><input type="text" id="ticketHeadlineOverride" maxlength="80" placeholder="Leave blank to use event title" /></label>',
			'      <label class="ticket-ctrl"><span>Footer note</span><input type="text" id="ticketCustomFooter" maxlength="120" placeholder="Optional short note on ticket" /></label>',
			'      <div class="ticket-palette-title">Add elements</div>',
			'      <div class="ticket-element-palette" id="ticketElementPalette"></div>',
			'      <div class="ticket-palette-title">Show on ticket</div>',
			'      <div class="ticket-toggle-grid">',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowDate" checked /> Date</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowVenue" checked /> Venue</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowType" checked /> Ticket type</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowSeat" checked /> Seat</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowPrice" checked /> Price</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowQr" checked /> QR code</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeeName" checked /> Name</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeePhone" checked /> Phone number</label>',
			'        <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeeEmail" checked /> Email</label>',
			'        <label class="ticket-toggle ticket-toggle-premium" id="ticketLogoToggleWrap"><input type="checkbox" id="ticketShowJodLogo" checked /> JOD Events logo</label>',
			'      </div>',
			'      <p class="ticket-premium-hint" id="ticketPremiumHint">JOD Events logo stays on free plans. Upgrade to Premium to remove it.</p>',
			'      <button type="button" class="ticket-reset-btn" id="ticketResetLayout">Reset layout</button>',
			'    </div>',
			'  </div>',
			'</div>',
		].join("");
		this.bindEvents();
		this.syncControls();
		this.renderTemplatePicker();
		this.renderPalette();
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
			["ticketShowDate", "show_date", "checked", "date"],
			["ticketShowVenue", "show_venue", "checked", "venue"],
			["ticketShowType", "show_ticket_type", "checked", "ticket_type"],
			["ticketShowSeat", "show_seat", "checked", "seat"],
			["ticketShowPrice", "show_price", "checked", "price"],
			["ticketShowQr", "show_qr", "checked", "qr"],
			["ticketShowJodLogo", "show_jod_logo", "checked", "jod_logo"],
			["ticketShowAttendeeName", "show_attendee_name", "checked", "name"],
			["ticketShowAttendeeEmail", "show_attendee_email", "checked", "email"],
			["ticketShowAttendeePhone", "show_attendee_phone", "checked", "phone"],
		];
		map.forEach(function (row) {
			const el = self.root.querySelector("#" + row[0]);
			if (!el) return;
			el.addEventListener("input", function () {
				if (row[0] === "ticketShowJodLogo" && !self.isPremium) {
					el.checked = true;
					self.layout.show_jod_logo = true;
					if (!self.hasElement("jod_logo")) self.addElement("jod_logo", true);
					self.renderPreview();
					return;
				}
				const on = row[2] === "checked" ? !!el.checked : String(el.value || "");
				self.layout[row[1]] = on;
				if (row[2] === "checked" && row[3]) {
					if (on) {
						self.addElement(row[3], true);
						if (row[3] === "qr") self.addElement("booking_id", true);
					} else {
						self.removeElement(row[3]);
						if (row[3] === "qr") self.removeElement("booking_id");
						return;
					}
				}
				if (row[1] === "custom_footer" || row[1] === "headline_override" || row[1] === "accent_color") {
					if (row[1] === "custom_footer" && String(on || "").trim() && !self.hasElement("footer")) {
						self.addElement("footer", true);
					}
				}
				self.renderPreview();
				self.renderPalette();
				self.emitChange();
			});
			el.addEventListener("change", function () {
				el.dispatchEvent(new Event("input"));
			});
		});

		const resetBtn = this.root.querySelector("#ticketResetLayout");
		if (resetBtn) {
			resetBtn.addEventListener("click", function () {
				const keep = {
					template_id: self.layout.template_id,
					accent_color: self.layout.accent_color,
					headline_override: self.layout.headline_override,
					custom_footer: self.layout.custom_footer,
				};
				self.layout = cloneLayout(Object.assign({}, DEFAULT_LAYOUT, keep));
				if (!self.isPremium) self.layout.show_jod_logo = true;
				self.selectedType = null;
				self.syncControls();
				self.renderPalette();
				self.renderPreview();
				self.emitChange();
			});
		}

		document.addEventListener("mousemove", function (ev) { self.onDragMove(ev); });
		document.addEventListener("mouseup", function () { self.onDragEnd(); });
		document.addEventListener("touchmove", function (ev) { self.onDragMove(ev.touches && ev.touches[0] ? ev.touches[0] : ev); }, { passive: false });
		document.addEventListener("touchend", function () { self.onDragEnd(); });
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
		setChk("ticketShowDate", this.hasElement("date"));
		setChk("ticketShowVenue", this.hasElement("venue"));
		setChk("ticketShowType", this.hasElement("ticket_type"));
		setChk("ticketShowSeat", this.hasElement("seat"));
		setChk("ticketShowPrice", this.hasElement("price"));
		setChk("ticketShowQr", this.hasElement("qr") || this.hasElement("booking_id"));
		setChk("ticketShowJodLogo", this.hasElement("jod_logo") || !this.isPremium);
		setChk("ticketShowAttendeeName", this.hasElement("name"));
		setChk("ticketShowAttendeeEmail", this.hasElement("email"));
		setChk("ticketShowAttendeePhone", this.hasElement("phone"));

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
				? "Premium active - drag or remove the JOD logo on the canvas."
				: "JOD Events logo stays on free plans. Upgrade to Premium to remove it.";
		}
	};

	TicketCanvasController.prototype.syncFormFieldToggles = function () {};

	TicketCanvasController.prototype.renderPalette = function () {
		const host = this.root && this.root.querySelector("#ticketElementPalette");
		if (!host) return;
		const self = this;
		host.innerHTML = ELEMENT_DEFS.map(function (def) {
			const onCanvas = self.hasElement(def.type);
			const locked = def.locked && !self.isPremium && def.type === "jod_logo";
			const disabled = onCanvas || locked;
			return '<button type="button" class="ticket-palette-chip' + (onCanvas ? " is-on" : "") + '" data-add-type="' + def.type + '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(def.label) + (onCanvas ? " ✓" : " +") + "</button>";
		}).join("");
		host.querySelectorAll("[data-add-type]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				self.addElement(btn.getAttribute("data-add-type"));
			});
		});
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
				'    <span style="background:' + (p.card || "#fff") + ';color:' + (p.text || "#111") + '">' + (t.name || t.id).slice(0, 1) + "</span>",
				"  </span>",
				'  <span class="ticket-template-meta"><strong>' + (t.name || t.id) + "</strong><em>" + (t.tagline || "") + "</em></span>",
				"</button>",
			].join("");
		}).join("");
		grid.querySelectorAll("[data-template-id]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				const id = btn.getAttribute("data-template-id");
				const tmpl = self.templates.find(function (x) { return x.id === id; });
				self.layout.template_id = id;
				if (tmpl && tmpl.preview && tmpl.preview.accent) self.layout.accent_color = tmpl.preview.accent;
				self.syncControls();
				self.renderTemplatePicker();
				self.renderPreview();
				self.emitChange();
			});
		});
	};

	TicketCanvasController.prototype.currentTemplate = function () {
		const id = this.layout.template_id || "classic";
		return this.templates.find(function (t) { return t.id === id; }) || this.templates[0] || FALLBACK_TEMPLATES[0];
	};

	TicketCanvasController.prototype.elementContent = function (type) {
		const L = this.layout;
		const s = this.sample;
		const title = (L.headline_override || "").trim() || s.title;
		switch (type) {
			case "poster": return '<div class="tc-poster-fill" aria-hidden="true"></div>';
			case "title": return '<div class="tc-el-title">' + escapeHtml(title) + "</div>";
			case "badge": return '<div class="tc-el-badge">E-Ticket</div>';
			case "date": return '<div class="tc-el-text">' + escapeHtml(s.date) + "</div>";
			case "venue": return '<div class="tc-el-text muted">' + escapeHtml(s.venue) + "</div>";
			case "qty": return '<div class="tc-el-text muted center">1 Ticket</div>';
			case "ticket_type": return '<div class="tc-el-strong center">' + escapeHtml(s.ticketType) + "</div>";
			case "seat": return '<div class="tc-el-text muted center">' + escapeHtml(s.seat) + "</div>";
			case "name": return '<div class="tc-el-row"><span>Name</span><strong>' + escapeHtml(s.attendeeName) + "</strong></div>";
			case "phone": return '<div class="tc-el-row"><span>Phone</span><strong>' + escapeHtml(s.attendeePhone) + "</strong></div>";
			case "email": return '<div class="tc-el-row"><span>Email</span><strong>' + escapeHtml(s.attendeeEmail) + "</strong></div>";
			case "qr": return '<div class="tc-el-qr" aria-hidden="true"></div>';
			case "booking_id": return '<div class="tc-el-text center strong">BOOKING ID: #' + escapeHtml(s.bookingId) + "</div>";
			case "price": return '<div class="tc-el-row"><span>Total Amount</span><strong>' + escapeHtml(s.price) + "</strong></div>";
			case "jod_logo": return '<div class="tc-el-logo">JOD Events</div>';
			case "footer": return '<div class="tc-el-text muted center">' + escapeHtml(L.custom_footer || "Footer note") + "</div>";
			default: return "";
		}
	};

	TicketCanvasController.prototype.renderPreview = function () {
		const stage = this.root && this.root.querySelector("#ticketCanvasStage");
		const card = this.root && this.root.querySelector("#ticketLiveCard");
		if (!stage || !card) return;
		const tmpl = this.currentTemplate();
		const p = tmpl.preview || {};
		const L = this.layout;
		const accent = L.accent_color || p.accent || "#2563eb";
		const self = this;

		stage.style.background = p.bg || "#f4f6f8";
		card.className = "ticket-live-card is-canvas style-" + (tmpl.id || "classic");
		card.style.background = p.card || "#fff";
		card.style.color = p.text || "#111827";
		card.style.setProperty("--ticket-accent", accent);
		card.style.setProperty("--ticket-muted", p.muted || "#6b7280");

		const bits = ['<div class="tlc-accent" aria-hidden="true"></div>'];
		(L.canvas_elements || []).forEach(function (el) {
			const locked = el.type === "jod_logo" && !self.isPremium;
			const selected = self.selectedType === el.type;
			bits.push(
				'<div class="tc-node' + (selected ? " is-selected" : "") + (locked ? " is-locked" : "") + '" data-type="' + el.type + '" style="left:' + el.x + "%;top:" + el.y + "%;width:" + el.w + "%;height:" + el.h + '%;">' +
				'<div class="tc-node-toolbar"><span>' + escapeHtml((ELEMENT_DEFS.find(function (d) { return d.type === el.type; }) || {}).label || el.type) + "</span>" +
				(locked ? "" : '<button type="button" class="tc-node-remove" data-remove="' + el.type + '" title="Remove">×</button>') +
				"</div>" +
				'<div class="tc-node-body">' + self.elementContent(el.type) + "</div>" +
				"</div>"
			);
		});
		card.innerHTML = bits.join("");

		card.querySelectorAll(".tc-node").forEach(function (node) {
			node.addEventListener("mousedown", function (ev) { self.onDragStart(ev, node); });
			node.addEventListener("touchstart", function (ev) {
				if (ev.touches && ev.touches[0]) self.onDragStart(ev.touches[0], node, ev);
			}, { passive: false });
		});
		card.querySelectorAll("[data-remove]").forEach(function (btn) {
			btn.addEventListener("click", function (ev) {
				ev.preventDefault();
				ev.stopPropagation();
				self.removeElement(btn.getAttribute("data-remove"));
			});
		});
	};

	TicketCanvasController.prototype.onDragStart = function (point, node, rawEvent) {
		if (rawEvent && rawEvent.cancelable) rawEvent.preventDefault();
		const type = node.getAttribute("data-type");
		const item = (this.layout.canvas_elements || []).find(function (e) { return e.type === type; });
		const card = this.root.querySelector("#ticketLiveCard");
		if (!item || !card) return;
		this.selectedType = type;
		const rect = card.getBoundingClientRect();
		this._drag = {
			type: type,
			startX: point.clientX,
			startY: point.clientY,
			origX: item.x,
			origY: item.y,
			cardW: rect.width,
			cardH: rect.height,
		};
		this.renderPreview();
	};

	TicketCanvasController.prototype.onDragMove = function (point) {
		if (!this._drag || !point) return;
		if (point.preventDefault) point.preventDefault();
		const dx = ((point.clientX - this._drag.startX) / this._drag.cardW) * 100;
		const dy = ((point.clientY - this._drag.startY) / this._drag.cardH) * 100;
		const item = (this.layout.canvas_elements || []).find(function (e) { return e.type === this._drag.type; }.bind(this));
		if (!item) return;
		item.x = clampNum(this._drag.origX + dx, 0, 100 - item.w, item.x);
		item.y = clampNum(this._drag.origY + dy, 0, 100 - item.h, item.y);
		const node = this.root.querySelector('.tc-node[data-type="' + item.type + '"]');
		if (node) {
			node.style.left = item.x + "%";
			node.style.top = item.y + "%";
		}
	};

	TicketCanvasController.prototype.onDragEnd = function () {
		if (!this._drag) return;
		this._drag = null;
		this.emitChange();
	};

	global.JodTicketCanvas = {
		DEFAULT_LAYOUT: DEFAULT_LAYOUT,
		FALLBACK_TEMPLATES: FALLBACK_TEMPLATES,
		ELEMENT_DEFS: ELEMENT_DEFS,
		create: function (opts) {
			return new TicketCanvasController(opts || {});
		},
	};
})(typeof window !== "undefined" ? window : globalThis);
