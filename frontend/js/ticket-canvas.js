/**
 * Host ticket design canvas. New tickets start blank in landscape.
 * The JOD Events logo is mandatory on every plan and switches between the
 * black and white wordmark from the ticket background.
 * Saved preset layouts (canvas_mode is not "custom") keep their published look
 * until the host edits and clicks Update tickets.
 */
(function (global) {
	"use strict";

	/* Must match the drawer breakpoint in organizer-dashboard.css */
	const DRAWER_QUERY = "(max-width: 960px)";

	const FALLBACK_TEMPLATES = [
		{ id: "classic", name: "Classic Clean", tagline: "Bright white card", preview: { bg: "#f4f6f8", card: "#ffffff", accent: "#2563eb", text: "#111827", muted: "#6b7280" } },
		{ id: "midnight", name: "Midnight Stage", tagline: "Concert stub ticket", preview: { bg: "#1a1033", card: "#5b21b6", accent: "#c4b5fd", text: "#ffffff", muted: "#ddd6fe" } },
		{ id: "sunset", name: "Sunset Glow", tagline: "Sunset concert ticket", preview: { bg: "#2a120c", card: "#ff7a1a", accent: "#e10600", text: "#ffffff", muted: "#fff7ed" } },
		{ id: "concert", name: "Concert Stripe", tagline: "Bold side stripe", preview: { bg: "#fafafa", card: "#ffffff", accent: "#dc2626", text: "#0f172a", muted: "#64748b" } },
		{ id: "minimal", name: "Paper Minimal", tagline: "Quiet editorial", preview: { bg: "#f8fafc", card: "#ffffff", accent: "#0f172a", text: "#0f172a", muted: "#64748b" } },
		{ id: "festival", name: "Festival Teal", tagline: "Outdoor teal frame", preview: { bg: "#ecfdf5", card: "#ffffff", accent: "#0d9488", text: "#134e4a", muted: "#5eead4" } },
		{ id: "vip_gold", name: "VIP Gold", tagline: "Gold details, QR on the black side", preview: { bg: "#1c1917", card: "#e6c15a", accent: "#d4a017", text: "#111111", muted: "#f6e27a" } },
		{ id: "neon_night", name: "Neon Night", tagline: "Electric cyan", preview: { bg: "#020617", card: "#0f172a", accent: "#22d3ee", text: "#e2e8f0", muted: "#64748b" } },
	];

	const DATA_DEFS = [
		{ type: "poster", label: "Poster", flag: null, w: 22, h: 18, locked: false, shape: false },
		{ type: "title", label: "Event title", flag: null, w: 58, h: 8, locked: false, shape: false },
		{ type: "badge", label: "E-Ticket badge", flag: null, w: 18, h: 4, locked: false, shape: false },
		{ type: "date", label: "Event date", flag: "show_date", w: 58, h: 5, locked: false, shape: false },
		{ type: "time", label: "Event time", flag: "show_time", w: 40, h: 5, locked: false, shape: false },
		{ type: "venue", label: "Venue", flag: "show_venue", w: 70, h: 8, locked: false, shape: false },
		{ type: "qty", label: "Ticket quantity", flag: "show_qty", w: 30, h: 4, locked: false, shape: false },
		{ type: "ticket_type", label: "Ticket type", flag: "show_ticket_type", w: 55, h: 6, locked: false, shape: false },
		{ type: "seat", label: "Seat", flag: "show_seat", w: 55, h: 5, locked: false, shape: false },
		{ type: "name", label: "Name", flag: "show_attendee_name", w: 70, h: 5, locked: false, shape: false },
		{ type: "phone", label: "Phone number", flag: "show_attendee_phone", w: 70, h: 5, locked: false, shape: false },
		{ type: "email", label: "Email", flag: "show_attendee_email", w: 70, h: 5, locked: false, shape: false },
		{ type: "qr", label: "QR code", flag: "show_qr", w: 34, h: 22, locked: false, shape: false },
		{ type: "booking_id", label: "Booking ID", flag: null, w: 55, h: 4, locked: false, shape: false },
		{ type: "ticket_id", label: "Ticket ID", flag: "show_ticket_id", w: 50, h: 4, locked: false, shape: false },
		{ type: "price", label: "Ticket price", flag: "show_price", w: 40, h: 5, locked: false, shape: false },
		{ type: "organizer", label: "Organizer name", flag: "show_organizer", w: 50, h: 5, locked: false, shape: false },
		{ type: "organizer_logo", label: "Organizer logo", flag: null, w: 22, h: 12, locked: false, shape: false },
		{ type: "jod_logo", label: "JOD Events logo", flag: "show_jod_logo", w: 32, h: 14, locked: true, shape: false },
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
	const LAYOUT_VERSION = 10;
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
		ticket_type: { x: 4, y: 4, w: 48, h: 9 },
		title: { x: 4, y: 13, w: 46, h: 7 },
		name: { x: 4, y: 21, w: 40, h: 12 },
		booking_id: { x: 64, y: 4, w: 22, h: 10 },
		date: { x: 64, y: 56, w: 22, h: 16 },
		jod_logo: { x: 4, y: 78, w: 16, h: 14 },
		qr: { x: 67, y: 16, w: 14, h: 36 },
		stub: { x: 90, y: 6, w: 8, h: 84 },
		phone: { x: 4, y: 43, w: 42, h: 7 },
		email: { x: 4, y: 35, w: 42, h: 7 },
		price: { x: 64, y: 74, w: 22, h: 8 },
		venue: { x: 4, y: 52, w: 40, h: 8 },
		seat: { x: 64, y: 84, w: 22, h: 7 },
	};

	/* Wide sunset ticket: photo + white details on the left, QR on the right stub. */
	const SUNSET_GEOMETRY = {
		ticket_type: { x: 4, y: 7, w: 66, h: 14 },
		title: { x: 4, y: 24, w: 66, h: 8 },
		name: { x: 2, y: 63, w: 22, h: 15 },
		email: { x: 25, y: 63, w: 24, h: 15 },
		phone: { x: 50, y: 63, w: 22, h: 15 },
		date: { x: 2, y: 80, w: 34, h: 16 },
		price: { x: 42, y: 80, w: 20, h: 16 },
		venue: { x: 64, y: 80, w: 8, h: 16 },
		seat: { x: 64, y: 80, w: 8, h: 16 },
		qr: { x: 79, y: 6, w: 16, h: 46 },
		booking_id: { x: 76, y: 54, w: 22, h: 14 },
		jod_logo: { x: 80, y: 84, w: 14, h: 12 },
		stub: { x: 74, y: 8, w: 5, h: 84 },
	};

	/* Gold left: title on top, name column, date and venue column, logo at the bottom. Black right: QR then booking ID. */
	const VIP_GEOMETRY = {
		ticket_type: { x: 0, y: 6, w: 68, h: 14, align: "center" },
		title: { x: 0, y: 20, w: 68, h: 10, align: "center" },
		name: { x: 6, y: 42, w: 26, h: 9, align: "left" },
		email: { x: 6, y: 52, w: 28, h: 9, align: "left" },
		phone: { x: 6, y: 62, w: 28, h: 9, align: "left" },
		date: { x: 36, y: 42, w: 30, h: 10, align: "left" },
		venue: { x: 36, y: 52, w: 30, h: 24, align: "left" },
		price: { x: 6, y: 74, w: 22, h: 8, align: "left" },
		seat: { x: 48, y: 78, w: 18, h: 8, align: "left" },
		jod_logo: { x: 26, y: 86, w: 16, h: 12 },
		qr: { x: 77, y: 12, w: 12, h: 40 },
		booking_id: { x: 70, y: 56, w: 26, h: 12, align: "center" },
		stub: { x: 92, y: 8, w: 6, h: 84 },
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
		sunset_hero_src: "",
		canvas_elements: DEFAULT_ELEMENTS.map(function (e) { return Object.assign({}, e); }),
	};

	let _shapeSeq = 1;

	function clampNum(v, min, max, fallback) {
		const n = Number(v);
		if (!Number.isFinite(n)) return fallback;
		return Math.max(min, Math.min(max, n));
	}

	/* Point sizes shown in the text-size list. 12 is the designed size of a normal field. */
	var FONT_STEPS = [6, 8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80, 96];

	function nearestFontStep(px) {
		var n = Number(px);
		if (!Number.isFinite(n)) return 12;
		var best = FONT_STEPS[0];
		var bestDiff = Math.abs(n - best);
		for (var i = 1; i < FONT_STEPS.length; i++) {
			var diff = Math.abs(n - FONT_STEPS[i]);
			if (diff < bestDiff) {
				best = FONT_STEPS[i];
				bestDiff = diff;
			}
		}
		return best;
	}

	function defaultFontPx(type, templateId) {
		if (templateId === "sunset" && type === "ticket_type") return 28;
		if (templateId === "sunset" && type === "title") return 10;
		if (templateId === "vip_gold" && type === "ticket_type") return 28;
		if (templateId === "vip_gold" && type === "title") return 12;
		if (templateId === "midnight" && type === "name") return 18;
		if (templateId === "midnight" && type === "ticket_type") return 16;
		if (templateId === "midnight" && type === "title") return 12;
		if (type === "ticket_type" || type === "title" || type === "name") return 16;
		if (type === "stub" || type === "badge") return 10;
		return 12;
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

	function sanitizeMediaSrc(src) {
		const v = String(src || "").trim();
		if (/^https?:\/\//.test(v) || v.charAt(0) === "/") return v.slice(0, 800);
		if (v.indexOf("data:image/") === 0 && v.length < 700000) return v;
		return "";
	}

	function ticketApiOrigin() {
		let origin = "";
		if (window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			origin = window.JodConfig.getApiOrigin();
		} else if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			origin = window.JodHealth.getApiBaseUrl();
		} else if (window.JodAuth && window.JodAuth.API_BASE) {
			origin = window.JodAuth.API_BASE;
		}
		return String(origin || "").replace(/\/$/, "");
	}

	/* Relative /api/media links must point at the API, or the ticket shows a broken image. */
	function resolveTicketMediaUrl(src) {
		const v = sanitizeMediaSrc(src);
		if (!v || v.indexOf("data:image/") === 0 || /^https?:\/\//.test(v)) return v;
		const origin = ticketApiOrigin();
		if (origin && (v.indexOf("/api/media") === 0 || v.indexOf("/uploads/") === 0)) return origin + v;
		return v;
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
				x: clampNum(e.x, 0, 98, 4),
				y: clampNum(e.y, 0, 98, 4),
				w: clampNum(e.w, 4, 100, 40),
				h: clampNum(e.h, shape && (type === "line" || type === "dashed_line") ? 1 : 2, 100, 6),
			};
			const savedColor = optionalColor(e.color);
			if (savedColor) item.color = savedColor;
			else if (shape) item.color = sanitizeColor(e.color, DEF_BY_TYPE[type].color);
			if (type === "text" || type === "stub" || ["title", "date", "time", "venue", "qty", "ticket_type", "seat", "name", "phone", "email", "booking_id", "price", "footer", "badge", "organizer", "ticket_id"].indexOf(type) >= 0) {
				item.align = sanitizeAlign(e.align, type);
			}
			if (type === "text") item.text = String(e.text || "Your text").trim().slice(0, 120) || "Your text";
			if (type === "stub") item.text = String(e.text || "").trim().slice(0, 120);
			if (["Arial", "Georgia", "Courier New", "Times New Roman", "Verdana"].indexOf(e.fontFamily) >= 0) item.fontFamily = e.fontFamily;
			if (["400", "500", "600", "700", "800"].indexOf(String(e.fontWeight || "")) >= 0) item.fontWeight = String(e.fontWeight);
			if (Number.isFinite(Number(e.rotation))) item.rotation = clampNum(Number(e.rotation), -180, 180, 0);
			if (type === "image" || type === "organizer_logo") {
				const src = String(e.src || "").trim();
				if (/^https?:\/\//.test(src) || src.charAt(0) === "/") item.src = src.slice(0, 800);
				else if (src.indexOf("data:image/") === 0 && src.length < 700000) item.src = src;
			}
			const fs = Number(e.fontScale);
			if (Number.isFinite(fs)) item.fontScale = clampNum(fs, 0.4, 8, 1);
			const fontSize = Number(e.fontSize);
			if (FONT_STEPS.indexOf(fontSize) >= 0) item.fontSize = fontSize;
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

	const LOGO_BLACK = "/images/JOD%20Events%20Logo.png";
	const LOGO_WHITE = "/images/JOD%20Events%20Logo%20White.png";

	function relativeLuminance(hex) {
		const raw = String(hex || "#ffffff").replace("#", "");
		const full = raw.length === 3 ? raw.split("").map(function (ch) { return ch + ch; }).join("") : raw;
		const n = parseInt(full, 16);
		if (!Number.isFinite(n) || full.length !== 6) return 1;
		function channel(v) {
			const c = v / 255;
			return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		}
		return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
	}

	function clampBox(el) {
		if (!el) return;
		el.w = clampNum(el.w, el.type === "jod_logo" ? 12 : 4, 100, el.w || 20);
		el.h = clampNum(el.h, el.type === "jod_logo" ? 6 : (el.type === "line" || el.type === "dashed_line" ? 1 : 2), el.type === "jod_logo" ? 28 : 100, el.h || 8);
		if (el.x + el.w > 100) el.x = Math.max(0, 100 - el.w);
		if (el.y + el.h > 100) el.y = Math.max(0, 100 - el.h);
		el.x = clampNum(el.x, 0, 100, 0);
		el.y = clampNum(el.y, 0, 100, 0);
	}

	function ensureLogoElement(layout) {
		if (!layout) return;
		layout.show_jod_logo = true;
		const list = layout.canvas_elements || (layout.canvas_elements = []);
		let logo = list.find(function (el) { return el && el.type === "jod_logo"; });
		if (!logo) {
			logo = { id: "jod_logo", type: "jod_logo", x: 4, y: 78, w: 32, h: 14 };
			list.push(logo);
		}
		clampBox(logo);
	}

	function landscapeReferenceElements() {
		return [
			{ id: "ticket_type", type: "ticket_type", x: 3, y: 8, w: 15, h: 34, fontSize: 11, fontWeight: "800", align: "left" },
			{ id: "title", type: "title", x: 16, y: 18, w: 52, h: 52, fontSize: 32, fontWeight: "800", align: "center" },
			{ id: "date", type: "date", x: 3, y: 76, w: 22, h: 16, fontSize: 11, fontWeight: "700", align: "left" },
			{ id: "time", type: "time", x: 26, y: 74, w: 40, h: 18, fontSize: 16, fontWeight: "800", align: "center" },
			{ id: "qr", type: "qr", x: 89, y: 14, w: 8, h: 68 },
			{ id: "jod_logo", type: "jod_logo", x: 72, y: 68, w: 15, h: 24 },
		];
	}

	function portraitReferenceElements() {
		return [
			{ id: "booking_id", type: "booking_id", x: 10, y: 7, w: 80, h: 12, fontSize: 16, fontWeight: "800", align: "center" },
			{ id: "title", type: "title", x: 8, y: 22, w: 84, h: 14, fontSize: 22, fontWeight: "800", align: "center" },
			{ id: "date", type: "date", x: 8, y: 40, w: 40, h: 14, fontSize: 16, fontWeight: "800", align: "left" },
			{ id: "time", type: "time", x: 52, y: 40, w: 40, h: 14, fontSize: 16, fontWeight: "800", align: "left" },
			{ id: "venue", type: "venue", x: 8, y: 58, w: 84, h: 12, fontSize: 16, fontWeight: "800", align: "left" },
			{ id: "qr", type: "qr", x: 28, y: 72, w: 44, h: 16 },
			{ id: "jod_logo", type: "jod_logo", x: 18, y: 90, w: 64, h: 8 },
		];
	}

	function eticketElements() {
		return [
			{ id: "poster", type: "poster", x: 5, y: 3, w: 19, h: 14 },
			{ id: "title", type: "title", x: 28, y: 3, w: 60, h: 6, fontSize: 18, fontWeight: "800", align: "left" },
			{ id: "date", type: "date", x: 28, y: 9.5, w: 60, h: 4, fontSize: 12, fontWeight: "700", align: "left" },
			{ id: "venue", type: "venue", x: 28, y: 13.5, w: 60, h: 7, fontSize: 10, align: "left" },
			{ id: "stub", type: "stub", x: 92, y: 3, w: 5, h: 16, text: "E-TICKET", fontSize: 8, color: "#9ca3af" },
			{ id: "qty", type: "qty", x: 30, y: 27, w: 40, h: 3.5, fontSize: 10, align: "center" },
			{ id: "ticket_type", type: "ticket_type", x: 15, y: 30.5, w: 70, h: 5, fontSize: 21, fontWeight: "800", align: "center" },
			{ id: "seat", type: "seat", x: 20, y: 36, w: 60, h: 3.5, fontSize: 12, align: "center" },
			{ id: "name", type: "name", x: 22, y: 41, w: 56, h: 4, fontSize: 10, align: "left" },
			{ id: "phone", type: "phone", x: 22, y: 45, w: 56, h: 4, fontSize: 10, align: "left" },
			{ id: "email", type: "email", x: 22, y: 49, w: 56, h: 4, fontSize: 10, align: "left" },
			{ id: "qr", type: "qr", x: 33, y: 54, w: 34, h: 21 },
			{ id: "booking_id", type: "booking_id", x: 15, y: 77, w: 70, h: 4, fontSize: 12, fontWeight: "800", align: "center" },
			{ id: "perforation", type: "dashed_line", x: 5, y: 82, w: 90, h: 1, color: "#cbd5e1" },
			{ id: "price", type: "price", x: 6, y: 85, w: 88, h: 5, fontSize: 14, fontWeight: "800" },
			{ id: "jod_logo", type: "jod_logo", x: 35, y: 92, w: 30, h: 7 },
		];
	}

	/* Default start design: the portrait e-ticket guests see on their confirmation page. */
	function eticketLayout() {
		return Object.assign(referenceLayout("portrait"), {
			card_style: "eticket",
			accent_color: "#cbd5e1",
			card_color: "#ffffff",
			text_color: "#111827",
			show_venue: true,
			show_qty: true,
			show_ticket_type: true,
			show_seat: true,
			show_price: true,
			show_attendee_name: true,
			show_attendee_phone: true,
			show_attendee_email: true,
			canvas_elements: eticketElements(),
		});
	}

	function referenceLayout(orient) {
		const portrait = orient === "portrait";
		return {
			template_id: "classic",
			canvas_mode: "custom",
			orientation: portrait ? "portrait" : "landscape",
			layout_version: 11,
			frame: "reference",
			card_style: "",
			accent_color: portrait ? "#5b9dff" : "#ff8fb3",
			card_color: portrait ? "#ffffff" : "#fff7f5",
			text_color: "#1a1a1a",
			background_image: "",
			show_jod_logo: true,
			show_venue: portrait,
			show_date: true,
			show_time: true,
			show_price: false,
			show_seat: false,
			show_qr: true,
			show_qty: false,
			show_ticket_type: !portrait,
			show_ticket_id: false,
			show_organizer: false,
			show_attendee_name: false,
			show_attendee_email: false,
			show_attendee_phone: false,
			custom_footer: "",
			headline_override: "",
			ticket_type_override: "",
			sunset_hero_src: "",
			canvas_elements: portrait ? portraitReferenceElements() : landscapeReferenceElements(),
		};
	}

	function blankCustomLayout() {
		return eticketLayout();
	}

	function cloneLayout(src) {
		const savedElements = src && Array.isArray(src.canvas_elements) && src.canvas_elements.length;
		const version = Number(src && src.layout_version) || 0;
		const mode = src && src.canvas_mode;
		const extraKeys = src ? Object.keys(src).filter(function (key) { return key !== "template_id"; }) : [];
		const fresh = !src || (!savedElements && mode !== "legacy" && mode !== "custom" && version < 11 && !extraKeys.length);
		if (fresh) return blankCustomLayout();
		if (mode === "custom" || version >= 11) {
			const onlyLogo = !!(savedElements && src.canvas_elements.length === 1 && src.canvas_elements[0] && src.canvas_elements[0].type === "jod_logo");
			const orient = src && src.orientation === "portrait" ? "portrait" : "landscape";
			if (src && src.frame === "reference") {
				return src.card_style === "eticket" ? eticketLayout() : referenceLayout(orient);
			}
			if (onlyLogo || !savedElements) return blankCustomLayout();
			const base = referenceLayout("landscape");
			const out = Object.assign({}, base, src || {});
			out.canvas_mode = "custom";
			out.frame = "edited";
			out.card_style = src && src.card_style === "eticket" ? "eticket" : "";
			out.orientation = orient;
			out.layout_version = Math.max(11, version || 11);
			out.card_color = optionalColor(src && src.card_color) || "#ffffff";
			out.text_color = optionalColor(src && src.text_color) || "#111111";
			out.accent_color = optionalColor(src && src.accent_color) || "#2563eb";
			out.background_image = sanitizeMediaSrc(src && src.background_image) || "";
			out.sunset_hero_src = sanitizeMediaSrc(src && src.sunset_hero_src);
			out.canvas_elements = cloneElements(savedElements ? src.canvas_elements : base.canvas_elements);
			out.canvas_elements.forEach(clampBox);
			ensureLogoElement(out);
			return out;
		}
		const out = Object.assign({}, DEFAULT_LAYOUT, src || {});
		out.canvas_mode = "legacy";
		out.card_color = optionalColor(src && src.card_color);
		out.text_color = optionalColor(src && src.text_color);
		out.sunset_hero_src = sanitizeMediaSrc(src && src.sunset_hero_src);
		out.canvas_elements = cloneElements(savedElements ? src.canvas_elements : DEFAULT_ELEMENTS);
		out.layout_version = version || LAYOUT_VERSION;
		if (!savedElements) repairFooterPlacement(out.canvas_elements);
		ensureLogoElement(out);
		return out;
	}

	function applyNamedGeometry(elements, geometry) {
		const list = elements || [];
		if (geometry.stub && !list.some(function (el) { return el && el.type === "stub"; })) {
			const geo = geometry.stub;
			list.push({ id: "stub", type: "stub", x: geo.x, y: geo.y, w: geo.w, h: geo.h, text: "" });
		}
		list.forEach(function (el) {
			const geo = el && geometry[el.type];
			if (!geo) return;
			el.x = geo.x;
			el.y = geo.y;
			el.w = geo.w;
			el.h = geo.h;
			if (geo.align) el.align = geo.align;
		});
	}

	function applyMidnightGeometry(elements) {
		applyNamedGeometry(elements, MIDNIGHT_GEOMETRY);
	}

	function applySunsetGeometry(elements) {
		applyNamedGeometry(elements, SUNSET_GEOMETRY);
	}

	function applyVipGeometry(elements) {
		applyNamedGeometry(elements, VIP_GEOMETRY);
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
			date: "Sat, Apr 18, 2026",
			time: "6:30 PM",
			venue: "Venue name",
			ticketType: "General Admission",
			seat: "A12",
			qty: "1 Ticket",
			price: "Rs. 999",
			bookingId: "BOOKING-12345",
			ticketId: "TICKET-12345",
			organizer: "Organizer Name",
			attendeeName: "Attendee Name",
			attendeeEmail: "attendee@example.com",
			attendeePhone: "+91 XXXXX XXXXX",
		}, opts.sample || {});
		this._undo = [];
		this._redo = [];
		this._historyLock = false;
		this._snap = "";
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
		if (!this._keepReference && this.layout && this.layout.frame === "reference") {
			this.layout.frame = "edited";
		}
		this.syncFlagsFromElements();
		if (!this._historyLock) {
			let next = "";
			try { next = JSON.stringify(this.getLayout()); } catch (_) { next = ""; }
			if (this._snap && next && next !== this._snap) {
				this._undo = this._undo || [];
				this._undo.push(this._snap);
				if (this._undo.length > 40) this._undo.shift();
				this._redo = [];
				this._snap = next;
			} else if (next) {
				this._snap = next;
			}
		}
		this.syncUndoButtons();
		this.onChange(this.getLayout());
	};

	TicketCanvasController.prototype.syncFlagsFromElements = function () {
		const present = {};
		(this.layout.canvas_elements || []).forEach(function (el) { present[el.type] = true; });
		DATA_DEFS.forEach(function (def) {
			if (!def.flag) return;
			this.layout[def.flag] = !!present[def.type] || def.type === "jod_logo";
		}.bind(this));
		this.layout.show_jod_logo = true;
		if (this.layout.canvas_mode !== "custom") {
			this.layout.show_qr = !!(present.qr || present.booking_id);
		}
	};

	TicketCanvasController.prototype.setPremium = function (premium) {
		this.isPremium = !!premium;
		ensureLogoElement(this.layout);
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
		ensureLogoElement(this.layout);
		this.applyFlagsToElements();
		this.selectedId = null;
		this.canvasSelected = false;
		this.syncControls();
		this.renderTemplatePicker();
		this.scrollActiveTemplateIntoView();
		this.renderPalette();
		this.renderPreview();
		this.syncSelectedPanel();
		if (!this._historyLock) {
			this._undo = [];
			this._redo = [];
			try { this._snap = JSON.stringify(this.getLayout()); } catch (_) { this._snap = ""; }
			this.syncUndoButtons();
		}
	};

	TicketCanvasController.prototype.applyFlagsToElements = function () {
		const L = this.layout;
		if (L.canvas_mode === "custom") {
			const seen = {};
			const keep = [];
			(L.canvas_elements || []).forEach(function (el) {
				if (!el || !DEF_BY_TYPE[el.type]) return;
				if (DEF_BY_TYPE[el.type].shape || DEF_BY_TYPE[el.type].repeatable || el.type === "text" || el.type === "image") {
					keep.push(el);
					return;
				}
				if (seen[el.type]) return;
				seen[el.type] = true;
				keep.push(el);
			});
			L.canvas_elements = keep;
			ensureLogoElement(L);
			return;
		}
		const keep = [];
		const seen = {};
		(L.canvas_elements || []).forEach(function (el) {
			const def = DEF_BY_TYPE[el.type];
			if (!def) return;
			if (def.shape || def.repeatable) {
				keep.push(el);
				return;
			}
			if (def.type === "jod_logo") {
				keep.push(el);
				seen[el.type] = true;
				return;
			}
			if (def.flag && L[def.flag] === false) return;
			if (seen[el.type]) return;
			seen[el.type] = true;
			keep.push(el);
		}.bind(this));
		const legacyTypes = {};
		DEFAULT_ELEMENTS.forEach(function (el) { legacyTypes[el.type] = true; });
		DATA_DEFS.forEach(function (def) {
			if (seen[def.type]) return;
			if (!legacyTypes[def.type] && L[def.flag] !== true) return;
			const shouldShow = def.type === "jod_logo" || !def.flag || L[def.flag] !== false;
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
		ensureLogoElement(out);
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
		if (type === "image" || type === "organizer_logo") next.src = "";
		const templateGeo = this.layout.canvas_mode === "custom" ? null : (this.layout.template_id === "midnight"
			? MIDNIGHT_GEOMETRY
			: (this.layout.template_id === "sunset"
				? SUNSET_GEOMETRY
				: (this.layout.template_id === "vip_gold" ? VIP_GEOMETRY : null)));
		if (templateGeo && templateGeo[type]) {
			next.x = templateGeo[type].x;
			next.y = templateGeo[type].y;
			next.w = templateGeo[type].w;
			next.h = templateGeo[type].h;
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
		if (type === "jod_logo") return;
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

	TicketCanvasController.prototype.fontPxFor = function (item) {
		if (!item) return 12;
		const saved = Number(item.fontSize);
		if (FONT_STEPS.indexOf(saved) >= 0) return saved;
		const tmpl = this.currentTemplate();
		const base = defaultFontPx(item.type, (tmpl && tmpl.id) || "");
		const scale = Number(item.fontScale);
		if (Number.isFinite(scale) && Math.abs(scale - 1) > 0.02) return nearestFontStep(base * scale);
		return base;
	};

	TicketCanvasController.prototype.hasCustomFont = function (item) {
		if (!item) return false;
		if (FONT_STEPS.indexOf(Number(item.fontSize)) >= 0) return true;
		const scale = Number(item.fontScale);
		return Number.isFinite(scale) && Math.abs(scale - 1) > 0.02;
	};

	TicketCanvasController.prototype.markFontMenu = function (px) {
		const menu = this.root && this.root.querySelector("#ticketElFontMenu");
		if (!menu) return;
		menu.querySelectorAll("[data-font-size]").forEach(function (btn) {
			btn.classList.toggle("is-active", Number(btn.getAttribute("data-font-size")) === Number(px));
		});
	};

	TicketCanvasController.prototype.growBoxForFont = function (item, fontPx) {
		if (!item) return;
		const card = this.root && this.root.querySelector("#ticketLiveCard");
		const cardH = card && card.clientHeight ? card.clientHeight : 240;
		const twoLine = ["name", "email", "phone", "date", "venue", "price", "seat", "booking_id"].indexOf(item.type) >= 0;
		const lines = twoLine ? 2.2 : 1.3;
		const needed = Math.ceil((fontPx * lines / cardH) * 100);
		if (needed > item.h) {
			item.h = clampNum(needed, 3, 40, item.h);
			if (item.y + item.h > 100) item.y = Math.max(0, 100 - item.h);
		}
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
		const fontBtn = this.root.querySelector("#ticketElFontBtn");
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
			const imageWrapCanvas = this.root.querySelector("#ticketImageEditWrap");
			if (imageWrapCanvas) imageWrapCanvas.hidden = true;
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
		const showFont = isText && item.type !== "jod_logo";
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
		const xEl = this.root.querySelector("#ticketElX");
		const yEl = this.root.querySelector("#ticketElY");
		const familyEl = this.root.querySelector("#ticketElFamily");
		const weightEl = this.root.querySelector("#ticketElWeight");
		const rotateEl = this.root.querySelector("#ticketElRotate");
		if (xEl) xEl.value = String(Math.round(item.x));
		if (yEl) yEl.value = String(Math.round(item.y));
		if (familyEl) familyEl.value = item.fontFamily || "";
		if (weightEl) weightEl.value = item.fontWeight || "400";
		if (rotateEl) rotateEl.value = String(Math.round(Number(item.rotation) || 0));
		if (hWrap) hWrap.hidden = !!isLine;
		if (fWrap) fWrap.hidden = !showFont;
		if (fontBtn && showFont) {
			const px = this.fontPxFor(item);
			fontBtn.textContent = String(px);
			this.markFontMenu(px);
		}
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
		if (imageWrap) imageWrap.hidden = item.type !== "image" && item.type !== "organizer_logo";
		if (colorLabel) colorLabel.textContent = item.type === "image" ? "Frame" : (isShapeType(item.type) ? "Shape" : "Text");
		if (colorInput) {
			const fallback = isShapeType(item.type) ? (def.color || "#38bdf8") : (this.layout.text_color || preview.text || "#111827");
			colorInput.value = sanitizeColor(item.color || fallback, fallback);
		}
		const removeBtn = this.root.querySelector("#ticketRemoveSelectedBtn");
		if (removeBtn) {
			const lockedLogo = item.type === "jod_logo";
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
		const customFont = this.hasCustomFont(item);
		const px = this.fontPxFor(item);
		node.classList.toggle("has-font-size", customFont);
		node.style.setProperty("--tc-font-scale", customFont ? "1" : String(item.fontScale || 1));
		if (customFont) node.style.setProperty("--tc-font-px", px + "px");
		else node.style.removeProperty("--tc-font-px");
	};

	TicketCanvasController.prototype.mount = function () {
		if (!this.root) return;
		this.applyFlagsToElements();
		this.root.innerHTML = [
			'<div class="ticket-design-studio is-studio-layout">',
			'  <div class="ticket-studio-toolbar">',
			'    <div class="ticket-canvas-controls ticket-studio-controls-top">',
			'      <div class="ticket-tool-block" id="ticketElementPanel">',
			'        <div class="ticket-palette-title">Add elements</div>',
			'        <div class="ticket-element-palette" id="ticketElementPalette"></div>',
			'      </div>',
			'      <div class="ticket-tool-block">',
			'        <div class="ticket-palette-title">Show on ticket</div>',
			'        <div class="ticket-toggle-grid">',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowDate" /> Date</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowTime" /> Time</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowVenue" /> Venue</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowType" /> Ticket type</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowQty" /> Quantity</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowSeat" /> Seat</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowPrice" /> Price</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowOrganizer" /> Organizer</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowQr" /> QR code</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowTicketId" /> Ticket ID</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeeName" /> Name</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeePhone" /> Phone</label>',
			'          <label class="ticket-toggle"><input type="checkbox" id="ticketShowAttendeeEmail" /> Email</label>',
			'        </div>',
			'        <p class="ticket-premium-hint" id="ticketPremiumHint">The JOD Events logo stays on every ticket. Its color follows the background.</p>',
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
			'      <div class="ticket-float-section" id="ticketHeroUploadSection" hidden>',
			'        <div class="ticket-palette-title">Ticket photo</div>',
			'        <p class="ticket-float-hint">Fills the sunset area. The ticket name and event name stay on top.</p>',
			'        <div class="ticket-hero-upload">',
			'          <button type="button" class="ticket-hero-upload-btn" id="ticketHeroUploadBtn">Choose photo</button>',
			'          <input type="file" id="ticketHeroImage" accept="image/png,image/jpeg,image/webp" hidden />',
			'          <span class="ticket-image-status" id="ticketHeroStatus"></span>',
			'        </div>',
			'      </div>',
			'      <div class="ticket-float-section">',
			'        <div class="ticket-palette-title">Layers</div>',
			'        <p class="ticket-float-hint">Top row is in front. Drag a row to change the order, or click it to edit.</p>',
			'        <div class="ticket-layers" id="ticketLayers" role="list"></div>',
			'      </div>',
			'      <div class="ticket-float-section">',
			'        <div class="ticket-palette-title">Ticket colors</div>',
			'        <div class="ticket-float-colors">',
			'          <label class="ticket-ctrl"><span>Background</span><input type="color" id="ticketCardColor" value="#ffffff" /></label>',
			'          <label class="ticket-ctrl"><span>Accent</span><input type="color" id="ticketAccentColor" value="#2563eb" /></label>',
			'        </div>',
			'        <div class="ticket-hero-upload">',
			'          <button type="button" class="ticket-hero-upload-btn" id="ticketBgUploadBtn">Background image</button>',
			'          <input type="file" id="ticketBgImage" accept="image/png,image/jpeg,image/webp" hidden />',
			'          <button type="button" class="ticket-reset-btn" id="ticketBgClearBtn">Remove image</button>',
			'        </div>',
			'      </div>',
			'      <div class="ticket-float-section ticket-selected-panel" id="ticketSelectedPanel" hidden>',
			'        <div class="ticket-palette-title">Selected <span id="ticketSelectedLabel"></span></div>',
			'        <p class="ticket-selected-help" id="ticketSelectedHelp">Click a field on the ticket to edit it here.</p>',
			'        <label class="ticket-ctrl" id="ticketTextEditWrap" hidden><span>Text</span><input type="text" id="ticketItemText" maxlength="120" /></label>',
			'        <label class="ticket-ctrl" id="ticketImageEditWrap" hidden><span>Image</span><input type="file" id="ticketItemImage" accept="image/png,image/jpeg,image/webp" /><span class="ticket-image-status" id="ticketImageStatus"></span></label>',
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
			'        <div class="ticket-ctrl-row" id="ticketPosRow">',
			'          <label class="ticket-ctrl"><span>X</span><input type="number" id="ticketElX" min="0" max="96" step="1" /></label>',
			'          <label class="ticket-ctrl"><span>Y</span><input type="number" id="ticketElY" min="0" max="96" step="1" /></label>',
			'        </div>',
			'        <div class="ticket-ctrl-row" id="ticketFontStyleRow">',
			'          <label class="ticket-ctrl"><span>Font</span><select id="ticketElFamily"><option value="">Default</option><option>Arial</option><option>Georgia</option><option>Times New Roman</option><option>Verdana</option><option>Courier New</option></select></label>',
			'          <label class="ticket-ctrl"><span>Weight</span><select id="ticketElWeight"><option value="400">Regular</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>',
			'          <label class="ticket-ctrl"><span>Rotate</span><input type="number" id="ticketElRotate" min="-180" max="180" step="1" value="0" /></label>',
			'        </div>',
			'        <div class="ticket-ctrl-row" id="ticketSizeRow">',
			'          <label class="ticket-ctrl"><span>Width</span><input type="number" id="ticketElWidth" min="8" max="96" step="1" /></label>',
			'          <label class="ticket-ctrl" id="ticketElHeightWrap"><span>Height</span><input type="number" id="ticketElHeight" min="1" max="40" step="1" /></label>',
			'          <label class="ticket-ctrl" id="ticketElFontWrap" hidden><span>Text size</span><div class="ticket-font-picker"><button type="button" class="ticket-font-picker-btn" id="ticketElFontBtn" aria-haspopup="listbox" aria-expanded="false">12</button><div class="ticket-font-menu" id="ticketElFontMenu" hidden role="listbox" aria-label="Text size"></div></div></label>',
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
		const fontMenu = this.root.querySelector("#ticketElFontMenu");
		if (fontMenu) {
			fontMenu.innerHTML = FONT_STEPS.map(function (n) {
				return '<button type="button" class="ticket-font-option" role="option" data-font-size="' + n + '">' + n + "</button>";
			}).join("");
		}
		this.bindEvents();
		this.placeFieldControls();
		this.syncControls();
		this.renderTemplatePicker();
		this.scrollActiveTemplateIntoView();
		this.renderPalette();
		this.renderPreview();
		this.syncSelectedPanel();
		this._undo = [];
		this._redo = [];
		try { this._snap = JSON.stringify(this.getLayout()); } catch (_) { this._snap = ""; }
		this.syncUndoButtons();
	};

	TicketCanvasController.prototype.bindEvents = function () {
		if (this._bound || !this.root) return;
		this._bound = true;
		const self = this;
		const map = [
			["ticketAccentColor", "accent_color", "value"],
			["ticketCardColor", "card_color", "value"],
			["ticketShowDate", "show_date", "checked", "date"],
			["ticketShowTime", "show_time", "checked", "time"],
			["ticketShowVenue", "show_venue", "checked", "venue"],
			["ticketShowType", "show_ticket_type", "checked", "ticket_type"],
			["ticketShowQty", "show_qty", "checked", "qty"],
			["ticketShowSeat", "show_seat", "checked", "seat"],
			["ticketShowPrice", "show_price", "checked", "price"],
			["ticketShowOrganizer", "show_organizer", "checked", "organizer"],
			["ticketShowQr", "show_qr", "checked", "qr"],
			["ticketShowTicketId", "show_ticket_id", "checked", "ticket_id"],
			["ticketShowAttendeeName", "show_attendee_name", "checked", "name"],
			["ticketShowAttendeeEmail", "show_attendee_email", "checked", "email"],
			["ticketShowAttendeePhone", "show_attendee_phone", "checked", "phone"],
		];
		map.forEach(function (row) {
			const el = self.root.querySelector("#" + row[0]);
			if (!el) return;
			el.addEventListener("input", function () {
				if (self.layout.canvas_mode !== "custom" && (row[0] === "ticketCardColor" || row[0] === "ticketAccentColor")) {
					self.layout.canvas_mode = self.layout.canvas_mode || "legacy";
				}
				const on = row[2] === "checked" ? !!el.checked : String(el.value || "");
				self.layout[row[1]] = on;
				if (row[2] === "checked" && row[3]) {
					if (on) {
						self.addElement(row[3], true);
					} else {
						self.removeElement(row[3]);
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
				const textTypes = ["title", "date", "venue", "qty", "ticket_type", "seat", "name", "phone", "email", "booking_id", "price", "footer", "badge", "text", "stub"];
				if (item) {
					item.color = color;
				} else if (self.canvasSelected) {
					self.layout.text_color = color;
					(self.layout.canvas_elements || []).forEach(function (el) {
						if (el && textTypes.indexOf(el.type) >= 0) el.color = color;
					});
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
				if (!file) return;
				let item = self.findById(self.selectedId);
				if (!item || (item.type !== "image" && item.type !== "organizer_logo")) {
					self.addElement("image", true);
					item = self.findById(self.selectedId);
				}
				const status = self.root.querySelector("#ticketImageStatus");
				if (status) status.textContent = "Uploading…";
				const applySrc = function (src, note) {
					if (!item || !src) {
						if (status) status.textContent = note || "Could not add that image.";
						return;
					}
					const raw = String(src);
					item.src = raw.indexOf("data:image/") === 0 ? raw.slice(0, 700000) : raw.slice(0, 800);
					if (status) status.textContent = note || "Image added.";
					self.renderPreview();
					self.emitChange();
				};
				const readLocal = function (note) {
					self.readImageFile(file, function (src) { applySrc(src, note); });
				};
				if (self.onUploadImage) {
					Promise.resolve(self.onUploadImage(file)).then(function (url) {
						if (url) applySrc(url, "Image added.");
						else readLocal("Upload did not return a link. This preview stays on this screen only.");
					}).catch(function (err) {
						const msg = err && err.message ? err.message : "Upload failed.";
						readLocal(msg + " Showing a local preview only.");
					});
				} else {
					readLocal("Image added on this screen only.");
				}
				itemImage.value = "";
			});
		}
		const heroBtn = this.root.querySelector("#ticketHeroUploadBtn");
		const heroImage = this.root.querySelector("#ticketHeroImage");
		if (heroBtn && heroImage) {
			heroBtn.addEventListener("click", function () { heroImage.click(); });
			heroImage.addEventListener("change", function () {
				const file = heroImage.files && heroImage.files[0];
				heroImage.value = "";
				if (!file) return;
				const heroStatus = self.root.querySelector("#ticketHeroStatus");
				const setHeroStatus = function (text) {
					const el = self.root.querySelector("#ticketHeroStatus");
					if (el) el.textContent = text || "";
				};
				setHeroStatus("Uploading…");
				const showLocal = function (note) {
					self.readImageFile(file, function (dataUrl) {
						if (!sanitizeMediaSrc(dataUrl)) {
							setHeroStatus(note || "Could not read that image. Use JPG, PNG, or WEBP.");
							return;
						}
						self._heroFailedSrc = "";
						self.layout.sunset_hero_src = dataUrl;
						self.layout.template_id = "sunset";
						self._heroNote = note || "Photo added.";
						self.syncControls();
						self.renderPreview();
					});
				};
				if (!self.onUploadImage) {
					showLocal("Photo added on this screen.");
					return;
				}
				Promise.resolve(self.onUploadImage(file)).then(function (url) {
					const safe = sanitizeMediaSrc(url);
					const display = resolveTicketMediaUrl(safe);
					if (!display) {
						showLocal("Photo added on this screen.");
						return;
					}
					const probe = new Image();
					probe.onload = function () {
						self._heroFailedSrc = "";
						self.layout.sunset_hero_src = safe;
						self.layout.template_id = "sunset";
						self._heroNote = "Photo added.";
						self.syncControls();
						self.renderPreview();
						self.emitChange();
					};
					probe.onerror = function () {
						showLocal("Photo added on this screen.");
					};
					probe.src = display;
				}).catch(function (err) {
					const msg = err && err.message ? err.message : "Upload failed.";
					if (heroStatus) heroStatus.textContent = msg;
					showLocal("Showing the photo on this screen.");
				});
			});
		}
		const layers = this.root.querySelector("#ticketLayers");
		if (layers) {
			layers.addEventListener("click", function (ev) {
				const row = ev.target && ev.target.closest ? ev.target.closest("[data-layer]") : null;
				if (!row) return;
				self.selectedId = row.getAttribute("data-layer");
				self.canvasSelected = false;
				self.renderPreview();
			});
			layers.addEventListener("dragstart", function (ev) {
				const row = ev.target && ev.target.closest ? ev.target.closest("[data-layer]") : null;
				if (!row || !ev.dataTransfer) return;
				ev.dataTransfer.setData("text/plain", row.getAttribute("data-layer") || "");
				ev.dataTransfer.effectAllowed = "move";
			});
			layers.addEventListener("dragover", function (ev) {
				ev.preventDefault();
			});
			layers.addEventListener("drop", function (ev) {
				ev.preventDefault();
				const fromId = ev.dataTransfer ? ev.dataTransfer.getData("text/plain") : "";
				const row = ev.target && ev.target.closest ? ev.target.closest("[data-layer]") : null;
				const toId = row ? row.getAttribute("data-layer") : "";
				if (!fromId || !toId || fromId === toId) return;
				const list = (self.layout.canvas_elements || []).slice();
				const visual = list.slice().reverse();
				const from = visual.findIndex(function (el) { return el.id === fromId; });
				const to = visual.findIndex(function (el) { return el.id === toId; });
				if (from < 0 || to < 0) return;
				const moved = visual.splice(from, 1)[0];
				visual.splice(to, 0, moved);
				self.layout.canvas_elements = visual.slice().reverse();
				self.renderPreview();
				self.emitChange();
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

		[["ticketElX", "x"], ["ticketElY", "y"], ["ticketElWidth", "w"], ["ticketElHeight", "h"]].forEach(function (pair) {
			const el = self.root.querySelector("#" + pair[0]);
			if (!el) return;
			el.addEventListener("input", function () {
				const item = self.findById(self.selectedId);
				if (!item) return;
				const key = pair[1];
				const isLine = item.type === "line" || item.type === "dashed_line";
				const logo = item.type === "jod_logo";
				let min = 0;
				let max = 96;
				if (key === "w") { min = logo ? 12 : 8; max = logo ? 80 : 96; }
				else if (key === "h") { min = logo ? 6 : (isLine ? 1 : 3); max = logo ? 28 : 40; }
				else { min = 0; max = 96; }
				item[key] = clampNum(Number(el.value), min, max, item[key]);
				clampBox(item);
				self.applyNodeBox(item);
				self.emitChange();
			});
		});
		const fontBtn = this.root.querySelector("#ticketElFontBtn");
		const fontMenuEl = this.root.querySelector("#ticketElFontMenu");
		if (fontBtn && fontMenuEl) {
			function placeFontMenu() {
				const rect = fontBtn.getBoundingClientRect();
				const menuHeight = 248;
				const spaceBelow = window.innerHeight - rect.bottom;
				fontMenuEl.style.position = "fixed";
				fontMenuEl.style.left = Math.max(8, rect.left) + "px";
				fontMenuEl.style.width = Math.max(76, rect.width) + "px";
				fontMenuEl.style.right = "auto";
				if (spaceBelow < menuHeight && rect.top > spaceBelow) {
					fontMenuEl.style.top = "auto";
					fontMenuEl.style.bottom = (window.innerHeight - rect.top + 4) + "px";
				} else {
					fontMenuEl.style.bottom = "auto";
					fontMenuEl.style.top = (rect.bottom + 4) + "px";
				}
			}
			fontBtn.addEventListener("click", function (ev) {
				ev.preventDefault();
				ev.stopPropagation();
				const opening = fontMenuEl.hidden;
				fontMenuEl.hidden = !opening;
				fontBtn.setAttribute("aria-expanded", opening ? "true" : "false");
				if (opening) {
					placeFontMenu();
					const current = fontMenuEl.querySelector(".is-active");
					if (current && current.scrollIntoView) current.scrollIntoView({ block: "center" });
				}
			});
			fontMenuEl.addEventListener("click", function (ev) {
				ev.stopPropagation();
				const opt = ev.target && ev.target.closest ? ev.target.closest("[data-font-size]") : null;
				if (!opt) return;
				ev.preventDefault();
				const item = self.findById(self.selectedId);
				if (!item || !self.isTextElement(item.type) || item.type === "jod_logo") return;
				const size = Number(opt.getAttribute("data-font-size"));
				if (FONT_STEPS.indexOf(size) < 0) return;
				const tmpl = self.currentTemplate();
				const base = defaultFontPx(item.type, (tmpl && tmpl.id) || "");
				item.fontSize = size;
				item.fontScale = clampNum(size / base, 0.4, 8, 1);
				self.growBoxForFont(item, size);
				self.applyNodeBox(item);
				const hEl = self.root.querySelector("#ticketElHeight");
				if (hEl) hEl.value = String(Math.round(item.h));
				fontBtn.textContent = String(size);
				self.markFontMenu(size);
				fontMenuEl.hidden = true;
				fontBtn.setAttribute("aria-expanded", "false");
				self.emitChange();
			});
			document.addEventListener("click", function () {
				if (fontMenuEl.hidden) return;
				fontMenuEl.hidden = true;
				fontBtn.setAttribute("aria-expanded", "false");
			});
			const floatCard = self.root.querySelector("#ticketFloatCard");
			if (floatCard) {
				floatCard.addEventListener("scroll", function () {
					if (fontMenuEl.hidden) return;
					fontMenuEl.hidden = true;
					fontBtn.setAttribute("aria-expanded", "false");
				});
			}
		}
		const deselectBtn = this.root.querySelector("#ticketDeselectBtn");
		if (deselectBtn) deselectBtn.addEventListener("click", function () { self.clearSelection(); });
		const removeSelectedBtn = this.root.querySelector("#ticketRemoveSelectedBtn");
		if (removeSelectedBtn) {
			removeSelectedBtn.addEventListener("click", function () {
				const item = self.findById(self.selectedId);
				if (!item) return;
				if (item.type === "jod_logo") return;
				self.removeElement(self.selectedId);
			});
		}

		const resetBtn = this.root.querySelector("#ticketResetLayout");
		if (resetBtn) {
			resetBtn.addEventListener("click", function () {
				const orient = self.layout && self.layout.orientation === "portrait" ? "portrait" : "landscape";
				if (!window.confirm("Reset this draft to the plain " + orient + " ticket? Published tickets stay as they are until you click Update tickets.")) return;
				self._keepReference = true;
				self.layout = referenceLayout(orient);
				self.selectedId = null;
				self.canvasSelected = false;
				self.syncControls();
				self.renderPalette();
				self.renderPreview();
				self.syncSelectedPanel();
				self.emitChange();
				self._keepReference = false;
			});
		}
		const familyEl = this.root.querySelector("#ticketElFamily");
		const weightEl = this.root.querySelector("#ticketElWeight");
		const rotateEl = this.root.querySelector("#ticketElRotate");
		function bindStyle(input, key, numeric) {
			if (!input) return;
			input.addEventListener("input", function () {
				const item = self.findById(self.selectedId);
				if (!item || item.type === "jod_logo") return;
				item[key] = numeric ? clampNum(Number(input.value), -180, 180, 0) : String(input.value || "");
				self.renderPreview();
				self.emitChange();
			});
		}
		bindStyle(familyEl, "fontFamily", false);
		bindStyle(weightEl, "fontWeight", false);
		bindStyle(rotateEl, "rotation", true);
		const bgBtn = this.root.querySelector("#ticketBgUploadBtn");
		const bgInput = this.root.querySelector("#ticketBgImage");
		const bgClear = this.root.querySelector("#ticketBgClearBtn");
		if (bgBtn && bgInput) {
			bgBtn.addEventListener("click", function () { bgInput.click(); });
			bgInput.addEventListener("change", function () {
				const file = bgInput.files && bgInput.files[0];
				bgInput.value = "";
				if (!file || typeof self.onUploadImage !== "function") return;
				Promise.resolve(self.onUploadImage(file)).then(function (src) {
					const clean = sanitizeMediaSrc(src);
					if (!clean) return;
					self.layout.background_image = clean;
					if (self.layout.canvas_mode !== "custom") self.layout.canvas_mode = "custom";
					self.renderPreview();
					self.emitChange();
				}).catch(function () {});
			});
		}
		if (bgClear) {
			bgClear.addEventListener("click", function () {
				self.layout.background_image = "";
				self.renderPreview();
				self.emitChange();
			});
		}
		function wireHeader(id, fn) {
			const btn = document.getElementById(id);
			if (!btn) return;
			btn._ticketAction = fn;
			if (btn._ticketWired) return;
			btn._ticketWired = true;
			btn.addEventListener("click", function () {
				if (typeof btn._ticketAction === "function") btn._ticketAction();
			});
		}
		wireHeader("ticketUndoBtn", function () { self.undo(); });
		wireHeader("ticketRedoBtn", function () { self.redo(); });
		wireHeader("ticketOrientLandscape", function () { self.setOrientation("landscape"); });
		wireHeader("ticketOrientPortrait", function () { self.setOrientation("portrait"); });
		wireHeader("ticketPreviewBtn", function () { self.openPreview(); });
		wireHeader("ticketDefaultDesignBtn", function () { self.applyDefaultDesign(); });
		wireHeader("ticketAddElementsBtn", function () {
			if (window.matchMedia(DRAWER_QUERY).matches) self.setToolsOpen(true);
			const panel = self.root.querySelector("#ticketElementPanel");
			if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
		});

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
		setChk("ticketShowTime", this.hasElement("time"));
		setChk("ticketShowVenue", this.hasElement("venue"));
		setChk("ticketShowType", this.hasElement("ticket_type"));
		setChk("ticketShowQty", this.hasElement("qty"));
		setChk("ticketShowSeat", this.hasElement("seat"));
		setChk("ticketShowPrice", this.hasElement("price"));
		setChk("ticketShowOrganizer", this.hasElement("organizer"));
		setChk("ticketShowQr", this.hasElement("qr"));
		setChk("ticketShowTicketId", this.hasElement("ticket_id"));
		setChk("ticketShowAttendeeName", this.hasElement("name"));
		setChk("ticketShowAttendeeEmail", this.hasElement("email"));
		setChk("ticketShowAttendeePhone", this.hasElement("phone"));
		const hint = this.root.querySelector("#ticketPremiumHint");
		if (hint) hint.textContent = "The JOD Events logo stays on every ticket. Its color follows the background.";
		const landBtn = document.getElementById("ticketOrientLandscape");
		const portBtn = document.getElementById("ticketOrientPortrait");
		const orient = (L.canvas_mode === "custom" && L.orientation === "portrait") ? "portrait" : (L.canvas_mode === "custom" ? "landscape" : "");
		if (landBtn) landBtn.classList.toggle("is-active", orient === "landscape");
		if (portBtn) portBtn.classList.toggle("is-active", orient === "portrait");
		const heroSection = this.root.querySelector("#ticketHeroUploadSection");
		const heroBtn = this.root.querySelector("#ticketHeroUploadBtn");
		const sunsetOn = (L.template_id || "") === "sunset";
		const heroReady = !!(L.sunset_hero_src && L.sunset_hero_src !== this._heroFailedSrc);
		if (heroSection) heroSection.hidden = !sunsetOn;
		if (heroBtn) heroBtn.textContent = heroReady ? "Change photo" : "Choose photo";
	};

	TicketCanvasController.prototype.syncFormFieldToggles = function () {};

	TicketCanvasController.prototype.syncUndoButtons = function () {
		const undo = document.getElementById("ticketUndoBtn");
		const redo = document.getElementById("ticketRedoBtn");
		if (undo) undo.disabled = !(this._undo && this._undo.length);
		if (redo) redo.disabled = !(this._redo && this._redo.length);
	};

	TicketCanvasController.prototype.undo = function () {
		if (!this._undo || !this._undo.length) return;
		this._redo = this._redo || [];
		if (this._snap) this._redo.push(this._snap);
		const prev = this._undo.pop();
		this._historyLock = true;
		try { this.setLayout(JSON.parse(prev)); } catch (_) {}
		this._snap = prev;
		this._historyLock = false;
		this.syncUndoButtons();
		this.onChange(this.getLayout());
	};

	TicketCanvasController.prototype.redo = function () {
		if (!this._redo || !this._redo.length) return;
		this._undo = this._undo || [];
		if (this._snap) this._undo.push(this._snap);
		const next = this._redo.pop();
		this._historyLock = true;
		try { this.setLayout(JSON.parse(next)); } catch (_) {}
		this._snap = next;
		this._historyLock = false;
		this.syncUndoButtons();
		this.onChange(this.getLayout());
	};

	TicketCanvasController.prototype.applyDefaultDesign = function () {
		if (!window.confirm("Replace this draft with the default e-ticket design? Published tickets stay as they are until you click Update tickets.")) return;
		this._keepReference = true;
		this.layout = eticketLayout();
		this.selectedId = null;
		this.canvasSelected = false;
		this.syncControls();
		this.renderPalette();
		this.renderPreview();
		this.syncSelectedPanel();
		this.emitChange();
		this._keepReference = false;
	};

	TicketCanvasController.prototype.setOrientation = function (next) {
		const orient = next === "portrait" ? "portrait" : "landscape";
		if (this.layout.orientation === orient && this.layout.frame === "reference") return;
		if (this.layout.frame !== "edited") {
			this._keepReference = true;
			this.layout = referenceLayout(orient);
		} else {
			this.layout.canvas_mode = "custom";
			this.layout.orientation = orient;
			this.layout.layout_version = 11;
			(this.layout.canvas_elements || []).forEach(clampBox);
			ensureLogoElement(this.layout);
		}
		this.syncControls();
		this.renderPreview();
		this.emitChange();
		this._keepReference = false;
	};

	TicketCanvasController.prototype.openPreview = function () {
		let modal = document.getElementById("ticketPreviewModal");
		if (!modal) {
			modal = document.createElement("div");
			modal.id = "ticketPreviewModal";
			modal.className = "ticket-preview-modal";
			modal.innerHTML = '<div class="ticket-preview-dialog" role="dialog" aria-modal="true" aria-label="Ticket preview"><div class="ticket-preview-bar"><strong>Preview</strong><button type="button" class="ticket-reset-btn" id="ticketPreviewClose">Close</button></div><div id="ticketPreviewStage"></div><p class="ticket-preview-note">Sample details only. Attendee PDFs use the published design for this event.</p></div>';
			document.body.appendChild(modal);
			modal.addEventListener("click", function (ev) {
				if (ev.target === modal || (ev.target && ev.target.id === "ticketPreviewClose")) modal.hidden = true;
			});
		}
		const stage = document.getElementById("ticketPreviewStage");
		const card = this.root && this.root.querySelector("#ticketLiveCard");
		if (stage) {
			stage.innerHTML = "";
			if (card) {
				const clone = card.cloneNode(true);
				clone.querySelectorAll(".tc-handles, .tc-node-remove, .tc-guides").forEach(function (node) { node.remove(); });
				clone.classList.remove("has-selection", "is-canvas-selected");
				clone.classList.add("is-preview");
				stage.appendChild(clone);
			}
		}
		modal.hidden = false;
	};

	TicketCanvasController.prototype.jodLogoSrc = function () {
		const L = this.layout || {};
		if (L.background_image) return LOGO_BLACK;
		const light = relativeLuminance(L.card_color || "#ffffff") > 0.179;
		return light ? LOGO_BLACK : LOGO_WHITE;
	};

	function chipIcon(type) {
		const paths = {
			poster: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 14l2.5-3 2 2.5L16 9l4 6"/>',
			title: '<path d="M5 6h14M5 12h9M5 18h12"/>',
			date: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
			time: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
			venue: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2"/>',
			ticket_type: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/>',
			qty: '<path d="M8 7h11l-1 9H9z"/><path d="M8 7L7 4H4"/>',
			seat: '<path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M5 11h14v6H5z"/>',
			price: '<path d="M12 4v16M8 8h6a3 3 0 0 1 0 6H8"/>',
			organizer: '<circle cx="12" cy="8" r="3"/><path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19"/>',
			name: '<circle cx="12" cy="8" r="3"/><path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19"/>',
			phone: '<path d="M8 4h3l1 4-2 1a12 12 0 0 0 5 5l1-2 4 1v3a2 2 0 0 1-2 2A14 14 0 0 1 6 6a2 2 0 0 1 2-2z"/>',
			email: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M4 7l8 6 8-6"/>',
			booking_id: '<path d="M7 7h10v10H7z"/><path d="M9 11h6M9 14h4"/>',
			ticket_id: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M9 12h6"/>',
			qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
			jod_logo: '<path d="M5 17V7h4.5a3.2 3.2 0 0 1 0 6.4H5M14 7h5M16.5 7v10"/>',
			organizer_logo: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 16l4-4 3 3 2-2 5 5"/>',
			text: '<path d="M6 6h12M12 6v12"/>',
			image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 16l4-4 3 3 2-2 5 5"/>',
			line: '<path d="M5 12h14"/>',
			dashed_line: '<path d="M4 12h3M10 12h4M18 12h2"/>',
			rectangle: '<rect x="5" y="6" width="14" height="12" rx="1.5"/>',
			circle: '<circle cx="12" cy="12" r="7"/>',
		};
		return '<svg class="ticket-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[type] || '<path d="M12 5v14M5 12h14"/>') + "</svg>";
	}

	TicketCanvasController.prototype.renderPalette = function () {
		const self = this;
		const dataHost = this.root && this.root.querySelector("#ticketElementPalette");
		const shapeHost = this.root && this.root.querySelector("#ticketShapePalette");
		if (dataHost) {
			const groups = [
				{ title: "Event information", types: ["poster", "title", "date", "time", "venue", "ticket_type", "qty", "seat", "price", "organizer"] },
				{ title: "Attendee information", types: ["name", "phone", "email", "booking_id", "ticket_id", "qr"] },
				{ title: "Branding", types: ["jod_logo", "organizer_logo"] },
				{ title: "Design elements", types: ["text", "image", "line", "dashed_line", "rectangle", "circle"] },
			];
			dataHost.innerHTML = groups.map(function (group) {
				const chips = group.types.map(function (type) {
					const def = DEF_BY_TYPE[type];
					if (!def) return "";
					const onCanvas = self.hasElement(type);
					const locked = type === "jod_logo";
					const disabled = (onCanvas && !def.repeatable) || locked;
					return '<button type="button" class="ticket-palette-chip' + (onCanvas ? " is-on" : "") + '" data-add-type="' + type + '"' + (disabled ? " disabled" : "") + ">" + chipIcon(type) + "<span>" + escapeHtml(def.label) + "</span>" + (onCanvas && !def.repeatable ? " ✓" : " +") + "</button>";
				}).join("");
				return '<div class="ticket-palette-group"><h4>' + escapeHtml(group.title) + "</h4><div class=\"ticket-palette-chips\">" + chips + "</div></div>";
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
					const type = btn.getAttribute("data-add-shape");
					if (type === "image") {
						const picker = self.root.querySelector("#ticketItemImage");
						if (picker) picker.click();
						return;
					}
					self.addElement(type);
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
				if (id === prevId) return;
				self.layout.template_id = id;
				if (id === "midnight") {
					applyMidnightGeometry(self.layout.canvas_elements);
				} else if (id === "sunset") {
					applySunsetGeometry(self.layout.canvas_elements);
				} else if (id === "vip_gold") {
					applyVipGeometry(self.layout.canvas_elements);
				} else if (prevId === "midnight" || prevId === "sunset" || prevId === "vip_gold") {
					self.layout.canvas_elements = snapDataElementsToDefault(self.layout.canvas_elements);
				}
				if (tmpl && tmpl.preview) {
					if (tmpl.preview.accent) self.layout.accent_color = tmpl.preview.accent;
					if (id === "midnight" || id === "sunset" || id === "vip_gold") {
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
		const custom = L.canvas_mode === "custom";
		const isSunset = !custom && L.template_id === "sunset";
		const isVip = !custom && L.template_id === "vip_gold";
		const isMidnight = !custom && L.template_id === "midnight";
		const eticketCard = custom && L.orientation === "portrait" && L.card_style === "eticket";
		const portraitCard = custom && L.orientation === "portrait" && !eticketCard;
		const landscapeCard = custom && L.orientation !== "portrait";
		const field = function (label, value) {
			return '<div class="tc-field"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
		};
		const sgDetail = function (_label, value) {
			return '<div class="sg-detail"><strong>' + escapeHtml(value) + "</strong></div>";
		};
		const vgDetail = function (_label, value) {
			return '<div class="vg-detail"><strong>' + escapeHtml(value) + "</strong></div>";
		};
		switch (type) {
			case "poster": return '<div class="tc-poster-fill" aria-hidden="true"></div>';
			case "image": {
				const src = String(el.src || "").trim();
				if (src) return '<div class="tc-el-image"><img src="' + escapeHtml(src) + '" alt="" draggable="false" /></div>';
				return '<div class="tc-el-image is-empty">Add image</div>';
			}
			case "stub": {
				const custom = String(el.text || "").trim();
				const fallback = isSunset ? "YOUR QR CODE" : (isVip ? "ADMIT ONE" : [ticketLabel, title].filter(Boolean).join(" "));
				return '<div class="ms-stub-text">' + escapeHtml(custom || fallback) + "</div>";
			}
			case "title": return isSunset
				? '<div class="sg-sub">' + escapeHtml(title) + "</div>"
				: (isVip
					? '<div class="vg-sub">' + escapeHtml(title) + "</div>"
					: (portraitCard
						? field("Event", title)
						: '<div class="tc-el-title">' + escapeHtml(title) + "</div>"));
			case "badge": return '<div class="tc-el-badge">E-Ticket</div>';
			case "time": return portraitCard
				? field("Time", s.time || "6:30 PM")
				: (landscapeCard
					? '<div class="tc-time-mark">' + escapeHtml(s.time || "6:30 PM") + "</div>"
					: '<div class="tc-el-text">' + escapeHtml(s.time || "6:30 PM") + "</div>");
			case "organizer": return '<div class="tc-el-text">' + escapeHtml(s.organizer || "Organizer Name") + "</div>";
			case "ticket_id": return '<div class="tc-el-text strong">' + escapeHtml(s.ticketId || "TICKET-12345") + "</div>";
			case "organizer_logo": {
				const src = String(el.src || "").trim();
				if (src) return '<div class="tc-el-image"><img src="' + escapeHtml(src) + '" alt="" draggable="false" /></div>';
				return '<div class="tc-el-image is-empty">Organizer logo</div>';
			}
			case "date": {
				if (isVip) return vgDetail("DATE", s.date);
				if (isSunset) return sgDetail("DATE", s.date);
				if (isMidnight) return '<div class="ms-meta"><strong>' + escapeHtml(s.date) + "</strong></div>";
				if (portraitCard) return field("Date", s.date);
				if (landscapeCard) return '<div class="tc-kicker">' + escapeHtml(s.date) + "</div>";
				return '<div class="tc-el-text">' + escapeHtml(s.date) + "</div>";
			}
			case "venue": return isVip
				? vgDetail("VENUE", s.venue)
				: (isSunset
					? sgDetail("VENUE", s.venue)
					: (portraitCard
						? field("Place", s.venue)
						: '<div class="tc-el-text muted">' + escapeHtml(s.venue) + "</div>"));
			case "qty": return '<div class="tc-el-text muted">1 Ticket</div>';
			case "ticket_type": return landscapeCard
				? '<div class="tc-kicker">' + escapeHtml(ticketLabel) + "</div>"
				: (isSunset
				? '<div class="sg-hero">' + escapeHtml(ticketLabel) + "</div>"
				: (isVip
					? '<div class="vg-hero">' + escapeHtml(ticketLabel) + "</div>"
					: '<div class="tc-el-strong">' + escapeHtml(ticketLabel) + "</div>"));
			case "seat": {
				if (isVip) return vgDetail("SEAT", s.seat);
				if (isSunset) return sgDetail("SEAT", s.seat);
				if (isMidnight) return '<div class="ms-meta"><strong>' + escapeHtml(s.seat) + "</strong></div>";
				return '<div class="tc-el-text muted">' + escapeHtml(s.seat) + "</div>";
			}
			case "name": {
				if (isVip) return vgDetail("NAME", s.attendeeName);
				if (isSunset) return sgDetail("NAME", s.attendeeName);
				if (isMidnight) return '<div class="ms-name"><strong>' + escapeHtml(s.attendeeName) + "</strong></div>";
				return '<div class="tc-el-row"><span>Name</span><strong>' + escapeHtml(s.attendeeName) + "</strong></div>";
			}
			case "phone": return isVip
				? vgDetail("PHONE", s.attendeePhone)
				: (isSunset
					? sgDetail("PHONE", s.attendeePhone)
					: (isMidnight
						? '<div class="tc-el-row"><strong>' + escapeHtml(s.attendeePhone) + "</strong></div>"
						: '<div class="tc-el-row"><span>Phone</span><strong>' + escapeHtml(s.attendeePhone) + "</strong></div>"));
			case "email": return isVip
				? vgDetail("EMAIL", s.attendeeEmail)
				: (isSunset
					? sgDetail("EMAIL", s.attendeeEmail)
					: (isMidnight
						? '<div class="tc-el-row"><strong>' + escapeHtml(s.attendeeEmail) + "</strong></div>"
						: '<div class="tc-el-row"><span>Email</span><strong>' + escapeHtml(s.attendeeEmail) + "</strong></div>"));
			case "qr": return portraitCard
				? '<div class="tc-scan"><span>SCAN</span><div class="tc-el-qr" aria-hidden="true"></div><span>ME!</span></div>'
				: '<div class="tc-el-qr" aria-hidden="true"></div>';
			case "booking_id": {
				if (isVip) return '<div class="vg-id"><strong>' + escapeHtml(s.bookingId) + "</strong></div>";
				if (isSunset) return sgDetail("ID", s.bookingId);
				if (isMidnight) return '<div class="ms-code"><strong>' + escapeHtml(s.bookingId) + "</strong></div>";
				if (portraitCard) return field("Ticket code", s.bookingId);
				return '<div class="tc-el-text strong">BOOKING ID: #' + escapeHtml(s.bookingId) + "</div>";
			}
			case "price": return isVip
				? vgDetail("PRICE", s.price)
				: (isSunset
					? sgDetail("PRICE", s.price)
					: (isMidnight
						? '<div class="tc-el-price"><strong class="tc-price-value">' + escapeHtml(s.price) + "</strong></div>"
						: '<div class="tc-el-price"><span class="tc-price-label">' + (eticketCard ? "Total Amount" : "Price") + '</span><strong class="tc-price-value">' + escapeHtml(s.price) + "</strong></div>"));
			case "jod_logo": {
				const plate = L.background_image ? " is-plate" : "";
				return '<div class="tc-el-logo is-watermark' + plate + '" aria-label="JOD Events"><img src="' + this.jodLogoSrc() + '" alt="JOD Events" draggable="false" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\'' + LOGO_BLACK + '\';}" /></div>';
			}
			case "footer": {
				const note = String(L.custom_footer || "").trim();
				if (!note) return '<div class="tc-el-text muted tc-el-placeholder">Footer note</div>';
				return '<div class="tc-el-text muted">' + escapeHtml(note) + "</div>";
			}
			case "text": return '<div class="tc-el-text">' + escapeHtml(el.text || "Your text") + "</div>";
			case "line": return '<div class="tc-shape-line' + (Number(el.h) > Number(el.w) ? " is-vertical" : "") + '" style="background:' + color + ';"></div>';
			case "dashed_line": return '<div class="tc-shape-line is-dashed" style="border-top-color:' + color + ';"></div>';
			case "rectangle": return '<div class="tc-shape-rect" style="border-color:' + color + ';background:color-mix(in srgb, ' + color + ' 18%, transparent);"></div>';
			case "circle": return '<div class="tc-shape-circle" style="border-color:' + color + ';background:color-mix(in srgb, ' + color + ' 22%, transparent);"></div>';
			default: return "";
		}
	};

	TicketCanvasController.prototype.renderLayers = function () {
		const host = this.root && this.root.querySelector("#ticketLayers");
		if (!host) return;
		const self = this;
		const items = (this.layout.canvas_elements || []).slice().reverse();
		host.innerHTML = items.map(function (el) {
			const def = DEF_BY_TYPE[el.type] || {};
			const active = self.selectedId === el.id;
			return '<button type="button" class="ticket-layer' + (active ? " is-active" : "") + '" data-layer="' + escapeHtml(el.id) + '" draggable="true">' +
				'<span class="ticket-layer-grip" aria-hidden="true"></span>' +
				"<span>" + escapeHtml(def.label || el.type) + "</span></button>";
		}).join("");
	};

	TicketCanvasController.prototype.readImageFile = function (file, done) {
		const reader = new FileReader();
		reader.onload = function () {
			const src = String(reader.result || "");
			if (src.indexOf("data:image/") === 0 && src.length < 700000) done(src);
			else done("");
		};
		reader.onerror = function () { done(""); };
		reader.readAsDataURL(file);
	};

	TicketCanvasController.prototype.mountHeroPhoto = function (card, heroSrc) {
		if (!card) return;
		const status = this.root && this.root.querySelector("#ticketHeroStatus");
		const setStatus = function (text) {
			if (status) status.textContent = text || "";
		};
		if (!heroSrc || heroSrc === this._heroFailedSrc) {
			if (heroSrc && heroSrc === this._heroFailedSrc) setStatus("That photo could not be shown. Choose a JPG, PNG, or WEBP.");
			return;
		}
		const display = resolveTicketMediaUrl(heroSrc);
		if (!display) {
			this._heroFailedSrc = heroSrc;
			setStatus("That photo could not be shown. Choose a JPG, PNG, or WEBP.");
			return;
		}
		const self = this;
		const token = (this._heroToken = (this._heroToken || 0) + 1);
		const probe = new Image();
		probe.onload = function () {
			if (self._heroToken !== token) return;
			const sky = card.querySelector(".sg-sky");
			if (!sky) return;
			const img = document.createElement("img");
			img.className = "sg-hero-photo";
			img.alt = "";
			img.draggable = false;
			img.src = display;
			sky.appendChild(img);
			card.classList.add("has-hero-photo");
			setStatus(self._heroNote || "Photo added.");
			self._heroNote = "";
		};
		probe.onerror = function () {
			if (self._heroToken !== token) return;
			self._heroFailedSrc = heroSrc;
			card.classList.remove("has-hero-photo");
			setStatus("That photo could not be shown. Choose a JPG, PNG, or WEBP.");
			self.syncControls();
		};
		probe.src = display;
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

		const custom = L.canvas_mode === "custom";
		const eticket = custom && L.orientation === "portrait" && L.card_style === "eticket";
		const isMidnight = !custom && (tmpl.id || "") === "midnight";
		const isSunset = !custom && (tmpl.id || "") === "sunset";
		const isVip = !custom && (tmpl.id || "") === "vip_gold";
		const stageTone = custom
			? (eticket ? "#1f2023" : (L.orientation === "portrait" ? "#dbe7ff" : "#ffffff"))
			: (isMidnight ? "#12081f" : (isSunset ? "#2a120c" : (isVip ? "#111111" : (p.bg || "#f4f6f8"))));
		stage.style.background = stageTone;
		const heroSrc = isSunset ? sanitizeMediaSrc(L.sunset_hero_src) : "";
		const orientClass = custom ? (" is-custom is-orient-" + (L.orientation === "portrait" ? "portrait" : "landscape") + (eticket ? " is-eticket" : "")) : "";
		card.className = "ticket-live-card is-canvas style-" + (custom ? "custom" : (tmpl.id || "classic")) + orientClass + (hasSel ? " has-selection" : "") + (this.canvasSelected && !hasSel ? " is-canvas-selected" : "");
		const customBg = L.card_color || "#ffffff";
		card.style.background = isMidnight
			? "linear-gradient(118deg, #4c1d95 0%, #6d28d9 46%, #7c3aed 100%)"
			: (isSunset ? "#ff7a1a" : (isVip ? "#e6c15a" : (custom ? customBg : (L.card_color || p.card || "#fff"))));
		const bgUrl = custom ? sanitizeMediaSrc(L.background_image) : "";
		card.style.backgroundImage = bgUrl ? ("url(\"" + bgUrl.replace(/"/g, "") + "\")") : ((isSunset || isVip || custom) ? "none" : "");
		card.style.backgroundSize = bgUrl ? "cover" : "";
		card.style.backgroundPosition = bgUrl ? "center" : "";
		card.style.color = L.text_color || (custom ? (relativeLuminance(customBg) > 0.179 ? "#111111" : "#ffffff") : (isMidnight || isSunset ? "#ffffff" : (isVip ? "#111111" : (p.text || "#111827"))));
		card.style.setProperty("--ticket-accent", isMidnight ? "#c4b5fd" : accent);
		card.style.setProperty("--ticket-muted", isMidnight ? "#ddd6fe" : (isSunset ? "#78716c" : (isVip ? "#d4a017" : (p.muted || "#6b7280"))));
		card.style.setProperty("--ticket-stage", stageTone);

		const face = custom
			? (eticket
				? ""
				: (L.orientation === "portrait"
					? '<div class="tc-stripe"></div>'
					: '<div class="tc-perf"></div>'))
			: (isMidnight
				? '<div class="ms-waves"></div><div class="ms-hole"></div><div class="ms-notch is-top"></div><div class="ms-notch is-bot"></div><div class="ms-perf"></div>'
				: (isSunset
					? '<div class="sg-sky"></div><div class="sg-sun"></div><div class="sg-crowd"></div><div class="sg-band"></div><div class="sg-stubbg"></div><div class="sg-notch is-top"></div><div class="sg-notch is-bot"></div><div class="sg-perf"></div>'
					: (isVip
						? '<div class="vg-gold"></div><div class="vg-black"></div>'
						: '<div class="tlc-accent"></div>')));
		const bits = [
			/* Face clips accents to rounded corners; nodes stay above so handles can overflow. */
			'<div class="tlc-face" aria-hidden="true">' + face + "</div>",
			custom
				? (eticket
					? '<div class="tc-notch is-left is-upper"></div><div class="tc-notch is-right is-upper"></div><div class="tc-notch is-left is-lower"></div><div class="tc-notch is-right is-lower"></div>'
					: '<div class="tc-notch is-left"></div><div class="tc-notch is-right"></div>')
				: "",
			'<div class="tc-guides" id="ticketGuides" aria-hidden="true"></div>',
		];
		(L.canvas_elements || []).forEach(function (el) {
			const locked = el.type === "jod_logo";
			const selected = self.selectedId === el.id;
			const def = DEF_BY_TYPE[el.type] || {};
			const isLine = el.type === "line" || el.type === "dashed_line";
			const customFont = self.hasCustomFont(el);
			const fontPx = self.fontPxFor(el);
			const scale = customFont ? 1 : (Number.isFinite(Number(el.fontScale)) ? el.fontScale : 1);
			const align = self.isTextElement(el.type) ? sanitizeAlign(el.align, el.type) : "";
			const ownColor = optionalColor(el.color);
			const ticketText = optionalColor(L.text_color);
			let paint = ownColor;
			if (!paint && !ticketText) {
				if (isSunset && ["name", "email", "phone", "date", "venue", "price", "seat"].indexOf(el.type) >= 0) paint = "#1c1917";
				else if (isSunset && (el.type === "booking_id" || el.type === "stub")) paint = "#ffffff";
				else if (isVip && el.type === "booking_id") paint = "#ffffff";
				else if (isVip && ["name", "email", "phone", "date", "venue", "price", "seat", "title", "ticket_type"].indexOf(el.type) >= 0) paint = "#111111";
				else if (isVip && el.type === "stub") paint = "#f6e27a";
			}
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
					(customFont ? " has-font-size" : "") +
					'" data-id="' + escapeHtml(el.id) + '" data-type="' + el.type +
					'" style="left:' + el.x + "%;top:" + el.y + "%;width:" + el.w + "%;height:" + el.h +
					"%;--tc-font-scale:" + scale + ";" + (customFont ? "--tc-font-px:" + fontPx + "px;" : "") + (paint ? "color:" + paint + ";" : "") +
					(el.fontFamily ? "font-family:" + escapeHtml(el.fontFamily) + ",sans-serif;" : "") +
					(el.fontWeight ? "font-weight:" + escapeHtml(el.fontWeight) + ";" : "") +
					(el.rotation ? "transform:rotate(" + Number(el.rotation) + "deg);" : "") + '">' +
				'<div class="tc-node-body">' + self.elementContent(el) + "</div>" +
				removeCtrl +
				'<div class="tc-handles" aria-hidden="true">' + handles + "</div>" +
				"</div>"
			);
		});
		card.innerHTML = bits.join("");
		this.mountHeroPhoto(card, heroSrc);
		this.renderLayers();
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
