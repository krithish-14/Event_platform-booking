/**
 * Host ticket design canvas - drag, remove, shapes, and data fields on live preview.
 * JOD Events logo is locked on unless host has premium subscription.
 */
(function (global) {
	"use strict";

	/* Must match the drawer breakpoint in organizer-dashboard.css */
	const DRAWER_QUERY = "(max-width: 960px)";

	const FALLBACK_TEMPLATES = [
		{ id: "classic", name: "Classic Clean", tagline: "Bright white card", preview: { bg: "#f4f6f8", card: "#ffffff", accent: "#2563eb", text: "#111827", muted: "#6b7280" } },
		{ id: "midnight", name: "Midnight Stage", tagline: "Concert stub ticket", preview: { bg: "#1a1033", card: "#5b21b6", accent: "#c4b5fd", text: "#ffffff", muted: "#ddd6fe" } },
		{ id: "sunset", name: "Sunset Glow", tagline: "Warm festival strip", preview: { bg: "#fff7ed", card: "#fffbeb", accent: "#ea580c", text: "#1c1917", muted: "#78716c" } },
		{ id: "concert", name: "Concert Stripe", tagline: "Bold side stripe", preview: { bg: "#fafafa", card: "#ffffff", accent: "#dc2626", text: "#0f172a", muted: "#64748b" } },
		{ id: "minimal", name: "Paper Minimal", tagline: "Quiet editorial", preview: { bg: "#f8fafc", card: "#ffffff", accent: "#0f172a", text: "#0f172a", muted: "#64748b" } },
		{ id: "festival", name: "Festival Teal", tagline: "Outdoor teal frame", preview: { bg: "#ecfdf5", card: "#ffffff", accent: "#0d9488", text: "#134e4a", muted: "#5eead4" } },
		{ id: "vip_gold", name: "VIP Gold", tagline: "Charcoal + gold", preview: { bg: "#1c1917", card: "#292524", accent: "#d4a017", text: "#fafaf9", muted: "#a8a29e" } },
		{ id: "neon_night", name: "Neon Night", tagline: "Electric cyan", preview: { bg: "#020617", card: "#0f172a", accent: "#22d3ee", text: "#e2e8f0", muted: "#64748b" } },
	];

	const DATA_DEFS = [
		{ type: "poster", label: "Poster", flag: null, w: 22, h: 18, locked: false, shape: false },
		{ type: "title", label: "Event title", flag: null, w: 58, h: 8, locked: false, shape: false },
		{ type: "badge", label: "E-Ticket badge", flag: null, w: 18, h: 4, locked: false, shape: false },
		{ type: "date", label: "Date", flag: "show_date", w: 58, h: 5, locked: false, shape: false },
		{ type: "venue", label: "Venue", flag: "show_venue", w: 70, h: 8, locked: false, shape: false },
		{ type: "qty", label: "Ticket count", flag: null, w: 30, h: 4, locked: false, shape: false },
		{ type: "ticket_type", label: "Ticket type", flag: "show_ticket_type", w: 55, h: 6, locked: false, shape: false },
		{ type: "seat", label: "Seat", flag: "show_seat", w: 55, h: 5, locked: false, shape: false },
		{ type: "name", label: "Name", flag: "show_attendee_name", w: 70, h: 5, locked: false, shape: false },
		{ type: "phone", label: "Phone number", flag: "show_attendee_phone", w: 70, h: 5, locked: false, shape: false },
		{ type: "email", label: "Email", flag: "show_attendee_email", w: 70, h: 5, locked: false, shape: false },
		{ type: "qr", label: "QR code", flag: "show_qr", w: 34, h: 22, locked: false, shape: false },
		{ type: "booking_id", label: "Booking ID", flag: null, w: 55, h: 4, locked: false, shape: false },
		{ type: "price", label: "Price", flag: "show_price", w: 86, h: 5, locked: false, shape: false },
		{ type: "jod_logo", label: "JOD Events logo", flag: "show_jod_logo", w: 78, h: 12, locked: true, shape: false },
		{ type: "stub", label: "Side text", flag: null, w: 10, h: 70, locked: false, shape: false },
		{ type: "footer", label: "Footer note", flag: null, w: 70, h: 4, locked: false, shape: false },
	];

	const SHAPE_DEFS = [
		{ type: "line", label: "Line", flag: null, w: 70, h: 2, locked: false, shape: true, color: "#38bdf8" },
		{ type: "dashed_line", label: "Dashed", flag: null, w: 70, h: 2, locked: false, shape: true, color: "#94a3b8" },
		{ type: "rectangle", label: "Box", flag: null, w: 40, h: 12, locked: false, shape: true, color: "#38bdf8" },
		{ type: "circle", label: "Circle", flag: null, w: 16, h: 10, locked: false, shape: true, color: "#22d3ee" },
	];
	const CUSTOM_DEFS = [
		{ type: "text", label: "Text", flag: null, w: 54, h: 6, locked: false, shape: false, repeatable: true },
		{ type: "image", label: "Image", flag: null, w: 24, h: 22, locked: false, shape: false, repeatable: true },
	];

	const ELEMENT_DEFS = DATA_DEFS.concat(SHAPE_DEFS).concat(CUSTOM_DEFS);
	const DEF_BY_TYPE = {};
	ELEMENT_DEFS.forEach(function (d) { DEF_BY_TYPE[d.type] = d; });

	/* Shared geometry for every color format — templates only change colors. */
	const LAYOUT_VERSION = 5;
	const DEFAULT_ELEMENTS = [
		{ id: "poster", type: "poster", x: 4, y: 3, w: 20, h: 16 },
		{ id: "badge", type: "badge", x: 78, y: 3, w: 18, h: 4 },
		{ id: "title", type: "title", x: 28, y: 3, w: 48, h: 7 },
		{ id: "date", type: "date", x: 28, y: 11, w: 60, h: 4 },
		{ id: "venue", type: "venue", x: 28, y: 16, w: 62, h: 9 },
		{ id: "qty", type: "qty", x: 35, y: 28, w: 30, h: 4 },
		{ id: "ticket_type", type: "ticket_type", x: 20, y: 33, w: 60, h: 5 },
		{ id: "seat", type: "seat", x: 20, y: 39, w: 60, h: 4 },
		{ id: "name", type: "name", x: 7, y: 45, w: 86, h: 5 },
		{ id: "phone", type: "phone", x: 7, y: 50, w: 86, h: 5 },
		{ id: "email", type: "email", x: 7, y: 55, w: 86, h: 5 },
		{ id: "qr", type: "qr", x: 30, y: 61, w: 40, h: 17 },
		{ id: "booking_id", type: "booking_id", x: 15, y: 79, w: 70, h: 4 },
		{ id: "price", type: "price", x: 7, y: 84, w: 86, h: 5 },
		{ id: "jod_logo", type: "jod_logo", x: 11, y: 89, w: 78, h: 10 },
	];

	/* Landscape concert stub — JOD logo sits where a barcode would be. */
	const MIDNIGHT_GEOMETRY = {
		ticket_type: { x: 5, y: 6, w: 46, h: 14 },
		title: { x: 5, y: 20, w: 48, h: 10 },
		name: { x: 5, y: 32, w: 42, h: 20 },
		booking_id: { x: 5, y: 54, w: 20, h: 12 },
		date: { x: 26, y: 54, w: 22, h: 14 },
		seat: { x: 49, y: 54, w: 18, h: 14 },
		jod_logo: { x: 5, y: 72, w: 28, h: 18 },
		qr: { x: 74, y: 18, w: 14, h: 52 },
		stub: { x: 89, y: 8, w: 10, h: 82 },
		phone: { x: 5, y: 50, w: 42, h: 8 },
		email: { x: 5, y: 58, w: 48, h: 8 },
		price: { x: 50, y: 64, w: 20, h: 8 },
		venue: { x: 5, y: 66, w: 40, h: 8 },
	};

	const DEFAULT_LAYOUT = {
		template_id: "classic",
		layout_version: LAYOUT_VERSION,
		accent_color: "#2563eb",
		card_color: "",
		text_color: "",
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
		ticket_type_override: "",
		canvas_elements: DEFAULT_ELEMENTS.map(function (e) { return Object.assign({}, e); }),
	};

	let _shapeSeq = 1;

	function clampNum(v, min, max, fallback) {
		const n = Number(v);
		if (!Number.isFinite(n)) return fallback;
		return Math.max(min, Math.min(max, n));
	}

	function isShapeType(type) {
		return !!(DEF_BY_TYPE[type] && DEF_BY_TYPE[type].shape);
	}

	function isRepeatableType(type) {
		const def = DEF_BY_TYPE[type];
		return !!(def && (def.shape || def.repeatable));
	}

	function sanitizeColor(c, fallback) {
		const v = String(c || fallback || "#38bdf8").trim();
		if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) return v;
		return fallback || "#38bdf8";
	}

	function optionalColor(c) {
		const v = String(c || "").trim();
		if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) return v;
		return "";
	}

	function defaultAlign(type) {
		if (["qty", "ticket_type", "seat", "booking_id", "footer", "badge"].indexOf(type) >= 0) return "center";
		return "left";
	}

	function sanitizeAlign(value, type) {
		const align = String(value || "").toLowerCase();
		if (align === "left" || align === "center" || align === "right") return align;
		return defaultAlign(type);
	}

	function cloneElements(list) {
		const out = [];
		const seenData = {};
		(Array.isArray(list) ? list : []).forEach(function (e) {
			if (!e) return;
			const type = String(e.type || "").trim();
			if (!DEF_BY_TYPE[type]) return;
			const shape = isShapeType(type);
			const repeatable = isRepeatableType(type);
			let id = String(e.id || "").trim();
			if (!repeatable) {
				id = type;
				if (seenData[type]) return;
				seenData[type] = true;
			} else if (!id) {
				id = type + "_" + (_shapeSeq++);
			}
			const item = {
				id: id,
				type: type,
				x: clampNum(e.x, 0, 92, 4),
				y: clampNum(e.y, 0, 94, 4),
				w: clampNum(e.w, shape && (type === "line" || type === "dashed_line") ? 8 : 10, 96, 40),
				h: clampNum(e.h, shape && (type === "line" || type === "dashed_line") ? 1 : 3, 40, 6),
			};
			const savedColor = optionalColor(e.color);
			if (savedColor) item.color = savedColor;
			else if (shape) item.color = sanitizeColor(e.color, DEF_BY_TYPE[type].color);
			if (type === "text" || ["title", "date", "venue", "qty", "ticket_type", "seat", "name", "phone", "email", "booking_id", "price", "footer", "badge"].indexOf(type) >= 0) {
				item.align = sanitizeAlign(e.align, type);
			}
			if (type === "text") item.text = String(e.text || "Your text").trim().slice(0, 120) || "Your text";
			if (type === "stub") item.text = String(e.text || "").trim().slice(0, 120);
			if (type === "image") {
				const src = String(e.src || "").trim();
				if (/^(https?:\/\/|\/)/.test(src)) item.src = src.slice(0, 500);
			}
			const fs = Number(e.fontScale);
			if (Number.isFinite(fs)) item.fontScale = clampNum(fs, 0.7, 2.2, 1);
			out.push(item);
		});
		return out;
	}

	function defaultByType() {
		const map = {};
		DEFAULT_ELEMENTS.forEach(function (e) { map[e.type] = e; });
		return map;
	}

	function snapDataElementsToDefault(elements) {
		const map = defaultByType();
		return (elements || []).map(function (el) {
			if (!el || isShapeType(el.type)) return el;
			const base = map[el.type];
			if (!base) {
				/* Keep custom footer below booking / above price so it never sits on venue. */
				if (el.type === "footer") {
					return Object.assign({}, el, { x: 15, y: 75, w: 70, h: 4 });
				}
				return el;
			}
			return Object.assign({}, el, { x: base.x, y: base.y, w: base.w, h: base.h });
		});
	}

	function cloneLayout(src) {
		const out = Object.assign({}, DEFAULT_LAYOUT, src || {});
		out.card_color = optionalColor(src && src.card_color);
		out.text_color = optionalColor(src && src.text_color);
		out.canvas_elements = cloneElements((src && src.canvas_elements) || DEFAULT_ELEMENTS);
		const prevVer = Number(src && src.layout_version) || 0;
		/* v2+: one shared alignment for every color format; migrate older drafts once. */
		if (!src || !Array.isArray(src.canvas_elements) || !src.canvas_elements.length || prevVer < LAYOUT_VERSION) {
			out.canvas_elements = snapDataElementsToDefault(out.canvas_elements);
		}
		out.layout_version = LAYOUT_VERSION;
		if (String(out.template_id || "") === "midnight" && prevVer < 5) {
			applyMidnightGeometry(out.canvas_elements);
		}
		repairFooterPlacement(out.canvas_elements);
		return out;
	}

	function applyMidnightGeometry(elements) {
		const list = elements || [];
		if (!list.some(function (el) { return el && el.type === "stub"; })) {
			const geo = MIDNIGHT_GEOMETRY.stub;
			list.push({ id: "stub", type: "stub", x: geo.x, y: geo.y, w: geo.w, h: geo.h, text: "" });
		}
		list.forEach(function (el) {
			const geo = el && MIDNIGHT_GEOMETRY[el.type];
			if (!geo) return;
			el.x = geo.x;
			el.y = geo.y;
			el.w = geo.w;
			el.h = geo.h;
		});
	}

	function repairFooterPlacement(elements) {
		const footer = (elements || []).find(function (e) { return e && e.type === "footer"; });
		if (!footer) return;
		const venue = (elements || []).find(function (e) { return e && e.type === "venue"; });
		const venueBottom = venue ? (Number(venue.y) || 0) + (Number(venue.h) || 0) : 0;
		if (Number(footer.y) < Math.max(72, venueBottom + 6)) {
			footer.y = 75;
			footer.x = 15;
			footer.w = 70;
			footer.h = 4;
		}
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
			seat: "Seat A12",
			price: "Rs. 999",
			bookingId: "JOD-A1B2C3D4",
			attendeeName: "fullname",
			attendeeEmail: "contact@jodevents.com",
			attendeePhone: "+91 91509 04455",
		}, opts.sample || {});
		this.onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
		this.onUploadImage = typeof opts.onUploadImage === "function" ? opts.onUploadImage : null;
		this.selectedId = null;
		this.canvasSelected = false;
		this.toolsOpen = false;
		this._drag = null;
		this._didDrag = false;
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
		DATA_DEFS.forEach(function (def) {
			if (!def.flag) return;
			this.layout[def.flag] = !!present[def.type] || (def.type === "jod_logo" && !this.isPremium);
		}.bind(this));
		if (!this.isPremium) this.layout.show_jod_logo = true;
		this.layout.show_qr = !!(present.qr || present.booking_id);
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
		this.scrollActiveTemplateIntoView();
		this.renderPreview();
	};

	TicketCanvasController.prototype.setLayout = function (layout) {
		this.layout = cloneLayout(layout);
		if (!this.isPremium) {
			this.layout.show_jod_logo = true;
			if (!this.hasElement("jod_logo")) this.addElement("jod_logo", true);
		}
		this.applyFlagsToElements();
		this.selectedId = null;
		this.canvasSelected = false;
		this.syncControls();
		this.renderTemplatePicker();
		this.scrollActiveTemplateIntoView();
		this.renderPalette();
		this.renderPreview();
	};

	TicketCanvasController.prototype.applyFlagsToElements = function () {
		const L = this.layout;
		const keep = [];
		const seen = {};
		(L.canvas_elements || []).forEach(function (el) {
			const def = DEF_BY_TYPE[el.type];
			if (!def) return;
			if (def.shape || def.repeatable) {
				keep.push(el);
				return;
			}
			if (def.flag && L[def.flag] === false && !(def.type === "jod_logo" && !this.isPremium)) return;
			if (seen[el.type]) return;
			seen[el.type] = true;
			keep.push(el);
		}.bind(this));
		DATA_DEFS.forEach(function (def) {
			if (seen[def.type]) return;
			const shouldShow = !def.flag || L[def.flag] !== false || (def.type === "jod_logo" && !this.isPremium);
			if (!shouldShow) return;
			const base = DEFAULT_ELEMENTS.find(function (e) { return e.type === def.type; }) || { id: def.type, type: def.type, x: 20, y: 20, w: def.w, h: def.h };
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

	TicketCanvasController.prototype.findById = function (id) {
		return (this.layout.canvas_elements || []).find(function (e) { return e.id === id; });
	};

	TicketCanvasController.prototype.addElement = function (type, silent) {
		const def = DEF_BY_TYPE[type];
		if (!def) return;
		if (!isRepeatableType(type) && this.hasElement(type)) return;
		const base = DEFAULT_ELEMENTS.find(function (e) { return e.type === type; });
		const id = isRepeatableType(type) ? (type + "_" + Date.now().toString(36) + "_" + (_shapeSeq++)) : type;
		const next = Object.assign(
			{ id: id, type: type, x: 15 + (Math.random() * 10), y: 20 + (Math.random() * 20), w: def.w, h: def.h },
			base || {},
			{ id: id, type: type }
		);
		if (type === "footer") {
			next.x = 15;
			next.y = 75;
			next.w = 70;
			next.h = 4;
		}
		if (type === "line" || type === "dashed_line") {
			next.x = 15;
			next.y = 42;
			next.w = 70;
			next.h = 2;
		}
		if (def.shape) next.color = def.color || "#38bdf8";
		if (type === "text") {
			next.text = "Your text";
			next.align = "left";
			next.color = this.layout.text_color || "#111827";
		}
		if (type === "stub") next.text = "";
		if (type === "image") next.src = "";
		if (this.layout.template_id === "midnight" && MIDNIGHT_GEOMETRY[type]) {
			next.x = MIDNIGHT_GEOMETRY[type].x;
			next.y = MIDNIGHT_GEOMETRY[type].y;
			next.w = MIDNIGHT_GEOMETRY[type].w;
			next.h = MIDNIGHT_GEOMETRY[type].h;
		}
		this.layout.canvas_elements = (this.layout.canvas_elements || []).concat([next]);
		if (def.flag) this.layout[def.flag] = true;
		this.selectedId = id;
		this.canvasSelected = false;
		this.renderPalette();
		this.renderPreview();
		this.syncControls();
		this.syncShapeColorControl();
		if (!silent) this.emitChange();
	};

	TicketCanvasController.prototype.removeElement = function (idOrType) {
		const byId = this.findById(idOrType);
		const type = byId ? byId.type : idOrType;
		const id = byId ? byId.id : idOrType;
		const def = DEF_BY_TYPE[type];
		if (def && def.locked && !this.isPremium && type === "jod_logo") return;
		if (byId) {
			this.layout.canvas_elements = (this.layout.canvas_elements || []).filter(function (e) { return e.id !== id; });
		} else {
			this.layout.canvas_elements = (this.layout.canvas_elements || []).filter(function (e) { return e.type !== type; });
		}
		if (def && def.flag && !isShapeType(type) && !this.hasElement(type)) this.layout[def.flag] = false;
		if (this.selectedId === id || (!byId && this.selectedId === type)) this.selectedId = null;
		this.renderPalette();
		this.renderPreview();
		this.syncControls();
		this.syncSelectedPanel();
		this.emitChange();
	};

	TicketCanvasController.prototype.clearSelection = function () {
		if (!this.selectedId && !this.canvasSelected && !this._drag && !this._resize) {
			this.clearGuides();
			return;
		}
		this.selectedId = null;
		this.canvasSelected = false;
		this._drag = null;
		this._resize = null;
		this._didDrag = false;
		this.releasePointer();
		this.clearGuides();
		this.renderPreview();
		this.syncSelectedPanel();
	};

	TicketCanvasController.prototype.selectCanvas = function () {
		this.selectedId = null;
		this.canvasSelected = true;
		this._drag = null;
		this._resize = null;
		this._didDrag = false;
		this.releasePointer();
		this.clearGuides();
		this.updateSelectionStyles();
		this.syncSelectedPanel();
	};

	TicketCanvasController.prototype.isTextElement = function (type) {
		return ["title", "date", "venue", "qty", "ticket_type", "seat", "name", "phone", "email", "booking_id", "price", "footer", "badge", "jod_logo", "text", "stub"].indexOf(type) >= 0;
	};

	TicketCanvasController.prototype.isEditableText = function (type) {
		return type === "title" || type === "ticket_type" || type === "footer" || type === "text" || type === "stub";
	};

	TicketCanvasController.prototype.syncSelectedPanel = function () {
		if (!this.root) return;
		const panel = this.root.querySelector("#ticketSelectedPanel");
		const label = this.root.querySelector("#ticketSelectedLabel");
		const help = this.root.querySelector("#ticketSelectedHelp");
		const wEl = this.root.querySelector("#ticketElWidth");
		const hEl = this.root.querySelector("#ticketElHeight");
		const hWrap = this.root.querySelector("#ticketElHeightWrap");
		const fEl = this.root.querySelector("#ticketElFont");
		const fWrap = this.root.querySelector("#ticketElFontWrap");
		const colorInput = this.root.querySelector("#ticketItemColor");
		const colorLabel = this.root.querySelector("#ticketItemColorLabel");
		const alignWrap = this.root.querySelector("#ticketAlignSection");
		const textWrap = this.root.querySelector("#ticketTextEditWrap");
		const textInput = this.root.querySelector("#ticketItemText");
		const sizeWrap = this.root.querySelector("#ticketSizeRow");
		const card = this.root.querySelector("#ticketLiveCard");
		const item = this.findById(this.selectedId);
		const tmpl = this.currentTemplate();
		const preview = (tmpl && tmpl.preview) || {};
		if (card) card.classList.toggle("is-canvas-selected", !!this.canvasSelected && !item);
		if (this.canvasSelected && !item) {
			if (panel) panel.hidden = false;
			if (label) label.textContent = "Ticket";
			if (help) help.textContent = "Change the ticket background, accent, or default text color.";
			if (sizeWrap) sizeWrap.hidden = true;
			if (alignWrap) alignWrap.hidden = true;
			if (textWrap) textWrap.hidden = true;
			if (colorLabel) colorLabel.textContent = "Text";
			if (colorInput) colorInput.value = sanitizeColor(this.layout.text_color || preview.text, "#111827");
			const removeBtn = this.root.querySelector("#ticketRemoveSelectedBtn");
			if (removeBtn) removeBtn.hidden = true;
			return;
		}
		if (!item) {
			if (panel) panel.hidden = true;
			if (alignWrap) alignWrap.hidden = true;
			if (textWrap) textWrap.hidden = true;
			if (sizeWrap) sizeWrap.hidden = true;
			if (colorLabel) colorLabel.textContent = "Color";
			if (colorInput) colorInput.value = sanitizeColor(this.layout.accent_color, "#2563eb");
			return;
		}
		const def = DEF_BY_TYPE[item.type] || {};
		const isLine = item.type === "line" || item.type === "dashed_line";
		const isText = this.isTextElement(item.type);
		if (panel) panel.hidden = false;
		if (label) label.textContent = def.label || item.type;
		if (help) help.textContent = item.type === "image"
			? "Upload a picture. Drag it anywhere on the ticket."
			: (item.type === "stub"
				? "Type the side text. Leave blank to use the ticket name and event name."
				: (this.isEditableText(item.type)
					? "Type the words you want on the ticket. Leave blank to use the event text."
					: (isText ? "Change this field’s color, alignment, and size." : "Change this shape’s color or size.")));
		if (sizeWrap) sizeWrap.hidden = false;
		if (wEl) wEl.value = String(Math.round(item.w));
		if (hEl) hEl.value = String(Math.round(item.h));
		if (hWrap) hWrap.hidden = !!isLine;
		if (fWrap) fWrap.hidden = !isText;
		if (fEl) fEl.value = String(Math.round((item.fontScale || 1) * 100));
		if (alignWrap) {
			alignWrap.hidden = !isText || item.type === "jod_logo";
			alignWrap.querySelectorAll("[data-align]").forEach(function (btn) {
				btn.classList.toggle("is-active", btn.getAttribute("data-align") === sanitizeAlign(item.align, item.type));
			});
		}
		if (textWrap && textInput) {
			const editable = this.isEditableText(item.type);
			textWrap.hidden = !editable;
			if (editable) {
				if (item.type === "title") textInput.value = this.layout.headline_override || "";
				else if (item.type === "ticket_type") textInput.value = this.layout.ticket_type_override || "";
				else if (item.type === "footer") textInput.value = this.layout.custom_footer || "";
				else if (item.type === "stub") textInput.value = item.text || "";
				else textInput.value = item.text || "";
				textInput.placeholder = item.type === "title"
					? "Your event name"
					: (item.type === "ticket_type"
						? "Your ticket name"
						: (item.type === "stub" ? "Side text" : (item.type === "footer" ? "Optional note on ticket" : "Your text")));
			}
		}
		const imageWrap = this.root.querySelector("#ticketImageEditWrap");
		if (imageWrap) imageWrap.hidden = item.type !== "image";
		if (colorLabel) colorLabel.textContent = item.type === "image" ? "Frame" : (isShapeType(item.type) ? "Shape" : "Text");
		if (colorInput) {
			const fallback = isShapeType(item.type) ? (def.color || "#38bdf8") : (this.layout.text_color || preview.text || "#111827");
			colorInput.value = sanitizeColor(item.color || fallback, fallback);
		}
		const removeBtn = this.root.querySelector("#ticketRemoveSelectedBtn");
		if (removeBtn) {
			const lockedLogo = item.type === "jod_logo" && !this.isPremium;
			removeBtn.hidden = !!lockedLogo;
			removeBtn.disabled = !!lockedLogo;
		}
	};

	TicketCanvasController.prototype.updateSelectionStyles = function () {
		if (!this.root) return;
		const selected = this.selectedId;
		const card = this.root.querySelector("#ticketLiveCard");
		if (card) {
			card.classList.toggle("has-selection", !!selected);
			card.classList.toggle("is-canvas-selected", !!this.canvasSelected && !selected);
		}
		const toolsToggle = this.root.querySelector("#ticketToolsToggle");
		if (toolsToggle) toolsToggle.classList.toggle("has-selection", !!(selected || this.canvasSelected));
		this.root.querySelectorAll(".tc-node").forEach(function (node) {
			const on = node.getAttribute("data-id") === selected;
			node.classList.toggle("is-selected", on);
			node.classList.toggle("is-dimmed", !!(selected && !on));
		});
		this.syncSelectedPanel();
	};

	TicketCanvasController.prototype.applyNodeBox = function (item) {
		if (!item || !this.root) return;
		const safeId = String(item.id || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const node = this.root.querySelector('.tc-node[data-id="' + safeId + '"]');
		if (!node) return;
		node.style.left = item.x + "%";
		node.style.top = item.y + "%";
		node.style.width = item.w + "%";
		node.style.height = item.h + "%";
		const scale = item.fontScale || 1;
		node.style.setProperty("--tc-font-scale", String(scale));
	};

	TicketCanvasController.prototype.mount = function () {
		if (!this.root) return;
		this.applyFlagsToElements();
		this.root.innerHTML = [
			'<div class="ticket-design-studio is-studio-layout">',
			'  <div class="ticket-studio-toolbar">',
			'    <div class="ticket-template-carousel">',
			'      <button type="button" class="ticket-carousel-btn is-prev" id="ticketTemplatePrev" aria-label="Previous designs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>',
			'      <div class="ticket-template-grid" id="ticketTemplateGrid" role="listbox" aria-label="Ticket templates"></div>',
			'      <button type="button" class="ticket-carousel-btn is-next" id="ticketTemplateNext" aria-label="More designs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>',
			'    </div>',
			'    <div class="ticket-canvas-controls ticket-studio-controls-top">',
			'      <div class="ticket-tool-block">',
			'        <div class="ticket-palette-title">Add fields</div>',
			'        <div class="ticket-element-palette" id="ticketElementPalette"></div>',
			'      </div>',
			'      <div class="ticket-tool-block">',
			'        <div class="ticket-palette-title">Show on ticket</div>',
			'        <div class="ticket-toggle-grid">',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowDate" checked /> Date</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowVenue" checked /> Venue</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowType" checked /> Ticket type</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowSeat" checked /> Seat</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowPrice" checked /> Price</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowQr" checked /> QR code</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeeName" checked /> Name</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeePhone" checked /> Phone number</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeeEmail" checked /> Email</label>',
			'          <label class="ticket-toggle ticket-toggle-premium" id="ticketLogoToggleWrap"><input type="checkbox" id="ticketShowJodLogo" checked /> JOD Events logo</label>',
			'        </div>',
			'        <p class="ticket-premium-hint" id="ticketPremiumHint">JOD Events logo stays on free plans. Upgrade to Premium to remove it.</p>',
			'      </div>',
			'      <button type="button" class="ticket-reset-btn" id="ticketResetLayout" hidden>Reset layout</button>',
			'    </div>',
			'  </div>',
			'  <div class="ticket-canvas-workspace ticket-studio-canvas-wrap">',
			'    <div class="ticket-canvas-stage" id="ticketCanvasStage">',
			'      <div class="ticket-canvas-hint">Click a field to edit it. Click empty ticket for background colors. Drag to move · Esc deselects.</div>',
			'      <div class="ticket-live-card is-canvas" id="ticketLiveCard" aria-live="polite"></div>',
			'    </div>',
			'    <button type="button" class="ticket-tools-fab" id="ticketToolsToggle" aria-controls="ticketFloatCard" aria-expanded="false" aria-label="Open ticket tools">',
			'      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
			'      <span>Tools</span>',
			'    </button>',
			'    <div class="ticket-tools-backdrop" id="ticketToolsBackdrop" hidden></div>',
			'    <aside class="ticket-float-card" id="ticketFloatCard" aria-label="Ticket editing tools">',
			'      <div class="ticket-float-head"><span>Tools</span><button type="button" class="ticket-float-close" id="ticketToolsClose" aria-label="Close tools">&times;</button></div>',
			'      <p class="ticket-float-hint">Add text or shapes, then click a section to change color and alignment.</p>',
			'      <div class="ticket-float-section">',
			'        <div class="ticket-palette-title">Add</div>',
			'        <div class="ticket-float-add" id="ticketShapePalette"></div>',
			'      </div>',
			'      <div class="ticket-float-section">',
			'        <div class="ticket-palette-title">Ticket colors</div>',
			'        <div class="ticket-float-colors">',
			'          <label class="ticket-ctrl"><span>Background</span><input type="color" id="ticketCardColor" value="#ffffff" /></label>',
			'          <label class="ticket-ctrl"><span>Accent</span><input type="color" id="ticketAccentColor" value="#2563eb" /></label>',
			'        </div>',
			'      </div>',
			'      <div class="ticket-float-section ticket-selected-panel" id="ticketSelectedPanel" hidden>',
			'        <div class="ticket-palette-title">Selected <span id="ticketSelectedLabel"></span></div>',
			'        <p class="ticket-selected-help" id="ticketSelectedHelp">Click a field on the ticket to edit it here.</p>',
			'        <label class="ticket-ctrl" id="ticketTextEditWrap" hidden><span>Text</span><input type="text" id="ticketItemText" maxlength="120" /></label>',
			'        <label class="ticket-ctrl" id="ticketImageEditWrap" hidden><span>Image</span><input type="file" id="ticketItemImage" accept="image/png,image/jpeg,image/webp,image/gif" /></label>',
			'        <div class="ticket-float-colors">',
			'          <label class="ticket-ctrl"><span id="ticketItemColorLabel">Color</span><input type="color" id="ticketItemColor" value="#111827" /></label>',
			'        </div>',
			'        <div class="ticket-float-section" id="ticketAlignSection" hidden>',
			'          <div class="ticket-palette-title">Align</div>',
			'          <div class="ticket-align-row" role="group" aria-label="Text alignment">',
			'            <button type="button" class="ticket-align-btn" data-align="left" title="Left">Left</button>',
			'            <button type="button" class="ticket-align-btn" data-align="center" title="Center">Center</button>',
			'            <button type="button" class="ticket-align-btn" data-align="right" title="Right">Right</button>',
			'          </div>',
			'        </div>',
			'        <div class="ticket-ctrl-row" id="ticketSizeRow">',
			'          <label class="ticket-ctrl"><span>Width</span><input type="range" id="ticketElWidth" min="8" max="96" step="1" /></label>',
			'          <label class="ticket-ctrl" id="ticketElHeightWrap"><span>Height</span><input type="range" id="ticketElHeight" min="1" max="40" step="1" /></label>',
			'          <label class="ticket-ctrl" id="ticketElFontWrap" hidden><span>Text size</span><input type="range" id="ticketElFont" min="70" max="220" step="5" /></label>',
			'        </div>',
			'        <div class="ticket-float-actions">',
			'          <button type="button" class="ticket-reset-btn" id="ticketDeselectBtn">Deselect</button>',
			'          <button type="button" class="ticket-reset-btn ticket-remove-selected-btn" id="ticketRemoveSelectedBtn">Remove</button>',
			'        </div>',
			'      </div>',
			'    </aside>',
			'  </div>',
			'</div>',
		].join("");
		this.bindEvents();
		this.placeFieldControls();
		this.syncControls();
		this.renderTemplatePicker();
		this.scrollActiveTemplateIntoView();
		this.renderPalette();
		this.renderPreview();
		this.syncSelectedPanel();
	};

	TicketCanvasController.prototype.bindEvents = function () {
		if (this._bound || !this.root) return;
		this._bound = true;
		const self = this;
		const map = [
			["ticketAccentColor", "accent_color", "value"],
			["ticketCardColor", "card_color", "value"],
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
				self.renderPreview();
				self.renderPalette();
				self.emitChange();
			});
			el.addEventListener("change", function () { el.dispatchEvent(new Event("input")); });
		});

		const itemColor = this.root.querySelector("#ticketItemColor");
		if (itemColor) {
			itemColor.addEventListener("input", function () {
				const item = self.findById(self.selectedId);
				const color = sanitizeColor(itemColor.value, "#111827");
				if (item) {
					item.color = color;
				} else if (self.canvasSelected) {
					self.layout.text_color = color;
				} else {
					return;
				}
				self.renderPreview();
				self.emitChange();
			});
		}
		const itemImage = this.root.querySelector("#ticketItemImage");
		if (itemImage) {
			itemImage.addEventListener("change", function () {
				const file = itemImage.files && itemImage.files[0];
				const item = self.findById(self.selectedId);
				itemImage.value = "";
				if (!file || !item || item.type !== "image") return;
				const applySrc = function (src) {
					item.src = String(src || "").slice(0, 500);
					self.renderPreview();
					self.emitChange();
				};
				if (self.onUploadImage) {
					Promise.resolve(self.onUploadImage(file)).then(applySrc).catch(function () {
						self.readImageFile(file, applySrc);
					});
				} else {
					self.readImageFile(file, applySrc);
				}
			});
		}
		const itemText = this.root.querySelector("#ticketItemText");
		if (itemText) {
			itemText.addEventListener("input", function () {
				const item = self.findById(self.selectedId);
				if (!item || !self.isEditableText(item.type)) return;
				const value = String(itemText.value || "");
				if (item.type === "title") {
					self.layout.headline_override = value.slice(0, 80);
				} else if (item.type === "ticket_type") {
					self.layout.ticket_type_override = value.slice(0, 80);
				} else if (item.type === "stub") {
					item.text = value.slice(0, 120);
				} else if (item.type === "footer") {
					self.layout.custom_footer = value.slice(0, 120);
					if (value.trim() && !self.hasElement("footer")) self.addElement("footer", true);
				} else {
					item.text = value.slice(0, 120) || "Your text";
				}
				self.renderPreview();
				self.emitChange();
			});
		}
		this.root.querySelectorAll("[data-align]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				const item = self.findById(self.selectedId);
				if (!item || !self.isTextElement(item.type)) return;
				item.align = sanitizeAlign(btn.getAttribute("data-align"), item.type);
				self.renderPreview();
				self.syncSelectedPanel();
				self.emitChange();
			});
		});

		[["ticketElWidth", "w"], ["ticketElHeight", "h"]].forEach(function (pair) {
			const el = self.root.querySelector("#" + pair[0]);
			if (!el) return;
			el.addEventListener("input", function () {
				const item = self.findById(self.selectedId);
				if (!item) return;
				const key = pair[1];
				const isLine = item.type === "line" || item.type === "dashed_line";
				const min = key === "h" && isLine ? 1 : (key === "w" ? 8 : 3);
				item[key] = clampNum(Number(el.value), min, key === "w" ? 96 : 40, item[key]);
				if (item.x + item.w > 100) item.x = Math.max(0, 100 - item.w);
				if (item.y + item.h > 100) item.y = Math.max(0, 100 - item.h);
				self.applyNodeBox(item);
				self.emitChange();
			});
		});
		const fontEl = this.root.querySelector("#ticketElFont");
		if (fontEl) {
			fontEl.addEventListener("input", function () {
				const item = self.findById(self.selectedId);
				if (!item || !self.isTextElement(item.type)) return;
				item.fontScale = clampNum(Number(fontEl.value) / 100, 0.7, 2.2, 1);
				self.applyNodeBox(item);
				self.emitChange();
			});
		}
		const deselectBtn = this.root.querySelector("#ticketDeselectBtn");
		if (deselectBtn) deselectBtn.addEventListener("click", function () { self.clearSelection(); });
		const removeSelectedBtn = this.root.querySelector("#ticketRemoveSelectedBtn");
		if (removeSelectedBtn) {
			removeSelectedBtn.addEventListener("click", function () {
				const item = self.findById(self.selectedId);
				if (!item) return;
				if (item.type === "jod_logo" && !self.isPremium) return;
				self.removeElement(self.selectedId);
			});
		}

		const resetBtn = this.root.querySelector("#ticketResetLayout");
		if (resetBtn) {
			resetBtn.addEventListener("click", function () {
				const keep = {
					template_id: self.layout.template_id,
					accent_color: self.layout.accent_color,
					card_color: self.layout.card_color,
					text_color: self.layout.text_color,
					headline_override: self.layout.headline_override,
					ticket_type_override: self.layout.ticket_type_override,
					custom_footer: self.layout.custom_footer,
				};
				self.layout = cloneLayout(Object.assign({}, DEFAULT_LAYOUT, keep));
				if (!self.isPremium) self.layout.show_jod_logo = true;
				self.selectedId = null;
				self.canvasSelected = false;
				self.syncControls();
				self.renderPalette();
				self.renderPreview();
				self.syncSelectedPanel();
				self.emitChange();
			});
		}

		document.addEventListener("pointermove", function (ev) { self.onPointerMove(ev); }, true);
		document.addEventListener("pointerup", function (ev) { self.onPointerEnd(ev); }, true);
		document.addEventListener("pointercancel", function (ev) { self.onPointerEnd(ev); }, true);
		document.addEventListener("mousemove", function (ev) {
			if (!(self._drag || self._resize)) return;
			if (ev.buttons === 0) self.onPointerEnd(ev);
			else self.onPointerMove(ev);
		});
		document.addEventListener("mouseup", function (ev) { self.onPointerEnd(ev); });
		document.addEventListener("touchend", function (ev) { self.onPointerEnd(ev); });
		document.addEventListener("touchcancel", function (ev) { self.onPointerEnd(ev); });
		window.addEventListener("blur", function () { self.onPointerEnd(); });
		/* End sticky drag if the studio panel scrolls (unlocks page scroll). */
		const scrollRoot = (this.host && this.host.closest) ? this.host.closest(".dash-content") : null;
		if (scrollRoot) {
			scrollRoot.addEventListener("scroll", function () {
				if (self._drag || self._resize) self.onPointerEnd();
			}, { passive: true });
		}
		/* No non-passive touchmove preventDefault — it locked page scrolling. */

		const stage = this.root.querySelector("#ticketCanvasStage");
		if (stage) {
			stage.addEventListener("pointerdown", function (ev) {
				const node = ev.target && ev.target.closest ? ev.target.closest(".tc-node") : null;
				const removeBtn = ev.target && ev.target.closest ? ev.target.closest("[data-remove], .tc-node-remove") : null;
				const handle = ev.target && ev.target.closest ? ev.target.closest("[data-resize]") : null;
				if (removeBtn || handle) return;
				if (!node) {
					self.onPointerEnd(ev);
					const onCard = ev.target && ev.target.closest ? ev.target.closest("#ticketLiveCard") : null;
					if (onCard) self.selectCanvas();
					else self.clearSelection();
					self.clearGuides();
				}
			});
		}

		const toolsToggle = this.root.querySelector("#ticketToolsToggle");
		if (toolsToggle) {
			toolsToggle.addEventListener("click", function () {
				self.setToolsOpen(!self.toolsOpen);
			});
		}
		const toolsClose = this.root.querySelector("#ticketToolsClose");
		if (toolsClose) toolsClose.addEventListener("click", function () { self.setToolsOpen(false); });
		const toolsBackdrop = this.root.querySelector("#ticketToolsBackdrop");
		if (toolsBackdrop) toolsBackdrop.addEventListener("click", function () { self.setToolsOpen(false); });
		const templateGrid = this.root.querySelector("#ticketTemplateGrid");
		const templatePrev = this.root.querySelector("#ticketTemplatePrev");
		const templateNext = this.root.querySelector("#ticketTemplateNext");
		if (templateGrid) {
			const step = function (dir) {
				templateGrid.scrollBy({ left: dir * Math.max(160, templateGrid.clientWidth * 0.85), behavior: "smooth" });
			};
			if (templatePrev) templatePrev.addEventListener("click", function () { step(-1); });
			if (templateNext) templateNext.addEventListener("click", function () { step(1); });
			templateGrid.addEventListener("scroll", function () { self.syncTemplateCarousel(); }, { passive: true });
			window.addEventListener("resize", function () { self.syncTemplateCarousel(); });
		}

		if (window.matchMedia) {
			const drawerQuery = window.matchMedia(DRAWER_QUERY);
			const onDrawerChange = function () {
				if (!drawerQuery.matches) self.setToolsOpen(false);
				self.placeFieldControls();
				self.syncTemplateCarousel();
			};
			if (drawerQuery.addEventListener) drawerQuery.addEventListener("change", onDrawerChange);
			else if (drawerQuery.addListener) drawerQuery.addListener(onDrawerChange);
		}

		document.addEventListener("keydown", function (ev) {
			if (ev.key === "Escape" && self.toolsOpen) {
				ev.preventDefault();
				self.setToolsOpen(false);
				return;
			}
			if (!self.root || !self.selectedId) return;
			if (ev.key === "Escape") {
				ev.preventDefault();
				self.clearSelection();
			}
			if ((ev.key === "Delete" || ev.key === "Backspace") && self.selectedId) {
				const tag = (ev.target && ev.target.tagName) || "";
				if (tag === "INPUT" || tag === "TEXTAREA" || (ev.target && ev.target.isContentEditable)) return;
				const item = self.findById(self.selectedId);
				if (!item) return;
				if (item.type === "jod_logo" && !self.isPremium) return;
				ev.preventDefault();
				self.removeElement(self.selectedId);
			}
		});
	};

	TicketCanvasController.prototype.isDrawerMode = function () {
		return !!(window.matchMedia && window.matchMedia(DRAWER_QUERY).matches);
	};

	TicketCanvasController.prototype.placeFieldControls = function () {
		if (!this.root) return;
		const controls = this.root.querySelector(".ticket-studio-controls-top");
		const card = this.root.querySelector("#ticketFloatCard");
		const toolbar = this.root.querySelector(".ticket-studio-toolbar");
		if (!controls || !card || !toolbar) return;
		const target = this.isDrawerMode() ? card : toolbar;
		if (controls.parentElement !== target) target.appendChild(controls);
	};

	TicketCanvasController.prototype.syncTemplateCarousel = function () {
		if (!this.root) return;
		const grid = this.root.querySelector("#ticketTemplateGrid");
		const prev = this.root.querySelector("#ticketTemplatePrev");
		const next = this.root.querySelector("#ticketTemplateNext");
		if (!grid) return;
		const maxLeft = grid.scrollWidth - grid.clientWidth;
		if (prev) prev.disabled = grid.scrollLeft <= 2;
		if (next) next.disabled = maxLeft <= 2 || grid.scrollLeft >= maxLeft - 2;
	};

	TicketCanvasController.prototype.scrollActiveTemplateIntoView = function () {
		if (!this.root) return;
		const grid = this.root.querySelector("#ticketTemplateGrid");
		const active = grid && grid.querySelector(".ticket-template-chip.is-active");
		if (!grid || !active || grid.scrollWidth <= grid.clientWidth) return;
		grid.scrollLeft = Math.max(0, active.offsetLeft - (grid.clientWidth - active.offsetWidth) / 2);
		this.syncTemplateCarousel();
	};

	TicketCanvasController.prototype.setToolsOpen = function (open) {
		if (!this.root) return;
		const on = !!open && this.isDrawerMode();
		this.toolsOpen = on;
		const card = this.root.querySelector("#ticketFloatCard");
		const toggle = this.root.querySelector("#ticketToolsToggle");
		const backdrop = this.root.querySelector("#ticketToolsBackdrop");
		if (card) card.classList.toggle("is-open", on);
		if (toggle) {
			toggle.setAttribute("aria-expanded", String(on));
			toggle.setAttribute("aria-label", on ? "Close ticket tools" : "Open ticket tools");
		}
		if (backdrop) backdrop.hidden = !on;
		const section = this.root.closest ? this.root.closest(".tab-section") : null;
		if (section) section.classList.toggle("is-tools-open", on);
		if (on && card && (this.selectedId || this.canvasSelected)) {
			const panel = this.root.querySelector("#ticketSelectedPanel");
			if (panel && !panel.hidden) panel.scrollIntoView({ block: "nearest" });
		}
	};

	TicketCanvasController.prototype.syncShapeColorControl = function () {
		this.syncSelectedPanel();
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
		const tmpl = this.currentTemplate();
		const preview = (tmpl && tmpl.preview) || {};
		setVal("ticketAccentColor", L.accent_color || preview.accent || "#2563eb");
		setVal("ticketCardColor", L.card_color || preview.card || "#ffffff");
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
		const self = this;
		const dataHost = this.root && this.root.querySelector("#ticketElementPalette");
		const shapeHost = this.root && this.root.querySelector("#ticketShapePalette");
		if (dataHost) {
			dataHost.innerHTML = DATA_DEFS.map(function (def) {
				const onCanvas = self.hasElement(def.type);
				const locked = def.locked && !self.isPremium && def.type === "jod_logo";
				const disabled = onCanvas || locked;
				return '<button type="button" class="ticket-palette-chip' + (onCanvas ? " is-on" : "") + '" data-add-type="' + def.type + '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(def.label) + (onCanvas ? " ✓" : " +") + "</button>";
			}).join("");
			dataHost.querySelectorAll("[data-add-type]").forEach(function (btn) {
				btn.addEventListener("click", function () { self.addElement(btn.getAttribute("data-add-type")); });
			});
		}
		if (shapeHost) {
			const tools = CUSTOM_DEFS.concat(SHAPE_DEFS);
			const preview = function (type) {
				if (type === "text") return '<span class="ticket-tool-preview is-text">text</span>';
				if (type === "image") return '<span class="ticket-tool-preview is-text">image</span>';
				if (type === "line") return '<span class="ticket-tool-preview is-line" aria-hidden="true"></span>';
				if (type === "dashed_line") return '<span class="ticket-tool-preview is-dashed">---------</span>';
				if (type === "rectangle") return '<span class="ticket-tool-preview is-box" aria-hidden="true"></span>';
				if (type === "circle") return '<span class="ticket-tool-preview is-circle" aria-hidden="true"></span>';
				return "";
			};
			shapeHost.innerHTML = tools.map(function (def) {
				return '<button type="button" class="ticket-tool-sample" data-add-shape="' + def.type + '" aria-label="Add ' + escapeHtml(def.label) + '">' + preview(def.type) + "</button>";
			}).join("");
			shapeHost.querySelectorAll("[data-add-shape]").forEach(function (btn) {
				btn.addEventListener("click", function () {
					self.addElement(btn.getAttribute("data-add-shape"));
					if (self.toolsOpen) self.setToolsOpen(false);
				});
			});
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
				'<button type="button" class="ticket-template-chip' + (active ? " is-active" : "") + '" data-template-id="' + t.id + '">',
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
				const prevId = self.layout.template_id;
				self.layout.template_id = id;
				if (id === "midnight") {
					applyMidnightGeometry(self.layout.canvas_elements);
				} else if (prevId === "midnight") {
					self.layout.canvas_elements = snapDataElementsToDefault(self.layout.canvas_elements);
				}
				if (tmpl && tmpl.preview) {
					if (tmpl.preview.accent) self.layout.accent_color = tmpl.preview.accent;
					if (id === "midnight") {
						self.layout.card_color = "";
						self.layout.text_color = "";
					} else {
						if (tmpl.preview.card) self.layout.card_color = tmpl.preview.card;
						if (tmpl.preview.text) self.layout.text_color = tmpl.preview.text;
					}
				}
				self.syncControls();
				self.renderTemplatePicker();
				self.renderPreview();
				self.emitChange();
			});
		});
		this.syncTemplateCarousel();
	};

	TicketCanvasController.prototype.currentTemplate = function () {
		const id = this.layout.template_id || "classic";
		return this.templates.find(function (t) { return t.id === id; }) || this.templates[0] || FALLBACK_TEMPLATES[0];
	};

	TicketCanvasController.prototype.elementContent = function (el) {
		const type = el.type;
		const L = this.layout;
		const s = this.sample;
		const title = (L.headline_override || "").trim() || s.title;
		const ticketLabel = (L.ticket_type_override || "").trim() || s.ticketType;
		const color = sanitizeColor(el.color, "#38bdf8");
		switch (type) {
			case "poster": return '<div class="tc-poster-fill" aria-hidden="true"></div>';
			case "image": {
				const src = String(el.src || "").trim();
				if (src) return '<div class="tc-el-image"><img src="' + escapeHtml(src) + '" alt="" draggable="false" /></div>';
				return '<div class="tc-el-image is-empty">Add image</div>';
			}
			case "stub": {
				const custom = String(el.text || "").trim();
				const fallback = [ticketLabel, title].filter(Boolean).join(" ");
				return '<div class="ms-stub-text">' + escapeHtml(custom || fallback) + "</div>";
			}
			case "title": return '<div class="tc-el-title">' + escapeHtml(title) + "</div>";
			case "badge": return '<div class="tc-el-badge">E-Ticket</div>';
			case "date": {
				if (L.template_id === "midnight") {
					const raw = String(s.date || "");
					const cut = raw.lastIndexOf(",");
					const datePart = cut > 0 ? raw.slice(0, cut).trim() : raw;
					const timePart = cut > 0 ? raw.slice(cut + 1).trim() : "";
					return '<div class="ms-meta"><span>DATE</span><strong>' + escapeHtml(datePart) + "</strong>" +
						(timePart ? '<span>TIME</span><strong>' + escapeHtml(timePart) + "</strong>" : "") + "</div>";
				}
				return '<div class="tc-el-text">' + escapeHtml(s.date) + "</div>";
			}
			case "venue": return '<div class="tc-el-text muted">' + escapeHtml(s.venue) + "</div>";
			case "qty": return '<div class="tc-el-text muted">1 Ticket</div>';
			case "ticket_type": return '<div class="tc-el-strong">' + escapeHtml(ticketLabel) + "</div>";
			case "seat": {
				if (L.template_id === "midnight") {
					return '<div class="ms-meta"><span>SEAT</span><strong>' + escapeHtml(s.seat) + "</strong></div>";
				}
				return '<div class="tc-el-text muted">' + escapeHtml(s.seat) + "</div>";
			}
			case "name": {
				if (L.template_id === "midnight") {
					return '<div class="ms-name"><span>NAME</span><strong>' + escapeHtml(s.attendeeName) + "</strong></div>";
				}
				return '<div class="tc-el-row"><span>Name</span><strong>' + escapeHtml(s.attendeeName) + "</strong></div>";
			}
			case "phone": return '<div class="tc-el-row"><span>Phone</span><strong>' + escapeHtml(s.attendeePhone) + "</strong></div>";
			case "email": return '<div class="tc-el-row"><span>Email</span><strong>' + escapeHtml(s.attendeeEmail) + "</strong></div>";
			case "qr": return '<div class="tc-el-qr" aria-hidden="true"></div>';
			case "booking_id": {
				if (L.template_id === "midnight") {
					return '<div class="ms-code"><span>ID</span><strong>' + escapeHtml(s.bookingId) + "</strong></div>";
				}
				return '<div class="tc-el-text strong">BOOKING ID: #' + escapeHtml(s.bookingId) + "</div>";
			}
			case "price": return '<div class="tc-el-price"><span class="tc-price-label">Price</span><strong class="tc-price-value">' + escapeHtml(s.price) + "</strong></div>";
			case "jod_logo": return '<div class="tc-el-logo is-watermark" aria-label="JOD Events"><img src="/images/JOD%20Events%20Logo.png" alt="JOD Events" draggable="false" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\'/images/jod-logo.png\';}" /></div>';
			case "footer": {
				const note = String(L.custom_footer || "").trim();
				if (!note) return '<div class="tc-el-text muted tc-el-placeholder">Footer note</div>';
				return '<div class="tc-el-text muted">' + escapeHtml(note) + "</div>";
			}
			case "text": return '<div class="tc-el-text">' + escapeHtml(el.text || "Your text") + "</div>";
			case "line": return '<div class="tc-shape-line" style="background:' + color + ';"></div>';
			case "dashed_line": return '<div class="tc-shape-line is-dashed" style="border-top-color:' + color + ';"></div>';
			case "rectangle": return '<div class="tc-shape-rect" style="border-color:' + color + ';background:color-mix(in srgb, ' + color + ' 18%, transparent);"></div>';
			case "circle": return '<div class="tc-shape-circle" style="border-color:' + color + ';background:color-mix(in srgb, ' + color + ' 22%, transparent);"></div>';
			default: return "";
		}
	};

	TicketCanvasController.prototype.readImageFile = function (file, done) {
		const reader = new FileReader();
		reader.onload = function () {
			const src = String(reader.result || "");
			if (src.indexOf("data:image/") === 0 && src.length < 700000) done(src);
		};
		reader.readAsDataURL(file);
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
		const hasSel = !!this.selectedId;

		const isMidnight = (tmpl.id || "") === "midnight";
		stage.style.background = isMidnight ? "#12081f" : (p.bg || "#f4f6f8");
		card.className = "ticket-live-card is-canvas style-" + (tmpl.id || "classic") + (hasSel ? " has-selection" : "") + (this.canvasSelected && !hasSel ? " is-canvas-selected" : "");
		card.style.background = isMidnight
			? "linear-gradient(118deg, #4c1d95 0%, #6d28d9 46%, #7c3aed 100%)"
			: (L.card_color || p.card || "#fff");
		card.style.color = isMidnight ? "#ffffff" : (L.text_color || p.text || "#111827");
		card.style.setProperty("--ticket-accent", isMidnight ? "#c4b5fd" : accent);
		card.style.setProperty("--ticket-muted", isMidnight ? "#ddd6fe" : (p.muted || "#6b7280"));
		card.style.setProperty("--ticket-stage", isMidnight ? "#12081f" : (p.bg || "#f4f6f8"));

		/* Keep footer note off the venue on every paint (old saved layouts). */
		if (!isMidnight) repairFooterPlacement(L.canvas_elements);
		if (isMidnight) {
			(L.canvas_elements || []).forEach(function (el) {
				const geo = el && MIDNIGHT_GEOMETRY[el.type];
				if (!geo || ["phone", "email", "price", "venue"].indexOf(el.type) < 0) return;
				if (el.w >= 60) {
					el.x = geo.x;
					el.y = geo.y;
					el.w = geo.w;
					el.h = geo.h;
				}
			});
		}

		const face = isMidnight
			? '<div class="ms-waves"></div><div class="ms-hole"></div><div class="ms-notch is-top"></div><div class="ms-notch is-bot"></div><div class="ms-perf"></div>'
			: '<div class="tlc-accent"></div>';
		const bits = [
			/* Face clips accents to rounded corners; nodes stay above so handles can overflow. */
			'<div class="tlc-face" aria-hidden="true">' + face + "</div>",
			'<div class="tc-guides" id="ticketGuides" aria-hidden="true"></div>',
		];
		(L.canvas_elements || []).forEach(function (el) {
			const locked = el.type === "jod_logo" && !self.isPremium;
			const selected = self.selectedId === el.id;
			const def = DEF_BY_TYPE[el.type] || {};
			const isLine = el.type === "line" || el.type === "dashed_line";
			const scale = Number.isFinite(Number(el.fontScale)) ? el.fontScale : 1;
			const align = self.isTextElement(el.type) ? sanitizeAlign(el.align, el.type) : "";
			const ownColor = optionalColor(el.color);
			const handles = isLine
				? '<span class="tc-handle tc-handle-e" data-resize="e" title="Extend"></span><span class="tc-handle tc-handle-w" data-resize="w" title="Extend"></span><span class="tc-handle tc-handle-s" data-resize="s" title="Thickness"></span>'
				: '<span class="tc-handle tc-handle-nw" data-resize="nw"></span><span class="tc-handle tc-handle-ne" data-resize="ne"></span><span class="tc-handle tc-handle-sw" data-resize="sw"></span><span class="tc-handle tc-handle-se" data-resize="se"></span><span class="tc-handle tc-handle-n" data-resize="n"></span><span class="tc-handle tc-handle-s" data-resize="s"></span><span class="tc-handle tc-handle-e" data-resize="e"></span><span class="tc-handle tc-handle-w" data-resize="w"></span>';
			/* Always mount chrome; CSS shows it only on .is-selected (selection updates via class, not full re-render). */
			const removeCtrl = locked
				? ""
				: '<button type="button" class="tc-node-remove" data-remove title="Delete" aria-label="Delete" tabindex="-1">&times;</button>';
			bits.push(
				'<div class="tc-node' +
					(selected ? " is-selected" : "") +
					(hasSel && !selected ? " is-dimmed" : "") +
					(locked ? " is-locked" : "") +
					(def.shape ? " is-shape" : "") +
					(isLine ? " is-line" : "") +
					(align ? " is-align-" + align : "") +
					'" data-id="' + escapeHtml(el.id) + '" data-type="' + el.type +
					'" style="left:' + el.x + "%;top:" + el.y + "%;width:" + el.w + "%;height:" + el.h +
					"%;--tc-font-scale:" + scale + ";" + (ownColor ? "color:" + ownColor + ";" : "") + '">' +
				'<div class="tc-node-body">' + self.elementContent(el) + "</div>" +
				removeCtrl +
				'<div class="tc-handles" aria-hidden="true">' + handles + "</div>" +
				"</div>"
			);
		});
		card.innerHTML = bits.join("");
		this.syncSelectedPanel();

		card.querySelectorAll(".tc-node").forEach(function (node) {
			node.addEventListener("pointerdown", function (ev) {
				const removeBtn = ev.target && ev.target.closest ? ev.target.closest("[data-remove], .tc-node-remove") : null;
				if (removeBtn) {
					ev.preventDefault();
					ev.stopPropagation();
					self.removeElement(node.getAttribute("data-id"));
					return;
				}
				const handle = ev.target && ev.target.closest ? ev.target.closest("[data-resize]") : null;
				if (handle) {
					if (ev.cancelable) ev.preventDefault();
					ev.stopPropagation();
					self.onResizeStart(ev, node, handle.getAttribute("data-resize"));
					return;
				}
				/* Do not preventDefault on press — that locked panel scrolling. */
				ev.stopPropagation();
				self.onDragStart(ev, node);
			});
		});
	};

	TicketCanvasController.prototype.clearGuides = function () {
		const host = this.root && this.root.querySelector("#ticketGuides");
		if (host) host.innerHTML = "";
	};

	TicketCanvasController.prototype.showGuides = function (vLines, hLines) {
		const host = this.root && this.root.querySelector("#ticketGuides");
		if (!host) return;
		const bits = [];
		(vLines || []).forEach(function (x) {
			bits.push('<div class="tc-guide is-v' + (Math.abs(x - 50) < 0.01 ? " is-center" : "") + '" style="left:' + x + '%;"></div>');
		});
		(hLines || []).forEach(function (y) {
			bits.push('<div class="tc-guide is-h' + (Math.abs(y - 50) < 0.01 ? " is-center" : "") + '" style="top:' + y + '%;"></div>');
		});
		host.innerHTML = bits.join("");
	};

	TicketCanvasController.prototype.snapBox = function (box, ignoreId) {
		const SNAP = 1.1;
		const others = (this.layout.canvas_elements || []).filter(function (e) { return e && e.id !== ignoreId; });
		const xTargets = [0, 50, 100];
		const yTargets = [0, 50, 100];
		others.forEach(function (e) {
			xTargets.push(e.x, e.x + e.w / 2, e.x + e.w);
			yTargets.push(e.y, e.y + e.h / 2, e.y + e.h);
		});
		const left = box.x;
		const right = box.x + box.w;
		const cx = box.x + box.w / 2;
		const top = box.y;
		const bottom = box.y + box.h;
		const cy = box.y + box.h / 2;
		let bestDx = null;
		let bestDy = null;
		const vGuides = [];
		const hGuides = [];

		xTargets.forEach(function (t) {
			[[left, 0], [cx, box.w / 2], [right, box.w]].forEach(function (pair) {
				const d = t - pair[0];
				if (Math.abs(d) <= SNAP && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
					bestDx = d;
				}
			});
		});
		yTargets.forEach(function (t) {
			[[top, 0], [cy, box.h / 2], [bottom, box.h]].forEach(function (pair) {
				const d = t - pair[0];
				if (Math.abs(d) <= SNAP && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
					bestDy = d;
				}
			});
		});

		if (bestDx !== null) box.x = clampNum(box.x + bestDx, 0, 100 - box.w, box.x);
		if (bestDy !== null) box.y = clampNum(box.y + bestDy, 0, 100 - box.h, box.y);

		const nLeft = box.x;
		const nRight = box.x + box.w;
		const nCx = box.x + box.w / 2;
		const nTop = box.y;
		const nBottom = box.y + box.h;
		const nCy = box.y + box.h / 2;
		xTargets.forEach(function (t) {
			if (Math.abs(nLeft - t) < 0.2 || Math.abs(nCx - t) < 0.2 || Math.abs(nRight - t) < 0.2) {
				if (vGuides.indexOf(t) < 0) vGuides.push(t);
			}
		});
		yTargets.forEach(function (t) {
			if (Math.abs(nTop - t) < 0.2 || Math.abs(nCy - t) < 0.2 || Math.abs(nBottom - t) < 0.2) {
				if (hGuides.indexOf(t) < 0) hGuides.push(t);
			}
		});
		this.showGuides(vGuides, hGuides);
		return box;
	};

	TicketCanvasController.prototype.releasePointer = function () {
		if (this._pointerId == null) return;
		try {
			const el = this._pointerTarget;
			if (el && el.releasePointerCapture) el.releasePointerCapture(this._pointerId);
		} catch (err) { /* ignore */ }
		this._pointerId = null;
		this._pointerTarget = null;
	};

	TicketCanvasController.prototype.capturePointer = function (ev, el) {
		if (!ev || ev.pointerId == null || !el || !el.setPointerCapture) return;
		try {
			el.setPointerCapture(ev.pointerId);
			this._pointerId = ev.pointerId;
			this._pointerTarget = el;
		} catch (err) { /* ignore */ }
	};

	TicketCanvasController.prototype.onDragStart = function (point, node) {
		if (point.stopPropagation) point.stopPropagation();
		this.releasePointer();
		this._drag = null;
		this._resize = null;
		this._didDrag = false;
		this.clearGuides();
		const id = node.getAttribute("data-id");
		const item = this.findById(id);
		const card = this.root.querySelector("#ticketLiveCard");
		if (!item || !card) return;
		const already = this.selectedId === id;
		this.selectedId = id;
		this.canvasSelected = false;
		this._wasAlreadySelected = already;
		const rect = card.getBoundingClientRect();
		this._drag = {
			id: id,
			active: false,
			startX: point.clientX,
			startY: point.clientY,
			origX: item.x,
			origY: item.y,
			cardW: Math.max(1, rect.width),
			cardH: Math.max(1, rect.height),
		};
		this.capturePointer(point, node);
		this.updateSelectionStyles();
	};

	TicketCanvasController.prototype.onResizeStart = function (point, node, edge) {
		if (point.cancelable) point.preventDefault();
		if (point.stopPropagation) point.stopPropagation();
		this.releasePointer();
		this._drag = null;
		this._resize = null;
		this._didDrag = false;
		this.clearGuides();
		const id = node.getAttribute("data-id");
		const item = this.findById(id);
		const card = this.root.querySelector("#ticketLiveCard");
		if (!item || !card || !edge) return;
		this.selectedId = id;
		this._wasAlreadySelected = true;
		const rect = card.getBoundingClientRect();
		this._resize = {
			id: id,
			edge: edge,
			startX: point.clientX,
			startY: point.clientY,
			origX: item.x,
			origY: item.y,
			origW: item.w,
			origH: item.h,
			cardW: Math.max(1, rect.width),
			cardH: Math.max(1, rect.height),
		};
		this.capturePointer(point, node);
		this.updateSelectionStyles();
	};

	TicketCanvasController.prototype.onPointerMove = function (point) {
		if (!point) return;
		if (typeof point.buttons === "number" && point.buttons === 0 && (this._drag || this._resize)) {
			this.onPointerEnd(point);
			return;
		}
		if (this._resize) {
			const dx = ((point.clientX - this._resize.startX) / this._resize.cardW) * 100;
			const dy = ((point.clientY - this._resize.startY) / this._resize.cardH) * 100;
			if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) this._didDrag = true;
			const item = this.findById(this._resize.id);
			if (!item) return;
			const edge = this._resize.edge;
			const isLine = item.type === "line" || item.type === "dashed_line";
			const minW = 8;
			const minH = isLine ? 1 : 3;
			let w = this._resize.origW;
			let h = this._resize.origH;
			if (edge.indexOf("e") >= 0) w = this._resize.origW + dx;
			if (edge.indexOf("s") >= 0) h = this._resize.origH + dy;
			if (edge.indexOf("w") >= 0) w = this._resize.origW - dx;
			if (edge.indexOf("n") >= 0) h = this._resize.origH - dy;
			w = clampNum(w, minW, 96, item.w);
			h = clampNum(h, minH, 40, item.h);
			let x = this._resize.origX;
			let y = this._resize.origY;
			if (edge.indexOf("w") >= 0) x = this._resize.origX + (this._resize.origW - w);
			if (edge.indexOf("n") >= 0) y = this._resize.origY + (this._resize.origH - h);
			x = clampNum(x, 0, 100 - w, item.x);
			y = clampNum(y, 0, 100 - h, item.y);
			const snapped = this.snapBox({ x: x, y: y, w: w, h: h }, item.id);
			item.x = snapped.x;
			item.y = snapped.y;
			item.w = snapped.w;
			item.h = snapped.h;
			this.applyNodeBox(item);
			this.syncSelectedPanel();
			return;
		}
		if (!this._drag) return;
		const mdx = ((point.clientX - this._drag.startX) / this._drag.cardW) * 100;
		const mdy = ((point.clientY - this._drag.startY) / this._drag.cardH) * 100;
		if (!this._drag.active) {
			if (Math.abs(mdx) < 0.45 && Math.abs(mdy) < 0.45) return;
			this._drag.active = true;
			this._didDrag = true;
			if (point.cancelable) point.preventDefault();
		}
		const dragItem = this.findById(this._drag.id);
		if (!dragItem) return;
		let nx = clampNum(this._drag.origX + mdx, 0, 100 - dragItem.w, dragItem.x);
		let ny = clampNum(this._drag.origY + mdy, 0, 100 - dragItem.h, dragItem.y);
		const snappedMove = this.snapBox({ x: nx, y: ny, w: dragItem.w, h: dragItem.h }, dragItem.id);
		dragItem.x = snappedMove.x;
		dragItem.y = snappedMove.y;
		this.applyNodeBox(dragItem);
	};

	TicketCanvasController.prototype.onPointerEnd = function () {
		const hadResize = !!this._resize;
		const hadDrag = !!this._drag;
		if (!hadResize && !hadDrag) {
			this.clearGuides();
			return;
		}
		const moved = this._didDrag || (this._drag && this._drag.active);
		const id = (this._drag && this._drag.id) || (this._resize && this._resize.id);
		const already = this._wasAlreadySelected;
		this.releasePointer();
		this._resize = null;
		this._drag = null;
		this._didDrag = false;
		this._wasAlreadySelected = false;
		this.clearGuides();
		if (moved) {
			this.emitChange();
			return;
		}
		if (hadDrag && already && this.selectedId === id) {
			this.clearSelection();
		}
	};

	global.JodTicketCanvas = {
		DEFAULT_LAYOUT: DEFAULT_LAYOUT,
		FALLBACK_TEMPLATES: FALLBACK_TEMPLATES,
		ELEMENT_DEFS: ELEMENT_DEFS,
		SHAPE_DEFS: SHAPE_DEFS,
		cloneLayout: cloneLayout,
		create: function (opts) {
			return new TicketCanvasController(opts || {});
		},
	};
})(typeof window !== "undefined" ? window : globalThis);
