function capitalize(str) {
	return typeof str === 'string' && str.length > 0
		? str.charAt(0).toUpperCase() + str.slice(1)
		: str;
}

(function initSidebarPermanent() {
	'use strict';

	function resolveTabFromEvent(target) {
		if (!target) return null;
		const item = target.closest('.sidebar-item[data-tab]');
		if (!item) return null;
		return item.getAttribute('data-tab');
	}

	function handleSidebarActivate(tab) {
		if (!tab) return;
		try {
			if (typeof window.switchTab === 'function') {
				window.switchTab(tab);
			} else if (typeof window.dashSwitchTab === 'function') {
				window.dashSwitchTab(tab);
			} else {
				console.warn('[Sidebar] switchTab function not yet available, queuing tab:', tab);
				window.__pendingSidebarTab = tab;
			}
		} catch (err) {
			console.error('[Sidebar] switchTab error:', err);
		}
	}

	function flashSidebarItem(item) {
		if (!item) return;
		try {
			item.classList.add('click-flash');
			setTimeout(function () { item.classList.remove('click-flash'); }, 350);
		} catch (_) { }
	}

	function attachSidebarDelegation() {
		const sidebar = document.querySelector('.dash-sidebar');
		if (!sidebar) return false;
		if (sidebar.dataset.sidebarBound === '1') return true;
		sidebar.dataset.sidebarBound = '1';

		sidebar.addEventListener('click', function (e) {
			const item = e.target.closest('.sidebar-item[data-tab]');
			if (!item) return;
			e.preventDefault();
			e.stopPropagation();
			const tab = item.getAttribute('data-tab');
			handleSidebarActivate(tab);
			flashSidebarItem(item);
		}, true);

		sidebar.addEventListener('keydown', function (e) {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			const item = e.target.closest('.sidebar-item[data-tab]');
			if (!item) return;
			e.preventDefault();
			const tab = item.getAttribute('data-tab');
			handleSidebarActivate(tab);
			flashSidebarItem(item);
		});

		console.debug && console.debug('[Sidebar] Event delegation bound to .dash-sidebar');
		return true;
	}

	function attachIndividualSidebarListeners() {
		const items = document.querySelectorAll('.sidebar-item[data-tab]');
		items.forEach(function (item) {
			if (item.dataset.itemBound === '1') return;
			item.dataset.itemBound = '1';
			item.setAttribute('role', 'tab');
			if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '0');

			item.addEventListener('click', function (e) {
				e.preventDefault();
				const tab = item.getAttribute('data-tab');
				handleSidebarActivate(tab);
				flashSidebarItem(item);
			});

			item.addEventListener('keydown', function (e) {
				if (e.key !== 'Enter' && e.key !== ' ') return;
				e.preventDefault();
				const tab = item.getAttribute('data-tab');
				handleSidebarActivate(tab);
				flashSidebarItem(item);
			});
		});
		return items.length;
	}

	function processPendingTab() {
		const pending = window.__pendingSidebarTab;
		if (pending) {
			delete window.__pendingSidebarTab;
			handleSidebarActivate(pending);
		}
	}

	function tryInit(mode) {
		const delegated = attachSidebarDelegation();
		const count = attachIndividualSidebarListeners();
		if (mode === 'DOMContentLoaded') processPendingTab();
		console.debug && console.debug('[Sidebar] Init (' + mode + '): delegation=' + delegated + ', items=' + count);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { tryInit('DOMContentLoaded'); }, { once: true });
	} else {
		tryInit('immediate');
	}

	setTimeout(function () { tryInit('timeout-safety'); }, 50);
	setTimeout(function () { tryInit('timeout-safety-2'); }, 500);
	setTimeout(function () { tryInit('timeout-safety-3'); }, 2000);

	window.__sidebarPermanentInit = true;
})();

function normalizeTab(tabName) {
	if (!tabName || typeof tabName !== 'string') return 'overview';
	const t = tabName.trim().toLowerCase();
	// Map common aliases to internal section keys
	if (t === 'event-day' || t === 'event_day' || t === 'eventday') return 'eventday';
	if (t === 'registration' || t === 'registrations') return 'registrations';
	if (t === 'exhibitor' || t === 'exhibitors') return 'exhibitors';
	if (t === 'communicate' || t === 'communication' || t === 'promote') return 'communicate';
	if (t === 'report' || t === 'reports' || t === 'analytics') return 'reports';
	if (t === 'setting' || t === 'settings') return 'settings';
	if (t === 'design' || t === 'designstudio') return 'design';
	if (t === 'manage' || t === 'create') return 'manage';
	return t;
}

function getInitialTabFromUrl() {
	const urlParams = new URLSearchParams(window.location.search);
	let tab = urlParams.get('tab');
	if (!tab || tab.trim() === '') {
		const hash = window.location.hash.slice(1);
		tab = (hash && hash.trim() !== '' && hash !== 'overview') ? hash : '';
	}
	if (!tab || tab.trim() === '' || tab.trim().toLowerCase() === 'overview') return '';
	return normalizeTab(tab);
}

/** Stub until initOrganizerDashboard registers the real implementation. */
function queueSwitchTab(tabName) {
	if (!tabName || typeof tabName !== 'string') return;
	const normalized = normalizeTab(tabName);
	window.__pendingDashboardTab = normalized;
	if (typeof window.__dashboardSwitchTabImpl === 'function') {
		window.__dashboardSwitchTabImpl(normalized);
		delete window.__pendingDashboardTab;
	}
}

window.switchTab = window.dashSwitchTab = queueSwitchTab;

async function initOrganizerDashboard() {
	let venueMap = null;
	let venueMarker = null;
	let venueGeocodeTimer = null;
	let venueFillingFromMap = false;
	let venueMapClickBound = false;

	const API_BASE = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "").replace(/\/$/, '') + '/api/organizers');

	const HOST_EVENTS_API_BASE = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "").replace(/\/$/, '') + '/api/host-events');

	const VOLUNTEERS_API = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "").replace(/\/$/, '') + '/api/volunteers');

	const LOCATION_API_BASE = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "").replace(/\/$/, '') + '/api/location');

	function getUploadOrigin() {
		if (HOST_EVENTS_API_BASE.startsWith("http")) {
			return HOST_EVENTS_API_BASE.replace(/\/api\/host-events\/?$/, "");
		}
		return window.location.origin;
	}

	function resolveUploadUrl(url) {
		if (!url) return "";
		const trimmed = String(url).trim();
		const lower = trimmed.toLowerCase();
		if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("data:text") || lower.startsWith("data:image/svg")) {
			return "";
		}
		if (trimmed.startsWith("blob:") || lower.startsWith("data:image/")) return trimmed;
		if (window.JodConfig && typeof window.JodConfig.safeMediaUrl === "function") {
			return window.JodConfig.safeMediaUrl(trimmed, "images/hero-event.jpg");
		}
		if (trimmed.startsWith("https://")) return trimmed;
		if (trimmed.startsWith("http://")) {
			try {
				const parsed = new URL(trimmed);
				if (parsed.pathname.indexOf("/api/media") === 0 || parsed.pathname.indexOf("/uploads/") === 0) {
					return `${getUploadOrigin()}${parsed.pathname}${parsed.search || ""}`;
				}
				if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return trimmed;
			} catch (_) {}
			return "";
		}
		if (trimmed.startsWith("/api/media") || trimmed.startsWith("/uploads/") || trimmed.startsWith("uploads/")) {
			return `${getUploadOrigin()}/${String(trimmed).replace(/^\//, "")}`;
		}
		if (trimmed.startsWith("images/") || trimmed.startsWith("./images/") || trimmed.startsWith("/images/")) {
			if (window.JodConfig && typeof window.JodConfig.assetUrl === "function") {
				return window.JodConfig.assetUrl(trimmed);
			}
			return "https://assets.jodevents.com/images/" + trimmed.replace(/^(\.\/)?images\//, "");
		}
		if (trimmed.startsWith("/") || trimmed.startsWith("./")) return trimmed;
		return "";
	}

	function bindPrivateDocumentLink(el, url) {
		if (!el || !url) return;
		const fullUrl = resolveUploadUrl(url);
		el.href = fullUrl;
		el.onclick = async (e) => {
			if (!String(fullUrl).includes("/api/media/private/")) return;
			e.preventDefault();
			try {
				const fetchFn = window.JodAuth && typeof window.JodAuth.fetchAuth === "function"
					? window.JodAuth.fetchAuth
					: fetch;
				const res = await fetchFn(fullUrl);
				if (!res.ok) throw new Error("Could not open document.");
				const blob = await res.blob();
				window.open(URL.createObjectURL(blob), "_blank");
			} catch (_) {
				showNotification("Sign in to view this private document.");
			}
		};
	}

	// KYC verification UI is hidden until Admin Portal is implemented.
	const VERIFICATION_UI_ENABLED = false;

	let activeEventId = null;
	let hostEventCancelled = false;
	let activeCustomerId = null;
	let activeHostId = null;
	let bannerImageUrl = null;
	let cardImageUrl = null;
	let galleryImageUrls = [];
	let pendingHostDesignData = null;
	let pendingManageEvent = null;
	let pendingRegistrationForm = null;
	let currentLifecycle = "draft";
	let canPublishNew = true;
	let canCreateNew = true;
	let _publishInFlight = false;

	function apiErrorMessage(data, fallback) {
		if (!data) return fallback;
		const d = data.detail;
		if (typeof d === "string" && d.trim()) return d;
		if (Array.isArray(d) && d.length) {
			return d.map((item) => (item && item.msg) ? item.msg : String(item)).join(" ");
		}
		if (data.message) return data.message;
		return fallback;
	}

	function isPublishedLifecycle() {
		return currentLifecycle === "published" || currentLifecycle === "live";
	}

	function toIstIsoFromDatetimeLocal(value) {
		if (!value) return undefined;
		if (value.includes("Z") || value.includes("+")) return value;
		return value.length === 16 ? value + ":00+05:30" : value + "+05:30";
	}

	function timeFromDatetimeLocal(value) {
		if (!value || !value.includes("T")) return undefined;
		return value.split("T")[1];
	}

	function isoToDatetimeLocal(value) {
		if (!value) return "";
		const s = String(value).trim();
		if (!s) return "";
		// Already a datetime-local / IST wall-clock string without offset
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
			return s.slice(0, 16);
		}
		const d = new Date(s.includes("T") || s.includes("Z") || s.includes("+") ? s : s.replace(" ", "T"));
		if (Number.isNaN(d.getTime())) return s.slice(0, 16);
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: "Asia/Kolkata",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false
		}).formatToParts(d);
		const get = (type) => (parts.find((p) => p.type === type) || {}).value || "00";
		return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
	}

	function endIsBeforeStart() {
		const dateInput = document.getElementById("eventDateInput");
		const endDateInput = document.getElementById("eventEndDateInput");
		if (!dateInput || !endDateInput || !dateInput.value || !endDateInput.value) return false;
		const startMs = new Date(dateInput.value).getTime();
		const endMs = new Date(endDateInput.value).getTime();
		return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs;
	}

	function attrEscape(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/</g, "&lt;");
	}

	function clearTicketTierRow(row) {
		if (!row) return;
		const type = row.querySelector(".ticket-type-input");
		const price = row.querySelector(".ticket-price-input");
		const qty = row.querySelector(".ticket-qty-input");
		const start = row.querySelector(".ticket-offer-start-input");
		const end = row.querySelector(".ticket-offer-end-input");
		if (type) type.value = "";
		if (price) price.value = "";
		if (qty) qty.value = "";
		if (start) start.value = "";
		if (end) end.value = "";
	}

	function collectTicketsJson() {
		const rows = document.querySelectorAll(".ticket-tier-row");
		const out = [];
		rows.forEach((row) => {
			const name = row.querySelector(".ticket-type-input")?.value?.trim();
			if (!name) return;
			const item = {
				name,
				price: Number(row.querySelector(".ticket-price-input")?.value || 0),
				qty: Number(row.querySelector(".ticket-qty-input")?.value || 0),
				// Always include keys so clearing offer windows updates the public page.
				sales_start: toIstIsoFromDatetimeLocal(row.querySelector(".ticket-offer-start-input")?.value || "") || null,
				sales_end: toIstIsoFromDatetimeLocal(row.querySelector(".ticket-offer-end-input")?.value || "") || null
			};
			out.push(item);
		});
		return out;
	}

	function collectAgendaJson() {
		const rows = document.querySelectorAll(".agenda-row");
		const out = [];
		rows.forEach((row) => {
			const title = row.querySelector(".agenda-title-input")?.value?.trim();
			if (!title) return;
			out.push({
				time: row.querySelector(".agenda-time-input")?.value?.trim() || "",
				title,
				speaker: row.querySelector(".agenda-speaker-input")?.value?.trim() || ""
			});
		});
		return out;
	}

	function getAuthHeaders() {
		const token = window.JodAuth ? window.JodAuth.getToken() : null;
		return token ? { "Authorization": `Bearer ${token}` } : {};
	}

	const ALLOWED_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
	const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
	const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
	const IMAGE_TYPE_MSG = "Your image is not in this standard file type. Please use JPG, JPEG, PNG, or WEBP.";
	const IMAGE_SIZE_MSG = "Your image is not in this standard size. Maximum file size is 5MB.";
	const BANNER_TARGET_W = 1200;
	const BANNER_TARGET_H = 530;
	const BANNER_DIM_MSG = "Your image is not in this standard size. Use 1200 × 530 px. Up to 99 px higher or lower is allowed; 100 px or more off will be rejected.";

	function hasAllowedImageMagicBytes(bytes) {
		if (!bytes || bytes.length < 12) return false;
		const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
		const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
		const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
			&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
		return jpeg || png || webp;
	}

	async function validateImageFile(file, options) {
		const opts = options || {};
		if (!file) throw new Error(IMAGE_TYPE_MSG);
		if (file.size > MAX_IMAGE_BYTES) throw new Error(IMAGE_SIZE_MSG);

		const name = String(file.name || "").toLowerCase();
		const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
		const mime = String(file.type || "").toLowerCase();
		const extOk = ALLOWED_IMAGE_EXTS.includes(ext);
		const mimeOk = !mime || mime === "application/octet-stream" || ALLOWED_IMAGE_MIMES.includes(mime);
		if (!extOk || !mimeOk) throw new Error(IMAGE_TYPE_MSG);

		const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
		if (!hasAllowedImageMagicBytes(header)) throw new Error(IMAGE_TYPE_MSG);

		if (opts.requireBannerSize) {
			const dims = await new Promise((resolve, reject) => {
				const url = URL.createObjectURL(file);
				const img = new Image();
				img.onload = () => {
					URL.revokeObjectURL(url);
					resolve({ width: img.naturalWidth, height: img.naturalHeight });
				};
				img.onerror = () => {
					URL.revokeObjectURL(url);
					reject(new Error(IMAGE_TYPE_MSG));
				};
				img.src = url;
			});
			const widthOff = Math.abs(dims.width - BANNER_TARGET_W);
			const heightOff = Math.abs(dims.height - BANNER_TARGET_H);
			if (widthOff >= 100 || heightOff >= 100) {
				throw new Error(BANNER_DIM_MSG);
			}
		}
	}

	function formatDesignUploadError(err) {
		const msg = err && err.message ? String(err.message) : "";
		if (/standard file type|wrong file type|valid image file|jpg, jpeg, png/i.test(msg)) {
			return IMAGE_TYPE_MSG;
		}
		if (/standard size|too large|5mb|5 mb|1200/i.test(msg)) {
			if (/1200/.test(msg)) return BANNER_DIM_MSG;
			return IMAGE_SIZE_MSG;
		}
		if (/failed to fetch|networkerror|load failed/i.test(msg)) {
			return "Could not upload the image. Check your connection and try again.";
		}
		return msg || IMAGE_TYPE_MSG;
	}

	function setInlineUploadError(hostEl, message) {
		if (!hostEl) return;
		let el = hostEl.querySelector(":scope > .design-upload-error");
		if (!el) {
			el = document.createElement("p");
			el.className = "design-upload-error";
			el.setAttribute("role", "alert");
			el.style.cssText = "margin:0.45rem 0 0; font-size:0.82rem; font-weight:600; color:#dc2626; line-height:1.4;";
			hostEl.appendChild(el);
		}
		el.textContent = message || "";
		el.style.display = message ? "block" : "none";
	}

	async function uploadDesignAsset(file, assetType) {
		if (!file || !email) throw new Error("Missing file or organizer email.");
		await validateImageFile(file, { requireBannerSize: assetType === "banner" });
		const fd = new FormData();
		fd.append("email", email);
		fd.append("asset_type", assetType);
		fd.append("file", file);
		if (activeEventId) fd.append("event_id", String(activeEventId));
		let res;
		try {
			res = await fetch(`${HOST_EVENTS_API_BASE}/upload-asset`, {
				method: "POST",
				headers: getAuthHeaders(),
				body: fd
			});
		} catch (networkErr) {
			throw new Error("Could not upload the image. Check your connection and try again.");
		}
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const detail = data.detail;
			const text = typeof detail === "string" ? detail : IMAGE_TYPE_MSG;
			throw new Error(text);
		}
		return data.file_url;
	}

	function collectSponsorDetails() {
		const rows = document.querySelectorAll("#sponsorsRows .sponsor-row");
		const out = [];
		rows.forEach(row => {
			const name = row.querySelector(".sponsor-name-input")?.value?.trim();
			if (!name) return;
			const tierEl = row.querySelector(".sponsor-tier-select") || row.querySelector(".sponsor-tier-input");
			out.push({
				name,
				tier: tierEl ? tierEl.value : "",
				logo_url: row.dataset.logoUrl || ""
			});
		});
		return out;
	}

	function collectSpeakerDetails() {
		const rows = document.querySelectorAll("#artistsRows .artist-row");
		const out = [];
		rows.forEach(row => {
			const name = row.querySelector(".artist-name-input")?.value?.trim();
			if (!name) return;
			out.push({
				name,
				role: row.querySelector(".artist-role-input")?.value?.trim() || "",
				photo_url: row.dataset.photoUrl || ""
			});
		});
		return out;
	}

	function collectPerformersTitle() {
		const select = document.getElementById("performersTitleSelect");
		const custom = document.getElementById("performersTitleCustom");
		if (!select) return "";
		if (select.value === "__other__") {
			return (custom && custom.value.trim()) || "";
		}
		return String(select.value || "").trim();
	}

	function syncPerformersTitleCustomVisibility() {
		const select = document.getElementById("performersTitleSelect");
		const custom = document.getElementById("performersTitleCustom");
		if (!select || !custom) return;
		const isOther = select.value === "__other__";
		custom.hidden = !isOther;
		if (isOther) custom.focus();
	}

	function applyPerformersTitle(title) {
		const select = document.getElementById("performersTitleSelect");
		const custom = document.getElementById("performersTitleCustom");
		if (!select) return;
		const value = String(title || "").trim();
		if (!value) {
			select.value = "";
			if (custom) {
				custom.value = "";
				custom.hidden = true;
			}
			return;
		}
		const match = Array.from(select.options).find((opt) => opt.value === value);
		if (match && value !== "__other__") {
			select.value = value;
			if (custom) {
				custom.value = "";
				custom.hidden = true;
			}
			return;
		}
		select.value = "__other__";
		if (custom) {
			custom.value = value;
			custom.hidden = false;
		}
	}

	function collectPoliciesJson() {
		const modeEl = document.getElementById("ticketPurchaseModeInput");
		const mode = (modeEl && modeEl.value === "multiple") ? "multiple" : "single";
		let limit = Number(document.getElementById("ticketPerPersonLimitInput")?.value || 4);
		if (!Number.isFinite(limit)) limit = 4;
		if (mode === "single") limit = 1;
		else limit = Math.max(2, Math.min(20, Math.round(limit)));
		const note = String(document.getElementById("ticketPriceNoteInput")?.value || "").trim().slice(0, 200);
		const purchase = { mode, per_person_limit: limit };
		if (note) purchase.price_note = note;
		return {
			event_policy: document.getElementById("policyEventInput")?.value?.trim() || "",
			cancellation_policy: document.getElementById("policyCancellationInput")?.value?.trim() || "",
			refund_policy: document.getElementById("policyRefundInput")?.value?.trim() || "",
			terms_and_conditions: document.getElementById("policyTermsInput")?.value?.trim() || "",
			privacy_policy: document.getElementById("policyPrivacyInput")?.value?.trim() || "",
			age_policy: document.getElementById("policyAgeInput")?.value?.trim() || "",
			_ticket_purchase: purchase
		};
	}

	function applyTicketPurchaseMode(mode, limit, priceNote) {
		const normalized = mode === "multiple" ? "multiple" : "single";
		const modeEl = document.getElementById("ticketPurchaseModeInput");
		if (modeEl) modeEl.value = normalized;
		document.querySelectorAll("#ticketModePills .ticket-mode-pill").forEach((pill) => {
			pill.classList.toggle("active", pill.getAttribute("data-ticket-mode") === normalized);
		});
		const wrap = document.getElementById("ticketPerPersonLimitWrap");
		if (wrap) wrap.hidden = normalized !== "multiple";
		const limitEl = document.getElementById("ticketPerPersonLimitInput");
		if (limitEl && normalized === "multiple") {
			const n = Number(limit);
			limitEl.value = String(Number.isFinite(n) && n >= 2 ? Math.min(20, Math.round(n)) : 4);
		}
		if (typeof priceNote === "string") {
			const noteEl = document.getElementById("ticketPriceNoteInput");
			if (noteEl) noteEl.value = priceNote;
		}
	}

	function populatePoliciesFromJson(policies) {
		if (!policies || typeof policies !== "object") return;
		const map = [
			["policyEventInput", "event_policy"],
			["policyCancellationInput", "cancellation_policy"],
			["policyRefundInput", "refund_policy"],
			["policyTermsInput", "terms_and_conditions"],
			["policyPrivacyInput", "privacy_policy"],
			["policyAgeInput", "age_policy"]
		];
		map.forEach(([id, key]) => {
			const el = document.getElementById(id);
			if (el && policies[key]) el.value = policies[key];
		});
		const purchase = policies._ticket_purchase;
		if (purchase && typeof purchase === "object") {
			applyTicketPurchaseMode(purchase.mode || "single", purchase.per_person_limit, purchase.price_note || "");
		}
	}

	function populateDesignRows(sponsors, speakers) {
		const sRows = document.getElementById("sponsorsRows");
		const aRows = document.getElementById("artistsRows");
		if (sRows) {
			sRows.innerHTML = "";
			const list = (sponsors && sponsors.length) ? sponsors : [{}];
			list.forEach(s => sRows.appendChild(createSponsorRowHtml(s.name || "", s.tier || "Title Sponsor", s.logo_url || "")));
		}
		if (aRows) {
			aRows.innerHTML = "";
			const list = (speakers && speakers.length) ? speakers : [{}];
			list.forEach(s => aRows.appendChild(createArtistRowHtml(s.name || "", s.role || "", s.photo_url || "")));
		}
	}

	const currentUser = window.JodAuth ? window.JodAuth.getUser() : null;
	const urlParams = new URLSearchParams(window.location.search);
	let email = (currentUser && currentUser.email)
		? currentUser.email
		: (urlParams.get("email") || sessionStorage.getItem("verified_organizer_email") || "");

	// Global error hook for diagnostics during development
	try {
		window.addEventListener('error', (ev) => {
			try { console.error('Uncaught error:', ev.message, ev.filename + ':' + ev.lineno, ev.error); } catch (_) {}
		});
	} catch (_) {}

	if (!email) {
		window.location.href = "login.html?redirect=" + encodeURIComponent("organizer-dashboard.html");
		return;
	}

	// Require authenticated session — do not fabricate tokens
	const isLoggedIn = window.JodAuth && typeof window.JodAuth.isLoggedIn === "function" && window.JodAuth.isLoggedIn();
	if (!isLoggedIn) {
		window.location.href = "login.html?redirect=" + encodeURIComponent(`organizer-dashboard.html?email=${encodeURIComponent(email)}`);
		return;
	}

	if (currentUser && currentUser.email && currentUser.email.toLowerCase() !== email.toLowerCase()) {
		email = currentUser.email;
	}

	try {
		sessionStorage.setItem("verified_organizer_email", email);
	} catch (_) {}

	try {
		const bankRes = await fetch(`${API_BASE}/account-setup?email=${encodeURIComponent(email)}`, {
			headers: getAuthHeaders()
		});
		if (bankRes.status === 404) {
			window.location.href = "account-setup.html";
			return;
		}
		if (bankRes.ok) {
			const bankData = await bankRes.json();
			const acc = bankData.account;
			const setupComplete = window.JodAuth && typeof window.JodAuth.isHostSetupComplete === "function"
				? window.JodAuth.isHostSetupComplete(acc, bankData)
				: Boolean(bankData.setup_complete);
			if (!setupComplete) {
				window.location.href = "account-setup.html";
				return;
			}
		}
	} catch (_) {}

	// ── Organizer Verification State Management ──────────────────────────────
	let currentVerificationInfo = null;

	async function fetchVerificationStatus(forceRefresh) {
		try {
			const res = await fetch(`${API_BASE}/verification-status?email=${encodeURIComponent(email)}`, {
				headers: getAuthHeaders()
			});
			if (!res.ok) {
				// No record / 404 etc — treat as NOT_SUBMITTED
				currentVerificationInfo = {
					verification_status: "NOT_SUBMITTED",
					can_publish_events: false,
					required_fields: {
						beneficiary_name: false,
						bank_name: false,
						account_number: false,
						bank_ifsc: false,
						pan_number: false,
						pan_card_uploaded: false,
						cancelled_cheque_uploaded: false
					},
					has_record: false
				};
				return currentVerificationInfo;
			}
			const data = await res.json();
			currentVerificationInfo = data;
			return currentVerificationInfo;
		} catch (err) {
			console.warn("verification-status fetch failed:", err);
			currentVerificationInfo = {
				verification_status: "NOT_SUBMITTED",
				can_publish_events: false,
				required_fields: {
					beneficiary_name: false,
					bank_name: false,
					account_number: false,
					bank_ifsc: false,
					pan_number: false,
					pan_card_uploaded: false,
					cancelled_cheque_uploaded: false
				},
				has_record: false
			};
			return currentVerificationInfo;
		}
	}

	function showVerificationOverlay() {
		const overlay = document.getElementById("organizerVerificationOverlay");
		if (overlay) {
			overlay.style.display = "flex";
		}
	}

	function hideVerificationOverlay() {
		const overlay = document.getElementById("organizerVerificationOverlay");
		if (overlay) {
			overlay.style.display = "none";
		}
	}

	function progressStepClass(idx, completed) {
		return completed ? "✓" : "○";
	}

	function renderVerificationPanel(info) {
		const panel = document.getElementById("organizerVerificationPanel");
		if (!panel) return;

		const status = info.verification_status || "NOT_SUBMITTED";
		const account = info.account || {};
		const req = info.required_fields || {};
		const rejection = info.rejection_reason;

		const steps = [
			{ label: "Bank Details", key: "bank", ok: !!(account.beneficiary_name && account.bank_name && account.account_number && account.bank_ifsc) },
			{ label: "PAN Card", key: "pan", ok: !!(account.pan_number && req.pan_card_uploaded) },
			{ label: "Cancelled Cheque", key: "cheque", ok: !!req.cancelled_cheque_uploaded },
			{ label: "Verification Review", key: "review", ok: status === "VERIFIED" }
		];

		let headerHtml = `
			<div style="padding:1.75rem 2rem; background:linear-gradient(135deg, #1e40af 0%, #2563eb 100%); color:#ffffff; display:flex; align-items:flex-start; justify-content:space-between; gap:1rem;">
				<div>
					<div style="font-size:0.75rem; font-weight:700; opacity:0.9; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:0.4rem;">Organizer Verification</div>
					<h2 style="margin:0; font-size:1.55rem; font-weight:800;">Complete Your KYC to Publish Events</h2>
					<p style="margin:0.4rem 0 0; opacity:0.92; font-size:0.92rem; line-height:1.45;">All information is encrypted and used exclusively for payout verification.</p>
				</div>
				${status === "VERIFIED" ? `
					<div style="background:rgba(255,255,255,0.15); padding:0.35rem 0.85rem; border-radius:999px; font-size:0.78rem; font-weight:700;">✓ VERIFIED</div>
				` : status === "PENDING" ? `
					<div style="background:rgba(255,255,255,0.15); padding:0.35rem 0.85rem; border-radius:999px; font-size:0.78rem; font-weight:700;">⏳ UNDER REVIEW</div>
				` : status === "REJECTED" ? `
					<div style="background:rgba(239,68,68,0.25); padding:0.35rem 0.85rem; border-radius:999px; font-size:0.78rem; font-weight:700;">✗ REJECTED</div>
				` : `
					<div style="background:rgba(255,255,255,0.15); padding:0.35rem 0.85rem; border-radius:999px; font-size:0.78rem; font-weight:700;">○ NOT SUBMITTED</div>
				`}
			</div>

			<!-- Progress Indicator -->
			<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:0.6rem; padding:1.15rem 2rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;">
				${steps.map((s, i) => `
					<div style="display:flex; align-items:center; gap:0.55rem;">
						<div style="width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.85rem; font-weight:800;
							background:${s.ok ? '#10b981' : (status === 'PENDING' && i === 3 ? '#f59e0b' : '#e2e8f0')};
							color:${s.ok || (status === 'PENDING' && i === 3) ? '#ffffff' : '#64748b'};">
							${s.ok ? '✓' : (status === 'PENDING' && i === 3 ? '◷' : (i + 1))}
						</div>
						<div style="font-size:0.8rem; font-weight:700; color:${s.ok ? '#065f46' : '#334155'};">${s.label}</div>
					</div>
				`).join('')}
			</div>
		`;

		let bodyHtml = "";

		if (status === "PENDING") {
			bodyHtml = `
				<div style="padding:2.5rem 2rem; text-align:center;">
					<div style="font-size:3.2rem; margin-bottom:0.8rem;">⏳</div>
					<h3 style="margin:0 0 0.5rem; font-size:1.35rem; font-weight:800; color:#0f172a;">Verification is under review</h3>
					<p style="margin:0 0 1.5rem; color:#475569; line-height:1.55;">
						We have received your organizer KYC documents and are currently verifying them.
						<br/>You will be able to publish events immediately after approval.
					</p>
					<div style="background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:1rem 1.2rem; border-radius:10px; font-size:0.9rem; font-weight:600; max-width:540px; margin:0 auto 1.5rem; text-align:left;">
						Your organizer verification is currently under review. You can publish this event after verification is approved.
					</div>
					<button id="btnKycPendingClose" type="button" style="background:#2563eb; color:#fff; padding:0.65rem 1.6rem; border:none; border-radius:8px; font-weight:700; font-size:0.92rem; cursor:pointer;">
						Close & Return to Dashboard
					</button>
				</div>
			`;
		} else if (status === "VERIFIED") {
			bodyHtml = `
				<div style="padding:2.5rem 2rem; text-align:center;">
					<div style="font-size:3.2rem; margin-bottom:0.8rem;">✅</div>
					<h3 style="margin:0 0 0.5rem; font-size:1.35rem; font-weight:800; color:#0f172a;">Organizer verification completed successfully</h3>
					<p style="margin:0 0 1.5rem; color:#475569; line-height:1.55;">
						You can now publish events. Your payout bank details have been locked for security.
					</p>
					<button id="btnKycPendingClose" type="button" style="background:#10b981; color:#fff; padding:0.65rem 1.6rem; border:none; border-radius:8px; font-weight:700; font-size:0.92rem; cursor:pointer;">
						Continue to Dashboard
					</button>
				</div>
			`;
		} else {
			// NOT_SUBMITTED or REJECTED → show KYC form
			const isRejected = status === "REJECTED";
			bodyHtml = `
				<div style="padding:1.75rem 2rem; overflow-y:auto; flex:1;">
					${isRejected ? `
						<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:1rem 1.1rem; border-radius:10px; margin-bottom:1.25rem;">
							<div style="font-weight:800; margin-bottom:0.35rem; font-size:0.95rem;">Your verification was rejected</div>
							<div style="font-size:0.88rem; line-height:1.45;">
								<strong>Reason:</strong> ${rejection || 'Please review and update your details, then resubmit for verification.'}
							</div>
						</div>
					` : ''}

					<form id="kycForm" autocomplete="off" novalidate>
						<div style="margin-bottom:1.4rem;">
							<div style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-bottom:0.9rem; display:flex; align-items:center; gap:0.4rem;">
								<span style="background:#eff6ff; color:#1e40af; width:26px; height:26px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">1</span>
								Bank Account Details
							</div>
							<div style="display:grid; grid-template-columns:1fr 1fr; gap:0.9rem;">
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">Account Holder Name (Beneficiary) <span style="color:#ef4444;">*</span></label>
									<input type="text" id="kyc_beneficiary_name" class="setup-input" style="width:100%; padding:0.6rem 0.85rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.92rem;" placeholder="As per bank records" value="${account.beneficiary_name || ''}" required />
								</div>
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">Bank Name <span style="color:#ef4444;">*</span></label>
									<input type="text" id="kyc_bank_name" class="setup-input" style="width:100%; padding:0.6rem 0.85rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.92rem;" placeholder="e.g. HDFC Bank" value="${account.bank_name || ''}" required />
								</div>
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">Account Number <span style="color:#ef4444;">*</span></label>
									<input type="text" id="kyc_account_number" class="setup-input" style="width:100%; padding:0.6rem 0.85rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.92rem;" placeholder="Bank account number" value="${account.account_number || ''}" required />
								</div>
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">Account Type</label>
									<select id="kyc_account_type" class="setup-input" style="width:100%; padding:0.6rem 0.85rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.92rem; background:#fff;">
										<option value="">Select account type</option>
										<option value="Savings" ${account.account_type === 'Savings' ? 'selected' : ''}>Savings</option>
										<option value="Current" ${account.account_type === 'Current' ? 'selected' : ''}>Current</option>
										<option value="NRE" ${account.account_type === 'NRE' ? 'selected' : ''}>NRE</option>
										<option value="NRO" ${account.account_type === 'NRO' ? 'selected' : ''}>NRO</option>
									</select>
								</div>
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">IFSC Code <span style="color:#ef4444;">*</span></label>
									<input type="text" id="kyc_bank_ifsc" class="setup-input" style="width:100%; padding:0.6rem 0.85rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.92rem; text-transform:uppercase;" placeholder="e.g. HDFC0001234" value="${account.bank_ifsc || ''}" required />
								</div>
							</div>
						</div>

						<div style="margin-bottom:1.4rem;">
							<div style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-bottom:0.9rem; display:flex; align-items:center; gap:0.4rem;">
								<span style="background:#eff6ff; color:#1e40af; width:26px; height:26px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">2</span>
								PAN Card
							</div>
							<div style="display:grid; grid-template-columns:1fr 1.1fr; gap:0.9rem; align-items:start;">
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">PAN Number <span style="color:#ef4444;">*</span></label>
									<input type="text" id="kyc_pan_number" class="setup-input" style="width:100%; padding:0.6rem 0.85rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.92rem; text-transform:uppercase;" maxlength="10" placeholder="ABCDE1234F" value="${account.pan_number || ''}" required />
								</div>
								<div>
									<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">Upload PAN Card Image <span style="color:#ef4444;">*</span></label>
									<input type="file" id="kyc_pan_file" accept=".jpg,.jpeg,.png,.pdf" style="width:100%; padding:0.55rem; border:1.5px dashed #cbd5e1; border-radius:8px; font-size:0.86rem; background:#f8fafc;" />
									${account.pan_card_url ? `<div id="kyc_pan_existing" style="margin-top:0.5rem; font-size:0.82rem; color:#166534; font-weight:600;">✓ PAN document on file. You may upload a new copy to replace it.</div>` : ''}
									<div id="kyc_pan_file_error" style="color:#dc2626; font-size:0.78rem; font-weight:600; margin-top:0.25rem; display:none;"></div>
								</div>
							</div>
						</div>

						<div style="margin-bottom:1.4rem;">
							<div style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-bottom:0.9rem; display:flex; align-items:center; gap:0.4rem;">
								<span style="background:#eff6ff; color:#1e40af; width:26px; height:26px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">3</span>
								Cancelled Cheque
							</div>
							<div>
								<label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.35rem;">Upload Cancelled Cheque Image <span style="color:#ef4444;">*</span></label>
								<input type="file" id="kyc_cheque_file" accept=".jpg,.jpeg,.png,.pdf" style="width:100%; padding:0.55rem; border:1.5px dashed #cbd5e1; border-radius:8px; font-size:0.86rem; background:#f8fafc;" />
								${account.cancelled_cheque_url ? `<div id="kyc_cheque_existing" style="margin-top:0.5rem; font-size:0.82rem; color:#166534; font-weight:600;">✓ Cancelled cheque on file. You may upload a new copy to replace it.</div>` : ''}
								<div id="kyc_cheque_file_error" style="color:#dc2626; font-size:0.78rem; font-weight:600; margin-top:0.25rem; display:none;"></div>
							</div>
						</div>

						<div id="kycStatusMessage" style="display:none; margin-bottom:1rem; padding:0.85rem 1rem; border-radius:8px; font-size:0.88rem; font-weight:600;"></div>

						<div style="display:flex; justify-content:space-between; align-items:center; gap:0.8rem; padding-top:1rem; border-top:1px solid #e2e8f0;">
							${status === "NOT_SUBMITTED" ? `<button id="btnKycSkip" type="button" style="background:#ffffff; border:1.5px solid #cbd5e1; color:#475569; padding:0.6rem 1.2rem; border-radius:8px; font-weight:700; font-size:0.9rem; cursor:pointer;">Complete Later</button>` : ''}
							<div style="display:flex; gap:0.7rem;">
								<button id="btnKycSaveDraft" type="button" style="background:#ffffff; border:1.5px solid #2563eb; color:#2563eb; padding:0.6rem 1.2rem; border-radius:8px; font-weight:700; font-size:0.9rem; cursor:pointer;">Save Draft</button>
								<button id="btnKycSubmit" type="button" style="background:linear-gradient(135deg, #2563eb 0%, #1e40af 100%); color:#fff; padding:0.6rem 1.5rem; border:none; border-radius:8px; font-weight:700; font-size:0.92rem; cursor:pointer;">
									${isRejected ? 'Update & Resubmit for Verification' : 'Submit for Verification'}
								</button>
							</div>
						</div>
					</form>
				</div>
			`;
		}

		panel.innerHTML = headerHtml + bodyHtml;

		// Wire up handlers inside panel
		const btnClose = document.getElementById("btnKycPendingClose");
		if (btnClose) {
			btnClose.addEventListener("click", () => {
				hideVerificationOverlay();
			});
		}
		const btnSkip = document.getElementById("btnKycSkip");
		if (btnSkip) {
			btnSkip.addEventListener("click", () => {
				hideVerificationOverlay();
			});
		}

		// KYC form actions
		const btnSaveDraft = document.getElementById("btnKycSaveDraft");
		const btnSubmit = document.getElementById("btnKycSubmit");
		if (btnSaveDraft) {
			btnSaveDraft.addEventListener("click", () => submitKycForm(false));
		}
		if (btnSubmit) {
			btnSubmit.addEventListener("click", () => submitKycForm(true));
		}
	}

	function setKycStatusMessage(msg, type) {
		const el = document.getElementById("kycStatusMessage");
		if (!el) return;
		el.style.display = "block";
		if (type === "error") {
			el.style.background = "#fef2f2";
			el.style.color = "#991b1b";
			el.style.border = "1px solid #fecaca";
		} else if (type === "success") {
			el.style.background = "#f0fdf4";
			el.style.color = "#166534";
			el.style.border = "1px solid #bbf7d0";
		} else {
			el.style.background = "#eff6ff";
			el.style.color = "#1e40af";
			el.style.border = "1px solid #bfdbfe";
		}
		el.textContent = msg;
	}

	async function uploadDocument(docType, fileInputId) {
		const input = document.getElementById(fileInputId);
		if (!input || !input.files || input.files.length === 0) {
			return null;
		}
		const file = input.files[0];
		const allowed = [".jpg", ".jpeg", ".png", ".pdf"];
		const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
		if (allowed.indexOf(ext) < 0) {
			const err = document.getElementById(docType === "pan_card" ? "kyc_pan_file_error" : "kyc_cheque_file_error");
			if (err) { err.textContent = "Invalid file format. Please upload .jpg, .png, or .pdf (max 2MB)."; err.style.display = "block"; }
			throw new Error("Invalid file format");
		}
		if (file.size > 2 * 1024 * 1024) {
			const err = document.getElementById(docType === "pan_card" ? "kyc_pan_file_error" : "kyc_cheque_file_error");
			if (err) { err.textContent = "File too large. Max size is 2MB."; err.style.display = "block"; }
			throw new Error("File too large");
		}
		const fd = new FormData();
		fd.append("email", email);
		fd.append("doc_type", docType);
		fd.append("file", file);
		const res = await fetch(`${API_BASE}/upload-document`, {
			method: "POST",
			headers: getAuthHeaders(),
			body: fd
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.detail || "Document upload failed");
		return data.file_url;
	}

	async function submitKycForm(isFinalSubmit) {
		const getVal = (id) => {
			const el = document.getElementById(id);
			return el ? (el.value || "").trim() : "";
		};
		const setErr = (id, msg) => {
			const el = document.getElementById(id);
			if (!el) return;
			el.style.border = msg ? "1.5px solid #ef4444" : "1.5px solid #cbd5e1";
		};

		const beneficiary_name = getVal("kyc_beneficiary_name");
		const bank_name = getVal("kyc_bank_name");
		const account_number = getVal("kyc_account_number");
		const bank_ifsc = getVal("kyc_bank_ifsc");
		const account_type = getVal("kyc_account_type") || (currentVerificationInfo && currentVerificationInfo.account ? currentVerificationInfo.account.account_type : null);
		const pan_number = getVal("kyc_pan_number");

		let valid = true;
		if (isFinalSubmit) {
			if (!beneficiary_name) { setErr("kyc_beneficiary_name", true); valid = false; }
			if (!bank_name) { setErr("kyc_bank_name", true); valid = false; }
			if (!account_number) { setErr("kyc_account_number", true); valid = false; }
			if (!bank_ifsc) { setErr("kyc_bank_ifsc", true); valid = false; }
			if (!pan_number || pan_number.length < 8) { setErr("kyc_pan_number", true); valid = false; }
		}
		if (!valid) {
			setKycStatusMessage("Please complete all required fields before submitting.", "error");
			return;
		}

		const existingPan = (currentVerificationInfo && currentVerificationInfo.account) ? currentVerificationInfo.account.pan_card_url : null;
		const existingCheque = (currentVerificationInfo && currentVerificationInfo.account) ? currentVerificationInfo.account.cancelled_cheque_url : null;

		let pan_card_url = existingPan || null;
		let cancelled_cheque_url = existingCheque || null;

		try {
			setKycStatusMessage("Uploading documents...", "info");
			const panInput = document.getElementById("kyc_pan_file");
			const chequeInput = document.getElementById("kyc_cheque_file");
			const panHasFile = panInput && panInput.files && panInput.files.length > 0;
			const chequeHasFile = chequeInput && chequeInput.files && chequeInput.files.length > 0;

			if (panHasFile) {
				pan_card_url = await uploadDocument("pan_card", "kyc_pan_file");
			} else if (isFinalSubmit && !pan_card_url) {
				const err = document.getElementById("kyc_pan_file_error");
				if (err) { err.textContent = "PAN card image is required."; err.style.display = "block"; }
				throw new Error("PAN card upload required");
			}

			if (chequeHasFile) {
				cancelled_cheque_url = await uploadDocument("cancelled_cheque", "kyc_cheque_file");
			} else if (isFinalSubmit && !cancelled_cheque_url) {
				const err = document.getElementById("kyc_cheque_file_error");
				if (err) { err.textContent = "Cancelled cheque image is required."; err.style.display = "block"; }
				throw new Error("Cancelled cheque upload required");
			}

			setKycStatusMessage("Saving verification details...", "info");

			const payload = {
				email: email,
				beneficiary_name: beneficiary_name || null,
				bank_name: bank_name || null,
				account_number: account_number || null,
				bank_ifsc: bank_ifsc || null,
				account_type: account_type || null,
				pan_number: pan_number || null,
				pan_card_url: pan_card_url,
				cancelled_cheque_url: cancelled_cheque_url,
				org_name: (currentVerificationInfo && currentVerificationInfo.account) ? (currentVerificationInfo.account.org_name || null) : null,
				contact_full_name: (currentVerificationInfo && currentVerificationInfo.account) ? (currentVerificationInfo.account.contact_full_name || null) : null,
				contact_mobile: (currentVerificationInfo && currentVerificationInfo.account) ? (currentVerificationInfo.account.contact_mobile || null) : null,
				is_final_submit: isFinalSubmit
			};

			const res = await fetch(`${API_BASE}/account-setup`, {
				method: "POST",
				headers: Object.assign({}, getAuthHeaders(), { "Content-Type": "application/json" }),
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.detail || "Failed to save KYC details");

			// Refresh verification info
			await fetchVerificationStatus(true);

			if (isFinalSubmit) {
				setKycStatusMessage("Your verification details have been submitted successfully and are currently under review.", "success");
				setTimeout(() => {
					renderVerificationPanel(currentVerificationInfo);
				}, 1200);
			} else {
				setKycStatusMessage("Draft saved.", "success");
			}

			// If now VERIFIED (unlikely but possible), auto-close after short delay
			if (currentVerificationInfo && currentVerificationInfo.verification_status === "VERIFIED") {
				setTimeout(() => hideVerificationOverlay(), 1000);
			}
		} catch (err) {
			setKycStatusMessage(err.message || "Submission failed. Please check your details and try again.", "error");
		}
	}

	// ── Access Control: verification overlay (disabled until admin portal) ──
	if (VERIFICATION_UI_ENABLED) {
	await fetchVerificationStatus(true);
	const vs = currentVerificationInfo ? currentVerificationInfo.verification_status : "NOT_SUBMITTED";
	if (vs !== "VERIFIED") {
		showVerificationOverlay();
		renderVerificationPanel(currentVerificationInfo || { verification_status: vs });
		} else {
			hideVerificationOverlay();
		}
	} else {
		hideVerificationOverlay();
	}

	const dashEventTitle = document.getElementById("dashEventTitle");
	const dashEventMeta = document.getElementById("dashEventMeta");
	const dashEventStatus = document.getElementById("dashEventStatus");
	const dashUserAvatar = document.getElementById("dashUserAvatar");
	const dashNotification = document.getElementById("dashNotification");

	const kpiSales = document.getElementById("kpiSales");
	const kpiRegs = document.getElementById("kpiRegs");
	const kpiPending = document.getElementById("kpiPending");
	const kpiAttendees = document.getElementById("kpiAttendees");
	const kpiDays = document.getElementById("kpiDays");

	const emptyStateCard = document.getElementById("emptyStateCard");
	const populatedOverviewGrid = document.getElementById("populatedOverviewGrid");
	const btnManageYourEvent = document.getElementById("btnManageYourEvent");

	const sectionOverview = document.getElementById("sectionOverview");
	const sectionManage = document.getElementById("sectionManage");
	const sectionSettings = document.getElementById("sectionSettings");
	const sectionDesign = document.getElementById("sectionDesign");
	const sectionRegistrations = document.getElementById("sectionRegistrations");
	const sectionExhibitors = document.getElementById("sectionExhibitors");
	const sectionCommunicate = document.getElementById("sectionCommunicate");
	const sectionReports = document.getElementById("sectionReports");
	const sectionEventday = document.getElementById("sectionEventday");
	const sectionAttendance = document.getElementById("sectionAttendance");
	const sidebarRoot = document.querySelector(".dash-sidebar");

	const createEventForm = document.getElementById("createEventForm");
	const eventTitleInput = document.getElementById("eventTitleInput");

	const allTabSections = [
		sectionOverview,
		sectionManage,
		sectionSettings,
		sectionDesign,
		sectionRegistrations,
		sectionExhibitors,
		sectionCommunicate,
		sectionReports,
		sectionEventday,
		sectionAttendance
	].filter(Boolean);

	// Track whether event has been created for this organizer
	let hasEvent = sessionStorage.getItem(`has_event_${email}`) === "true";
	const requestedInitialTab = getInitialTabFromUrl();

	// Diagnostic: log initial state for reproduction
	try {
		console.debug && console.debug('initOrganizerDashboard start', {
			initialTab: requestedInitialTab || 'overview',
			email: email,
			hasEvent: hasEvent,
			sidebarCount: document.querySelectorAll('.sidebar-item[data-tab]').length
		});
	} catch (_) {}

	function showNotification(msg) {
		if (!dashNotification) return;
		dashNotification.style.display = "block";
		dashNotification.textContent = msg;
		setTimeout(() => {
			if (dashNotification) dashNotification.style.display = "none";
		}, 4000);
	}
	window.showNotification = showNotification;

	function readAboutEventHtml() {
		if (window.JodDescEditor && typeof window.JodDescEditor.sync === "function") {
			return window.JodDescEditor.sync();
		}
		const descEl = document.getElementById("eventDescInput");
		return descEl ? String(descEl.value || "") : "";
	}

	function writeAboutEventHtml(html) {
		if (window.JodDescEditor && typeof window.JodDescEditor.setHtml === "function") {
			window.JodDescEditor.setHtml(html || "");
			return;
		}
		const descEl = document.getElementById("eventDescInput");
		if (descEl) descEl.value = html || "";
	}

	function aboutEventIsEmpty() {
		if (window.JodDescEditor && typeof window.JodDescEditor.isEmpty === "function") {
			return window.JodDescEditor.isEmpty();
		}
		const descEl = document.getElementById("eventDescInput");
		return !descEl || !String(descEl.value || "").trim();
	}

	function setSectionVisible(section, visible) {
		if (!section) return;
		if (visible) {
			section.classList.add('active-tab');
			section.style.display = 'block';
			section.style.removeProperty('visibility');
			section.style.removeProperty('opacity');
		} else {
			section.classList.remove('active-tab');
			section.style.display = 'none';
			section.style.removeProperty('visibility');
			section.style.removeProperty('opacity');
		}
	}

	function loadTabModuleData(tabName) {
		if (tabName === 'overview') {
			renderOverviewState();
			loadDashboardData();
		} else if (tabName === 'settings') {
			renderHostSettingsAvatar();
			loadProfileAndBankDetails();
		} else if (tabName === 'registrations') {
			if (typeof window.renderFormBuilderQuestions === 'function') {
				window.renderFormBuilderQuestions();
			}
			if (typeof window.renderFormLivePreview === 'function') {
				window.renderFormLivePreview();
			}
			loadRegistrationModuleData();
		} else if (tabName === 'exhibitors') {
			loadExhibitors();
		} else if (tabName === 'communicate') {
			loadCommunicationsData();
		} else if (tabName === 'reports') {
			loadReportsData();
		} else if (tabName === 'eventday') {
			loadGates();
			loadVolunteers();
			loadEventDayVolunteerStats();
			loadDashboardData();
		} else if (tabName === 'attendance') {
			loadAttendanceData();
			startAttendancePolling();
		} else {
			stopAttendancePolling();
		}
	}

// Dynamic Tab Switching
	function switchTab(tabName) {
		console.debug && console.debug("switchTab invoked:", tabName);
		if (!tabName || typeof tabName !== "string") {
			console.warn("switchTab ignored invalid tabName:", tabName);
			return;
		}
		tabName = normalizeTab(tabName);

		try {
			const newUrl = new URL(window.location.href);
			newUrl.searchParams.set("tab", tabName);
			window.history.replaceState({}, "", newUrl);
		} catch (_) {}

		document.querySelectorAll(".sidebar-item[data-tab]").forEach(item => {
			const isActive = item.getAttribute("data-tab") === tabName;
			item.classList.toggle("active", isActive);
			item.setAttribute("aria-selected", isActive ? "true" : "false");
		});

		const targetSections = {
			overview: sectionOverview,
			manage: sectionManage,
			settings: sectionSettings,
			design: sectionDesign,
			registrations: sectionRegistrations,
			exhibitors: sectionExhibitors,
			communicate: sectionCommunicate,
			reports: sectionReports,
			eventday: sectionEventday,
			attendance: sectionAttendance
		};

		const targetSection = targetSections[tabName] || sectionOverview;

		allTabSections.forEach(section => {
			setSectionVisible(section, section === targetSection);
		});

		loadTabModuleData(tabName);
		if (tabName === "manage") {
			setTimeout(() => {
				initVenueMapPicker();
				invalidateVenueMap();
			}, 80);
			setTimeout(() => invalidateVenueMap(), 300);
		}

		window.scrollTo({ top: 0, behavior: "smooth" });

		try {
			const sectionIds = ['sectionOverview','sectionManage','sectionSettings','sectionDesign','sectionRegistrations','sectionExhibitors','sectionCommunicate','sectionReports','sectionEventday','sectionAttendance'];
			const visible = sectionIds.filter(id => {
				const el = document.getElementById(id);
				return el && (el.classList.contains('active-tab') || el.style.display === 'block');
			});
			console.debug && console.debug('switchTab result - active tab:', tabName, 'visible sections:', visible);
		} catch (_) {}
	}
	// Expose globally immediately after definition
	window.__dashboardSwitchTabImpl = switchTab;
	window.switchTab = switchTab;
	window.dashSwitchTab = switchTab;

	function updateEventPagePreview(data) {
		const link = document.getElementById("eventPagePreviewLink");
		const banner = document.getElementById("webBannerImg");
		const badge = document.getElementById("webTitleBadge");
		const headline = document.getElementById("webHeadline");
		const venue = document.getElementById("webDate");
		const eventId = (data && data.event_id) || activeEventId;
		const title = (data && data.event_title) || (headline && headline.textContent) || "My Event";
		const isLive = data && String(data.event_status || "").toLowerCase() === "published";

		if (link) {
			link.href = eventId
				? `event-details.html?id=${encodeURIComponent(eventId)}`
				: "event-details.html";
		}
		if (banner) {
			const imgSrc = (data && (data.banner_image || data.image_url))
				|| bannerImageUrl
				|| (window.JodConfig && window.JodConfig.assetUrl
					? window.JodConfig.assetUrl("images/hero-event.jpg")
					: "https://assets.jodevents.com/images/hero-event.jpg");
			banner.src = resolveUploadUrl(imgSrc);
			banner.alt = `${title} banner`;
		}
		if (badge) {
			badge.textContent = isLive ? "Live" : "Draft";
			badge.classList.toggle("is-draft", !isLive);
		}
		if (headline) headline.textContent = title;
		if (venue) {
			venue.textContent = (data && data.venue) || (document.getElementById("eventLocationInput")?.value.trim()) || "Venue TBD";
		}
	}

	function zeroHostKpis() {
		if (kpiSales) kpiSales.textContent = "₹0.00";
		if (kpiRegs) kpiRegs.textContent = "0";
		if (kpiPending) kpiPending.textContent = "0";
		if (kpiAttendees) kpiAttendees.textContent = "0";
		if (kpiDays) kpiDays.textContent = "0";
		["numSpeakers", "numSponsors", "numExhibitors", "exKpiTotal", "exKpiConfirmed", "exKpiPending", "exKpiSponsors", "valSold", "valPending", "valAvail", "valCheckedIn", "valYetToCheckIn", "sidebarCheckinCount"].forEach((id) => {
			const el = document.getElementById(id);
			if (el) el.textContent = id === "valSold" || id === "valPending" || id === "valAvail" ? "0 (0%)" : "0";
		});
		const donutCenterValue = document.getElementById("donutCenterValue");
		const donutCenterLabel = document.getElementById("donutCenterLabel");
		const donutCaption = document.getElementById("donutCaption");
		if (donutCenterValue) donutCenterValue.textContent = "0";
		if (donutCenterLabel) donutCenterLabel.textContent = "of 0 tickets";
		if (donutCaption) donutCaption.textContent = "No active event.";
		["donutPendingPath", "donutSoldPath", "donutCheckinPath"].forEach((id) => {
			const el = document.getElementById(id);
			if (el) el.setAttribute("stroke-dasharray", "0, 100");
		});
	}

	function paintEmptyHostDashboard() {
		hasEvent = false;
		activeEventId = null;
		currentLifecycle = "draft";
		canPublishNew = true;
		canCreateNew = true;
		sessionStorage.removeItem(`has_event_${email}`);
		sessionStorage.removeItem(`active_event_id_${email}`);
		if (dashEventTitle) dashEventTitle.textContent = "My Events Dashboard";
		zeroHostKpis();
		updateEventPagePreview({
			event_id: null,
			event_title: "My Event",
			event_status: "draft",
			venue: "Venue TBD",
			banner_image: ""
		});
		renderOverviewState();
	}

	function clearHostWorkspaceForms() {
		pendingManageEvent = null;
		pendingHostDesignData = null;
		pendingRegistrationForm = null;
		bannerImageUrl = null;
		cardImageUrl = null;
		galleryImageUrls = [];
		if (createEventForm) createEventForm.reset();
		if (eventTitleInput) eventTitleInput.value = "";
		const catSel = document.getElementById("eventCategorySelect");
		if (catSel) catSel.value = "";
		["eventDescInput", "eventDateInput", "eventEndDateInput", "eventLocationInput", "eventDurationInput", "eventVenueLat", "eventVenueLon", "policyEventInput", "policyCancellationInput", "policyRefundInput", "policyTermsInput", "policyPrivacyInput", "policyAgeInput", "ticketPriceNoteInput"].forEach((id) => {
			const el = document.getElementById(id);
			if (el) el.value = "";
		});
		writeAboutEventHtml("");
		const ticketHost = document.getElementById("ticketTiersRows");
		if (ticketHost) {
			ticketHost.innerHTML = "";
			if (typeof createTicketTierRowHtml === "function") {
				ticketHost.appendChild(createTicketTierRowHtml("", "", ""));
			}
		}
		if (typeof applyTicketPurchaseMode === "function") applyTicketPurchaseMode("single", 4, "");
		const agendaHost = document.getElementById("agendaRows");
		if (agendaHost) {
			agendaHost.innerHTML = "";
			if (typeof createAgendaRowHtml === "function") {
				agendaHost.appendChild(createAgendaRowHtml("", "", ""));
			}
		}
		const bannerPreviewBoxEl = document.getElementById("bannerPreviewBox");
		const bannerPreviewImgEl = document.getElementById("bannerPreviewImg");
		const bannerDropzoneContentEl = document.getElementById("bannerDropzoneContent");
		if (bannerPreviewBoxEl) bannerPreviewBoxEl.style.display = "none";
		if (bannerPreviewImgEl) bannerPreviewImgEl.removeAttribute("src");
		if (bannerDropzoneContentEl) bannerDropzoneContentEl.style.display = "";
		const cardPreviewBox = document.getElementById("cardImagePreviewBox");
		const cardPreviewImg = document.getElementById("cardImagePreviewImg");
		if (cardPreviewBox) cardPreviewBox.style.display = "none";
		if (cardPreviewImg) cardPreviewImg.removeAttribute("src");
		const galleryPreview = document.getElementById("galleryPreviewGrid");
		if (galleryPreview) galleryPreview.innerHTML = "";
		if (window.JodFormBuilder && typeof window.JodFormBuilder.loadFromHost === "function") {
			window.JodFormBuilder.loadFromHost({ questions_json: [], form_json: {}, settings_json: {} });
		}
		if (typeof populateDesignRows === "function") populateDesignRows([], []);
	}

	// ── Dynamic Dashboard Data Loader ──────────────────────────────────────────
	async function loadDashboardData() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/dashboard?email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const d = await res.json();
				if (d.customer_id) activeCustomerId = d.customer_id;
				if (d.host_id) activeHostId = d.host_id;
				const life = String(d.lifecycle || d.event_status || "").toLowerCase();
				if (!d.has_event || life === "cancelled" || life === "unpublished") {
					paintEmptyHostDashboard();
					return;
				}
				if (d.has_event) {
					hasEvent = true;
					if (d.event_id) activeEventId = d.event_id;
					if (d.event_title && dashEventTitle) dashEventTitle.textContent = d.event_title;

					// Top 3 KPI Cards
					if (kpiSales) kpiSales.textContent = `₹${(d.total_sales || 0).toLocaleString("en-IN", {minimumFractionDigits: 2})}`;
					if (kpiRegs) kpiRegs.textContent = (d.total_registrations || 0).toLocaleString("en-IN");
					if (kpiPending) {
						const pendingCount = (d.pending_registrations != null)
							? d.pending_registrations
							: Math.max(0, Number(d.total_registrations || 0) - Number(d.tickets_sold || 0));
						kpiPending.textContent = Number(pendingCount || 0).toLocaleString("en-IN");
					}
					if (kpiAttendees) kpiAttendees.textContent = (d.attendees_count || d.tickets_sold || 0).toLocaleString("en-IN");
					if (kpiDays) kpiDays.textContent = d.days_to_event !== undefined ? d.days_to_event : 0;

					applyLiveAttendanceStats(d);
					drawTrendChart(d.registration_trend);
					updateEventPagePreview(d);

					// Event Numbers Grid
					const numSpeakers = document.getElementById("numSpeakers");
					const numSponsors = document.getElementById("numSponsors");
					const numExhibitors = document.getElementById("numExhibitors");

					if (numSpeakers) numSpeakers.textContent = d.speakers_count || 0;
					if (numSponsors) numSponsors.textContent = d.sponsors_count || 0;
					if (numExhibitors) numExhibitors.textContent = d.exhibitors_count || 0;

					// Exhibitor KPI Cards
					const exKpiTotal = document.getElementById("exKpiTotal");
					const exKpiConfirmed = document.getElementById("exKpiConfirmed");
					const exKpiPending = document.getElementById("exKpiPending");
					const exKpiSponsors = document.getElementById("exKpiSponsors");

					if (exKpiTotal) exKpiTotal.textContent = d.exhibitors_count || 0;
					if (exKpiConfirmed) exKpiConfirmed.textContent = d.exhibitors_confirmed || 0;
					if (exKpiPending) exKpiPending.textContent = d.exhibitors_pending || 0;
					if (exKpiSponsors) exKpiSponsors.textContent = d.sponsors_count || 0;
				}
			}
		} catch (err) {
			console.warn("Could not load dynamic dashboard data:", err);
		}
	}

	function applyLiveAttendanceStats(d) {
		const sold = Number(d.tickets_sold || 0);
		const pending = Number(
			d.pending_registrations != null
				? d.pending_registrations
				: Math.max(0, Number(d.total_registrations || 0) - sold)
		);
		const claimed = sold + pending;
		const capacity = Number(d.ticket_capacity || 0);
		const avail = capacity > 0
			? Math.max(0, capacity - claimed)
			: Number(d.tickets_available || 0);
		const total = (capacity > 0 ? capacity : (claimed + avail)) || 1;

		const rawSold = (sold / total) * 100;
		const rawPending = (pending / total) * 100;
		const soldPct = total > 0 ? rawSold : 0;
		const pendingPct = total > 0 ? rawPending : 0;
		const availPct = Math.max(0, 100 - soldPct - pendingPct);

		function fmtPct(n) {
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n < 1) return n.toFixed(1);
			return String(Math.round(n));
		}

		const checked = Number(d.checked_in || 0);
		const yetCheck = Number(d.yet_to_checkin || 0);
		const attendeeTotal = Math.max(sold, checked + yetCheck);
		const checkedPct = attendeeTotal > 0 ? Math.round((checked / attendeeTotal) * 100) : 0;

		const valSold = document.getElementById("valSold");
		const valPending = document.getElementById("valPending");
		const valAvail = document.getElementById("valAvail");
		if (valSold) valSold.textContent = `${sold.toLocaleString()} (${fmtPct(soldPct)}%)`;
		if (valPending) valPending.textContent = `${pending.toLocaleString()} (${fmtPct(pendingPct)}%)`;
		if (valAvail) valAvail.textContent = `${avail.toLocaleString()} (${fmtPct(availPct)}%)`;

		const claimedArc = soldPct + pendingPct;
		const donutPendingPath = document.getElementById("donutPendingPath");
		const donutSoldPath = document.getElementById("donutSoldPath");
		if (donutPendingPath) donutPendingPath.setAttribute("stroke-dasharray", `${claimedArc.toFixed(2)}, 100`);
		if (donutSoldPath) donutSoldPath.setAttribute("stroke-dasharray", `${soldPct.toFixed(2)}, 100`);

		const donutCenterValue = document.getElementById("donutCenterValue");
		const donutCenterLabel = document.getElementById("donutCenterLabel");
		const donutCaption = document.getElementById("donutCaption");
		if (donutCenterValue) donutCenterValue.textContent = claimed.toLocaleString();
		if (donutCenterLabel) donutCenterLabel.textContent = `of ${total.toLocaleString()} tickets`;
		if (donutCaption) {
			donutCaption.textContent = `${sold.toLocaleString()} sold + ${pending.toLocaleString()} pending are held. ${avail.toLocaleString()} still available.`;
		}

		const valCheckedIn = document.getElementById("valCheckedIn");
		const valYetToCheckIn = document.getElementById("valYetToCheckIn");
		if (valCheckedIn) valCheckedIn.textContent = checked.toLocaleString();
		if (valYetToCheckIn) valYetToCheckIn.textContent = yetCheck.toLocaleString();
		const donutCheckinPath = document.getElementById("donutCheckinPath");
		if (donutCheckinPath) donutCheckinPath.setAttribute("stroke-dasharray", `${checkedPct}, 100`);

		const sidebarBadge = document.getElementById("sidebarCheckinCount");
		if (sidebarBadge) {
			sidebarBadge.textContent = String(checked);
			sidebarBadge.classList.toggle("is-visible", checked > 0);
		}

		const evTotalTickets = document.getElementById("evTotalTickets");
		const evCheckedIn = document.getElementById("evCheckedIn");
		const evNotCheckedIn = document.getElementById("evNotCheckedIn");
		const evCheckinRate = document.getElementById("evCheckinRate");
		if (evTotalTickets) evTotalTickets.textContent = sold.toLocaleString();
		if (evCheckedIn) evCheckedIn.textContent = checked.toLocaleString();
		if (evNotCheckedIn) evNotCheckedIn.textContent = yetCheck.toLocaleString();
		if (evCheckinRate) evCheckinRate.textContent = `${checkedPct}%`;

		const attKpiCheckedIn = document.getElementById("attKpiCheckedIn");
		const attKpiYetToCheckIn = document.getElementById("attKpiYetToCheckIn");
		const attKpiSold = document.getElementById("attKpiSold");
		if (attKpiCheckedIn) attKpiCheckedIn.textContent = checked.toLocaleString();
		if (attKpiYetToCheckIn) attKpiYetToCheckIn.textContent = yetCheck.toLocaleString();
		if (attKpiSold) attKpiSold.textContent = sold.toLocaleString();

		if (Array.isArray(d.checked_in_attendees) && d.checked_in_attendees.length) {
			renderAttendanceTable(d.checked_in_attendees);
		} else if (Array.isArray(d.attendees)) {
			renderAttendanceTable(d.attendees.filter((row) => row && row.status === "checked_in"));
		}
	}

	function renderAttendanceTable(attendees) {
		const body = document.getElementById("attendanceTableBody");
		if (!body) return;
		const rows = (attendees || []).slice().sort((a, b) => {
			const ta = new Date(a && a.checked_in_at ? a.checked_in_at : 0).getTime();
			const tb = new Date(b && b.checked_in_at ? b.checked_in_at : 0).getTime();
			return tb - ta;
		});
		if (!rows.length) {
			body.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #94a3b8;">No check-ins yet. Names appear here after a host or volunteer verifies a ticket.</td></tr>`;
			return;
		}
		body.innerHTML = rows.map((row) => {
			const checked = row.status === "checked_in";
			const when = row.checked_in_at ? new Date(row.checked_in_at).toLocaleString() : "—";
			const volunteer = checked ? (row.volunteer_name || row.scanned_by || "—") : "—";
			const ticketBits = [row.booking_ref, row.ticket_type].filter((bit) => String(bit || "").trim());
			const ticketLabel = ticketBits.length ? ticketBits.join(" · ") : "Ticket";
			const badge = checked
				? `<span style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;padding:0.15rem 0.6rem;border-radius:999px;font-size:0.75rem;font-weight:700;">Checked-in</span>`
				: `<span style="background:#fff7ed;color:#c2410c;border:1px solid #fdba74;padding:0.15rem 0.6rem;border-radius:999px;font-size:0.75rem;font-weight:700;">Yet to check-in</span>`;
			return `<tr style="border-bottom:1px solid #f1f5f9;">
				<td style="padding:0.85rem 1.2rem;">
					<div class="dash-ink" style="font-weight:700;">${escapeVolunteerHtml(row.attendee_name || "Guest")}</div>
					<div class="dash-muted-text" style="font-size:0.78rem;">${escapeVolunteerHtml(row.attendee_email || "")}</div>
				</td>
				<td class="dash-muted-text" style="padding:0.85rem 1.2rem;">${escapeVolunteerHtml(ticketLabel)}</td>
				<td style="padding:0.85rem 1.2rem;">${badge}</td>
				<td class="dash-muted-text" style="padding:0.85rem 1.2rem;">${when}</td>
				<td class="dash-ink" style="padding:0.85rem 1.2rem;font-weight:600;">${escapeVolunteerHtml(volunteer)}</td>
			</tr>`;
		}).join("");
	}

	let attendancePollTimer = null;
	const ATTENDANCE_POLL_MS = 8000;

	function startAttendancePolling() {
		stopAttendancePolling();
		attendancePollTimer = setInterval(() => {
			if (document.visibilityState === "visible") loadAttendanceData();
		}, ATTENDANCE_POLL_MS);
	}

	function stopAttendancePolling() {
		if (attendancePollTimer) {
			clearInterval(attendancePollTimer);
			attendancePollTimer = null;
		}
	}

	async function loadAttendanceData() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/attendance?email=${encodeURIComponent(email)}${activeEventId ? "&event_id=" + activeEventId : ""}`, {
				headers: getAuthHeaders(),
				credentials: "include",
				cache: "no-store"
			});
			if (!res.ok) return;
			const data = await res.json();
			applyLiveAttendanceStats(data);
		} catch (err) {
			console.warn("Could not load attendance data:", err);
		}
	}

	function paintCheckinResult(el, ok, message, already) {
		if (!el) return;
		el.style.display = "block";
		if (ok) {
			el.style.background = "#f0fdf4";
			el.style.borderColor = "#bbf7d0";
			el.style.color = "#166534";
		} else if (already) {
			el.style.background = "#fff7ed";
			el.style.borderColor = "#fdba74";
			el.style.color = "#9a3412";
		} else {
			el.style.background = "#fef2f2";
			el.style.borderColor = "#fecaca";
			el.style.color = "#b91c1c";
		}
		el.textContent = message;
	}

	async function performTicketCheckin(code, resultEl) {
		const value = String(code || "").trim();
		if (!value) {
			paintCheckinResult(resultEl, false, "Enter an attendee email or ticket code to validate.");
			return null;
		}
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/registrations/checkin`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
				body: JSON.stringify({
					organizer_email: email,
					event_id: activeEventId,
					qr_token: value,
					attendee_email: value.includes("@") ? value : undefined,
					scan_method: "manual",
					status: "checked_in",
					notes: "Validated from organizer dashboard"
				})
			});
			const data = await res.json().catch(() => ({}));
			const status = String(data.status || "").toLowerCase();
			const already = Boolean(
				data.already_checked_in
				|| data.duplicate
				|| status === "already_used"
				|| status === "duplicate"
				|| status === "already_checked_in"
				|| String(data.check_in_type || "").toLowerCase() === "duplicate"
			);
			const ok = res.ok && data.valid !== false && !already && status !== "cancelled";
			const detail = typeof data.detail === "string" ? data.detail : "";
			const ticketId = data.ticket_id ? String(data.ticket_id) : "";
			let message = data.message || detail || (ok ? `${value} checked in successfully.` : "Could not validate this ticket.");
			if (ok && !/^new check-in/i.test(message)) {
				message = ticketId
					? `New check-in — ticket ${ticketId}. ${message}`
					: `New check-in — ${message}`;
			}
			if (already && !/duplicate/i.test(message)) {
				message = ticketId
					? `Duplicate check-in — ticket ${ticketId}. ${message}`
					: `Duplicate check-in — ${message}`;
			}
			paintCheckinResult(resultEl, ok, (ok ? "✓ " : "") + message.replace(/^✓\s*/, ""), already);
			await loadDashboardData();
			await loadAttendanceData();
			return data;
		} catch (err) {
			console.warn("Could not validate QR/check-in:", err);
			paintCheckinResult(resultEl, false, "Could not reach the check-in service.");
			return null;
		}
	}

	// ── Initializer: Load organizer state & apply initial tab ──────────────────
	(async function initDashboardStateAndTab() {
		await loadDashboardData();

		const initialTab = requestedInitialTab || 'overview';
		switchTab(initialTab);

		if (window.__pendingDashboardTab) {
			switchTab(window.__pendingDashboardTab);
			delete window.__pendingDashboardTab;
		}
		if (window.__pendingSidebarTab) {
			switchTab(window.__pendingSidebarTab);
			delete window.__pendingSidebarTab;
		}
	})();

	async function loadRegistrationModuleData() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/registrations?email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (!res.ok) return;
			const data = await res.json();
			if (data.customer_id) activeCustomerId = data.customer_id;
			if (data.host_id) activeHostId = data.host_id;
			if (data.event_id) activeEventId = data.event_id;

			const summary = data.summary || {};
			const total = summary.total_registrations || 0;
			const confirmed = summary.confirmed_registrations || 0;
			const completion = total > 0 ? `${Math.round((confirmed / total) * 100)}%` : "0%";
			const avgTime = total > 0 ? `${Math.max(1, Math.round(total / 2))}m` : "0m";

			if (typeof window.loadFormSubmissionsData === "function") {
				window.loadFormSubmissionsData();
				return;
			}

			const totalSubmissionsEl = document.getElementById("kpiTotalSubmissions");
			if (totalSubmissionsEl) totalSubmissionsEl.textContent = total.toLocaleString("en-IN");
			const completionRateEl = document.getElementById("kpiCompletionRate");
			if (completionRateEl) completionRateEl.textContent = completion;
			const avgTimeEl = document.getElementById("kpiAvgTime");
			if (avgTimeEl) avgTimeEl.textContent = avgTime;
		} catch (err) {
			console.warn("Could not load registration module data:", err);
		}
	}

	function formatInr(amount, withSign) {
		const value = Number(amount || 0);
		const formatted = `₹${Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		if (!withSign) return formatted;
		if (value > 0) return `+${formatted}`;
		if (value < 0) return `-${formatted}`;
		return `-${formatted}`;
	}

	async function loadReportsData() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/reports?email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (!res.ok) return;
			const data = await res.json();
			const gross = Number(data.gross_revenue || 0);
			const platformFee = Number(data.platform_fee != null ? data.platform_fee : gross * 0.05);
			const gstFee = Number(data.gst_fee != null ? data.gst_fee : gross * 0.18);
			const net = Number(data.net_earnings != null ? data.net_earnings : gross - platformFee - gstFee);
			const platformPct = Number(data.platform_fee_pct || 5);
			const gstPct = Number(data.gst_fee_pct != null ? data.gst_fee_pct : 18);

			const grossRevenueEl = document.getElementById("repGrossRevenue");
			const netEarningsEl = document.getElementById("repNetEarnings");
			const attendanceRateEl = document.getElementById("repAttendanceRate");
			const conversionRateEl = document.getElementById("repConversionRate");
			if (grossRevenueEl) grossRevenueEl.textContent = formatInr(gross);
			if (netEarningsEl) netEarningsEl.textContent = formatInr(net);
			if (attendanceRateEl) attendanceRateEl.textContent = `${Number(data.attendance_rate || 0).toFixed(1)}%`;
			if (conversionRateEl) conversionRateEl.textContent = `${Number(data.conversion_rate || 0).toFixed(1)}%`;

			const grossSalesEl = document.getElementById("repGrossSales");
			const platformFeeEl = document.getElementById("repPlatformFee");
			const gstFeeEl = document.getElementById("repGstFee");
			const netPayoutEl = document.getElementById("repNetPayout");
			const platformLabel = document.getElementById("repPlatformFeeLabel");
			const gstLabel = document.getElementById("repGstFeeLabel");
			if (grossSalesEl) grossSalesEl.textContent = formatInr(gross);
			if (platformFeeEl) platformFeeEl.textContent = formatInr(-platformFee, true);
			if (gstFeeEl) gstFeeEl.textContent = formatInr(-gstFee, true);
			if (netPayoutEl) netPayoutEl.textContent = formatInr(net);
			if (platformLabel) platformLabel.textContent = `Platform Service Fee (${platformPct}%)`;
			if (gstLabel) gstLabel.textContent = `Taxes & Statutory GST (${gstPct}%)`;

			const ticketRowsEl = document.getElementById("repTicketFeeRows");
			if (ticketRowsEl) {
				ticketRowsEl.style.display = "none";
				ticketRowsEl.innerHTML = "";
			}

			const citiesEl = document.getElementById("repTopCities");
			if (citiesEl) {
				const cities = Array.isArray(data.top_cities) ? data.top_cities : [];
				if (!cities.length) {
					citiesEl.innerHTML = `<div style="text-align: center; padding: 1.2rem 0.5rem; color: #94a3b8;">No attendee locations yet.</div>`;
				} else {
					citiesEl.innerHTML = cities.map((row, index) => {
						const isLast = index === cities.length - 1;
						const isOther = /other locations|location not shared/i.test(row.city || "");
						const wrapStyle = isLast
							? "display:flex;justify-content:space-between;padding-top:0.4rem;font-size:0.9rem;font-weight:700;"
							: "display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding-bottom:0.5rem;";
						const countClass = isOther ? "dash-muted-text" : "dash-ink";
						return `<div class="dash-muted-text" style="${wrapStyle}"><span>${row.city || "Unknown"}</span><span class="${countClass}" style="${isOther ? "" : "font-weight:700;"}">${Number(row.count || 0).toLocaleString("en-IN")} (${Number(row.percent || 0)}%)</span></div>`;
					}).join("");
				}
			}
		} catch (err) {
			console.warn("Could not load reports data:", err);
		}
	}

	let cachedCommAudienceOptions = [];

	function renderCommAudienceOptions(options, selectedValue) {
		const audienceSelect = document.getElementById("commAudienceSelect");
		if (!audienceSelect) return;
		cachedCommAudienceOptions = Array.isArray(options) ? options : [];
		const prev = selectedValue || audienceSelect.value;
		if (!cachedCommAudienceOptions.length) {
			audienceSelect.innerHTML = `<option value="all_tickets">All Ticket Holders (0)</option>`;
			return;
		}
		audienceSelect.innerHTML = cachedCommAudienceOptions.map((opt) => {
			const label = escapeVolunteerHtml(opt.label || "Ticket");
			const count = Number(opt.count || 0);
			const value = escapeVolunteerHtml(opt.value || "all_tickets");
			return `<option value="${value}">${label} (${count})</option>`;
		}).join("");
		if (prev && [...audienceSelect.options].some((o) => o.value === prev)) {
			audienceSelect.value = prev;
		}
	}

	function commAudienceLabel(value) {
		const match = cachedCommAudienceOptions.find((opt) => opt.value === value);
		if (match) return `${match.label} (${match.count})`;
		if (value === "all_tickets" || value === "all_attendees") return "All Ticket Holders";
		if (value && value.startsWith("ticket_type:")) {
			return value.replace("ticket_type:", "").replace(/_/g, " ");
		}
		return value || "All Ticket Holders";
	}

	async function loadCommunicationsData() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/communications?email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (!res.ok) return;
			const data = await res.json();
			const communications = data.communications || [];
			renderCommAudienceOptions(data.audience_options || []);

			const commHistoryContainer = document.getElementById("commHistoryContainer");
			if (commHistoryContainer) {
				if (communications.length === 0) {
					commHistoryContainer.innerHTML = `
						<div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8; border: 2px dashed #e2e8f0; border-radius: 8px;">
							<div style="font-size: 1.5rem; margin-bottom: 0.4rem;">📢</div>
							<div style="font-weight: 700; color: #475569;">No Communications Sent Yet</div>
							<div style="font-size: 0.82rem; margin-top: 0.2rem;">Use the composer above to broadcast updates to ticket holders by pass type.</div>
						</div>
					`;
				} else {
					commHistoryContainer.innerHTML = communications.map(c => `
						<div class="dash-surface" style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
							<div>
								<div class="dash-ink" style="font-weight: 700; font-size: 0.95rem;">${escapeVolunteerHtml(c.subject || 'Broadcast Message')}</div>
								<div class="dash-muted-text" style="font-size: 0.82rem; margin-top: 0.2rem;">Channel: ${escapeVolunteerHtml(c.channel || 'Email')} | Audience: ${escapeVolunteerHtml(commAudienceLabel(c.audience))}</div>
							</div>
							<span style="background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">Sent</span>
						</div>
					`).join('');
				}
			}
		} catch (err) {
			console.warn("Could not load communications:", err);
		}
	}

	// ── Exhibitors Dynamic Table & Modal Handler ─────────────────────────────
	let cachedExhibitors = [];

	async function loadExhibitors() {
		if (!email) return;
		const tableBody = document.getElementById("exhibitorTableBody");
		if (!tableBody) return;

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/exhibitors?email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				cachedExhibitors = data.exhibitors || [];

				const exKpiTotal = document.getElementById("exKpiTotal");
				const exKpiConfirmed = document.getElementById("exKpiConfirmed");
				const exKpiPending = document.getElementById("exKpiPending");

				if (exKpiTotal) exKpiTotal.textContent = data.total || 0;
				if (exKpiConfirmed) exKpiConfirmed.textContent = data.confirmed || 0;
				if (exKpiPending) exKpiPending.textContent = data.pending || 0;

				renderExhibitorsTable(cachedExhibitors);
			} else {
				renderExhibitorsTable([]);
			}
		} catch (err) {
			console.warn("Could not load exhibitors:", err);
			renderExhibitorsTable([]);
		}
	}

	function renderExhibitorsTable(list) {
		const tableBody = document.getElementById("exhibitorTableBody");
		if (!tableBody) return;

		if (!list || list.length === 0) {
			tableBody.innerHTML = `
				<tr>
					<td colspan="5" style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8;">
						<div style="font-size: 1.5rem; margin-bottom: 0.4rem;">🎪</div>
						<div style="font-weight: 700; color: #475569;">No Exhibitors Added Yet</div>
						<div style="font-size: 0.82rem; margin-top: 0.2rem;">Click "+ Add New Exhibitor" above to add booth vendors and partners.</div>
					</td>
				</tr>
			`;
			return;
		}

		tableBody.innerHTML = list.map(ex => `
			<tr style="border-bottom: 1px solid #f1f5f9;">
				<td class="dash-ink" style="padding: 0.85rem 1.2rem; font-weight: 700;">${escapeVolunteerHtml(ex.company_name)}</td>
				<td class="dash-muted-text" style="padding: 0.85rem 1.2rem;">${escapeVolunteerHtml(ex.category)}</td>
				<td class="dash-muted-text" style="padding: 0.85rem 1.2rem;">${escapeVolunteerHtml(ex.contact_name)} <br/><span class="dash-muted-text" style="font-size: 0.78rem;">${escapeVolunteerHtml(ex.contact_email)}</span></td>
				<td style="padding: 0.85rem 1.2rem;">
					<span style="background: ${ex.status === 'confirmed' ? '#f0fdf4' : '#fffbe6'}; border: 1px solid ${ex.status === 'confirmed' ? '#bbf7d0' : '#ffe58f'}; color: ${ex.status === 'confirmed' ? '#166534' : '#873800'}; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">
						${ex.status === 'confirmed' ? 'Confirmed' : 'Pending Approval'}
					</span>
				</td>
				<td style="padding: 0.85rem 1.2rem; text-align: right;">
					<button type="button" class="btn-delete-exhibitor" data-id="${escapeVolunteerHtml(ex.exhibitor_id)}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Remove</button>
				</td>
			</tr>
		`).join('');

		tableBody.querySelectorAll(".btn-delete-exhibitor").forEach(btn => {
			btn.addEventListener("click", async (e) => {
				const exId = btn.getAttribute("data-id");
				if (confirm("Remove this exhibitor?")) {
					try {
						await fetch(`${HOST_EVENTS_API_BASE}/exhibitors/${exId}`, { method: "DELETE" });
						loadExhibitors();
						showNotification("Exhibitor removed successfully.");
					} catch (err) {
						console.warn("Could not delete exhibitor:", err);
					}
				}
			});
		});
	}

	// Add Exhibitor Modal Listeners
	const btnAddExhibitorModalBtn = document.getElementById("btnAddExhibitorModalBtn");
	const addExhibitorModal = document.getElementById("addExhibitorModal");
	const btnCloseExhibitorModal = document.getElementById("btnCloseExhibitorModal");
	const btnCancelExhibitorModal = document.getElementById("btnCancelExhibitorModal");
	const addExhibitorForm = document.getElementById("addExhibitorForm");

	function openExhibitorModal() {
		if (addExhibitorModal) addExhibitorModal.style.display = "flex";
	}
	function closeExhibitorModal() {
		if (addExhibitorModal) addExhibitorModal.style.display = "none";
		if (addExhibitorForm) addExhibitorForm.reset();
	}

	if (btnAddExhibitorModalBtn) btnAddExhibitorModalBtn.addEventListener("click", openExhibitorModal);
	if (btnCloseExhibitorModal) btnCloseExhibitorModal.addEventListener("click", closeExhibitorModal);
	if (btnCancelExhibitorModal) btnCancelExhibitorModal.addEventListener("click", closeExhibitorModal);

	if (addExhibitorForm) {
		addExhibitorForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			const payload = {
				organizer_email: email,
				event_id: activeEventId,
				company_name: document.getElementById("exCompanyInput").value.trim(),
				contact_name: document.getElementById("exContactNameInput").value.trim(),
				contact_email: document.getElementById("exContactEmailInput").value.trim(),
				category: document.getElementById("exCategorySelect").value,
				status: document.getElementById("exStatusSelect").value
			};

			try {
				const res = await fetch(`${HOST_EVENTS_API_BASE}/exhibitors`, {
					method: "POST",
					headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
					body: JSON.stringify(payload)
				});
				if (res.ok) {
					closeExhibitorModal();
					loadExhibitors();
					showNotification("✓ Exhibitor added successfully!");
				}
			} catch (err) {
				console.warn("Could not save exhibitor:", err);
			}
		});
	}

	// ── Gate Management & Scanner Access Logic ──────────────────────────────
	let cachedGates = [];
	let cachedScanners = [];

	const gateForm = document.getElementById("gateForm");
	const gateIdInput = document.getElementById("gateIdInput");
	const gateNameInput = document.getElementById("gateNameInput");
	const gateCodeInput = document.getElementById("gateCodeInput");
	const gateDescInput = document.getElementById("gateDescInput");
	const btnCancelGateEdit = document.getElementById("btnCancelGateEdit");
	const gatesTableBody = document.getElementById("gatesTableBody");
	const volunteerGateSelect = document.getElementById("volunteerGateSelect");

	async function loadGates() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/gates?organizer_email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				cachedGates = data.gates || [];
				renderGatesTable(cachedGates);
				populateGateDropdown(cachedGates);
			}
		} catch (err) {
			console.warn("Could not load gates:", err);
		}
	}

	function renderGatesTable(gates) {
		if (!gatesTableBody) return;
		if (!gates || gates.length === 0) {
			gatesTableBody.innerHTML = `
				<tr>
					<td colspan="5" style="text-align: center; padding: 1.5rem; color: #94a3b8;">
						No gates configured for this event yet. Add a gate above to get started.
					</td>
				</tr>
			`;
			return;
		}

		gatesTableBody.innerHTML = gates.map(g => `
			<tr style="border-bottom: 1px solid #f1f5f9;">
				<td class="dash-ink" style="padding: 0.75rem 1rem; font-weight: 700;">${escapeVolunteerHtml(g.gate_name)}</td>
				<td class="dash-muted-text" style="padding: 0.75rem 1rem;">${escapeVolunteerHtml(g.gate_code || '—')}</td>
				<td class="dash-muted-text" style="padding: 0.75rem 1rem;">${escapeVolunteerHtml(g.gate_description || '—')}</td>
				<td style="padding: 0.75rem 1rem;">
					<span style="background: ${g.status === 'Active' ? '#f0fdf4' : '#fee2e2'}; border: 1px solid ${g.status === 'Active' ? '#bbf7d0' : '#fecaca'}; color: ${g.status === 'Active' ? '#166534' : '#991b1b'}; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700; cursor: pointer;" class="btn-toggle-gate-status" data-id="${escapeVolunteerHtml(g.gate_id)}" data-status="${escapeVolunteerHtml(g.status)}">
						${escapeVolunteerHtml(g.status)}
					</span>
				</td>
				<td style="padding: 0.75rem 1rem; text-align: right; display: flex; gap: 0.4rem; justify-content: flex-end;">
					<button type="button" class="btn-edit-gate" data-id="${escapeVolunteerHtml(g.gate_id)}" style="background: #ffffff; border: 1px solid #cbd5e1; color: #2563eb; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Edit</button>
					<button type="button" class="btn-delete-gate" data-id="${escapeVolunteerHtml(g.gate_id)}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Delete</button>
				</td>
			</tr>
		`).join('');

		// Attach listeners to Toggle Status
		gatesTableBody.querySelectorAll(".btn-toggle-gate-status").forEach(btn => {
			btn.addEventListener("click", async () => {
				const gateId = btn.getAttribute("data-id");
				const currentStatus = btn.getAttribute("data-status");
				const targetStatus = currentStatus === "Active" ? "Inactive" : "Active";
				const gateObj = cachedGates.find(x => x.gate_id === gateId);
				if (!gateObj) return;

				try {
					const res = await fetch(`${HOST_EVENTS_API_BASE}/gates`, {
						method: "POST",
						headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
						body: JSON.stringify({
							gate_id: gateId,
							event_id: activeEventId,
							organizer_email: email,
							gate_name: gateObj.gate_name,
							gate_code: gateObj.gate_code,
							gate_description: gateObj.gate_description,
							status: targetStatus
						})
					});
					if (res.ok) {
						loadGates();
						showNotification(`Gate is now ${targetStatus}.`);
					} else {
						const errData = await res.json();
						alert(errData.detail || "Could not toggle gate status.");
					}
				} catch (err) {
					console.warn(err);
				}
			});
		});

		// Attach listeners to Edit
		gatesTableBody.querySelectorAll(".btn-edit-gate").forEach(btn => {
			btn.addEventListener("click", () => {
				const gateId = btn.getAttribute("data-id");
				const gObj = cachedGates.find(x => x.gate_id === gateId);
				if (gObj) {
					if (gateIdInput) gateIdInput.value = gObj.gate_id;
					if (gateNameInput) gateNameInput.value = gObj.gate_name;
					if (gateCodeInput) gateCodeInput.value = gObj.gate_code;
					if (gateDescInput) gateDescInput.value = gObj.gate_description;
					if (btnCancelGateEdit) btnCancelGateEdit.style.display = "inline-block";
					window.scrollTo({ top: gateForm.offsetTop - 100, behavior: "smooth" });
				}
			});
		});

		// Attach listeners to Delete
		gatesTableBody.querySelectorAll(".btn-delete-gate").forEach(btn => {
			btn.addEventListener("click", async () => {
				const gateId = btn.getAttribute("data-id");
				if (confirm("Are you sure you want to delete this gate?")) {
					try {
						const res = await fetch(`${HOST_EVENTS_API_BASE}/gates/${gateId}`, {
							method: "DELETE",
							headers: getAuthHeaders()
						});
						if (res.ok) {
							loadGates();
							showNotification("Gate deleted successfully.");
						} else {
							const errData = await res.json();
							alert(errData.detail || "Could not delete gate.");
						}
					} catch (err) {
						console.warn(err);
					}
				}
			});
		});
	}

	function populateGateDropdown(gates) {
		const volunteerGateSelect = document.getElementById("volunteerGateSelect");
		const volunteerGateField = document.getElementById("volunteerGateField");
		const volunteerGateHint = document.getElementById("volunteerGateHint");
		const inviteBtn = document.getElementById("btnInviteVolunteer");
		const activeGates = (gates || []).filter((g) => String(g.status || "Active").toLowerCase() === "active");
		const hasGates = activeGates.length > 0;
		if (volunteerGateField) volunteerGateField.style.display = hasGates ? "block" : "none";
		if (volunteerGateHint) volunteerGateHint.style.display = hasGates ? "none" : "block";
		if (inviteBtn) inviteBtn.disabled = !hasGates;
		if (!volunteerGateSelect) return;
		if (!hasGates) {
			volunteerGateSelect.innerHTML = `<option value="" disabled selected>Save a gate first</option>`;
			return;
		}
		volunteerGateSelect.innerHTML = `<option value="" disabled selected>Select a saved gate</option>` + activeGates.map((g) => {
			const code = g.gate_code ? ` (${escapeVolunteerHtml(g.gate_code)})` : "";
			return `<option value="${escapeVolunteerHtml(g.gate_id)}">${escapeVolunteerHtml(g.gate_name)}${code}</option>`;
		}).join("");
	}

	// Gate Form Submit Listener
	if (gateForm) {
		gateForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			const payload = {
				gate_id: gateIdInput.value || null,
				event_id: activeEventId,
				organizer_email: email,
				gate_name: gateNameInput.value.trim(),
				gate_code: gateCodeInput.value.trim() || null,
				gate_description: gateDescInput.value.trim() || null,
				status: "Active"
			};

			try {
				const res = await fetch(`${HOST_EVENTS_API_BASE}/gates`, {
					method: "POST",
					headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
					body: JSON.stringify(payload)
				});
				if (res.ok) {
					gateForm.reset();
					if (gateIdInput) gateIdInput.value = "";
					if (btnCancelGateEdit) btnCancelGateEdit.style.display = "none";
					loadGates();
					showNotification("✓ Gate saved successfully!");
				} else {
					const errData = await res.json();
					alert(errData.detail || "Could not save gate.");
				}
			} catch (err) {
				console.warn("Could not save gate:", err);
			}
		});
	}

	if (btnCancelGateEdit) {
		btnCancelGateEdit.addEventListener("click", () => {
			gateForm.reset();
			if (gateIdInput) gateIdInput.value = "";
			btnCancelGateEdit.style.display = "none";
		});
	}

	async function loadVolunteers() {
		const tableBody = document.getElementById("volunteerTableBody");
		if (!tableBody) return;

		try {
			const qs = activeEventId ? `?event_id=${encodeURIComponent(activeEventId)}` : "";
			const res = await fetch(`${VOLUNTEERS_API}${qs}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				cachedScanners = data.volunteers || [];
				renderVolunteersTable(cachedScanners);
			} else if (res.status === 401) {
				tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 1.5rem; color: #94a3b8;">Sign in to manage volunteers.</td></tr>`;
			}
		} catch (err) {
			console.warn("Could not load volunteers:", err);
		}
	}

	function loadScanners() {
		return loadVolunteers();
	}

	function volunteerStatusStyle(status) {
		const s = String(status || "").toUpperCase();
		if (s === "ACTIVE") return { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534", label: "Active" };
		if (s === "PENDING") return { bg: "#fff7ed", border: "#fed7aa", color: "#c2410c", label: "Pending" };
		if (s === "REVOKED") return { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", label: "Revoked" };
		if (s === "EXPIRED") return { bg: "#f8fafc", border: "#e2e8f0", color: "#64748b", label: "Expired" };
		return { bg: "#f8fafc", border: "#e2e8f0", color: "#475569", label: s || "Unknown" };
	}

	function escapeVolunteerHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function renderVolunteersTable(volunteers) {
		const tableBody = document.getElementById("volunteerTableBody");
		if (!tableBody) return;

		if (!volunteers || volunteers.length === 0) {
			tableBody.innerHTML = `
				<tr>
					<td colspan="6" style="text-align: center; padding: 1.5rem; color: #94a3b8;">
						No volunteers invited yet. Save a gate, then add a volunteer email above.
					</td>
				</tr>
			`;
			return;
		}

		tableBody.innerHTML = volunteers.map((row) => {
			const st = volunteerStatusStyle(row.status);
			const roleLabel = (row.role || "SCANNER").toUpperCase() === "SCANNER" ? "Scanner" : escapeVolunteerHtml(row.role);
			const gateLabel = row.gate_name || "—";
			const canResend = String(row.status || "").toUpperCase() === "PENDING";
			const canRevoke = ["PENDING", "ACTIVE"].includes(String(row.status || "").toUpperCase());
			const actions = [];
			if (canResend) {
				actions.push(`<button type="button" class="btn-resend-volunteer" data-id="${escapeVolunteerHtml(row.id)}" data-name="${escapeVolunteerHtml(row.name)}" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; margin-left: 0.35rem;">Resend</button>`);
			}
			if (canRevoke) {
				actions.push(`<button type="button" class="btn-revoke-volunteer" data-id="${escapeVolunteerHtml(row.id)}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; margin-left: 0.35rem;">Revoke</button>`);
			}
			return `
			<tr style="border-bottom: 1px solid #f1f5f9;">
				<td class="dash-ink" style="padding: 0.8rem 1rem; font-weight: 700;">${escapeVolunteerHtml(row.name)}</td>
				<td class="dash-muted-text" style="padding: 0.8rem 1rem;">${escapeVolunteerHtml(row.email)}</td>
				<td class="dash-muted-text" style="padding: 0.8rem 1rem;">${escapeVolunteerHtml(gateLabel)}</td>
				<td class="dash-muted-text" style="padding: 0.8rem 1rem;">${roleLabel}</td>
				<td style="padding: 0.8rem 1rem;"><span style="background: ${st.bg}; border: 1px solid ${st.border}; color: ${st.color}; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">${st.label}</span></td>
				<td style="padding: 0.8rem 1rem; text-align: right;">${actions.join("") || "—"}</td>
			</tr>`;
		}).join("");

		tableBody.querySelectorAll(".btn-revoke-volunteer").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const volunteerId = btn.getAttribute("data-id");
				if (!confirm("Revoke this volunteer's scanner access?")) return;
					try {
					const res = await fetch(`${VOLUNTEERS_API}/${volunteerId}/revoke`, {
						method: "POST",
							headers: getAuthHeaders()
						});
						if (res.ok) {
						loadVolunteers();
						loadEventDayVolunteerStats();
						showNotification("Volunteer access revoked.");
						} else {
						const err = await res.json().catch(() => ({}));
						alert(apiErrorMessage(err, "Could not revoke volunteer."));
						}
					} catch (err) {
						console.warn(err);
					}
			});
		});

		tableBody.querySelectorAll(".btn-resend-volunteer").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const volunteerId = btn.getAttribute("data-id");
				const volunteerName = btn.getAttribute("data-name") || "";
				hideVolunteerInviteLink();
				try {
					const res = await fetch(`${VOLUNTEERS_API}/${volunteerId}/resend`, {
						method: "POST",
						headers: getAuthHeaders()
					});
					const data = await res.json().catch(() => ({}));
					if (res.ok) {
						showVolunteerInviteLink(data.invite_url, volunteerName, data.email_sent);
						loadVolunteers();
						showNotification(data.email_sent === false
							? "Invitation link ready. Email could not be sent — copy the live link."
							: "Invitation resent.");
					} else {
						alert(apiErrorMessage(data, "Could not resend invitation."));
					}
				} catch (err) {
					console.warn(err);
				}
			});
		});
	}

	function hideVolunteerInviteLink() {
		const generatedLinkContainer = document.getElementById("generatedLinkContainer");
		const volunteerPortalUrl = document.getElementById("volunteerPortalUrl");
		const volunteerLinkLabel = document.getElementById("volunteerLinkLabel");
		if (volunteerPortalUrl) volunteerPortalUrl.value = "";
		if (volunteerLinkLabel) volunteerLinkLabel.textContent = "Invitation link (also emailed):";
		if (generatedLinkContainer) generatedLinkContainer.style.display = "none";
	}

	function publicVolunteerInviteUrl(url) {
		if (!url) return "";
		try {
			const parsed = new URL(url, window.location.origin);
			const host = (parsed.hostname || "").toLowerCase();
			if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
				parsed.protocol = window.location.protocol;
				parsed.host = window.location.host;
			}
			return parsed.toString();
		} catch (_) {
			return String(url);
		}
	}

	function showVolunteerInviteLink(url, volunteerName, emailSent) {
		const generatedLinkContainer = document.getElementById("generatedLinkContainer");
		const volunteerPortalUrl = document.getElementById("volunteerPortalUrl");
		const volunteerLinkLabel = document.getElementById("volunteerLinkLabel");
		if (!generatedLinkContainer || !volunteerPortalUrl || !url) return;
		const liveUrl = publicVolunteerInviteUrl(url);
		volunteerPortalUrl.value = liveUrl;
		if (volunteerLinkLabel) {
			const emailed = emailSent !== false;
			if (volunteerName && emailed) {
				volunteerLinkLabel.textContent = `Invitation link for ${volunteerName} (also emailed):`;
			} else if (volunteerName) {
				volunteerLinkLabel.textContent = `Invitation link for ${volunteerName} (copy and send this live link):`;
			} else if (emailed) {
				volunteerLinkLabel.textContent = "Invitation link (also emailed):";
			} else {
				volunteerLinkLabel.textContent = "Invitation link (copy and send this live link):";
			}
		}
		generatedLinkContainer.style.display = "block";
	}

	function formatEventDayTime(iso) {
		if (!iso) return "";
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return "";
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	async function loadEventDayVolunteerStats() {
		try {
			const qs = activeEventId ? `?event_id=${encodeURIComponent(activeEventId)}` : "";
			const res = await fetch(`${VOLUNTEERS_API}/event-day-stats${qs}`, {
				headers: getAuthHeaders()
			});
			if (!res.ok) return;
			const data = await res.json();
			const totalEl = document.getElementById("evTotalTickets");
			const checkedEl = document.getElementById("evCheckedIn");
			const notEl = document.getElementById("evNotCheckedIn");
			const rateEl = document.getElementById("evCheckinRate");
			const activeEl = document.getElementById("evActiveVolunteers");
			if (totalEl) totalEl.textContent = Number(data.total_tickets || 0).toLocaleString();
			if (checkedEl) checkedEl.textContent = Number(data.checked_in || 0).toLocaleString();
			if (notEl) notEl.textContent = Number(data.not_checked_in || 0).toLocaleString();
			if (rateEl) rateEl.textContent = `${Number(data.checkin_rate || 0)}%`;
			if (activeEl) activeEl.textContent = Number(data.active_volunteers || 0).toLocaleString();
		} catch (err) {
			console.warn("Could not load event day volunteer stats:", err);
		}
	}

	// Quick Action Buttons Listener
	document.querySelectorAll(".qa-btn").forEach(btn => {
		btn.addEventListener("click", () => {
			const targetTab = btn.getAttribute("data-tab");
			if (targetTab) switchTab(targetTab);
		});
	});

	const btnGoToRegs = document.getElementById("btnGoToRegs");
	if (btnGoToRegs) {
		btnGoToRegs.addEventListener("click", () => switchTab("registrations"));
	}

	const btnSendBroadcast = document.getElementById("btnSendBroadcast");
	if (btnSendBroadcast) {
		btnSendBroadcast.addEventListener("click", async () => {
			const subject = document.getElementById("commSubjectInput")?.value.trim();
			const message = document.getElementById("commBodyInput")?.value.trim();
			const audience = document.getElementById("commAudienceSelect")?.value || "all_tickets";
			const channel = document.getElementById("commChannelSelect")?.value || "email";
			if (!subject || !message) {
				alert("Please enter both a subject and a message before sending.");
				return;
			}
			try {
				const res = await fetch(`${HOST_EVENTS_API_BASE}/communications`, {
					method: "POST",
					headers: Object.assign({"Content-Type": "application/json"}, getAuthHeaders()),
					body: JSON.stringify({
						organizer_email: email,
						event_id: activeEventId,
						audience,
						channel,
						subject,
						message,
						status: "sent",
						delivery_status: "sent"
					})
				});
				if (res.ok) {
					showNotification("Broadcast saved and queued for delivery.");
					loadCommunicationsData();
				} else {
					const errData = await res.json().catch(() => ({}));
					alert(errData.detail || "Could not send broadcast.");
				}
			} catch (err) {
				console.warn("Broadcast save failed:", err);
			}
		});
	}

	const btnSaveTemplate = document.getElementById("btnSaveTemplate");
	if (btnSaveTemplate) {
		btnSaveTemplate.addEventListener("click", async () => {
			const subject = document.getElementById("commSubjectInput")?.value.trim();
			const message = document.getElementById("commBodyInput")?.value.trim();
			if (!subject || !message) {
				alert("Please enter a subject and message before saving a template.");
				return;
			}
			try {
				const res = await fetch(`${HOST_EVENTS_API_BASE}/communications`, {
					method: "POST",
					headers: Object.assign({"Content-Type": "application/json"}, getAuthHeaders()),
					body: JSON.stringify({
						organizer_email: email,
						event_id: activeEventId,
						audience: document.getElementById("commAudienceSelect")?.value || "all_tickets",
						channel: document.getElementById("commChannelSelect")?.value || "email",
						subject,
						message,
						status: "draft",
						delivery_status: "pending"
					})
				});
				if (res.ok) {
					showNotification("Template saved successfully.");
				}
			} catch (err) {
				console.warn("Template save failed:", err);
			}
		});
	}

	const btnValidateQr = document.getElementById("btnValidateQr");
	const liveQrInput = document.getElementById("liveQrInput");
	const qrScanResult = document.getElementById("qrScanResult");
	if (btnValidateQr) {
		btnValidateQr.addEventListener("click", async () => {
			const value = liveQrInput ? liveQrInput.value.trim() : "";
			await performTicketCheckin(value, qrScanResult);
		});
	}
	if (liveQrInput) {
		liveQrInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				btnValidateQr && btnValidateQr.click();
			}
		});
	}

	const btnRefreshAttendance = document.getElementById("btnRefreshAttendance");
	if (btnRefreshAttendance) {
		btnRefreshAttendance.addEventListener("click", () => {
			loadDashboardData();
			loadAttendanceData();
		});
	}

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible" && normalizeTab(new URLSearchParams(window.location.search).get("tab") || "") === "attendance") {
			loadAttendanceData();
		}
	});
	window.addEventListener("focus", () => {
		if (normalizeTab(new URLSearchParams(window.location.search).get("tab") || "") === "attendance") {
			loadAttendanceData();
		}
	});

	function applySectionActionLabels() {
		const published = isPublishedLifecycle() || currentLifecycle === "ended";
		const btnManage = document.getElementById("btnManageNext");
		const btnDesign = document.getElementById("btnSaveDesign");
		const btnForm = document.getElementById("btnSaveDraftForm");
		if (btnManage) {
			btnManage.innerHTML = published
				? "<span>Update Manage</span>"
				: "<span>Save &amp; Next: Design</span> →";
			delete btnManage.dataset.originalLabel;
		}
		if (btnDesign) {
			btnDesign.innerHTML = published
				? "<span>Update Design</span>"
				: "<span>Save &amp; Next: Registration Form</span> →";
			delete btnDesign.dataset.originalLabel;
		}
		if (btnForm) {
			btnForm.textContent = published ? "Update Registration Form" : "Save & Next";
		}
		const btnPublish = document.getElementById("btnPublishForm");
		if (btnPublish && published) {
			btnPublish.innerHTML = "Update &amp; Republish";
		}
	}

	function updateLifecycleBanners() {
		const endedBanner = document.getElementById("endedEventBanner");
		const blockBanner = document.getElementById("activeEventBlockBanner");
		if (endedBanner) {
			endedBanner.style.display = currentLifecycle === "ended" ? "block" : "none";
		}
		if (blockBanner) {
			const showBlock = isPublishedLifecycle() && !canPublishNew;
			blockBanner.style.display = showBlock ? "block" : "none";
		}
	}

	function applyLifecycleStatusBadge() {
		if (!dashEventStatus) return;
		const map = {
			draft: { text: "Draft", bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1" },
			ready_to_publish: { text: "Ready to publish", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
			published: { text: "Published", bg: "#10b98122", color: "#10b981", border: "#10b98166" },
			live: { text: "Live", bg: "#dcfce7", color: "#166534", border: "#86efac" },
			ended: { text: "Ended", bg: "#fff7ed", color: "#c2410c", border: "#fdba74" },
			cancelled: { text: "Cancelled", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" }
		};
		const key = hasEvent ? (currentLifecycle || "published") : "draft";
		const s = map[key] || map.draft;
		if (!hasEvent) {
			dashEventStatus.textContent = "No Event";
			dashEventStatus.style.background = map.draft.bg;
			dashEventStatus.style.color = map.draft.color;
			dashEventStatus.style.borderColor = map.draft.border;
			return;
		}
		dashEventStatus.textContent = s.text;
		dashEventStatus.className = "status-badge-published";
		dashEventStatus.style.background = s.bg;
		dashEventStatus.style.color = s.color;
		dashEventStatus.style.borderColor = s.border;
	}

	function renderOverviewState() {
		if (window.__renderingOverview) return;
		window.__renderingOverview = true;
		try {
			if (!hasEvent) {
				if (emptyStateCard) emptyStateCard.style.display = "flex";
				if (populatedOverviewGrid) populatedOverviewGrid.style.display = "none";
			} else {
				if (emptyStateCard) emptyStateCard.style.display = "none";
				if (populatedOverviewGrid) populatedOverviewGrid.style.display = "flex";
				loadDashboardData();
				setTimeout(drawTrendChart, 100);
			}
			applyLifecycleStatusBadge();
			updateLifecycleBanners();
			applySectionActionLabels();
		} finally {
			window.__renderingOverview = false;
		}
	}

	// Sidebar listeners: idempotent (safe double-bind) via permanent init guard flags
	try {
		if (typeof window.__sidebarPermanentInit !== 'undefined') {
			window.__sidebarPermanentInit = true;
		}
	} catch (_) {}

	const sidebarItems = document.querySelectorAll(".sidebar-item[data-tab]");
	try {
		console.debug && console.debug("Dashboard scope sidebar re-sync, count:", sidebarItems.length);
	} catch (e) {}

	sidebarItems.forEach((item) => {
		if (item.dataset.dashboardBound === '1') return;
		item.dataset.dashboardBound = '1';
		item.addEventListener("click", (e) => {
			const tab = item.getAttribute("data-tab");
			if (!tab) return;
			try { switchTab(tab); } catch (err) { console.error("switchTab error:", err); }
		});
	});

	const emptyIconOrBtn = document.getElementById("emptyStateIcon");
	if (emptyIconOrBtn) {
		emptyIconOrBtn.addEventListener("click", (e) => {
			e.preventDefault();
			switchTab("manage");
		});
	}

	// Direct button listeners for explicit triggers
	if (btnManageYourEvent) {
		btnManageYourEvent.addEventListener("click", (e) => {
			e.preventDefault();
			switchTab("manage");
		});
	}

	["qaBtnUpdate", "qaBtnManage", "qaBtnDesign", "qaBtnRegForm"].forEach((id) => {
		const btn = document.getElementById(id);
		if (!btn) return;
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			switchTab(btn.getAttribute("data-tab"));
		});
	});

	const btnOpenFormStudio = document.getElementById("btnOpenFormStudio");
	if (btnOpenFormStudio) {
		btnOpenFormStudio.addEventListener("click", () => {
			switchTab("registrations");
		});
	}

	function updateManageQuestionsPreview() {
		const container = document.getElementById("manageWizardQuestionsPreview");
		if (!container) return;
		container.innerHTML = `
			<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:0.4rem; font-size:0.85rem; font-weight:700; color:#334155;">
				<span>Full Name (Required)</span>
				<span style="background:#eff6ff; color:#2563eb; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;">Short Answer</span>
			</div>
			<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:0.4rem; font-size:0.85rem; font-weight:700; color:#334155;">
				<span>Email Address (Required)</span>
				<span style="background:#eff6ff; color:#2563eb; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;">Email</span>
			</div>
			<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:0.4rem; font-size:0.85rem; font-weight:700; color:#334155;">
				<span>Mobile Phone Number (Required)</span>
				<span style="background:#eff6ff; color:#2563eb; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;">Phone</span>
			</div>
			<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; font-weight:700; color:#334155;">
				<span>Dietary Preference</span>
				<span style="background:#eff6ff; color:#2563eb; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;">Radio Choices</span>
			</div>
		`;
	}
	updateManageQuestionsPreview();

	// Draw Smooth Line Chart on Canvas
	let lastTrendData = [];
	let lastTrendPoints = [];
	let trendHoverIndex = -1;
	let trendChartEventsBound = false;

	function showTrendTooltip(point, canvas, mx, my) {
		const tip = document.getElementById("trendChartTooltip");
		if (!tip || !point || !canvas) return;
		const count = Number(point.value) || 0;
		const label = count === 1 ? "registration" : "registrations";
		const rect = canvas.getBoundingClientRect();
		tip.innerHTML = `
			<div class="tip-date">${escapeVolunteerHtml(point.date)}</div>
			<div class="tip-count">${count.toLocaleString("en-IN")} ${label}</div>
		`;
		tip.style.left = `${rect.left + mx}px`;
		tip.style.top = `${rect.top + my}px`;
		tip.classList.add("is-visible");
	}

	function hideTrendTooltip() {
		const tip = document.getElementById("trendChartTooltip");
		if (!tip) return;
		tip.classList.remove("is-visible");
	}

	function onTrendChartMouseLeave() {
		trendHoverIndex = -1;
		hideTrendTooltip();
		const canvas = document.getElementById("trendChartCanvas");
		if (canvas) canvas.style.cursor = "default";
		drawTrendChart();
	}

	function onTrendChartMouseMove(e) {
		const canvas = document.getElementById("trendChartCanvas");
		if (!canvas || !lastTrendPoints.length) return;
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const hitRadius = 14;
		let found = -1;
		let bestDist = Infinity;
		lastTrendPoints.forEach((p, i) => {
			const dx = mx - p.x;
			const dy = my - p.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist <= hitRadius && dist < bestDist) {
				bestDist = dist;
				found = i;
			}
		});
		if (found !== trendHoverIndex) {
			trendHoverIndex = found;
			drawTrendChart();
		}
		if (found >= 0) {
			showTrendTooltip(lastTrendPoints[found], canvas, mx, my);
			canvas.style.cursor = "pointer";
		} else {
			hideTrendTooltip();
			canvas.style.cursor = "default";
		}
	}

	function bindTrendChartEvents() {
		const canvas = document.getElementById("trendChartCanvas");
		if (!canvas || trendChartEventsBound) return;
		trendChartEventsBound = true;
		canvas.addEventListener("mousemove", onTrendChartMouseMove);
		canvas.addEventListener("mouseleave", onTrendChartMouseLeave);
	}

	function drawTrendChart(incoming) {
		const canvas = document.getElementById("trendChartCanvas");
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		
		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(rect.width * dpr);
		const targetH = Math.round(rect.height * dpr);
		if (canvas.width !== targetW || canvas.height !== targetH) {
			canvas.width = targetW;
			canvas.height = targetH;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(dpr, dpr);
		}

		const width = rect.width;
		const height = rect.height;

		ctx.clearRect(0, 0, width, height);

		if (Array.isArray(incoming) && incoming.length) {
			lastTrendData = incoming.map((row) => ({
				date: row.date || "Now",
				value: Number(row.value) || 0
			}));
		}
		const trendData = lastTrendData.length
			? lastTrendData
			: [{ date: "Now", value: 0 }];

		const paddingX = 35;
		const paddingY = 25;
		const chartW = width - paddingX * 2;
		const chartH = height - paddingY * 2;
		const rawMax = Math.max(1, ...trendData.map((d) => d.value));
		const maxVal = Math.max(4, Math.ceil(rawMax / 4) * 4);
		const gridStep = maxVal / 4;

		const denom = Math.max(1, trendData.length - 1);
		const points = trendData.map((d, i) => {
			const x = paddingX + (i / denom) * chartW;
			const y = height - paddingY - (d.value / maxVal) * chartH;
			return { x, y, date: d.date, value: d.value };
		});
		lastTrendPoints = points;

		// Horizontal Grid Lines
		ctx.strokeStyle = "#e2e8f0";
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);

		for (let i = 0; i <= 4; i++) {
			const val = Math.round(gridStep * i);
			const y = height - paddingY - (val / maxVal) * chartH;
			ctx.beginPath();
			ctx.moveTo(paddingX, y);
			ctx.lineTo(width - paddingX, y);
			ctx.stroke();

			ctx.fillStyle = "#94a3b8";
			ctx.font = "10px sans-serif";
			ctx.textAlign = "right";
			ctx.fillText(String(val), paddingX - 6, y + 3);
		}

		ctx.setLineDash([]);

		// Fill Gradient
		const grad = ctx.createLinearGradient(0, 0, 0, height);
		grad.addColorStop(0, "rgba(59, 130, 246, 0.35)");
		grad.addColorStop(1, "rgba(59, 130, 246, 0.0)");

		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (let i = 0; i < points.length - 1; i++) {
			const xc = (points[i].x + points[i + 1].x) / 2;
			const yc = (points[i].y + points[i + 1].y) / 2;
			ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
		}
		ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
		ctx.lineTo(points[points.length - 1].x, height - paddingY);
		ctx.lineTo(points[0].x, height - paddingY);
		ctx.closePath();
		ctx.fillStyle = grad;
		ctx.fill();

		// Smooth Curve Line
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (let i = 0; i < points.length - 1; i++) {
			const xc = (points[i].x + points[i + 1].x) / 2;
			const yc = (points[i].y + points[i + 1].y) / 2;
			ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
		}
		ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
		ctx.strokeStyle = "#3b82f6";
		ctx.lineWidth = 3;
		ctx.stroke();

		// Data Points & X-Labels
		points.forEach((p, i) => {
			const hovered = i === trendHoverIndex;
			ctx.fillStyle = hovered ? "#1d4ed8" : "#3b82f6";
			ctx.beginPath();
			ctx.arc(p.x, p.y, hovered ? 6 : 4, 0, Math.PI * 2);
			ctx.fill();
			if (hovered) {
				ctx.strokeStyle = "#ffffff";
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			ctx.fillStyle = "#64748b";
			ctx.font = "10px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText(p.date, p.x, height - 6);
		});

		bindTrendChartEvents();
	}

	// Fetch Current Host Event, Customer ID, & Host ID from API
	try {
		const hostRes = await fetch(`${HOST_EVENTS_API_BASE}/current?email=${encodeURIComponent(email)}`, {
			headers: getAuthHeaders()
		});
		if (hostRes.ok) {
			const hostData = await hostRes.json();
			const badgeCustomerId = document.getElementById("badgeCustomerId");
			const badgeHostId = document.getElementById("badgeHostId");

			if (hostData.customer_id) {
				activeCustomerId = hostData.customer_id;
				if (badgeCustomerId) badgeCustomerId.textContent = `CUST: ${hostData.customer_id}`;
			}
			if (hostData.host_id) {
				activeHostId = hostData.host_id;
				if (badgeHostId) badgeHostId.textContent = `HOST: ${hostData.host_id}`;
			}

			if (hostData.has_event && hostData.event) {
				currentLifecycle = hostData.lifecycle || hostData.event.lifecycle || hostData.event.event_status || "draft";
				if (currentLifecycle === "cancelled" || currentLifecycle === "unpublished") {
					pendingManageEvent = null;
					pendingHostDesignData = null;
					pendingRegistrationForm = null;
					paintEmptyHostDashboard();
				} else {
				activeEventId = hostData.event.event_id;
				sessionStorage.setItem(`active_event_id_${email}`, String(activeEventId));
				canPublishNew = hostData.can_publish_new !== false;
				canCreateNew = hostData.can_create_new !== false;
				pendingManageEvent = hostData.event;
				if (hostData.event.event_title && eventTitleInput) {
					eventTitleInput.value = hostData.event.event_title;
					if (dashEventTitle) dashEventTitle.textContent = hostData.event.event_title;
				}
				if (hostData.event.event_category) {
					const catSel = document.getElementById("eventCategorySelect");
					if (catSel) catSel.value = hostData.event.event_category;
				}
				const durationInput = document.getElementById("eventDurationInput");
				if (durationInput) durationInput.value = hostData.event.duration || "";
				if (hostData.event.policies) {
					populatePoliciesFromJson(hostData.event.policies);
				}
				if (hostData.event.event_status === "published" || currentLifecycle === "published" || currentLifecycle === "live" || currentLifecycle === "ended") {
					hasEvent = true;
					sessionStorage.setItem(`has_event_${email}`, "true");
					renderOverviewState();
					loadDashboardData();
				} else {
					hasEvent = false;
					sessionStorage.removeItem(`has_event_${email}`);
					renderOverviewState();
				}
				}
			} else {
				hasEvent = false;
				activeEventId = null;
				currentLifecycle = "draft";
				canPublishNew = true;
				canCreateNew = true;
				pendingManageEvent = null;
				pendingHostDesignData = null;
				pendingRegistrationForm = null;
				sessionStorage.removeItem(`has_event_${email}`);
				sessionStorage.removeItem(`active_event_id_${email}`);
				paintEmptyHostDashboard();
			}
			if (hostData.has_event && currentLifecycle !== "cancelled" && currentLifecycle !== "unpublished") {
			if (hostData.design) {
				pendingHostDesignData = hostData.design;
				if (hostData.design.about_event) {
					writeAboutEventHtml(hostData.design.about_event);
				}
			}
			if (hostData.registration_form) {
				pendingRegistrationForm = hostData.registration_form;
				if (window.JodFormBuilder && typeof window.JodFormBuilder.loadFromHost === "function") {
					window.JodFormBuilder.loadFromHost(hostData.registration_form);
				}
			}
			}
			applySectionActionLabels();
			updateLifecycleBanners();
		}
	} catch (err) {
		console.warn("Could not fetch current host event:", err);
	}

	// ── Live Auto-Save / UPSERT Synchronization ────────────────────────────────
	let autoSaveTimer = null;

	async function autoSaveManageEvent(notifyError = false) {
		if (!email) return false;
		if (hostEventCancelled && !notifyError) return false;
		if (hostEventCancelled && notifyError) hostEventCancelled = false;
		const dateInput = document.getElementById("eventDateInput");
		const endDateInput = document.getElementById("eventEndDateInput");
		const event_start_date = toIstIsoFromDatetimeLocal(dateInput && dateInput.value);
		const event_end_date = toIstIsoFromDatetimeLocal(endDateInput && endDateInput.value);
		const categoryEl = document.getElementById("eventCategorySelect");
		const payload = {
			event_id: activeEventId,
			organizer_email: email,
			event_title: eventTitleInput ? eventTitleInput.value.trim() : "",
			event_category: categoryEl && categoryEl.value ? categoryEl.value : undefined,
			event_mode: document.getElementById("eventFormatInput") ? document.getElementById("eventFormatInput").value : "Hybrid",
			venue: document.getElementById("eventLocationInput") ? document.getElementById("eventLocationInput").value : "",
			address: document.getElementById("eventLocationInput") ? document.getElementById("eventLocationInput").value : "",
			latitude: readVenueCoord("eventVenueLat"),
			longitude: readVenueCoord("eventVenueLon"),
			event_start_date: event_start_date,
			event_end_date: event_end_date,
			event_start_time: timeFromDatetimeLocal(dateInput && dateInput.value),
			event_end_time: timeFromDatetimeLocal(endDateInput && endDateInput.value),
			duration: (document.getElementById("eventDurationInput")?.value || "").trim().slice(0, 20),
			tickets_json: collectTicketsJson(),
			agenda_json: collectAgendaJson(),
			policies_json: collectPoliciesJson(),
			about_event: readAboutEventHtml() || undefined
		};

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/manage`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
				credentials: "include",
				body: JSON.stringify(payload)
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				if (data.event_id) {
					activeEventId = data.event_id;
					sessionStorage.setItem(`active_event_id_${email}`, String(activeEventId));
				}
				if (data.lifecycle) currentLifecycle = data.lifecycle;
				if (typeof data.can_publish_new === "boolean") canPublishNew = data.can_publish_new;
				if (typeof data.can_create_new === "boolean") canCreateNew = data.can_create_new;
				if (data.customer_id) {
					activeCustomerId = data.customer_id;
					const el = document.getElementById("badgeCustomerId");
					if (el) el.textContent = `CUST: ${data.customer_id}`;
				}
				if (data.host_id) {
					activeHostId = data.host_id;
					const el = document.getElementById("badgeHostId");
					if (el) el.textContent = `HOST: ${data.host_id}`;
				}
				if (isPublishedLifecycle() && data.catalog_synced === false) {
					const syncMsg = data.catalog_sync_error
						? `Saved, but public page sync failed: ${data.catalog_sync_error}`
						: "Saved, but public page sync failed. Retry Save.";
					if (notifyError) showNotification(syncMsg);
					else console.warn(syncMsg);
					return false;
				}
				return true;
			}
			const errMsg = apiErrorMessage(data, "Could not save Manage details.");
			if (notifyError) showNotification(errMsg);
			else console.warn("Manage save failed:", errMsg);
		} catch (e) {
			console.warn("Manage live auto-save warning:", e);
			if (notifyError) {
				showNotification((e && e.message) || "Could not save event details. Check your connection and try again.");
			}
		}
		return false;
	}

	async function autoSaveEventDesign(notifyError = false) {
		if (!email) return false;
		if (hostEventCancelled && !notifyError) return false;
		if (!activeEventId) {
			const manageSaved = await autoSaveManageEvent(notifyError);
			if (!manageSaved || !activeEventId) return false;
		}
		const payload = {
			event_id: activeEventId,
			organizer_email: email,
			theme_color: "#2563eb",
			font: "Grift",
			banner_image: bannerImageUrl || undefined,
			card_image: cardImageUrl || "",
			gallery_images: galleryImageUrls.length ? galleryImageUrls : undefined,
			sponsor_details: collectSponsorDetails(),
			speaker_details: collectSpeakerDetails(),
			performers_title: collectPerformersTitle(),
			about_event: readAboutEventHtml() || undefined
		};

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/design`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
				body: JSON.stringify(payload)
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				if (data.event_id) activeEventId = data.event_id;
				if (isPublishedLifecycle() && data.catalog_synced === false) {
					const syncMsg = data.catalog_sync_error
						? `Design saved, but public page sync failed: ${data.catalog_sync_error}`
						: "Design saved, but public page sync failed. Retry Save.";
					if (notifyError) showNotification(syncMsg);
					else console.warn(syncMsg);
					return false;
				}
				return true;
			}
			if (notifyError) showNotification(apiErrorMessage(data, "Could not save Design details."));
			return false;
		} catch (e) {
			console.warn("Design live auto-save warning:", e);
			return false;
		}
	}

	async function saveFullEventDesign(notifyError = false) {
		return autoSaveEventDesign(notifyError);
	}

	function validateManageWizardStep() {
		const title = eventTitleInput ? eventTitleInput.value.trim() : "";
		if (!title) {
			showNotification("Please enter an event title before continuing to Design.");
			if (eventTitleInput) eventTitleInput.focus();
			return false;
		}
		const categoryEl = document.getElementById("eventCategorySelect");
		if (!categoryEl || !categoryEl.value) {
			showNotification("Please select an event category before continuing to Design.");
			if (categoryEl) categoryEl.focus();
			return false;
		}
		const dateInput = document.getElementById("eventDateInput");
		if (!dateInput || !dateInput.value) {
			showNotification("Please select an event date and time before continuing to Design.");
			if (dateInput) dateInput.focus();
			return false;
		}
		const locationInput = document.getElementById("eventLocationInput");
		if (!locationInput || !locationInput.value.trim()) {
			showNotification("Please enter a venue / location before continuing to Design.");
			if (locationInput) locationInput.focus();
			return false;
		}
		const endDateInput = document.getElementById("eventEndDateInput");
		if (!endDateInput || !endDateInput.value) {
			showNotification("Please select an event end date and time before continuing.");
			if (endDateInput) endDateInput.focus();
			return false;
		}
		if (endIsBeforeStart()) {
			showNotification("Event end date & time must be after the start. The event is not ended until after it starts.");
			endDateInput.focus();
			return false;
		}
		return true;
	}

	function syncManageWizardPreview() {
		const title = eventTitleInput && eventTitleInput.value.trim()
			? eventTitleInput.value.trim()
			: "My New Event 2026";
		const formatEl = document.getElementById("eventFormatInput");
		const format = formatEl ? formatEl.value : "Hybrid";
		const dateInput = document.getElementById("eventDateInput");
		const locationInput = document.getElementById("eventLocationInput");
		let metaText = format;
		if (dateInput && dateInput.value) {
			try {
				const dt = new Date(dateInput.value);
				metaText = `${dt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} • ${format}`;
			} catch (_) {
				metaText = format;
			}
		}
		if (locationInput && locationInput.value.trim()) {
			metaText += ` • ${locationInput.value.trim()}`;
		}

		if (dashEventTitle) dashEventTitle.textContent = title;
		if (dashEventMeta) dashEventMeta.textContent = metaText;

		updateEventPagePreview({
			event_id: activeEventId,
			event_title: title,
			venue: locationInput && locationInput.value.trim() ? locationInput.value.trim() : "Venue TBD",
			event_status: isPublishedLifecycle() ? "published" : "draft",
			banner_image: bannerImageUrl || undefined
		});
	}

	function setWizardNavBusy(button, busy, busyLabel) {
		if (!button) return;
		if (busy) {
			if (!button.dataset.originalLabel) {
				button.dataset.originalLabel = button.innerHTML;
			}
			button.disabled = true;
			button.style.opacity = "0.75";
			button.style.pointerEvents = "none";
			if (busyLabel) button.innerHTML = busyLabel;
		} else {
			button.disabled = false;
			button.style.opacity = "";
			button.style.pointerEvents = "";
			if (button.dataset.originalLabel) {
				button.innerHTML = button.dataset.originalLabel;
			}
		}
	}

	async function advanceManageToDesign() {
		if (!validateManageWizardStep()) return;
		const btn = document.getElementById("btnManageNext");
		setWizardNavBusy(btn, true, "<span>Saving…</span>");
		try {
			const saved = await autoSaveManageEvent(true);
			syncManageWizardPreview();
			if (!saved) {
				// autoSaveManageEvent(true) already shows the real API/network error.
				return;
			}
			if (isPublishedLifecycle() || currentLifecycle === "ended") {
				showNotification("✓ Manage section updated successfully");
				return;
			}
			showNotification("Step 1 of 4 complete: Event details saved. Continuing to Design…");
			switchTab("design");
		} finally {
			setWizardNavBusy(btn, false);
		}
	}

	async function advanceDesignToRegistrations() {
		const btn = document.getElementById("btnSaveDesign");
		setWizardNavBusy(btn, true, "<span>Saving…</span>");
		try {
			const saved = await saveFullEventDesign(true);
			if (!saved) {
				showNotification("Could not save Design details. Stay on this section and try again.");
				return;
			}
			if (isPublishedLifecycle() || currentLifecycle === "ended") {
				showNotification("✓ Design section updated successfully");
				return;
			}
			showNotification("Step 2 of 4 complete: Design assets saved. Continuing to Registration Form…");
			switchTab("registrations");
		} catch (err) {
			showNotification(err.message || "Failed to save design assets.");
		} finally {
			setWizardNavBusy(btn, false);
		}
	}

	let designSaveTimer = null;

	function triggerManageAutoSave() {
		clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => { autoSaveManageEvent(); }, 800);
	}

	function triggerDesignAutoSave() {
		clearTimeout(designSaveTimer);
		designSaveTimer = setTimeout(() => { autoSaveEventDesign(); }, 800);
	}

	function triggerLiveAutoSave() {
		triggerDesignAutoSave();
	}

	if (createEventForm) {
		createEventForm.addEventListener("input", triggerManageAutoSave);
		createEventForm.addEventListener("change", triggerManageAutoSave);
	}
	["policyEventInput", "policyCancellationInput", "policyRefundInput", "policyTermsInput", "policyPrivacyInput", "policyAgeInput"].forEach((id) => {
		const el = document.getElementById(id);
		if (el) {
			el.addEventListener("input", triggerManageAutoSave);
		}
	});

	// Interactive Format Pills
	const formatPills = document.querySelectorAll("#formatPillsGroup .format-pill");
	const eventFormatInput = document.getElementById("eventFormatInput");
	formatPills.forEach(pill => {
		pill.addEventListener("click", () => {
			formatPills.forEach(p => p.classList.remove("active"));
			pill.classList.add("active");
			if (eventFormatInput) eventFormatInput.value = pill.getAttribute("data-value");
			updateVenueMapVisibility();
			triggerManageAutoSave();
		});
	});

	document.querySelectorAll("#ticketModePills .ticket-mode-pill").forEach((pill) => {
		pill.addEventListener("click", () => {
			applyTicketPurchaseMode(pill.getAttribute("data-ticket-mode") || "single");
			triggerManageAutoSave();
		});
	});
	const ticketLimitInput = document.getElementById("ticketPerPersonLimitInput");
	if (ticketLimitInput) {
		ticketLimitInput.addEventListener("change", () => {
			let n = Number(ticketLimitInput.value);
			if (!Number.isFinite(n) || n < 2) n = 2;
			if (n > 20) n = 20;
			ticketLimitInput.value = String(Math.round(n));
			triggerManageAutoSave();
		});
	}

	function readVenueCoord(id) {
		const el = document.getElementById(id);
		const n = el ? parseFloat(el.value) : NaN;
		return Number.isFinite(n) ? n : null;
	}

	function writeVenueCoords(lat, lon) {
		const latEl = document.getElementById("eventVenueLat");
		const lonEl = document.getElementById("eventVenueLon");
		if (latEl) latEl.value = lat != null ? String(lat) : "";
		if (lonEl) lonEl.value = lon != null ? String(lon) : "";
	}

	function setVenueHint(text, isAddress) {
		const el = document.getElementById("venueMapHint");
		if (!el) return;
		el.textContent = text || "";
		el.classList.toggle("is-address", Boolean(isAddress));
	}

	function updateVenueMapVisibility() {
		const panel = document.getElementById("venueMapPanel") || ensureVenueMapMarkup();
		const modeEl = document.getElementById("eventFormatInput");
		const mode = (modeEl && modeEl.value) || "";
		const hide = mode === "Online";
		if (panel) {
			panel.classList.toggle("is-hidden", hide);
			panel.style.display = hide ? "none" : "block";
		}
		if (!hide) setTimeout(() => invalidateVenueMap(), 80);
	}

	function invalidateVenueMap() {
		if (venueMap && typeof venueMap.invalidateSize === "function") {
			venueMap.invalidateSize();
			if (venueMarker) {
				const p = venueMarker.getLatLng();
				if (p) venueMap.setView(p, Math.max(venueMap.getZoom() || 16, 16), { animate: false });
			}
		}
	}

	const CHENNAI_CENTER = [13.0827, 80.2707];

	function ensureVenueMapMarkup() {
		const input = document.getElementById("eventLocationInput");
		if (!input || !input.parentNode) return null;

		let latEl = document.getElementById("eventVenueLat");
		if (!latEl) {
			latEl = document.createElement("input");
			latEl.type = "hidden";
			latEl.id = "eventVenueLat";
			input.insertAdjacentElement("afterend", latEl);
		}
		let lonEl = document.getElementById("eventVenueLon");
		if (!lonEl) {
			lonEl = document.createElement("input");
			lonEl.type = "hidden";
			lonEl.id = "eventVenueLon";
			latEl.insertAdjacentElement("afterend", lonEl);
		}

		let panel = document.getElementById("venueMapPanel");
		if (!panel) {
			panel = document.createElement("div");
			panel.className = "venue-map-panel";
			panel.id = "venueMapPanel";
			panel.style.cssText = "display:block;margin-top:0.75rem;border:1.5px solid #cbd5e1;border-radius:12px;overflow:hidden;background:#e2e8f0;";
			panel.innerHTML = `
				<div class="venue-map" id="venueMap" role="application" aria-label="Venue map" style="width:100%;height:280px;min-height:280px;background:#dbeafe;"></div>
				<p class="venue-map-hint" id="venueMapHint" style="margin:0;padding:0.6rem 0.9rem;font-size:0.8rem;color:#334155;background:#fff;border-top:1px solid #e2e8f0;">Click the map or drag the pin onto the building. The venue line fills with building name, street, area, and pincode.</p>
			`;
			const after = lonEl.nextSibling;
			if (after) input.parentNode.insertBefore(panel, after);
			else input.parentNode.appendChild(panel);
		}
		return panel;
	}

	function loadLeafletAssets() {
		if (window.L && typeof window.L.map === "function") {
			return Promise.resolve(window.L);
		}
		if (loadLeafletAssets._pending) return loadLeafletAssets._pending;

		loadLeafletAssets._pending = new Promise((resolve, reject) => {
			if (!document.getElementById("jodVenueLeafletCss")) {
				const link = document.createElement("link");
				link.id = "jodVenueLeafletCss";
				link.rel = "stylesheet";
				link.href = "vendor/leaflet/leaflet.css";
				document.head.appendChild(link);
			}
			const urls = [
				"vendor/leaflet/leaflet.js",
				"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
				"https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"
			];
			let i = 0;
			const tryNext = () => {
				if (window.L && typeof window.L.map === "function") {
					resolve(window.L);
					return;
				}
				if (i >= urls.length) {
					reject(new Error("Map library failed to load"));
					return;
				}
				const src = urls[i++];
				const script = document.createElement("script");
				script.src = src;
				script.async = true;
				script.onload = () => {
					if (window.L && typeof window.L.map === "function") resolve(window.L);
					else tryNext();
				};
				script.onerror = tryNext;
				document.head.appendChild(script);
			};
			tryNext();
		});
		return loadLeafletAssets._pending;
	}

	function formatStreetAreaPin(address, displayName, namedetails) {
		const addr = address || {};
		const indic = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/;
		const skipState = /^(india|tamil nadu|karnataka|maharashtra|delhi|nct of delhi|west bengal|telangana|kerala|andhra pradesh|gujarat|rajasthan|uttar pradesh|madhya pradesh|bihar|odisha|punjab|haryana|assam)$/i;
		const adminOnly = /^(cmwssb(\s+division)?(\s+\d+)?|ward\s+\d+|zone\s+\d+|division\s+\d+|circle\s+\d+)$/i;
		const adminPrefix = /^(cmwssb\b|ward\s+\d+|division\s+\d+|circle\s+\d+)/i;
		const zonePrefix = /^zone\s+\d+\s+(.+)$/i;

		function cleanAdmin(text) {
			let s = String(text || "").trim();
			if (!s) return "";
			if (adminOnly.test(s) || adminPrefix.test(s)) return "";
			const zone = s.match(zonePrefix);
			if (zone) s = String(zone[1] || "").trim();
			if (skipState.test(s)) return "";
			return s;
		}

		function isEnglishPart(text) {
			const s = String(text || "").trim();
			if (!s) return false;
			if (indic.test(s)) return false;
			if (skipState.test(s)) return false;
			return true;
		}

		function pickEnglish() {
			for (let i = 0; i < arguments.length; i++) {
				const val = cleanAdmin(arguments[i]);
				if (isEnglishPart(val)) return val;
			}
			return "";
		}

		function addPart(parts, value) {
			let val = cleanAdmin(value);
			const raw = String(value || "").trim();
			const pin = raw.replace(/\D/g, "");
			if (!val && pin.length === 6 && pin === raw.replace(/\s/g, "")) val = pin;
			if (!val) return;
			if (!(val.length === 6 && /^\d{6}$/.test(val)) && !isEnglishPart(val)) return;
			const low = val.toLowerCase();
			for (let i = 0; i < parts.length; i++) {
				const ex = parts[i].toLowerCase();
				if (ex === low) return;
				if (low.length < ex.length && ex.includes(low)) return;
				if (ex.length < low.length && low.includes(ex)) {
					parts[i] = val;
					return;
				}
			}
			parts.push(val);
		}

		const house = pickEnglish(addr.house_number);
		const road = pickEnglish(addr.road, addr.pedestrian, addr.residential, addr.street, addr.footway, addr.path);
		const names = namedetails || {};
		const poi = pickEnglish(
			names["name:en"],
			names.name,
			addr.building,
			addr.amenity,
			addr.shop,
			addr.office,
			addr.leisure,
			addr.club,
			addr.tourism,
			addr.hotel,
			addr.university,
			addr.college,
			addr.school,
			addr.hospital,
			addr.railway,
			addr.public_building,
			addr.house_name,
			addr.place
		);
		if (poi && road && poi.toLowerCase() === road.toLowerCase()) poi = "";
		const neighbourhood = pickEnglish(addr.neighbourhood, addr.quarter, addr.hamlet, addr.allotments);
		const suburb = pickEnglish(addr.suburb, addr.village, addr.city_district);
		const city = pickEnglish(addr.city, addr.town, addr.municipality, addr.county);
		const pin = String(addr.postcode || "").replace(/\s/g, "");
		const street = [house, road].filter(Boolean).join(" ");

		const parts = [];
		addPart(parts, poi);
		addPart(parts, street);
		addPart(parts, neighbourhood);
		addPart(parts, suburb);
		addPart(parts, city);
		if (/^\d{6}$/.test(pin)) addPart(parts, pin);

		if (parts.length < 2) {
			String(displayName || "").split(",").forEach((chunk) => addPart(parts, chunk.trim()));
		}

		return parts.join(", ") || "";
	}

	function fillVenueAddress(text) {
		const input = document.getElementById("eventLocationInput");
		if (!input || !text) return;
		venueFillingFromMap = true;
		input.value = text;
		venueFillingFromMap = false;
		setVenueHint("📍 " + text + " — drag the pin to adjust", true);
		triggerManageAutoSave();
	}

	function venuePinIcon() {
		return window.L.divIcon({
			className: "venue-pin-wrap",
			html: '<div class="venue-pin"></div>',
			iconSize: [30, 42],
			iconAnchor: [15, 40],
			popupAnchor: [0, -36],
		});
	}

	function ensureVenueMap() {
		ensureVenueMapMarkup();
		if (!window.L || typeof window.L.map !== "function") return null;
		const el = document.getElementById("venueMap");
		if (!el) return null;
		if (!venueMap) {
			venueMap = window.L.map(el, {
				zoomControl: true,
				scrollWheelZoom: true,
			}).setView(CHENNAI_CENTER, 12);
			window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 19,
				attribution: "&copy; OpenStreetMap",
			}).addTo(venueMap);
			if (!venueMapClickBound) {
				venueMapClickBound = true;
				venueMap.on("click", (e) => {
					if (!e || !e.latlng) return;
					plotVenuePin(e.latlng.lat, e.latlng.lng, { fly: false, reverse: true });
				});
			}
		}
		setTimeout(() => invalidateVenueMap(), 60);
		return venueMap;
	}

	function plotVenuePin(lat, lon, opts) {
		opts = opts || {};
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
		if (!ensureVenueMap()) return;
		writeVenueCoords(lat, lon);
		if (venueMarker) {
			venueMarker.setLatLng([lat, lon]);
		} else {
			venueMarker = window.L.marker([lat, lon], {
				icon: venuePinIcon(),
				draggable: true,
				autoPan: true,
				autoPanPadding: [48, 48],
				riseOnDrag: true,
				title: "Drag to set the exact venue",
			}).addTo(venueMap);
			venueMarker.on("dragstart", () => {
				if (venueMarker.closePopup) venueMarker.closePopup();
				setVenueHint("Drop the pin on the exact venue.");
			});
			venueMarker.on("dragend", (e) => {
				const p = e.target.getLatLng();
				writeVenueCoords(p.lat, p.lng);
				reverseGeocodeVenue(p.lat, p.lng);
			});
		}
		if (opts.fly !== false) {
			const zoom = venueMap.getZoom() < 14 ? 16 : Math.max(venueMap.getZoom(), 16);
			if (typeof venueMap.flyTo === "function") venueMap.flyTo([lat, lon], zoom, { duration: 0.7 });
			else venueMap.setView([lat, lon], zoom);
		}
		if (opts.reverse) reverseGeocodeVenue(lat, lon);
		else setTimeout(() => invalidateVenueMap(), 80);
	}

	async function reverseGeocodeVenue(lat, lon) {
		setVenueHint("Looking up street, area, and pincode…");
		try {
			let formatted = "";
			try {
				const res = await fetch(`${LOCATION_API_BASE}/venue-reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
				if (res.ok) {
					const data = await res.json();
					formatted = String(data.formatted || "").trim();
				}
			} catch (_) {}

			if (!formatted) {
				const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&namedetails=1&zoom=18&accept-language=en&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
				const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
				if (!res.ok) throw new Error("reverse failed");
				const hit = await res.json();
				formatted = formatStreetAreaPin(hit.address || {}, hit.display_name || hit.name, hit.namedetails || {});
			}

			if (formatted) {
				fillVenueAddress(formatted);
				if (venueMarker) {
					venueMarker.bindPopup(formatted.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))).openPopup();
				}
			} else {
				setVenueHint("Pin dropped. Drag again if this is not the right spot.");
			}
		} catch (_) {
			setVenueHint("Pin dropped. Street lookup failed — you can still type the address.");
		}
	}

	async function geocodeVenueQuery(query) {
		const q = String(query || "").trim();
		if (q.length < 3) return;
		setVenueHint("Finding this venue on the map…");
		try {
			let hitLat = NaN;
			let hitLon = NaN;
			let formatted = "";

			try {
				const res = await fetch(`${LOCATION_API_BASE}/venue-search?q=${encodeURIComponent(q)}`);
				if (res.ok) {
					const data = await res.json();
					hitLat = parseFloat(data.location_lat);
					hitLon = parseFloat(data.location_lon);
					formatted = String(data.formatted || "").trim();
				}
			} catch (_) {}

			if (!Number.isFinite(hitLat) || !Number.isFinite(hitLon)) {
				const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&countrycodes=in&limit=1&accept-language=en&q=${encodeURIComponent(q)}`;
				const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
				if (!res.ok) return;
				const results = await res.json();
				if (!Array.isArray(results) || !results.length) {
					setVenueHint("Place not found. Click the map or drag a pin to set the venue.");
					return;
				}
				const hit = results[0];
				hitLat = parseFloat(hit.lat);
				hitLon = parseFloat(hit.lon);
				formatted = formatStreetAreaPin(hit.address || {}, hit.display_name || hit.name, hit.namedetails || {});
			}

			if (!Number.isFinite(hitLat) || !Number.isFinite(hitLon)) {
				setVenueHint("Place not found. Click the map or drag a pin to set the venue.");
				return;
			}

			plotVenuePin(hitLat, hitLon, { fly: true, reverse: false });
			if (formatted) {
				const typed = q;
				const merged = (!formatted.toLowerCase().includes(typed.toLowerCase()) && typed.length <= 48 && !/,/.test(typed) && !/\d{6}/.test(typed))
					? `${typed}, ${formatted}`
					: formatted;
				fillVenueAddress(merged);
				if (venueMarker) venueMarker.bindPopup(merged.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))).openPopup();
			}
		} catch (_) {
			setVenueHint("Could not search that place. Click the map to drop a pin.");
		}
	}

	let venueInputBound = false;

	async function initVenueMapPicker() {
		ensureVenueMapMarkup();
		updateVenueMapVisibility();
		setVenueHint("Loading the map…");
		try {
			await loadLeafletAssets();
		} catch (err) {
			setVenueHint("Map could not load. Type the address, or refresh the page and try again.");
			return;
		}
		if (!ensureVenueMap()) {
			setVenueHint("Map could not start. Type the address, or refresh the page and try again.");
			return;
		}

		const input = document.getElementById("eventLocationInput");
		if (input && !venueInputBound) {
			venueInputBound = true;
			input.addEventListener("input", () => {
				if (venueFillingFromMap) return;
				clearTimeout(venueGeocodeTimer);
				venueGeocodeTimer = setTimeout(() => geocodeVenueQuery(input.value), 650);
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					clearTimeout(venueGeocodeTimer);
					geocodeVenueQuery(input.value);
				}
			});
		}

		const lat = readVenueCoord("eventVenueLat");
		const lon = readVenueCoord("eventVenueLon");
		if (lat != null && lon != null) {
			plotVenuePin(lat, lon, { fly: true, reverse: false });
		} else if (input && input.value.trim().length >= 3) {
			geocodeVenueQuery(input.value.trim());
		} else if (!venueMarker) {
			plotVenuePin(CHENNAI_CENTER[0], CHENNAI_CENTER[1], { fly: true, reverse: false });
			setVenueHint("Drag the pin (or click the map) to mark the exact street. Type a pincode such as 600021 to jump there.");
		}
		setTimeout(() => invalidateVenueMap(), 120);
		setTimeout(() => invalidateVenueMap(), 400);
	}

	initVenueMapPicker();

	// Dynamic Ticket Tier Rows Adder
	const ticketTiersRows = document.getElementById("ticketTiersRows");
	const btnAddTicketTier = document.getElementById("btnAddTicketTier");

	function createTicketTierRowHtml(type = "", price = "", qty = "", offerStart = "", offerEnd = "") {
		const div = document.createElement("div");
		div.className = "ticket-tier-row";
		div.innerHTML = `
			<div class="setup-grid-3 ticket-tier-main">
			<div class="setup-form-group">
				<label>Ticket Type / Name <span style="color: #ef4444;">*</span></label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#127915;</span>
						<input type="text" class="setup-input ticket-type-input" placeholder="e.g. VIP Pass, Early Bird, General" required value="${attrEscape(type)}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Ticket Price (₹) <span style="color: #ef4444;">*</span></label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#8377;</span>
						<input type="number" class="setup-input ticket-price-input" placeholder="e.g. 499" min="0" required value="${attrEscape(price)}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Capacity <span style="color: #ef4444;">*</span></label>
				<div style="display: flex; gap: 0.5rem;">
					<div class="input-icon-wrap" style="flex: 1;">
						<span class="input-icon">&#128101;</span>
							<input type="number" class="setup-input ticket-qty-input" placeholder="e.g. 100" min="1" required value="${attrEscape(qty)}" />
					</div>
					<button type="button" class="btn-remove-ticket" title="Remove Ticket" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 0 0.8rem; cursor: pointer; font-weight: 700; height: 44px;">&times;</button>
				</div>
			</div>
			</div>
			<div class="setup-grid-2 ticket-tier-offer">
				<div class="setup-form-group">
					<label>Offer starts</label>
					<input type="datetime-local" class="setup-input ticket-offer-start-input" value="${attrEscape(offerStart)}" />
				</div>
				<div class="setup-form-group">
					<label>Offer ends</label>
					<input type="datetime-local" class="setup-input ticket-offer-end-input" value="${attrEscape(offerEnd)}" />
				</div>
			</div>
			<p class="ticket-offer-hint">Leave blank to keep this ticket on sale for the whole event. Set dates for a same-day or limited-time offer.</p>
		`;

		const removeBtn = div.querySelector(".btn-remove-ticket");
		removeBtn.addEventListener("click", () => {
			if (ticketTiersRows.children.length > 1) {
				div.remove();
			} else {
				clearTicketTierRow(div);
			}
		});
		return div;
	}

	if (btnAddTicketTier) {
		btnAddTicketTier.addEventListener("click", () => {
			ticketTiersRows.appendChild(createTicketTierRowHtml("", "", ""));
		});
	}

	if (ticketTiersRows) {
		const initialRemoveBtn = ticketTiersRows.querySelector(".btn-remove-ticket");
		if (initialRemoveBtn) {
			initialRemoveBtn.addEventListener("click", (e) => {
				const row = e.target.closest(".ticket-tier-row");
				if (ticketTiersRows.children.length > 1) {
					row.remove();
				} else {
					clearTicketTierRow(row);
				}
			});
		}
	}

	// Dynamic Agenda Session Rows Adder
	const agendaRows = document.getElementById("agendaRows");
	const btnAddAgendaSession = document.getElementById("btnAddAgendaSession");

	function createAgendaRowHtml(time = "", title = "", speaker = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 agenda-row";
		div.style.alignItems = "flex-end";
		div.style.marginBottom = "0.8rem";
		div.innerHTML = `
			<div class="setup-form-group">
				<label>Time Slot <span style="color: #ef4444;">*</span></label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#9200;</span>
					<input type="text" class="setup-input agenda-time-input" placeholder="e.g. 09:00 AM - 10:00 AM" required value="${time}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Session Title / Topic <span style="color: #ef4444;">*</span></label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#128187;</span>
					<input type="text" class="setup-input agenda-title-input" placeholder="e.g. Panel Discussion" required value="${title}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Speaker / Host Name</label>
				<div style="display: flex; gap: 0.5rem;">
					<div class="input-icon-wrap" style="flex: 1;">
						<span class="input-icon">&#128587;</span>
						<input type="text" class="setup-input agenda-speaker-input" placeholder="e.g. Speaker Name" value="${speaker}" />
					</div>
					<button type="button" class="btn-remove-agenda" title="Remove Session" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 0 0.8rem; cursor: pointer; font-weight: 700; height: 44px;">&times;</button>
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-agenda");
		removeBtn.addEventListener("click", () => {
			if (agendaRows.children.length > 1) {
				div.remove();
			} else {
				div.querySelector(".agenda-time-input").value = "";
				div.querySelector(".agenda-title-input").value = "";
				div.querySelector(".agenda-speaker-input").value = "";
			}
		});

		return div;
	}

	if (btnAddAgendaSession) {
		btnAddAgendaSession.addEventListener("click", () => {
			agendaRows.appendChild(createAgendaRowHtml("", "", ""));
		});
	}

	if (agendaRows) {
		const initialAgendaRemoveBtn = agendaRows.querySelector(".btn-remove-agenda");
		if (initialAgendaRemoveBtn) {
			initialAgendaRemoveBtn.addEventListener("click", (e) => {
				const row = e.target.closest(".agenda-row");
				if (agendaRows.children.length > 1) {
					row.remove();
				} else {
					row.querySelector(".agenda-time-input").value = "";
					row.querySelector(".agenda-title-input").value = "";
					row.querySelector(".agenda-speaker-input").value = "";
				}
			});
		}
	}

	function populateManageForm(event) {
		if (!event) return;
		if (eventTitleInput && event.event_title) {
			eventTitleInput.value = event.event_title;
			if (dashEventTitle) dashEventTitle.textContent = event.event_title;
		}
		const catSel = document.getElementById("eventCategorySelect");
		if (catSel && event.event_category) catSel.value = event.event_category;
		const formatInput = document.getElementById("eventFormatInput");
		const mode = event.event_mode || "Hybrid";
		if (formatInput) formatInput.value = mode;
		document.querySelectorAll("#formatPillsGroup .format-pill").forEach((pill) => {
			pill.classList.toggle("active", pill.getAttribute("data-value") === mode);
		});
		const dateInput = document.getElementById("eventDateInput");
		if (dateInput && (event.event_start_date_local || event.event_start_date)) {
			dateInput.value = isoToDatetimeLocal(event.event_start_date_local || event.event_start_date);
		}
		const endDateInput = document.getElementById("eventEndDateInput");
		if (endDateInput && (event.event_end_date_local || event.event_end_date)) {
			endDateInput.value = isoToDatetimeLocal(event.event_end_date_local || event.event_end_date);
		}
		const durationInput = document.getElementById("eventDurationInput");
		if (durationInput) durationInput.value = event.duration || "";
		const locationInput = document.getElementById("eventLocationInput");
		if (locationInput) locationInput.value = event.venue || event.address || "";
		const latEl = document.getElementById("eventVenueLat");
		const lonEl = document.getElementById("eventVenueLon");
		if (latEl) latEl.value = event.latitude != null ? String(event.latitude) : "";
		if (lonEl) lonEl.value = event.longitude != null ? String(event.longitude) : "";
		setTimeout(() => {
			updateVenueMapVisibility();
			if (event.latitude != null && event.longitude != null) {
				plotVenuePin(Number(event.latitude), Number(event.longitude), { fly: true, reverse: false });
			} else if (locationInput && locationInput.value.trim()) {
				geocodeVenueQuery(locationInput.value.trim());
			} else {
				invalidateVenueMap();
			}
		}, 250);
		if (event.policies) populatePoliciesFromJson(event.policies);
		const purchase = (event.policies && event.policies._ticket_purchase) || event.ticket_purchase || {};
		applyTicketPurchaseMode(purchase.mode || "single", purchase.per_person_limit, purchase.price_note || "");
		if (ticketTiersRows && Array.isArray(event.tickets) && event.tickets.length) {
			ticketTiersRows.innerHTML = "";
			event.tickets.forEach((t) => {
				ticketTiersRows.appendChild(createTicketTierRowHtml(
					t.name || t.ticket_name || t.type || "",
					t.price != null ? t.price : "",
					t.qty != null ? t.qty : (t.quantity != null ? t.quantity : ""),
					isoToDatetimeLocal(t.sales_start || t.offer_start || t.sale_start || ""),
					isoToDatetimeLocal(t.sales_end || t.offer_end || t.sale_end || "")
				));
			});
		}
		if (agendaRows && Array.isArray(event.agenda) && event.agenda.length) {
			agendaRows.innerHTML = "";
			event.agenda.forEach((a) => {
				agendaRows.appendChild(createAgendaRowHtml(
					a.time || a.time_slot || "",
					a.title || a.session || "",
					a.speaker || a.host || ""
				));
			});
		}
		syncManageWizardPreview();
	}

	if (pendingManageEvent) {
		populateManageForm(pendingManageEvent);
		pendingManageEvent = null;
	}

	const btnCreateNewEvent = document.getElementById("btnCreateNewEvent");
	if (btnCreateNewEvent) {
		btnCreateNewEvent.addEventListener("click", () => {
			if (!canCreateNew && isPublishedLifecycle()) {
				showNotification("You already have an active event. You can create and publish a new event only after your current event has ended.");
				return;
			}
			hostEventCancelled = false;
			activeEventId = null;
			currentLifecycle = "draft";
			hasEvent = false;
			sessionStorage.removeItem(`active_event_id_${email}`);
			sessionStorage.removeItem(`has_event_${email}`);
			if (createEventForm) createEventForm.reset();
			writeAboutEventHtml("");
			if (eventTitleInput) eventTitleInput.value = "";
			const catSel = document.getElementById("eventCategorySelect");
			if (catSel) catSel.value = "";
			if (ticketTiersRows) {
				ticketTiersRows.innerHTML = "";
				ticketTiersRows.appendChild(createTicketTierRowHtml("", "", ""));
			}
			applyTicketPurchaseMode("single", 4, "");
			if (agendaRows) {
				agendaRows.innerHTML = "";
				agendaRows.appendChild(createAgendaRowHtml("", "", ""));
			}
			applySectionActionLabels();
			renderOverviewState();
			switchTab("manage");
			showNotification("Start a new event. Save each section to create the new draft.");
		});
	}

	// Step 1: Manage Form Handler -> Save and move to Design (Step 2)
	const btnManageNext = document.getElementById("btnManageNext");
	if (btnManageNext) {
		btnManageNext.addEventListener("click", (e) => {
			e.preventDefault();
			advanceManageToDesign();
		});
	}
	if (createEventForm) {
		createEventForm.addEventListener("submit", (e) => {
			e.preventDefault();
			advanceManageToDesign();
		});
	}

	function hostProfileInitials() {
		if (window.JodProfile && typeof window.JodProfile.getInitials === "function") {
			const initials = window.JodProfile.getInitials();
			if (initials) return initials;
		}
		const nameEl = document.getElementById("profileHeaderName");
		const name = (nameEl && nameEl.textContent) || "";
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
		return "?";
	}

	function renderHostSettingsAvatar() {
		const img = document.getElementById("profileAvatarImg");
		const initialsEl = document.getElementById("profileAvatarInitials");
		const saved = (window.JodProfile && typeof window.JodProfile.getSavedAvatar === "function")
			? window.JodProfile.getSavedAvatar()
			: null;
		if (saved && img) {
			img.onload = () => {
				img.style.display = "block";
				if (initialsEl) initialsEl.style.display = "none";
			};
			img.onerror = () => {
				img.style.display = "none";
				if (initialsEl) {
					initialsEl.style.display = "flex";
					initialsEl.textContent = hostProfileInitials();
				}
			};
			img.src = saved;
			img.alt = "Organizer avatar";
			return;
		}
		if (img) {
			img.removeAttribute("src");
			img.style.display = "none";
		}
		if (initialsEl) {
			initialsEl.style.display = "flex";
			initialsEl.textContent = hostProfileInitials();
		}
	}

	function applyHostAvatarDataUrl(dataUrl) {
		if (window.JodProfile && typeof window.JodProfile.setProfilePicture === "function") {
			window.JodProfile.setProfilePicture(dataUrl);
		} else if (window.JodAuth && typeof window.JodAuth.avatarCacheKey === "function") {
			const key = window.JodAuth.avatarCacheKey();
			if (key) localStorage.setItem(key, dataUrl);
		}
		renderHostSettingsAvatar();
	}

	function bindHostSettingsAvatar() {
		const fileInput = document.getElementById("hostSettingsPhotoInput");
		const uploadBtn = document.getElementById("btnUploadHostAvatar");
		const changeBtn = document.getElementById("btnChangeHostAvatar");
		const deleteBtn = document.getElementById("btnDeleteHostAvatar");
		if (!fileInput || fileInput.dataset.bound === "1") return;
		fileInput.dataset.bound = "1";

		const openPicker = () => fileInput.click();
		if (uploadBtn) uploadBtn.addEventListener("click", openPicker);
		if (changeBtn) changeBtn.addEventListener("click", openPicker);

		fileInput.addEventListener("change", (e) => {
			const file = e.target.files && e.target.files[0];
			e.target.value = "";
			if (!file) return;
			if (!String(file.type || "").startsWith("image/")) {
				showNotification("Please choose a JPG, PNG, or WEBP image.");
				return;
			}
			if (file.size > 5 * 1024 * 1024) {
				showNotification("Please choose an image under 5MB.");
				return;
			}
			if (window.JodCropModal && typeof window.JodCropModal.open === "function") {
				window.JodCropModal.open(file, () => {
					renderHostSettingsAvatar();
					showNotification("✓ Profile photo updated.");
				});
				return;
			}
			const reader = new FileReader();
			reader.onload = (ev) => {
				applyHostAvatarDataUrl(ev.target.result);
				showNotification("✓ Profile photo updated.");
			};
			reader.readAsDataURL(file);
		});

		if (deleteBtn) {
			deleteBtn.addEventListener("click", () => {
				if (window.JodProfile && typeof window.JodProfile.removeProfilePicture === "function") {
					window.JodProfile.removeProfilePicture();
				} else if (window.JodAuth && typeof window.JodAuth.avatarCacheKey === "function") {
					const key = window.JodAuth.avatarCacheKey();
					if (key) localStorage.removeItem(key);
				}
				renderHostSettingsAvatar();
				showNotification("Profile photo removed.");
			});
		}
	}

	bindHostSettingsAvatar();
	renderHostSettingsAvatar();

	// Load Profile & Bank Details for Settings Tab (status-aware: only lock when VERIFIED)
	async function loadProfileAndBankDetails() {
		const profEmail = document.getElementById("profEmail");
		if (profEmail) profEmail.value = email;
		renderHostSettingsAvatar();

		// Use current verification info if available; otherwise fetch account-setup
		let vs = "NOT_SUBMITTED";
		let rejection = null;
		if (currentVerificationInfo && currentVerificationInfo.verification_status) {
			vs = currentVerificationInfo.verification_status;
			rejection = currentVerificationInfo.rejection_reason;
		}

		// Inject status banner + CTA into settings tab (hidden until Admin Portal KYC)
		const sectionSettings = document.getElementById("sectionSettings");
		if (sectionSettings && VERIFICATION_UI_ENABLED) {
			let existingBanner = document.getElementById("settingsVerificationBanner");
			if (!existingBanner) {
				existingBanner = document.createElement("div");
				existingBanner.id = "settingsVerificationBanner";
				sectionSettings.insertBefore(existingBanner, sectionSettings.firstChild.nextSibling);
			}
			let bannerBg = "#f8fafc", bannerBorder = "#e2e8f0", bannerColor = "#475569", bannerTitle = "Verification Status", bannerIcon = "○", bannerSub = "", ctaLabel = null, ctaAction = null;

			if (vs === "VERIFIED") {
				bannerBg = "#f0fdf4"; bannerBorder = "#bbf7d0"; bannerColor = "#166534";
				bannerIcon = "✓"; bannerTitle = "Organizer Verified";
				bannerSub = "Your verification has been approved. Bank details are locked for payout security.";
			} else if (vs === "PENDING") {
				bannerBg = "#fffbeb"; bannerBorder = "#fde68a"; bannerColor = "#92400e";
				bannerIcon = "◷"; bannerTitle = "Verification Under Review";
				bannerSub = "Your KYC documents have been submitted and are under review. You can publish events after approval.";
			} else if (vs === "REJECTED") {
				bannerBg = "#fef2f2"; bannerBorder = "#fecaca"; bannerColor = "#991b1b";
				bannerIcon = "✗"; bannerTitle = "Verification Rejected";
				bannerSub = rejection ? `Reason: ${rejection}. Please update your details and resubmit.` : "Your verification was rejected. Please update your details and resubmit.";
				ctaLabel = "Update & Resubmit Verification";
				ctaAction = () => window.openOrganizerVerificationPanel && window.openOrganizerVerificationPanel();
			} else {
				bannerBg = "#eff6ff"; bannerBorder = "#bfdbfe"; bannerColor = "#1e40af";
				bannerIcon = "!"; bannerTitle = "KYC Required to Publish Events";
				bannerSub = "Complete your organizer verification (bank details, PAN card, and cancelled cheque) to enable publishing and payouts.";
				ctaLabel = "Complete Verification";
				ctaAction = () => window.openOrganizerVerificationPanel && window.openOrganizerVerificationPanel();
			}

			existingBanner.style.cssText = `background:${bannerBg}; border:1.5px solid ${bannerBorder}; color:${bannerColor}; padding:1rem 1.25rem; border-radius:12px; margin-bottom:1.5rem; display:flex; align-items:flex-start; justify-content:space-between; gap:1rem;`;
			existingBanner.innerHTML = `
				<div style="display:flex; gap:0.85rem; align-items:flex-start;">
					<div style="width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.65); border:1.5px solid ${bannerBorder}; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1rem; flex-shrink:0;">${bannerIcon}</div>
					<div>
						<div style="font-weight:800; font-size:0.98rem; margin-bottom:0.15rem;">${bannerTitle}</div>
						<div style="font-size:0.86rem; line-height:1.5; font-weight:500; opacity:0.95;">${bannerSub}</div>
					</div>
				</div>
				${ctaLabel ? `<button id="settingsVerificationBannerCta" type="button" style="background:${bannerColor}; color:#fff; padding:0.5rem 1.05rem; border:none; border-radius:8px; font-weight:700; font-size:0.85rem; cursor:pointer; white-space:nowrap;">${ctaLabel}</button>` : ''}
			`;
			const ctaBtn = document.getElementById("settingsVerificationBannerCta");
			if (ctaBtn && ctaAction) ctaBtn.addEventListener("click", ctaAction);
		} else if (sectionSettings) {
			const existingBanner = document.getElementById("settingsVerificationBanner");
			if (existingBanner) existingBanner.remove();
		}

		try {
			const res = await fetch(`${API_BASE}/account-setup?email=${encodeURIComponent(email)}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				if (data.account) {
					const acc = data.account;
					const profFirstName = document.getElementById("profFirstName");
					const profLastName = document.getElementById("profLastName");
					const profMobile = document.getElementById("profMobile");
					const profGstin = document.getElementById("profGstin");
					const profPan = document.getElementById("profPan");
					const profAddress = document.getElementById("profAddress");
					const profileHeaderName = document.getElementById("profileHeaderName");

					if (acc.contact_full_name) {
						const parts = acc.contact_full_name.split(' ');
						if (profFirstName) profFirstName.value = parts[0] || "";
						if (profLastName) profLastName.value = parts.slice(1).join(' ') || "";
						if (profileHeaderName) profileHeaderName.textContent = acc.contact_full_name;
					}
					renderHostSettingsAvatar();
					if (acc.contact_mobile && profMobile) profMobile.value = acc.contact_mobile;
					if (acc.gstin_number && profGstin) profGstin.value = acc.gstin_number;
					if (acc.pan_number && profPan) profPan.value = acc.pan_number;
					if (acc.org_address && profAddress) profAddress.value = acc.org_address;

					// Bank Details stay locked for payout security — changes go through support.
					const profBankBeneficiary = document.getElementById("profBankBeneficiary");
					const profBankName = document.getElementById("profBankName");
					const profBankAccountType = document.getElementById("profBankAccountType");
					const profBankAccountNumber = document.getElementById("profBankAccountNumber");
					const profBankIfsc = document.getElementById("profBankIfsc");

					[profBankBeneficiary, profBankName, profBankAccountType, profBankAccountNumber, profBankIfsc].forEach(inp => {
						if (!inp) return;
							inp.setAttribute("readonly", "readonly");
							inp.setAttribute("disabled", "disabled");
						inp.setAttribute("tabindex", "-1");
							inp.style.backgroundColor = "#f1f5f9";
							inp.style.cursor = "not-allowed";
							inp.style.color = "#334155";
							inp.style.fontWeight = "700";
					});

					if (acc.beneficiary_name && profBankBeneficiary) profBankBeneficiary.value = acc.beneficiary_name;
					if (acc.bank_name && profBankName) profBankName.value = acc.bank_name;
					if (acc.account_type && profBankAccountType) profBankAccountType.value = acc.account_type.toUpperCase();
					if (acc.account_number && profBankAccountNumber) {
						const rawAcc = String(acc.account_number);
						profBankAccountNumber.value = rawAcc.length > 4
							? `•••• •••• ${rawAcc.slice(-4)}`
							: rawAcc;
					}
					if (acc.bank_ifsc && profBankIfsc) profBankIfsc.value = acc.bank_ifsc;

					// Documents Links
					const profPanDocLink = document.getElementById("profPanDocLink");
					const profChequeDocLink = document.getElementById("profChequeDocLink");
					if (acc.pan_card_url && profPanDocLink) bindPrivateDocumentLink(profPanDocLink, acc.pan_card_url);
					if (acc.cancelled_cheque_url && profChequeDocLink) bindPrivateDocumentLink(profChequeDocLink, acc.cancelled_cheque_url);
				}
			}
		} catch (e) {
			console.log("Could not load account details for settings.");
		}
	}

	const profileForm = document.getElementById("profileForm");
	if (profileForm) {
		profileForm.addEventListener("submit", (e) => {
			e.preventDefault();
			showNotification("✓ Profile details updated successfully. Bank payout information remains locked for security.");
		});
	}

	const btnClearEventData = document.getElementById("btnClearEventData");
	if (btnClearEventData) {
		btnClearEventData.addEventListener("click", async () => {
			const cancelOtpOpts = {
				badge: "Verify to Cancel",
				title: "Confirm event cancellation",
				purpose: "cancel this event and remove it from Home, Category, and Event Details",
				verifyLabel: "Verify & Cancel Event",
				headerBg: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
				verifyBg: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)"
			};
			const introOk = await showHostActionIntroModal({
				badge: "Cancel event",
				title: "Cancel this event?",
				headerBg: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
				confirmBg: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
				confirmLabel: "Send OTP to email",
				bodyHtml: `
					<p style="margin:0 0 0.75rem;">Cancelling removes this event from Home, Category, and Event Details. Tickets already issued will show as cancelled.</p>
					<ul style="margin:0;padding-left:1.15rem;">
						<li>A 6-digit OTP will be sent to your registered organizer email.</li>
						<li>Enter that code to confirm you want to cancel.</li>
						<li>This cannot be undone from the host dashboard.</li>
					</ul>`
			});
			if (!introOk) return;
			const confirmed = await showPublishAuthOtpModal(cancelOtpOpts);
			if (!confirmed) return;
			try {
				const qs = new URLSearchParams({ email });
				if (activeEventId) qs.set("event_id", String(activeEventId));
				const res = await fetch(`${HOST_EVENTS_API_BASE}/clear?${qs.toString()}`, {
					method: "DELETE",
					headers: getAuthHeaders()
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					if (isPublishAuthError(apiErrorMessage(data, ""))) {
						const authed = await showPublishAuthOtpModal(cancelOtpOpts);
						if (!authed) return;
						const retry = await fetch(`${HOST_EVENTS_API_BASE}/clear?${qs.toString()}`, {
							method: "DELETE",
							headers: getAuthHeaders()
						});
						const retryData = await retry.json().catch(() => ({}));
						if (!retry.ok) throw new Error(apiErrorMessage(retryData, "Could not cancel event."));
					} else {
						throw new Error(apiErrorMessage(data, "Could not cancel event."));
					}
				}
					sessionStorage.removeItem(`has_event_${email}`);
				sessionStorage.removeItem(`active_event_id_${email}`);
				hostEventCancelled = true;
					hasEvent = false;
					activeEventId = null;
				currentLifecycle = "draft";
				canPublishNew = true;
				canCreateNew = true;
				if (autoSaveTimer) clearTimeout(autoSaveTimer);
				if (designSaveTimer) clearTimeout(designSaveTimer);
				clearHostWorkspaceForms();
				paintEmptyHostDashboard();
				try { window.dispatchEvent(new Event("jod:inbox-refresh")); } catch (_) {}
				showNotification("Event cancelled. It is no longer listed on Home, Category, or Event Details.");
					switchTab("overview");
				} catch (err) {
				console.warn("Could not cancel event:", err);
				showNotification((err && err.message) || "Could not cancel event. Please try again.");
			}
		});
	}

	// ── DESIGN & MEDIA ASSETS HANDLERS ────────────────────────────────────────

	// Hero Banner Upload
	const bannerDropzone = document.getElementById("bannerDropzone");
	const bannerFileInput = document.getElementById("bannerFileInput");
	const bannerDropzoneContent = document.getElementById("bannerDropzoneContent");
	const bannerPreviewBox = document.getElementById("bannerPreviewBox");
	const bannerPreviewImg = document.getElementById("bannerPreviewImg");
	const btnClearBanner = document.getElementById("btnClearBanner");

	function bindImageDropzone(dropzone, fileInput, skipIds) {
		if (!dropzone || !fileInput) return;
		const skip = skipIds || [];
		dropzone.addEventListener("dragover", (event) => {
			event.preventDefault();
			dropzone.style.borderColor = "#2563eb";
		});
		dropzone.addEventListener("dragleave", () => {
			dropzone.style.borderColor = "";
		});
		dropzone.addEventListener("drop", (event) => {
			event.preventDefault();
			dropzone.style.borderColor = "";
			const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
			if (!file) return;
			try {
				const dt = new DataTransfer();
				dt.items.add(file);
				fileInput.files = dt.files;
			} catch (_) {
				return;
			}
			fileInput.dispatchEvent(new Event("change", { bubbles: true }));
		});
		dropzone.addEventListener("click", (e) => {
			if (skip.includes(e.target && e.target.id)) return;
			fileInput.click();
		});
	}

	function showLocalThenRemotePreview(imgEl, file, remoteUrl) {
		if (!imgEl) return resolveUploadUrl(remoteUrl);
		let localUrl = "";
		if (file) {
			try {
				localUrl = URL.createObjectURL(file);
				imgEl.src = localUrl;
			} catch (_) {}
		}
		const resolved = resolveUploadUrl(remoteUrl);
		if (resolved) {
			imgEl.onload = function onPreviewLoad() {
				imgEl.onload = null;
				if (localUrl) {
					try { URL.revokeObjectURL(localUrl); } catch (_) {}
				}
			};
			imgEl.src = resolved;
		}
		return resolved;
	}

	if (bannerDropzone && bannerFileInput) {
		bindImageDropzone(bannerDropzone, bannerFileInput, ["btnClearBanner"]);
		bannerFileInput.addEventListener("change", async (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			const host = document.getElementById("bannerUploadHost");
			setInlineUploadError(host, "");
			try {
				bannerDropzoneContent.style.opacity = "0.6";
				if (bannerPreviewImg && file) {
					bannerPreviewImg.src = URL.createObjectURL(file);
					bannerDropzoneContent.style.display = "none";
					bannerPreviewBox.style.display = "block";
				}
				const url = await uploadDesignAsset(file, "banner");
				bannerImageUrl = url;
				showLocalThenRemotePreview(bannerPreviewImg, null, url);
				bannerDropzoneContent.style.display = "none";
				bannerPreviewBox.style.display = "block";
				updateEventPagePreview({ event_id: activeEventId, banner_image: url });
				triggerLiveAutoSave();
			} catch (err) {
				setInlineUploadError(host, formatDesignUploadError(err));
			} finally {
				bannerDropzoneContent.style.opacity = "1";
				bannerFileInput.value = "";
			}
		});

		if (btnClearBanner) {
			btnClearBanner.addEventListener("click", (e) => {
				e.stopPropagation();
				bannerFileInput.value = "";
				bannerImageUrl = null;
				bannerDropzoneContent.style.display = "flex";
				bannerPreviewBox.style.display = "none";
				triggerLiveAutoSave();
			});
		}
	}

	function readImageDimensions(file) {
		return new Promise((resolve) => {
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(url);
				resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(null);
			};
			img.src = url;
		});
	}

	// Card Image Upload (Home / Category / Ticket thumbnail)
	const cardImageDropzone = document.getElementById("cardImageDropzone");
	const cardImageFileInput = document.getElementById("cardImageFileInput");
	const cardImageDropzoneContent = document.getElementById("cardImageDropzoneContent");
	const cardImagePreviewBox = document.getElementById("cardImagePreviewBox");
	const cardImagePreviewImg = document.getElementById("cardImagePreviewImg");
	const btnClearCardImage = document.getElementById("btnClearCardImage");

	if (cardImageDropzone && cardImageFileInput) {
		bindImageDropzone(cardImageDropzone, cardImageFileInput, ["btnClearCardImage"]);
		cardImageFileInput.addEventListener("change", async (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			const host = document.getElementById("cardImageUploadHost");
			setInlineUploadError(host, "");
			const dims = await readImageDimensions(file);
			if (dims && (dims.width < 300 || dims.height < 150)) {
				setInlineUploadError(host, `Card image is ${dims.width} × ${dims.height}px. Minimum size is 300 × 150 px.`);
				cardImageFileInput.value = "";
				return;
			}
			try {
				cardImageDropzoneContent.style.opacity = "0.6";
				if (cardImagePreviewImg && file) {
					cardImagePreviewImg.src = URL.createObjectURL(file);
					cardImageDropzoneContent.style.display = "none";
					cardImagePreviewBox.style.display = "block";
				}
				const url = await uploadDesignAsset(file, "card_image");
				cardImageUrl = url;
				showLocalThenRemotePreview(cardImagePreviewImg, null, url);
				cardImageDropzoneContent.style.display = "none";
				cardImagePreviewBox.style.display = "block";
				triggerLiveAutoSave();
			} catch (err) {
				setInlineUploadError(host, formatDesignUploadError(err));
			} finally {
				cardImageDropzoneContent.style.opacity = "1";
				cardImageFileInput.value = "";
			}
		});
	}

	if (btnClearCardImage) {
		btnClearCardImage.addEventListener("click", (e) => {
			e.stopPropagation();
			cardImageUrl = null;
			if (cardImagePreviewImg) cardImagePreviewImg.src = "";
			if (cardImagePreviewBox) cardImagePreviewBox.style.display = "none";
			if (cardImageDropzoneContent) cardImageDropzoneContent.style.display = "flex";
			setInlineUploadError(document.getElementById("cardImageUploadHost"), "");
			triggerLiveAutoSave();
		});
	}

	// Dynamic Sponsor Row Adder
	const sponsorsRows = document.getElementById("sponsorsRows");
	const btnAddSponsor = document.getElementById("btnAddSponsor");

	function createSponsorRowHtml(name = "", tier = "Title Sponsor", logoUrl = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 sponsor-row";
		if (logoUrl) div.dataset.logoUrl = logoUrl;
		const safeName = String(name).replace(/"/g, "&quot;");
		div.innerHTML = `
			<div class="setup-form-group">
				<label>Sponsor Name</label>
				<input type="text" class="setup-input sponsor-name-input" placeholder="e.g. Red Bull" value="${safeName}" />
			</div>
			<div class="setup-form-group">
				<label>Sponsor Category / Tier</label>
				<select class="setup-select sponsor-tier-select">
					<option value="Title Sponsor" ${tier === 'Title Sponsor' ? 'selected' : ''}>Title Sponsor</option>
					<option value="Powered By" ${tier === 'Powered By' ? 'selected' : ''}>Powered By</option>
					<option value="Associate Sponsor" ${tier === 'Associate Sponsor' ? 'selected' : ''}>Associate Sponsor</option>
					<option value="Media Partner" ${tier === 'Media Partner' ? 'selected' : ''}>Media Partner</option>
				</select>
			</div>
			<div class="setup-form-group">
				<label>Sponsor Logo</label>
				<div class="sponsor-logo-wrap" style="display:flex; flex-direction:column; gap:0.45rem;">
					<div style="display:flex; gap:0.5rem;">
						<input type="file" class="sponsor-file-input" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" style="display:none;" />
						<button type="button" class="btn-upload-sponsor-logo" style="background:#fff; border:1.5px solid #cbd5e1; color:#2563eb; font-weight:700; border-radius:8px; padding:0 0.8rem; flex:1; height:44px; font-size:0.85rem; cursor:pointer;">${logoUrl ? "Replace Logo" : "Upload Logo"}</button>
						<button type="button" class="btn-remove-sponsor" title="Remove Sponsor" style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; border-radius:8px; padding:0 0.8rem; cursor:pointer; font-weight:700; height:44px;">&times;</button>
					</div>
					<span style="font-size:0.74rem; color:#64748b;">JPG, JPEG, PNG, WEBP · Max 5MB</span>
					${logoUrl ? `<img class="sponsor-preview-img" src="${resolveUploadUrl(logoUrl)}" alt="Sponsor logo" style="display:block; width:100%; max-width:180px; height:72px; object-fit:contain; border-radius:8px; border:1px solid #e2e8f0; background:#fff; padding:6px;" />` : ""}
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-sponsor");
		removeBtn.addEventListener("click", () => {
			if (sponsorsRows.children.length > 1) div.remove();
			else {
				div.querySelector(".sponsor-name-input").value = "";
				delete div.dataset.logoUrl;
				const prev = div.querySelector(".sponsor-preview-img");
				if (prev) prev.remove();
				div.querySelector(".btn-upload-sponsor-logo").textContent = "Upload Logo";
			}
			triggerLiveAutoSave();
		});

		const uploadBtn = div.querySelector(".btn-upload-sponsor-logo");
		const fileInput = div.querySelector(".sponsor-file-input");
		uploadBtn.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", async (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			const errorHost = div.querySelector(".sponsor-logo-wrap");
			setInlineUploadError(errorHost, "");
			try {
				uploadBtn.textContent = "Uploading…";
				uploadBtn.disabled = true;
				const url = await uploadDesignAsset(file, "sponsor_logo");
				div.dataset.logoUrl = url;
				let prev = div.querySelector(".sponsor-preview-img");
				if (!prev) {
					prev = document.createElement("img");
					prev.className = "sponsor-preview-img";
					prev.alt = "Sponsor logo";
					prev.style.cssText = "display:block; width:100%; max-width:180px; height:72px; object-fit:contain; border-radius:8px; border:1px solid #e2e8f0; background:#fff; padding:6px;";
					div.querySelector(".sponsor-logo-wrap").appendChild(prev);
				}
				prev.src = resolveUploadUrl(url);
				uploadBtn.textContent = "Replace Logo";
				triggerLiveAutoSave();
			} catch (err) {
				setInlineUploadError(errorHost, formatDesignUploadError(err));
				uploadBtn.textContent = logoUrl ? "Replace Logo" : "Upload Logo";
			} finally {
				uploadBtn.disabled = false;
				fileInput.value = "";
			}
		});

		div.querySelector(".sponsor-name-input").addEventListener("input", triggerLiveAutoSave);
		div.querySelector(".sponsor-tier-select").addEventListener("change", triggerLiveAutoSave);
		return div;
	}

	if (btnAddSponsor && sponsorsRows) {
		btnAddSponsor.addEventListener("click", () => {
			sponsorsRows.appendChild(createSponsorRowHtml());
		});
		if (!sponsorsRows.children.length) {
			sponsorsRows.appendChild(createSponsorRowHtml());
		}
	}

	// Dynamic Artist Row Adder
	const artistsRows = document.getElementById("artistsRows");
	const btnAddArtist = document.getElementById("btnAddArtist");

	function createArtistRowHtml(name = "", role = "", photoUrl = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 artist-row";
		if (photoUrl) div.dataset.photoUrl = photoUrl;
		const safeName = String(name).replace(/"/g, "&quot;");
		const safeRole = String(role).replace(/"/g, "&quot;");
		div.innerHTML = `
			<div class="setup-form-group">
				<label>Artist / Speaker Name</label>
				<input type="text" class="setup-input artist-name-input" placeholder="e.g. Artist / Speaker Name" value="${safeName}" />
			</div>
			<div class="setup-form-group">
				<label>Role / Category</label>
				<input type="text" class="setup-input artist-role-input" placeholder="e.g. Headliner / Keynote Speaker" value="${safeRole}" />
			</div>
			<div class="setup-form-group">
				<label>Photo / Headshot</label>
				<div class="artist-photo-wrap" style="display:flex; flex-direction:column; gap:0.45rem;">
					<div style="display:flex; gap:0.5rem;">
						<input type="file" class="artist-file-input" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" style="display:none;" />
						<button type="button" class="btn-upload-artist-photo" style="background:#fff; border:1.5px solid #cbd5e1; color:#2563eb; font-weight:700; border-radius:8px; padding:0 0.8rem; flex:1; height:44px; font-size:0.85rem; cursor:pointer;">${photoUrl ? "Replace Photo" : "Upload Photo"}</button>
						<button type="button" class="btn-remove-artist" title="Remove Artist" style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; border-radius:8px; padding:0 0.8rem; cursor:pointer; font-weight:700; height:44px;">&times;</button>
					</div>
					<span style="font-size:0.74rem; color:#64748b;">JPG, JPEG, PNG, WEBP · Max 5MB</span>
					${photoUrl ? `<img class="artist-preview-img" src="${resolveUploadUrl(photoUrl)}" alt="Artist photo" style="display:block; width:72px; height:72px; object-fit:cover; border-radius:50%; border:1px solid #e2e8f0; background:#f8fafc;" />` : ""}
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-artist");
		removeBtn.addEventListener("click", () => {
			if (artistsRows.children.length > 1) div.remove();
			else {
				div.querySelector(".artist-name-input").value = "";
				div.querySelector(".artist-role-input").value = "";
				delete div.dataset.photoUrl;
				const prev = div.querySelector(".artist-preview-img");
				if (prev) prev.remove();
				div.querySelector(".btn-upload-artist-photo").textContent = "Upload Photo";
			}
			triggerLiveAutoSave();
		});

		const uploadBtn = div.querySelector(".btn-upload-artist-photo");
		const fileInput = div.querySelector(".artist-file-input");
		uploadBtn.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", async (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			const errorHost = div.querySelector(".artist-photo-wrap");
			setInlineUploadError(errorHost, "");
			try {
				uploadBtn.textContent = "Uploading…";
				uploadBtn.disabled = true;
				const url = await uploadDesignAsset(file, "artist_photo");
				div.dataset.photoUrl = url;
				let prev = div.querySelector(".artist-preview-img");
				if (!prev) {
					prev = document.createElement("img");
					prev.className = "artist-preview-img";
					prev.alt = "Artist photo";
					prev.style.cssText = "display:block; width:72px; height:72px; object-fit:cover; border-radius:50%; border:1px solid #e2e8f0; background:#f8fafc;";
					div.querySelector(".artist-photo-wrap").appendChild(prev);
				}
				prev.src = resolveUploadUrl(url);
				uploadBtn.textContent = "Replace Photo";
				triggerLiveAutoSave();
			} catch (err) {
				setInlineUploadError(errorHost, formatDesignUploadError(err));
				uploadBtn.textContent = photoUrl ? "Replace Photo" : "Upload Photo";
			} finally {
				uploadBtn.disabled = false;
				fileInput.value = "";
			}
		});

		div.querySelector(".artist-name-input").addEventListener("input", triggerLiveAutoSave);
		div.querySelector(".artist-role-input").addEventListener("input", triggerLiveAutoSave);
		return div;
	}

	if (btnAddArtist && artistsRows) {
		btnAddArtist.addEventListener("click", () => {
			artistsRows.appendChild(createArtistRowHtml());
		});
		if (!artistsRows.children.length) {
			artistsRows.appendChild(createArtistRowHtml());
		}
	}

	const performersTitleSelect = document.getElementById("performersTitleSelect");
	const performersTitleCustom = document.getElementById("performersTitleCustom");
	if (performersTitleSelect) {
		performersTitleSelect.addEventListener("change", () => {
			syncPerformersTitleCustomVisibility();
			if (performersTitleSelect.value !== "__other__") triggerLiveAutoSave();
		});
	}
	if (performersTitleCustom) {
		performersTitleCustom.addEventListener("input", triggerLiveAutoSave);
		performersTitleCustom.addEventListener("change", triggerLiveAutoSave);
	}

	// Dynamic Event Gallery Photos
	const galleryDropzone = document.getElementById("galleryDropzone");
	const galleryFileInput = document.getElementById("galleryFileInput");
	const galleryThumbnailsGrid = document.getElementById("galleryThumbnailsGrid");

	if (galleryDropzone && galleryFileInput && galleryThumbnailsGrid) {
		const maxGalleryPhotos = 6;

		const galleryHintClass = 'gallery-empty-hint';

		const renderGalleryHint = () => {
			if (!galleryThumbnailsGrid.querySelector('.gallery-thumb-item')) {
				galleryThumbnailsGrid.innerHTML = `<div class="${galleryHintClass}" style="grid-column: 1 / -1; color: #64748b; font-size: 0.92rem; padding: 1rem; border: 1px dashed #cbd5e1; border-radius: 12px; text-align: center;">No gallery photos uploaded yet. Click or drag files to add up to 6 images.</div>`;
			}
		};

		const clearGalleryHint = () => {
			const hint = galleryThumbnailsGrid.querySelector(`.${galleryHintClass}`);
			if (hint) galleryThumbnailsGrid.removeChild(hint);
		};

		const addThumbnail = (src) => {
			clearGalleryHint();
			const thumbDiv = document.createElement('div');
			thumbDiv.className = 'gallery-thumb-item';
			thumbDiv.dataset.originalUrl = src;
			thumbDiv.style.position = 'relative';
			thumbDiv.style.height = '110px';
			thumbDiv.style.borderRadius = '8px';
			thumbDiv.style.overflow = 'hidden';
			thumbDiv.style.border = '1px solid #cbd5e1';
			thumbDiv.style.background = '#f8fafc';
			const img = document.createElement("img");
			img.alt = "Gallery photo";
			img.style.cssText = "width: 100%; height: 100%; object-fit: cover; display: block;";
			img.src = resolveUploadUrl(src);
			const removeBtn = document.createElement("button");
			removeBtn.type = "button";
			removeBtn.className = "btn-remove-thumb";
			removeBtn.innerHTML = "&times;";
			removeBtn.style.cssText = "position: absolute; top: 5px; right: 5px; background: rgba(220,38,38,0.85); color: #fff; border: none; width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 0.8rem; font-weight: 800;";
			removeBtn.addEventListener('click', () => {
				const original = thumbDiv.dataset.originalUrl;
				if (original) {
					galleryImageUrls = galleryImageUrls.filter(u => u !== original);
				}
				thumbDiv.remove();
				if (!galleryThumbnailsGrid.querySelector('.gallery-thumb-item')) renderGalleryHint();
				triggerLiveAutoSave();
			});
			thumbDiv.appendChild(img);
			thumbDiv.appendChild(removeBtn);
			galleryThumbnailsGrid.appendChild(thumbDiv);
		};

		const handleGalleryFiles = async (files) => {
			const galleryHost = document.getElementById("galleryUploadHost");
			setInlineUploadError(galleryHost, "");
			const existingCount = galleryThumbnailsGrid.querySelectorAll('.gallery-thumb-item').length;
			const allowedCount = Math.max(0, maxGalleryPhotos - existingCount);
			if (allowedCount === 0) {
				setInlineUploadError(galleryHost, `You can upload up to ${maxGalleryPhotos} gallery photos.`);
				return;
			}

			const selectedFiles = Array.from(files).slice(0, allowedCount);
			for (const file of selectedFiles) {
				try {
					const url = await uploadDesignAsset(file, "gallery");
					galleryImageUrls.push(url);
					addThumbnail(url);
				} catch (err) {
					setInlineUploadError(galleryHost, formatDesignUploadError(err));
				}
			}
			triggerLiveAutoSave();
		};

		galleryDropzone.addEventListener('click', () => galleryFileInput.click());
		galleryDropzone.addEventListener('dragover', (event) => {
			event.preventDefault();
			galleryDropzone.style.borderColor = '#2563eb';
		});
		galleryDropzone.addEventListener('dragleave', () => {
			galleryDropzone.style.borderColor = '#cbd5e1';
		});
		galleryDropzone.addEventListener('drop', (event) => {
			event.preventDefault();
			galleryDropzone.style.borderColor = '#cbd5e1';
			if (event.dataTransfer?.files) {
				handleGalleryFiles(event.dataTransfer.files);
			}
		});

		galleryFileInput.addEventListener('change', (e) => {
			handleGalleryFiles(e.target.files);
			galleryFileInput.value = '';
		});
		renderGalleryHint();

		function applyPendingHostDesign() {
			if (!pendingHostDesignData) return;
			const d = pendingHostDesignData;
			if (d.about_event && aboutEventIsEmpty()) {
				writeAboutEventHtml(d.about_event);
			}
			if (d.card_image) {
				cardImageUrl = d.card_image;
				const cardPreviewImg = document.getElementById("cardImagePreviewImg");
				const cardDropzoneContent = document.getElementById("cardImageDropzoneContent");
				const cardPreviewBox = document.getElementById("cardImagePreviewBox");
				const cardSrc = resolveUploadUrl(d.card_image);
				if (cardPreviewImg && cardSrc) cardPreviewImg.src = cardSrc;
				if (cardDropzoneContent) cardDropzoneContent.style.display = "none";
				if (cardPreviewBox) cardPreviewBox.style.display = "block";
			}
			if (d.banner_image) {
				bannerImageUrl = d.banner_image;
				const bannerSrc = resolveUploadUrl(d.banner_image);
				if (bannerPreviewImg && bannerSrc) bannerPreviewImg.src = bannerSrc;
				if (bannerDropzoneContent) bannerDropzoneContent.style.display = "none";
				if (bannerPreviewBox) bannerPreviewBox.style.display = "block";
				updateEventPagePreview({ event_id: activeEventId, banner_image: d.banner_image });
			}
			if (d.gallery_images && Array.isArray(d.gallery_images) && d.gallery_images.length) {
				galleryImageUrls = d.gallery_images.slice();
				galleryThumbnailsGrid.innerHTML = "";
				d.gallery_images.forEach((url) => addThumbnail(url));
			}
			populateDesignRows(d.sponsor_details || [], d.speaker_details || []);
			applyPerformersTitle(d.performers_title || "");
			pendingHostDesignData = null;
		}
		applyPendingHostDesign();
	} else if (pendingHostDesignData) {
		applyPerformersTitle(pendingHostDesignData.performers_title || "");
		populateDesignRows(
			pendingHostDesignData.sponsor_details || [],
			pendingHostDesignData.speaker_details || []
		);
		pendingHostDesignData = null;
	}


// ── EVENT DAY LIVE QR SCANNER ────────────────────────────────────────
	const cameraVideo          = document.getElementById("cameraVideo");
	const cameraCanvas         = document.getElementById("cameraCanvas");
	const cameraLoadingOverlay = document.getElementById("cameraLoadingOverlay");
	const cameraScanFrame      = document.getElementById("cameraScanFrame");
	const cameraStatusLabel    = document.getElementById("cameraStatusLabel");
	const cameraTargetBox      = document.getElementById("cameraTargetBox");
	const cameraErrorOverlay   = document.getElementById("cameraErrorOverlay");
	const cameraErrorTitle     = document.getElementById("cameraErrorTitle");
	const cameraErrorMessage   = document.getElementById("cameraErrorMessage");
	const btnRetryCamera       = document.getElementById("btnRetryCamera");

	let _cameraStream = null;
	let _scanRafId = null;
	let _lastDetectedCode = null;

	// Open Camera Modal → auto-start camera
	if (btnLaunchCameraScanner && cameraScannerModal) {
		btnLaunchCameraScanner.addEventListener("click", async () => {
			cameraScannerModal.style.display = "flex";
			if (modalScanResult) modalScanResult.style.display = "none";
			_lastDetectedCode = null;
			await _startCamera();
		});
	}

	// Retry Camera Button
	if (btnRetryCamera) {
		btnRetryCamera.addEventListener("click", async () => {
			await _startCamera();
		});
	}

	function _showCameraError(title, message) {
		if (cameraLoadingOverlay) cameraLoadingOverlay.style.display = "none";
		if (cameraScanFrame) cameraScanFrame.style.display = "none";
		if (cameraVideo) cameraVideo.style.display = "none";
		if (cameraErrorTitle) cameraErrorTitle.textContent = title;
		if (cameraErrorMessage) cameraErrorMessage.textContent = message;
		if (cameraErrorOverlay) cameraErrorOverlay.style.display = "flex";
	}

	function _stopCamera() {
		if (_scanRafId) { cancelAnimationFrame(_scanRafId); _scanRafId = null; }
		if (_cameraStream) {
			_cameraStream.getTracks().forEach(t => t.stop());
			_cameraStream = null;
		}
		if (cameraVideo) {
			try { cameraVideo.pause(); } catch (e) {}
			cameraVideo.srcObject = null;
			cameraVideo.style.display = "none";
		}
		if (cameraScanFrame) cameraScanFrame.style.display = "none";
		if (cameraLoadingOverlay) cameraLoadingOverlay.style.display = "none";
		if (cameraErrorOverlay) cameraErrorOverlay.style.display = "none";
	}

	function _startScanLoop() {
		if (!cameraCanvas || !cameraVideo) return;
		const ctx = cameraCanvas.getContext("2d", { willReadFrequently: true });

		function tick() {
			if (!_cameraStream || cameraVideo.paused || cameraVideo.ended) return;

			if (cameraVideo.readyState >= cameraVideo.HAVE_ENOUGH_DATA) {
				cameraCanvas.width = cameraVideo.videoWidth || 640;
				cameraCanvas.height = cameraVideo.videoHeight || 480;
				ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

				const imageData = ctx.getImageData(0, 0, cameraCanvas.width, cameraCanvas.height);
				let codeData = null;

				if (typeof jsQR !== "undefined") {
					const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
					if (code && code.data) {
						codeData = code.data;
					}
				}

				if (codeData && codeData !== _lastDetectedCode) {
					_lastDetectedCode = codeData;

					// Visual feedback on QR detection
					if (cameraTargetBox) cameraTargetBox.style.borderColor = "#34d399";
					if (cameraStatusLabel) {
						cameraStatusLabel.textContent = "QR Code Detected!";
						cameraStatusLabel.style.color = "#34d399";
					}

					// Auto-fill input field and trigger verification
					if (cameraQrInput) cameraQrInput.value = codeData;
					if (btnVerifyQr) btnVerifyQr.click();

					setTimeout(() => {
						if (cameraTargetBox) cameraTargetBox.style.borderColor = "#10b981";
						if (cameraStatusLabel) {
							cameraStatusLabel.textContent = "Scanning for QR code…";
							cameraStatusLabel.style.color = "#10b981";
						}
					}, 1800);

					setTimeout(() => {
						if (_lastDetectedCode === codeData) {
							_lastDetectedCode = null;
						}
					}, 2500);
				}
			}

			_scanRafId = requestAnimationFrame(tick);
		}

		_scanRafId = requestAnimationFrame(tick);
	}

	async function _startCamera() {
		_stopCamera(); // Stop existing streams before initializing

		// Check secure context / mediaDevices support
		const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
		if (!window.isSecureContext && !isLocalhost) {
			_showCameraError(
				"Security Context Required",
				"Camera access requires a secure connection (HTTPS or localhost). Please open this site over HTTPS or from http://127.0.0.1."
			);
			return;
		}

		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			_showCameraError(
				"Browser Not Supported",
				"Your browser does not support camera access. Please use a modern browser such as Chrome, Edge, or Safari."
			);
			return;
		}

		if (cameraLoadingOverlay) cameraLoadingOverlay.style.display = "flex";
		if (cameraErrorOverlay) cameraErrorOverlay.style.display = "none";
		if (cameraScanFrame) cameraScanFrame.style.display = "none";

		let stream = null;

		// Strategy 1: Rear / Environment camera (ideal for mobile QR scanning)
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false
			});
		} catch (err1) {
			// Strategy 2: Any video camera (for laptop / desktop webcams)
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: true,
					audio: false
				});
			} catch (err2) {
				const err = err2 || err1;
				if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
					_showCameraError(
						"Camera Permission Denied",
						"Camera permission was denied. Please allow camera access in your browser settings and click Retry."
					);
				} else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
					_showCameraError(
						"No Camera Detected",
						"No camera hardware was detected on this device. You can still type or paste QR codes manually below."
					);
				} else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
					_showCameraError(
						"Camera In Use",
						"Unable to access camera because it is being used by another application or browser tab."
					);
				} else {
					_showCameraError(
						"Unable to Access Camera",
						`Unable to initialize camera stream: ${err.message || err.name}`
					);
				}
				return;
			}
		}

		if (!stream) {
			_showCameraError("Camera Failure", "Could not start camera stream.");
			return;
		}

		_cameraStream = stream;
		cameraVideo.srcObject = stream;
		cameraVideo.style.display = "block";

		try {
			await cameraVideo.play();
		} catch (playErr) {
			console.warn("Camera video play warning:", playErr);
		}

		if (cameraLoadingOverlay) cameraLoadingOverlay.style.display = "none";
		if (cameraScanFrame) cameraScanFrame.style.display = "flex";
		if (cameraStatusLabel) {
			cameraStatusLabel.textContent = "Scanning for QR code…";
			cameraStatusLabel.style.color = "#10b981";
		}

		_startScanLoop();
	}


	// ── CAMERA QR SCANNER – VERIFY BUTTON ────────────────────────────────
	const cameraQrInput        = document.getElementById("cameraQrInput");
	const btnVerifyQr          = document.getElementById("btnVerifyQr");
	const scanHistoryWrap      = document.getElementById("scanHistoryWrap");
	const scanHistoryList      = document.getElementById("scanHistoryList");

	// Map: qrCode → { count, name, firstTime }
	const _scanRegistry = new Map();

	// Mock attendee data keyed by QR code prefix (in production replace with API call)
	function _mockLookup(code) {
		// Simple deterministic mock – in production this would call the backend
		const names = ["Ananya Sharma", "Karthik Raja", "Priya Nair", "Vikram S.", "Demo Attendee"];
		const types = ["VIP Access Pass", "General Admission", "Speaker Pass", "Press Pass", "Exhibitor Pass"];
		const gates = ["Gate 1", "Gate 2", "Gate A", "Main Entrance"];
		const h = [...code].reduce((a, c) => a + c.charCodeAt(0), 0);
		return {
			name: names[h % names.length],
			type: types[h % types.length],
			gate: gates[h % gates.length],
		};
	}

	function _addHistoryRow(code, status, name) {
		if (!scanHistoryWrap || !scanHistoryList) return;
		scanHistoryWrap.style.display = "block";
		const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		const color = status === "valid" ? "#10b981" : (status === "invalid" ? "#f87171" : "#f59e0b");
		const label = status === "valid" ? "✔ Valid" : (status === "invalid" ? "✖ Invalid" : "⚠ Duplicate");
		const row = document.createElement("div");
		row.style.cssText = "display:flex;justify-content:space-between;align-items:center;background:#1e293b;border-radius:6px;padding:0.4rem 0.7rem;font-size:0.8rem;";
		row.innerHTML = `<span style="color:#f1f5f9;font-weight:600;">${escapeVolunteerHtml(name)}</span><span style="color:#94a3b8;font-size:0.75rem;">${escapeVolunteerHtml(String(code).slice(0,18))}…</span><span style="color:${color};font-weight:700;">${label}</span><span style="color:#64748b;font-size:0.72rem;">${escapeVolunteerHtml(now)}</span>`;
		scanHistoryList.insertBefore(row, scanHistoryList.firstChild);
	}

	if (btnVerifyQr && modalScanResult && cameraQrInput) {
		btnVerifyQr.addEventListener("click", async () => {
			const code = cameraQrInput.value.trim();
			if (!code) {
				cameraQrInput.style.borderColor = "#ef4444";
				cameraQrInput.focus();
				setTimeout(() => (cameraQrInput.style.borderColor = "#334155"), 1500);
				return;
			}
			const data = await performTicketCheckin(code, modalScanResult);
			const name = (data && (data.attendee_name || data.customer_name)) || "Attendee";
			const status = String((data && data.status) || "").toLowerCase();
			if (data && (data.valid || status === "success")) {
				_addHistoryRow(code, "valid", name);
			} else if (data && (data.already_checked_in || data.duplicate || status === "already_used" || status === "duplicate")) {
				_addHistoryRow(code, "duplicate", name);
			} else {
				_addHistoryRow(code, "invalid", name);
			}
			cameraQrInput.value = "";
			cameraQrInput.focus();
		});

		// Allow pressing Enter to trigger Verify
		cameraQrInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") btnVerifyQr.click();
		});
	}

	// Close Camera Modal (Close Button or Backdrop Click)
	if (cameraScannerModal) {
		if (btnCloseCameraModal) {
			btnCloseCameraModal.addEventListener("click", () => {
				_stopCamera();
				cameraScannerModal.style.display = "none";
				if (modalScanResult) modalScanResult.style.display = "none";
				if (scanHistoryWrap) scanHistoryWrap.style.display = "none";
				if (scanHistoryList) scanHistoryList.innerHTML = "";
				if (cameraQrInput) cameraQrInput.value = "";
			});
		}
		cameraScannerModal.addEventListener("click", (e) => {
			if (e.target === cameraScannerModal) {
				_stopCamera();
				cameraScannerModal.style.display = "none";
				if (modalScanResult) modalScanResult.style.display = "none";
				if (scanHistoryWrap) scanHistoryWrap.style.display = "none";
				if (scanHistoryList) scanHistoryList.innerHTML = "";
				if (cameraQrInput) cameraQrInput.value = "";
			}
		});
	}

	const volunteerNameInput = document.getElementById("volunteerNameInput");
	const volunteerEmailInput = document.getElementById("volunteerEmailInput");
	const volunteerRoleSelect = document.getElementById("volunteerRoleSelect");
	const volunteerGateSelectEl = document.getElementById("volunteerGateSelect");
	const btnInviteVolunteer = document.getElementById("btnInviteVolunteer");
	const generatedLinkContainer = document.getElementById("generatedLinkContainer");
	const volunteerPortalUrl = document.getElementById("volunteerPortalUrl");
	const btnCopyVolunteerUrl = document.getElementById("btnCopyVolunteerUrl");

	if (btnInviteVolunteer) {
		btnInviteVolunteer.addEventListener("click", async () => {
			const name = (volunteerNameInput && volunteerNameInput.value.trim()) || "";
			const volunteerEmail = (volunteerEmailInput && volunteerEmailInput.value.trim()) || "";
			const role = (volunteerRoleSelect && volunteerRoleSelect.value) || "SCANNER";
			const gateId = (volunteerGateSelectEl && volunteerGateSelectEl.value) || "";
			if (!name) {
				alert("Enter the volunteer name.");
				return;
			}
			if (!volunteerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(volunteerEmail)) {
				alert("Enter a valid volunteer email address.");
				return;
			}
			if (!gateId) {
				alert("Save a gate first, then assign this volunteer to that gate.");
				return;
			}
			hideVolunteerInviteLink();
			try {
				const res = await fetch(VOLUNTEERS_API, {
					method: "POST",
					headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
					body: JSON.stringify({
						volunteer_name: name,
						email: volunteerEmail,
						role,
						gate_id: gateId,
						event_id: activeEventId
					})
				});
				const data = await res.json().catch(() => ({}));
				if (res.ok) {
					showVolunteerInviteLink(data.invite_url, name, data.email_sent);
					if (volunteerNameInput) volunteerNameInput.value = "";
					if (volunteerEmailInput) volunteerEmailInput.value = "";
					if (volunteerGateSelectEl) volunteerGateSelectEl.selectedIndex = 0;
					loadVolunteers();
					loadEventDayVolunteerStats();
					if (data.email_sent === false) {
						showNotification(`Volunteer added. Email could not be sent — copy the live invitation link.`);
				} else {
						showNotification(`Invitation sent to ${volunteerEmail}.`);
					}
				} else {
					alert(apiErrorMessage(data, "Could not send volunteer invitation."));
				}
			} catch (err) {
				console.warn(err);
				alert("Could not send volunteer invitation.");
			}
		});
	}

	if (btnCopyVolunteerUrl && volunteerPortalUrl) {
		btnCopyVolunteerUrl.addEventListener("click", async () => {
			const url = (volunteerPortalUrl.value || "").trim();
			if (!url) return;
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					await navigator.clipboard.writeText(url);
				} else {
			volunteerPortalUrl.select();
					document.execCommand("copy");
				}
				showNotification("Invitation link copied.");
				hideVolunteerInviteLink();
			} catch (err) {
				console.warn(err);
				alert("Could not copy the invitation link.");
			}
		});
	}

	// Step 2: Design Form Submit -> Save and move to Registration (Step 3)
	const designAssetsForm = document.getElementById("designAssetsForm");
	const btnSaveDesign = document.getElementById("btnSaveDesign");
	if (btnSaveDesign) {
		btnSaveDesign.addEventListener("click", (e) => {
			e.preventDefault();
			advanceDesignToRegistrations();
		});
	}
	if (designAssetsForm) {
		designAssetsForm.addEventListener("submit", (e) => {
			e.preventDefault();
			advanceDesignToRegistrations();
		});
	}

	const btnDesignBack = document.getElementById("btnDesignBack");
	if (btnDesignBack) {
		btnDesignBack.addEventListener("click", () => {
			switchTab("manage");
		});
	}

	const btnRegBack = document.getElementById("btnRegBack");
	if (btnRegBack) {
		btnRegBack.addEventListener("click", () => {
			switchTab("design");
		});
	}

	// Final Step 4: Publish Event Handler (verification-gated)
	const btnPublishForm = document.getElementById("btnPublishForm");
	const btnTopPublish = document.getElementById("btnTopPublish");

	let _publishEventId = sessionStorage.getItem(`active_event_id_${email}`) || null;

	async function ensureCurrentEventExists() {
		// Gets (or creates) the current EventManagement draft for this organizer via the host-events API.
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/current?email=${encodeURIComponent(email)}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				if (data && data.event && data.event.event_id) {
					_publishEventId = data.event.event_id;
					sessionStorage.setItem(`active_event_id_${email}`, String(_publishEventId));
					return data.event;
				}
			}
		} catch (_) {}
		return null;
	}

	function collectManageEventPayload() {
		// Try to read Manage tab form inputs (if present) for validation.
		const titleInput = document.getElementById("eventTitleInput");
		const title = (titleInput && titleInput.value && titleInput.value.trim()) ||
			(dashEventTitle && dashEventTitle.textContent && dashEventTitle.textContent.trim()) ||
			"My Published Event";
		return {
			event_title: title,
			event_id: _publishEventId || null
		};
	}

	async function verifyCurrentEventIsValid(manageData) {
		const missing = [];
		if (!manageData.event_title || manageData.event_title === "My Published Event" || manageData.event_title.length < 3) {
			missing.push("Event title");
		}
		// Note: Further validation (dates, venue) could be added here; for now only require a title.
		return missing;
	}

	function showPublishGateModal(statusKey, rejectionReason) {
		let title = "";
		let message = "";
		let ctaLabel = "";
		let ctaAction = null;
		let colorCls = "";

		if (statusKey === "NOT_SUBMITTED") {
			title = "Complete Organizer Verification";
			message = "Please complete organizer verification before publishing an event. We need your bank details, PAN card, and a cancelled cheque to verify your identity and enable payouts.";
			ctaLabel = "Complete Verification";
			colorCls = "#2563eb";
			ctaAction = () => {
				closePublishGateModal();
				showVerificationOverlay();
				if (currentVerificationInfo) renderVerificationPanel(currentVerificationInfo);
			};
		} else if (statusKey === "PENDING") {
			title = "Verification Under Review";
			message = "Your organizer verification is currently under review. You can publish this event after verification is approved.";
			ctaLabel = "Close";
			colorCls = "#f59e0b";
			ctaAction = closePublishGateModal;
		} else if (statusKey === "REJECTED") {
			title = "Verification Was Rejected";
			message = rejectionReason
				? `Your organizer verification was rejected: ${rejectionReason}. Please update your verification details and resubmit.`
				: "Your organizer verification was rejected. Please update your verification details and resubmit.";
			ctaLabel = "Update & Resubmit Verification";
			colorCls = "#dc2626";
			ctaAction = () => {
				closePublishGateModal();
				showVerificationOverlay();
				if (currentVerificationInfo) renderVerificationPanel(currentVerificationInfo);
			};
		} else {
			title = "Verification Required";
			message = "You must complete organizer verification before you can publish events.";
			ctaLabel = "Start Verification";
			colorCls = "#2563eb";
			ctaAction = () => {
				closePublishGateModal();
				showVerificationOverlay();
			};
		}

		let modal = document.getElementById("publishGateModal");
		if (!modal) {
			modal = document.createElement("div");
			modal.id = "publishGateModal";
			modal.style.cssText = "position:fixed; inset:0; z-index:10000; background:rgba(15,23,42,0.7); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:1.25rem;";
			document.body.appendChild(modal);
		}
		modal.style.display = "flex";
		modal.innerHTML = `
			<div style="background:#ffffff; border-radius:16px; max-width:520px; width:100%; box-shadow:0 25px 60px rgba(0,0,0,0.35); overflow:hidden;">
				<div style="padding:1.5rem 1.75rem; background:${colorCls}; color:#fff;">
					<div style="font-size:0.72rem; font-weight:700; opacity:0.9; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:0.35rem;">Publish Blocked</div>
					<h3 style="margin:0; font-size:1.25rem; font-weight:800;">${title}</h3>
				</div>
				<div style="padding:1.5rem 1.75rem;">
					<p style="margin:0; color:#334155; line-height:1.55; font-size:0.95rem;">${message}</p>
				</div>
				<div style="display:flex; justify-content:flex-end; gap:0.65rem; padding:1rem 1.75rem 1.5rem; border-top:1px solid #e2e8f0; background:#f8fafc;">
					<button id="publishGateCancel" type="button" style="background:#ffffff; border:1.5px solid #cbd5e1; color:#475569; padding:0.55rem 1.15rem; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">Close</button>
					<button id="publishGateCta" type="button" style="background:linear-gradient(135deg, ${colorCls} 0%, ${colorCls} 100%); color:#fff; padding:0.55rem 1.25rem; border:none; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">${ctaLabel}</button>
				</div>
			</div>
		`;
		document.getElementById("publishGateCancel").addEventListener("click", closePublishGateModal);
		if (ctaAction) document.getElementById("publishGateCta").addEventListener("click", ctaAction);
	}

	function closePublishGateModal() {
		const m = document.getElementById("publishGateModal");
		if (m) {
			m.style.display = "none";
			m.innerHTML = "";
		}
	}

	function ensurePublishModal() {
		let modal = document.getElementById("publishGateModal");
		if (!modal) {
			modal = document.createElement("div");
			modal.id = "publishGateModal";
			modal.style.cssText = "position:fixed; inset:0; z-index:10000; background:rgba(15,23,42,0.7); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:1.25rem;";
			document.body.appendChild(modal);
		}
		modal.style.display = "flex";
		return modal;
	}

	function storePublishAuthToken(_token) {
		return;
	}

	function hasPublishAuthToken() {
		return !!(window.JodAuth && typeof window.JodAuth.isLoggedIn === "function" && window.JodAuth.isLoggedIn());
	}

	function isPublishAuthError(msg) {
		return /authentication required|not authenticated|could not validate credentials|unauthorized/i.test(msg || "");
	}

	function getHostMobile() {
		const profMobile = document.getElementById("profMobile");
		if (profMobile && profMobile.value.trim()) return profMobile.value.trim();
		const acc = currentVerificationInfo && currentVerificationInfo.account;
		return (acc && acc.contact_mobile) ? String(acc.contact_mobile).trim() : "";
	}

	function maskHostMobile(phone) {
		const digits = String(phone || "").replace(/\D/g, "");
		if (digits.length < 4) return phone || "";
		return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
	}

	function showHostActionIntroModal(options) {
		const opts = Object.assign({
			badge: "Confirm action",
			title: "Please confirm",
			bodyHtml: "",
			confirmLabel: "Continue",
			headerBg: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
			confirmBg: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
		}, options || {});
		return new Promise((resolve) => {
			const modal = ensurePublishModal();
			modal.innerHTML = `
				<div style="background:#ffffff; border-radius:16px; max-width:520px; width:100%; box-shadow:0 25px 60px rgba(0,0,0,0.35); overflow:hidden;">
					<div style="padding:1.5rem 1.75rem; background:${opts.headerBg}; color:#fff;">
						<div style="font-size:0.72rem; font-weight:700; opacity:0.92; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:0.35rem;">${opts.badge}</div>
						<h3 style="margin:0; font-size:1.25rem; font-weight:800;">${opts.title}</h3>
					</div>
					<div style="padding:1.5rem 1.75rem; color:#334155; font-size:0.95rem; line-height:1.55;">${opts.bodyHtml}</div>
					<div style="display:flex; justify-content:flex-end; gap:0.65rem; padding:1rem 1.75rem 1.5rem; border-top:1px solid #e2e8f0; background:#f8fafc;">
						<button id="hostIntroCancel" type="button" style="background:#ffffff; border:1.5px solid #cbd5e1; color:#475569; padding:0.55rem 1.15rem; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">Close</button>
						<button id="hostIntroContinue" type="button" style="background:${opts.confirmBg}; color:#fff; padding:0.55rem 1.25rem; border:none; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">${opts.confirmLabel}</button>
					</div>
				</div>`;
			document.getElementById("hostIntroCancel").addEventListener("click", () => {
				closePublishGateModal();
				resolve(false);
			});
			document.getElementById("hostIntroContinue").addEventListener("click", () => {
				closePublishGateModal();
				resolve(true);
			});
		});
	}

	function showPublishAuthOtpModal(options) {
		const opts = Object.assign({
			badge: "Verify to Publish",
			title: "Confirm with OTP",
			purpose: "authenticate and publish this event",
			verifyLabel: "Verify & Publish",
			headerBg: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
			verifyBg: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
		}, options || {});
		return new Promise(async (resolve) => {
			const hostEmail = email || (window.JodAuth && window.JodAuth.getUser && window.JodAuth.getUser() && window.JodAuth.getUser().email) || "";
			const hostMobile = getHostMobile();
			const modal = ensurePublishModal();
			let settled = false;
			let verifying = false;
			let otpChannel = hostMobile ? "email" : "email";
			const finish = (ok) => {
				if (settled) return;
				settled = true;
				closePublishGateModal();
				resolve(ok);
			};
			modal.innerHTML = `
				<div style="background:#ffffff; border-radius:16px; max-width:480px; width:100%; box-shadow:0 25px 60px rgba(0,0,0,0.35); overflow:hidden;">
					<div style="padding:1.5rem 1.75rem; background:${opts.headerBg}; color:#fff;">
						<div style="font-size:0.72rem; font-weight:700; opacity:0.92; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:0.35rem;"></div>
						<h3 style="margin:0; font-size:1.25rem; font-weight:800;"></h3>
					</div>
					<div style="padding:1.5rem 1.75rem;">
						<p style="margin:0 0 0.85rem; color:#334155; line-height:1.55; font-size:0.95rem;">
							Choose where we should send a 6-digit OTP, then enter the code to <span id="publishOtpPurpose"></span>.
						</p>
						<div style="display:flex; gap:0.5rem; margin-bottom:0.9rem;">
							<button type="button" id="otpChannelEmail" style="flex:1; border:1.5px solid #2563eb; background:#eff6ff; color:#1d4ed8; padding:0.5rem 0.6rem; border-radius:8px; font-weight:800; cursor:pointer;">Email</button>
							<button type="button" id="otpChannelPhone" style="flex:1; border:1.5px solid #cbd5e1; background:#ffffff; color:#475569; padding:0.5rem 0.6rem; border-radius:8px; font-weight:800; cursor:pointer;">Mobile</button>
						</div>
						<p style="margin:0 0 0.75rem; color:#334155; font-size:0.9rem;">
							Code will be sent to <strong id="publishOtpEmail" style="color:#0f172a;"></strong>.
						</p>
						<div id="publishOtpDevBanner" style="display:none; margin-bottom:0.85rem; background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:8px; padding:0.65rem 0.8rem; font-size:0.82rem; font-weight:600;">
							Dev OTP: <span id="publishOtpDevValue"></span>
						</div>
						<div id="publishOtpInputs" style="display:flex; gap:0.45rem; justify-content:center; margin:1rem 0 0.5rem;">
							<input class="publish-otp-field" maxlength="1" inputmode="numeric" pattern="[0-9]" style="width:42px; height:48px; text-align:center; font-size:1.25rem; font-weight:800; border:1.5px solid #cbd5e1; border-radius:8px;" />
							<input class="publish-otp-field" maxlength="1" inputmode="numeric" pattern="[0-9]" style="width:42px; height:48px; text-align:center; font-size:1.25rem; font-weight:800; border:1.5px solid #cbd5e1; border-radius:8px;" />
							<input class="publish-otp-field" maxlength="1" inputmode="numeric" pattern="[0-9]" style="width:42px; height:48px; text-align:center; font-size:1.25rem; font-weight:800; border:1.5px solid #cbd5e1; border-radius:8px;" />
							<input class="publish-otp-field" maxlength="1" inputmode="numeric" pattern="[0-9]" style="width:42px; height:48px; text-align:center; font-size:1.25rem; font-weight:800; border:1.5px solid #cbd5e1; border-radius:8px;" />
							<input class="publish-otp-field" maxlength="1" inputmode="numeric" pattern="[0-9]" style="width:42px; height:48px; text-align:center; font-size:1.25rem; font-weight:800; border:1.5px solid #cbd5e1; border-radius:8px;" />
							<input class="publish-otp-field" maxlength="1" inputmode="numeric" pattern="[0-9]" style="width:42px; height:48px; text-align:center; font-size:1.25rem; font-weight:800; border:1.5px solid #cbd5e1; border-radius:8px;" />
						</div>
						<p id="publishOtpStatus" style="min-height:1.2rem; margin:0.4rem 0 0; font-size:0.82rem; font-weight:600; color:#64748b; text-align:center;"></p>
					</div>
					<div style="display:flex; justify-content:space-between; gap:0.65rem; padding:1rem 1.75rem 1.5rem; border-top:1px solid #e2e8f0; background:#f8fafc;">
						<button id="publishOtpResend" type="button" style="background:#ffffff; border:1.5px solid #cbd5e1; color:#2563eb; padding:0.55rem 1.15rem; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">Resend OTP</button>
						<div style="display:flex; gap:0.65rem;">
							<button id="publishOtpCancel" type="button" style="background:#ffffff; border:1.5px solid #cbd5e1; color:#475569; padding:0.55rem 1.15rem; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">Close</button>
							<button id="publishOtpVerify" type="button" style="background:${opts.verifyBg}; color:#fff; padding:0.55rem 1.25rem; border:none; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;"></button>
						</div>
					</div>
				</div>
			`;
			const badgeEl = modal.querySelector("div[style*='letter-spacing']");
			if (badgeEl) badgeEl.textContent = opts.badge;
			const titleEl = modal.querySelector("h3");
			if (titleEl) titleEl.textContent = opts.title;
			const emailEl = document.getElementById("publishOtpEmail");
			const btnEmail = document.getElementById("otpChannelEmail");
			const btnPhone = document.getElementById("otpChannelPhone");
			const purposeEl = document.getElementById("publishOtpPurpose");
			if (purposeEl) purposeEl.textContent = opts.purpose;
			const verifyBtn = document.getElementById("publishOtpVerify");
			if (verifyBtn) verifyBtn.textContent = opts.verifyLabel;

			function paintChannel() {
				const emailActive = otpChannel === "email";
				if (btnEmail) {
					btnEmail.style.border = emailActive ? "1.5px solid #2563eb" : "1.5px solid #cbd5e1";
					btnEmail.style.background = emailActive ? "#eff6ff" : "#ffffff";
					btnEmail.style.color = emailActive ? "#1d4ed8" : "#475569";
				}
				if (btnPhone) {
					btnPhone.style.border = !emailActive ? "1.5px solid #2563eb" : "1.5px solid #cbd5e1";
					btnPhone.style.background = !emailActive ? "#eff6ff" : "#ffffff";
					btnPhone.style.color = !emailActive ? "#1d4ed8" : "#475569";
				}
				if (emailEl) {
					emailEl.textContent = emailActive
						? (hostEmail || "your registered email")
						: (hostMobile ? maskHostMobile(hostMobile) : "your registered mobile");
				}
			}
			paintChannel();

			const statusEl = document.getElementById("publishOtpStatus");
			const fields = Array.from(modal.querySelectorAll(".publish-otp-field"));
			const setStatus = (msg, ok) => {
				if (!statusEl) return;
				statusEl.textContent = msg || "";
				statusEl.style.color = ok ? "#166534" : "#dc2626";
			};

			const readOtp = () => fields.map((f) => f.value).join("");

			async function sendPublishOtp() {
				if (!hostEmail) {
					setStatus("No organizer email found. Please log in again.");
					return;
				}
				if (otpChannel === "phone" && !hostMobile) {
					setStatus("No mobile number on your organizer account. Add it in Host Settings, or verify by email.");
					return;
				}
				setStatus("Sending OTP…", true);
				try {
					const fetchFn = window.JodAuth && typeof window.JodAuth.fetchAuth === "function"
						? window.JodAuth.fetchAuth
						: fetch;
					const res = await fetchFn(`${API_BASE}/send-otp`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email: hostEmail, channel: otpChannel })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(apiErrorMessage(data, "Failed to send OTP."));
					const banner = document.getElementById("publishOtpDevBanner");
					if (banner) banner.style.display = "none";
					setStatus(data.message || `OTP sent to ${data.destination || hostEmail}.`, true);
					if (fields[0]) fields[0].focus();
				} catch (err) {
					setStatus(err.message || "Failed to send OTP.");
				}
			}

			async function verifyPublishOtp() {
				if (verifying || settled) return;
				const code = readOtp();
				if (code.length !== 6) {
					setStatus("Enter the 6-digit OTP we sent you.");
					return;
				}
				verifying = true;
				setStatus("Verifying…", true);
				try {
					const fetchFn = window.JodAuth && typeof window.JodAuth.fetchAuth === "function"
						? window.JodAuth.fetchAuth
						: fetch;
					const res = await fetchFn(`${API_BASE}/verify-otp`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email: hostEmail, otp_code: code })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(apiErrorMessage(data, "Invalid OTP."));
					if (!data.verified) {
						throw new Error("Could not verify OTP. Please try again.");
					}
					finish(true);
				} catch (err) {
					verifying = false;
					setStatus(err.message || "Could not verify OTP.");
				}
			}

			fields.forEach((field, index) => {
				field.addEventListener("input", (e) => {
					e.target.value = e.target.value.replace(/\D/g, "").slice(0, 1);
					if (e.target.value && index < fields.length - 1) fields[index + 1].focus();
					if (readOtp().length === 6) verifyPublishOtp();
				});
				field.addEventListener("keydown", (e) => {
					if (e.key === "Backspace" && !field.value && index > 0) fields[index - 1].focus();
				});
				field.addEventListener("paste", (e) => {
					e.preventDefault();
					const pasted = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
					pasted.split("").forEach((ch, i) => { if (fields[i]) fields[i].value = ch; });
					if (pasted.length === 6) verifyPublishOtp();
				});
			});

			document.getElementById("publishOtpCancel").addEventListener("click", () => {
				finish(false);
			});
			document.getElementById("publishOtpResend").addEventListener("click", sendPublishOtp);
			document.getElementById("publishOtpVerify").addEventListener("click", verifyPublishOtp);
			if (btnEmail) btnEmail.addEventListener("click", () => {
				otpChannel = "email";
				paintChannel();
				sendPublishOtp();
			});
			if (btnPhone) btnPhone.addEventListener("click", () => {
				otpChannel = "phone";
				paintChannel();
				sendPublishOtp();
			});

			await sendPublishOtp();
		});
	}

	function showPublishConfirm(manageData, onConfirm) {
		const readyNote = VERIFICATION_UI_ENABLED
			? `<div style="display:flex; gap:0.55rem; align-items:center; background:#f0fdf4; color:#166534; padding:0.75rem 1rem; border-radius:8px; border:1px solid #bbf7d0; font-size:0.85rem; font-weight:600;">
						<span style="font-size:1rem;">✓</span>
						<span>Organizer verification passed. Proceeding to publish.</span>
					</div>`
			: `<div style="display:flex; gap:0.55rem; align-items:center; background:#eff6ff; color:#1e40af; padding:0.75rem 1rem; border-radius:8px; border:1px solid #bfdbfe; font-size:0.85rem; font-weight:600;">
						<span style="font-size:1rem;">ℹ</span>
						<span>Your design, policies, and registration form will go live for attendees.</span>
					</div>`;
		let modal = document.getElementById("publishGateModal");
		if (!modal) {
			modal = document.createElement("div");
			modal.id = "publishGateModal";
			modal.style.cssText = "position:fixed; inset:0; z-index:10000; background:rgba(15,23,42,0.7); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:1.25rem;";
			document.body.appendChild(modal);
		}
		modal.style.display = "flex";
		modal.innerHTML = `
			<div style="background:#ffffff; border-radius:16px; max-width:520px; width:100%; box-shadow:0 25px 60px rgba(0,0,0,0.35); overflow:hidden;">
				<div style="padding:1.5rem 1.75rem; background:linear-gradient(135deg, #059669 0%, #047857 100%); color:#fff;">
					<div style="font-size:0.72rem; font-weight:700; opacity:0.92; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:0.35rem;">Ready to Go Live</div>
					<h3 style="margin:0; font-size:1.25rem; font-weight:800;">Publish this event?</h3>
				</div>
				<div style="padding:1.5rem 1.75rem;">
					<p style="margin:0 0 0.75rem; color:#334155; line-height:1.55; font-size:0.95rem;">
						You are about to publish <strong style="color:#0f172a;">${manageData.event_title || "your event"}</strong>.
						Once published, attendees can discover and register for it.
					</p>
					${readyNote}
				</div>
				<div style="display:flex; justify-content:flex-end; gap:0.65rem; padding:1rem 1.75rem 1.5rem; border-top:1px solid #e2e8f0; background:#f8fafc;">
					<button id="publishConfirmCancel" type="button" style="background:#ffffff; border:1.5px solid #cbd5e1; color:#475569; padding:0.55rem 1.15rem; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">Cancel</button>
					<button id="publishConfirmOk" type="button" style="background:linear-gradient(135deg, #10b981 0%, #047857 100%); color:#fff; padding:0.55rem 1.25rem; border:none; border-radius:8px; font-weight:700; font-size:0.88rem; cursor:pointer;">✓ Publish Event Now</button>
				</div>
			</div>
		`;
		document.getElementById("publishConfirmCancel").addEventListener("click", closePublishGateModal);
		document.getElementById("publishConfirmOk").addEventListener("click", onConfirm);
	}

	async function handleFinalPublish() {
		if (_publishInFlight) return;
		if (VERIFICATION_UI_ENABLED) {
		const info = await fetchVerificationStatus(true);
		const statusKey = info ? info.verification_status : "NOT_SUBMITTED";
		if (statusKey !== "VERIFIED") {
			showPublishGateModal(statusKey, info ? info.rejection_reason : null);
			return;
			}
		}

		if (!canPublishNew && !isPublishedLifecycle()) {
			showNotification("You already have an active event. You can create and publish a new event only after your current event has ended.");
			return;
		}
		if (endIsBeforeStart()) {
			showNotification("Event end date & time must be after the start. Fix the schedule in Manage, then publish again.");
			return;
		}

		_publishInFlight = true;
		const btnPublish = document.getElementById("btnPublishForm");
		const btnTop = document.getElementById("btnTopPublish");
		setWizardNavBusy(btnPublish, true, "<span>Publishing…</span>");
		setWizardNavBusy(btnTop, true, "<span>Publishing…</span>");

		try {
			const manageSaved = await autoSaveManageEvent();
			if (!manageSaved) {
				showNotification("Could not save Manage details. Publishing cancelled.");
				return;
			}
			await autoSaveEventDesign();
			if (window.JodFormBuilder && typeof window.JodFormBuilder.saveDraft === "function") {
				try {
					await window.JodFormBuilder.saveDraft();
				} catch (formErr) {
					console.warn("Registration form save warning:", formErr);
				}
			}

		const manageData = collectManageEventPayload();
		const missing = await verifyCurrentEventIsValid(manageData);
		if (missing && missing.length > 0) {
			alert("Please complete the following before publishing: " + missing.join(", "));
				if (missing.indexOf("Event title") >= 0) switchTab("manage");
			return;
		}

		showPublishConfirm(manageData, async () => {
			closePublishGateModal();
				_publishInFlight = true;
				setWizardNavBusy(btnPublish, true, "<span>Publishing…</span>");
				setWizardNavBusy(btnTop, true, "<span>Publishing…</span>");

				async function postPublishEvent() {
				const cur = await ensureCurrentEventExists();
					const event_id = activeEventId || (cur && cur.event_id) || _publishEventId || null;
					const dateInput = document.getElementById("eventDateInput");
					const endDateInput = document.getElementById("eventEndDateInput");
					const locationInput = document.getElementById("eventLocationInput");
					const categorySelect = document.getElementById("eventCategorySelect");
					const formatInput = document.getElementById("eventFormatInput");

				const payload = {
					organizer_email: email,
					event_id: event_id || undefined,
					event_title: manageData.event_title,
						event_category: categorySelect ? categorySelect.value : undefined,
						event_mode: formatInput ? formatInput.value : undefined,
						venue: locationInput ? locationInput.value.trim() : undefined,
						address: locationInput ? locationInput.value.trim() : undefined,
						latitude: readVenueCoord("eventVenueLat"),
						longitude: readVenueCoord("eventVenueLon"),
						event_start_date: toIstIsoFromDatetimeLocal(dateInput && dateInput.value),
						event_end_date: toIstIsoFromDatetimeLocal(endDateInput && endDateInput.value),
						event_start_time: timeFromDatetimeLocal(dateInput && dateInput.value),
						event_end_time: timeFromDatetimeLocal(endDateInput && endDateInput.value),
						duration: (document.getElementById("eventDurationInput")?.value || "").trim().slice(0, 20),
						event_status: "published",
						tickets_json: collectTicketsJson(),
						agenda_json: collectAgendaJson(),
						policies_json: collectPoliciesJson(),
						about_event: readAboutEventHtml() || undefined
				};

				const res = await fetch(`${HOST_EVENTS_API_BASE}/manage`, {
					method: "POST",
					headers: Object.assign({}, getAuthHeaders(), { "Content-Type": "application/json" }),
					body: JSON.stringify(payload)
				});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(apiErrorMessage(data, "Publishing failed on the server."));

					if (data.catalog_synced === false) {
						throw new Error(
							data.catalog_sync_error ||
							"Event was saved but could not be published to the public catalog. Please try again."
						);
					}

				if (data.event_id) {
						activeEventId = data.event_id;
					_publishEventId = data.event_id;
					sessionStorage.setItem(`active_event_id_${email}`, String(data.event_id));
				}

					// Publish registration form so Buy Ticket can load published-form.html
					if (window.JodFormBuilder && typeof window.JodFormBuilder.saveAndPublishForEvent === "function") {
						try {
							await window.JodFormBuilder.saveAndPublishForEvent();
						} catch (formPublishErr) {
							console.warn("Registration form publish warning:", formPublishErr);
							showNotification("Event is live, but the registration form could not be published. Open Form Builder and publish the form.");
						}
					}

					currentLifecycle = data.lifecycle || "published";
				hasEvent = true;
				sessionStorage.setItem(`has_event_${email}`, "true");
				const title = manageData.event_title || "My Published Event";
				if (dashEventTitle) dashEventTitle.textContent = title;
					applySectionActionLabels();
					renderOverviewState();
					showNotification(`Event "${title}" is now live on Home, Category, and Event Details pages.`);
				switchTab("overview");
				}

				async function authenticateThenPublish() {
					setWizardNavBusy(btnPublish, false);
					setWizardNavBusy(btnTop, false);
					const verified = await showPublishAuthOtpModal();
					if (!verified) return false;
					setWizardNavBusy(btnPublish, true, "<span>Publishing…</span>");
					setWizardNavBusy(btnTop, true, "<span>Publishing…</span>");
					await postPublishEvent();
					return true;
				}

				try {
					setWizardNavBusy(btnPublish, false);
					setWizardNavBusy(btnTop, false);
					const verified = await showPublishAuthOtpModal();
					if (!verified) return;
					setWizardNavBusy(btnPublish, true, "<span>Publishing…</span>");
					setWizardNavBusy(btnTop, true, "<span>Publishing…</span>");
					await postPublishEvent();
			} catch (err) {
				const msg = err && err.message ? err.message : String(err || "");
					if (isPublishAuthError(msg)) {
						try {
							await authenticateThenPublish();
						} catch (retryErr) {
							showNotification((retryErr && retryErr.message) || "Failed to publish event. Please try again.");
						}
					} else if (/already have an active event/i.test(msg)) {
						showNotification("You already have an active event. You can create and publish a new event only after your current event has ended.");
					} else if (/verification|under review|rejected/i.test(msg)) {
					const refreshed = await fetchVerificationStatus(true);
					showPublishGateModal(
						refreshed ? refreshed.verification_status : "NOT_SUBMITTED",
						refreshed ? refreshed.rejection_reason : null
					);
				} else {
						showNotification(msg || "Failed to publish event. Please try again.");
				}
				} finally {
					_publishInFlight = false;
					setWizardNavBusy(btnPublish, false);
					setWizardNavBusy(btnTop, false);
			}
		});
		} finally {
			setWizardNavBusy(btnPublish, false);
			setWizardNavBusy(btnTop, false);
			_publishInFlight = false;
		}
	}

	if (btnPublishForm) {
		btnPublishForm.addEventListener("click", (e) => {
			if (e && typeof e.preventDefault === "function") e.preventDefault();
			if (e && typeof e.stopPropagation === "function") e.stopPropagation();
			handleFinalPublish();
		});
	}

	if (btnTopPublish) {
		btnTopPublish.addEventListener("click", (e) => {
			if (e && typeof e.preventDefault === "function") e.preventDefault();
			handleFinalPublish();
		});
	}

	// Expose active event id for form-builder and other modules
	window.JodOrganizer = {
		getActiveEventId: () => activeEventId,
		getOrganizerEmail: () => email,
		getLifecycle: () => currentLifecycle
	};

	// Expose verification controls globally (so Settings tab or other parts can open the panel)
	window.openOrganizerVerificationPanel = function () {
		if (!VERIFICATION_UI_ENABLED) return;
		showVerificationOverlay();
		fetchVerificationStatus(true).then(() => {
			renderVerificationPanel(currentVerificationInfo || { verification_status: "NOT_SUBMITTED" });
		});
	};

	// ── Information Symbol 'i' Modal Logic ────────────────────────────────────
	const INFO_DETAILS_DATA = {
		"exhibitors-overview": {
			badge: "Exhibitors & Booth AI",
			title: "AI Booth Placement & Traffic Optimization",
			icon: "🎪",
			description: "Our machine learning engine analyzes floor plans, attendee demographic interests, and entry gate traffic flows to suggest peak booth locations and dynamic pricing.",
			sections: [
				{
					heading: "How AI Optimization Works",
					content: "1. <strong>Heatmap Simulation:</strong> Maps predicted footfall vectors from main entrances to key stage halls.<br/>2. <strong>Category Balance:</strong> Distributes direct competitors across different aisle zones.<br/>3. <strong>Revenue Maximization:</strong> Adjusts booth tier pricing based on historical demand."
				},
				{
					heading: "🚀 Traffic Optimization",
					content: "<strong>Recommendation:</strong> Relocate TechCorp booth #B-12 to Hall A Entrance to boost footfall by +24%.<br/><br/>• <strong>+24% Footfall Surge:</strong> Positioning near Hall A Entrance increases attendee exposure.<br/>• <strong>Queue Reduction:</strong> Reduces choke points in secondary corridors.<br/>• <strong>Sponsor Value:</strong> High visibility increases booth lead captures."
				},
				{
					heading: "💎 Sponsorship Pricing Suggestion",
					content: "High demand predicted for Hall C Premium booths. Suggest +15% package price surge for late registrations.<br/><br/>• <strong>Inventory Remaining:</strong> Only 22% of Hall C booths available.<br/>• <strong>Suggested Surge:</strong> +15% price increase.<br/>• <strong>Projected Extra Revenue:</strong> ₹45,000."
				},
				{
					heading: "📊 Popular Booth Forecast",
					content: "Booths #A-01 to #A-05 are predicted to receive 65% of attendee check-in scans.<br/><br/>• <strong>Avg Dwell Time:</strong> 8.5 minutes per visitor.<br/>• <strong>Peak Traffic Hours:</strong> 11:30 AM & 02:30 PM.<br/>• <strong>Recommended Prep:</strong> Assign dedicated volunteer scanners and Wi-Fi repeaters to Hall A."
				},
				{
					heading: "Recommended Action Plan",
					content: "Review high-demand booths regularly and assign prime spots to key partners early to maximize booth sales ROI."
				}
			]
		},
		"traffic-opt": {
			badge: "Traffic Analytics",
			title: "Traffic Optimization Details",
			icon: "🚀",
			description: "Detailed analysis for relocating high-traffic exhibitors (e.g. TechCorp booth #B-12) to Hall A Entrance.",
			sections: [
				{
					heading: "Impact & Benefits",
					content: "• <strong>+24% Footfall Surge:</strong> Positioning near Hall A Entrance increases attendee exposure.<br/>• <strong>Queue Reduction:</strong> Reduces choke points in secondary corridors.<br/>• <strong>Sponsor Value:</strong> High visibility increases booth lead captures."
				},
				{
					heading: "Implementation",
					content: "Contact exhibitor to confirm booth relocation. Update gate digital maps automatically."
				}
			]
		},
		"sponsorship-pricing": {
			badge: "Pricing Intelligence",
			title: "Sponsorship Pricing & Dynamic Surge",
			icon: "💎",
			description: "Algorithmically calculated price surge model based on inventory scarcity and time remaining until event day.",
			sections: [
				{
					heading: "Current Metrics",
					content: "• <strong>Inventory Remaining:</strong> Only 22% of Hall C booths available.<br/>• <strong>Suggested Surge:</strong> +15% price increase.<br/>• <strong>Projected Extra Revenue:</strong> ₹45,000."
				},
				{
					heading: "Best Practice",
					content: "Enable automated pricing tiers to capture high late-registration willingness-to-pay."
				}
			]
		},
		"booth-forecast": {
			badge: "Predictive Analytics",
			title: "Popular Booth Check-in Forecast",
			icon: "📊",
			description: "Predicts attendee scan distribution across all booths based on ticket surveys and industry interests.",
			sections: [
				{
					heading: "Key Predictions",
					content: "• <strong>Top Zone:</strong> Booths #A-01 to #A-05 will attract 65% of total scans.<br/>• <strong>Avg Dwell Time:</strong> 8.5 minutes per visitor.<br/>• <strong>Peak Traffic Hours:</strong> 11:30 AM & 02:30 PM."
				},
				{
					heading: "Recommended Prep",
					content: "Ensure dedicated volunteer scanners and Wi-Fi repeaters are assigned to Hall A."
				}
			]
		},
		"communicate-overview": {
			badge: "Communication Hub",
			title: "Omnichannel Broadcast Studio Guide",
			icon: "📢",
			description: "Centralized messaging studio to compose, schedule, and broadcast multi-channel announcements across Email, SMS, WhatsApp, and Mobile Push.",
			sections: [
				{
					heading: "✉️ Email Campaigns",
					content: "Send personalized broadcast emails, ticket confirmations, calendar invites, and automated event reminders.<br/><br/>• <strong>Delivery Rate:</strong> 99.4% inbox placement.<br/>• <strong>Avg Open Rate:</strong> 42.8% for event broadcasts.<br/>• <strong>Supported Media:</strong> PDF Tickets, Calendar Passes (.ics), Custom HTML.<br/>• <strong>Pro Tip:</strong> Schedule your primary reminder email 24 hours prior to door opening for maximum attendance turn-out."
				},
				{
					heading: "📱 SMS & Push Alerts",
					content: "Instant delivery channel for urgent notifications, parking updates, schedule shifts, and security alerts.<br/><br/>• <strong>Delivery Speed:</strong> Delivered within 3 seconds worldwide.<br/>• <strong>Open Rate:</strong> 98% read rate.<br/>• <strong>DLT Verification:</strong> Compliant with Indian telecom DLT regulations.<br/>• <strong>Usage:</strong> Reserve SMS for urgent gate check-in pass delivery and emergencies."
				},
				{
					heading: "💬 WhatsApp Integration",
					content: "Direct WhatsApp messaging with interactive buttons, green-tick verification, and instant QR pass delivery.<br/><br/>• <strong>Instant Ticket Delivery:</strong> Sends PDF tickets directly to attendee WhatsApp.<br/>• <strong>Read Rate:</strong> 95% within 5 minutes.<br/>• <strong>Interactive Buttons:</strong> 'View Venue Map', 'Add to Calendar', 'Ask Bot'.<br/>• <strong>Setup:</strong> Ensure WhatsApp template permissions are active prior to mass blasts."
				},
				{
					heading: "📣 Announcement Center",
					content: "Broadcast live notices across attendee mobile web apps, hall digital signage screens, and stage audio.<br/><br/>• <strong>Screen Takeover:</strong> Push emergency or keynote alerts to hall screens.<br/>• <strong>Targeting:</strong> Select specific halls, VIP lounges, or all venue zones.<br/>• <strong>Auto-Translation:</strong> Instant translation into major regional languages.<br/>• <strong>Best Practice:</strong> Publish key session start alerts 10 minutes beforehand to direct crowd movement."
				},
				{
					heading: "Targeting & AI Copywriter",
					content: "1. Filter recipient audience by All Attendees, VIP Pass Holders, Exhibitors, or Keynote Speakers.<br/>2. Click <strong>Generate Message with AI</strong> to draft high-converting announcement copy instantly."
				}
			]
		},
		"email-campaigns": {
			badge: "Channel Details",
			title: "Email Campaigns & Automation Studio",
			icon: "✉️",
			description: "Send personalized broadcast emails, ticket confirmations, calendar invites, and automated event reminders.",
			sections: [
				{
					heading: "Performance Standards",
					content: "• <strong>Delivery Rate:</strong> 99.4% inbox placement.<br/>• <strong>Avg Open Rate:</strong> 42.8% for event broadcasts.<br/>• <strong>Supported Media:</strong> PDF Tickets, Calendar Passes (.ics), Custom HTML."
				},
				{
					heading: "Pro Tips",
					content: "Schedule your primary reminder email 24 hours prior to door opening for maximum attendance turn-out."
				}
			]
		},
		"sms-push-alerts": {
			badge: "Channel Details",
			title: "SMS & Mobile Push Emergency Broadcasts",
			icon: "📱",
			description: "Instant delivery channel for urgent notifications, parking updates, schedule shifts, and security alerts.",
			sections: [
				{
					heading: "Key Specifications",
					content: "• <strong>Delivery Speed:</strong> Delivered within 3 seconds worldwide.<br/>• <strong>Open Rate:</strong> 98% read rate.<br/>• <strong>DLT Verification:</strong> Compliant with Indian telecom DLT regulations."
				},
				{
					heading: "Usage Recommendations",
					content: "Reserve SMS broadcasts for urgent updates and gate check-in pass delivery."
				}
			]
		},
		"whatsapp-integration": {
			badge: "Channel Details",
			title: "WhatsApp Official Business API",
			icon: "💬",
			description: "Direct WhatsApp messaging with interactive buttons, green-tick verification, and instant QR pass delivery.",
			sections: [
				{
					heading: "Capabilities & Features",
					content: "• <strong>Instant Ticket Delivery:</strong> Sends PDF tickets directly to attendee WhatsApp.<br/>• <strong>Read Rate:</strong> 95% within 5 minutes.<br/>• <strong>Interactive Buttons:</strong> 'View Venue Map', 'Add to Calendar', 'Ask Bot'."
				},
				{
					heading: "Setup Guide",
					content: "Ensure WhatsApp template permissions are active prior to sending mass blasts."
				}
			]
		},
		"announcement-center": {
			badge: "Channel Details",
			title: "Announcement & Screen Broadcast Center",
			icon: "📢",
			description: "Broadcast live notices across attendee mobile web apps, hall digital signage screens, and stage audio.",
			sections: [
				{
					heading: "Channel Functions",
					content: "• <strong>Screen Takeover:</strong> Push emergency or keynote alerts to hall screens.<br/>• <strong>Targeting:</strong> Select specific halls, VIP lounges, or all venue zones.<br/>• <strong>Auto-Translation:</strong> Instant translation into major regional languages."
				},
				{
					heading: "Best Practice",
					content: "Publish key session start alerts 10 minutes beforehand to direct crowd movement."
				}
			]
		},
		"reports-overview": {
			badge: "Executive Reports",
			title: "Reports & Financial Intelligence",
			icon: "📈",
			description: "Comprehensive financial intelligence breakdown including gross sales, platform fees, taxes, attendee demographics, and AI-powered executive insights.",
			sections: [
				{
					heading: "Financial Calculation Standard",
					content: "• <strong>Gross Revenue:</strong> Sum of all ticket tier transactions.<br/>• <strong>Platform Fee:</strong> 5% service fee on each ticket sale.<br/>• <strong>Taxes/GST:</strong> 18% statutory tax on each ticket sale.<br/>• <strong>Net Payout:</strong> Transferred to verified bank account after reconciliation."
				},
				{
					heading: "⚡ Registration Trend & Velocity",
					content: "Real-time registration sales velocity, daily run-rate, and peak purchase window tracking.<br/><br/>• <strong>Peak Hours:</strong> 6:00 PM - 9:30 PM.<br/>• <strong>Weekly Velocity:</strong> +18% growth week-over-week.<br/>• <strong>Checkout Conversion:</strong> 94.2% completion rate.<br/>• <strong>Action Step:</strong> Trigger automated cart-abandonment emails for uncompleted registrations."
				},
				{
					heading: "🎯 Marketing Attribution & Source Tracking",
					content: "Multi-touch attribution to determine which marketing campaigns generate the highest ticket sales.<br/><br/>• <strong>Instagram Stories:</strong> 41% of total registrations.<br/>• <strong>LinkedIn Posts:</strong> Highest ticket value (₹1,250 avg).<br/>• <strong>Direct Referral:</strong> 22% organic word-of-mouth.<br/>• <strong>Optimization Tip:</strong> Reallocate budget towards top-converting Instagram and LinkedIn channels."
				},
				{
					heading: "🏷️ Ticket Tier Elasticity & Pricing Insights",
					content: "Monitors ticket tier sell-out velocity to recommend optimal tier caps and price points.<br/><br/>• <strong>General Pass:</strong> 82% sold.<br/>• <strong>VIP Pass:</strong> 3.5x higher profit margin per seat.<br/>• <strong>Dynamic Suggestion:</strong> Introduce 'Phase 2 Late Pass' tier.<br/>• <strong>Strategy:</strong> Close Early Bird tier early to create scarcity demand for standard passes."
				},
				{
					heading: "Audience Analytics",
					content: "Tracks registrant location by IP/address to display top city distribution."
				}
			]
		},
		"reg-trend-insight": {
			badge: "Sales Insights",
			title: "Registration Trend & Velocity",
			icon: "⚡",
			description: "Real-time registration sales velocity, daily run-rate, and peak purchase window tracking.",
			sections: [
				{
					heading: "Analytics Breakdown",
					content: "• <strong>Peak Hours:</strong> 6:00 PM - 9:30 PM.<br/>• <strong>Weekly Velocity:</strong> +18% growth week-over-week.<br/>• <strong>Checkout Conversion:</strong> 94.2% completion rate."
				},
				{
					heading: "Action Step",
					content: "Trigger automated cart-abandonment emails for uncompleted registrations."
				}
			]
		},
		"mktg-source-insight": {
			badge: "Marketing ROI",
			title: "Marketing Attribution & Source Tracking",
			icon: "🎯",
			description: "Multi-touch attribution to determine which marketing campaigns generate the highest ticket sales.",
			sections: [
				{
					heading: "Top Performers",
					content: "• <strong>Instagram Stories:</strong> 41% of total registrations.<br/>• <strong>LinkedIn Posts:</strong> Highest ticket value (₹1,250 avg).<br/>• <strong>Direct Referral:</strong> 22% organic word-of-mouth."
				},
				{
					heading: "Optimization Tip",
					content: "Reallocate promotional budget towards top-converting Instagram and LinkedIn channels."
				}
			]
		},
		"pricing-insight": {
			badge: "Pricing Strategy",
			title: "Ticket Tier Elasticity & Pricing Insights",
			icon: "🏷️",
			description: "Monitors ticket tier sell-out velocity to recommend optimal tier caps and price points.",
			sections: [
				{
					heading: "Current Metrics",
					content: "• <strong>General Pass:</strong> 82% sold.<br/>• <strong>VIP Pass:</strong> 3.5x higher profit margin per seat.<br/>• <strong>Dynamic Suggestion:</strong> Introduce 'Phase 2 Late Pass' tier."
				},
				{
					heading: "Strategy Recommendation",
					content: "Close Early Bird tier early to create scarcity demand for standard passes."
				}
			]
		},
		"eventday-crowd-alert": {
			badge: "Live Safety & Ops",
			title: "AI Crowd Density & Safety Monitoring",
			icon: "🚨",
			description: "Real-time gate scanner frequency monitoring and computer vision crowd density alerts.",
			sections: [
				{
					heading: "Live Safety Thresholds",
					content: "• <strong>Current Gate Flow:</strong> 42 check-ins/minute (Normal).<br/>• <strong>Max Safety Capacity:</strong> 80 check-ins/minute.<br/>• <strong>Average Queue Time:</strong> 1.2 minutes."
				},
				{
					heading: "Automated Bottleneck Protocol",
					content: "1. <strong>Reroute Alert:</strong> Directs overflow crowd to secondary gates.<br/>2. <strong>Staff Push:</strong> Dispatches additional volunteer scanners automatically.<br/>3. <strong>Security Alert:</strong> Notifies venue control if hall reaches 90% capacity."
				}
			]
		},
		"eventday-overview": {
			badge: "Live Operations",
			title: "Event Day Live Operations Guide",
			icon: "🚨",
			description: "Real-time command center for managing door check-ins, entry gate configurations, volunteer scanner passes, crowd safety alerts, and live incident management.",
			sections: [
				{
					heading: "Gate Operations",
					content: "• <strong>QR Ticket Validation:</strong> Use device camera or manual input to validate attendee ticket numbers instantly.<br/>• <strong>Gate Management:</strong> Create isolated entry gates (e.g. Gate 1, VIP Portal) specific to this event.<br/>• <strong>Staff Scanner Passes:</strong> Assign passcode credentials to gate volunteers to track live scan throughput."
				},
				{
					heading: "🚨 AI Crowd Density & Bottleneck Alert",
					content: "Real-time gate scanner frequency monitoring and computer vision crowd density alerts.<br/><br/>• <strong>Current Gate Flow:</strong> 42 check-ins/minute (Normal).<br/>• <strong>Max Safety Capacity:</strong> 80 check-ins/minute.<br/>• <strong>Average Queue Time:</strong> 1.2 minutes."
				},
				{
					heading: "Automated Bottleneck Protocol",
					content: "1. <strong>Reroute Alert:</strong> Directs overflow crowd to secondary gates.<br/>2. <strong>Staff Push:</strong> Dispatches additional volunteer scanners automatically.<br/>3. <strong>Security Alert:</strong> Notifies venue control if hall reaches 90% capacity."
				},
				{
					heading: "Crowd Control & Safety",
					content: "Real-time AI crowd density alerts notify control if hall occupancy or gate entry queues reach capacity limits."
				}
			]
		}
	};

	const infoModal = document.getElementById("infoDetailsModal");
	const infoModalIconBg = document.getElementById("infoModalIconBg");
	const infoModalBadge = document.getElementById("infoModalBadge");
	const infoModalTitle = document.getElementById("infoModalTitle");
	const infoModalBody = document.getElementById("infoModalBody");
	const btnCloseInfoModal = document.getElementById("btnCloseInfoModal");
	const btnGotItInfoModal = document.getElementById("btnGotItInfoModal");

	function openInfoModal(typeKey) {
		const data = INFO_DETAILS_DATA[typeKey] || {
			badge: "Information",
			title: "Details & Insights",
			icon: "ℹ️",
			description: "Detailed information for this section.",
			sections: []
		};

		if (infoModalIconBg) infoModalIconBg.textContent = data.icon || "ℹ️";
		if (infoModalBadge) infoModalBadge.textContent = data.badge || "MODULE INFO CARD";
		if (infoModalTitle) infoModalTitle.textContent = data.title || "Information Card";

		let html = `
			<div style="background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border: 1.5px solid #bfdbfe; border-left: 5px solid #2563eb; border-radius: 14px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.05);">
				<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
					<span style="background: #2563eb; color: #ffffff; font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Module Summary</span>
					<span style="font-size: 0.75rem; font-weight: 700; color: #2563eb;">Information Card Format</span>
				</div>
				<p style="font-size: 0.9rem; color: #1e293b; line-height: 1.6; margin: 0; font-weight: 500;">${data.description}</p>
			</div>
		`;

		if (data.sections && data.sections.length > 0) {
			html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">`;
			data.sections.forEach((sec, idx) => {
				html += `
					<div style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 1.2rem; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04); display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s ease;">
						<div>
							<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.55rem;">
								<h4 style="font-size: 0.9rem; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 0.4rem;">${sec.heading}</h4>
								<span style="background: #f8fafc; color: #475569; font-size: 0.7rem; font-weight: 800; padding: 0.15rem 0.5rem; border-radius: 8px; border: 1px solid #cbd5e1;">CARD ${idx + 1}</span>
							</div>
							<div style="font-size: 0.85rem; color: #334155; line-height: 1.6;">${sec.content}</div>
						</div>
					</div>
				`;
			});
			html += `</div>`;
		}

		if (infoModalBody) infoModalBody.innerHTML = html;
		if (infoModal) {
			infoModal.style.display = "flex";
		}
	}

	function closeInfoModal() {
		if (infoModal) infoModal.style.display = "none";
	}

	if (btnCloseInfoModal) btnCloseInfoModal.addEventListener("click", closeInfoModal);
	if (btnGotItInfoModal) btnGotItInfoModal.addEventListener("click", closeInfoModal);

	if (infoModal) {
		infoModal.addEventListener("click", (e) => {
			if (e.target === infoModal) closeInfoModal();
		});
	}

	// Attach click delegation for all info-details-btn elements
	document.addEventListener("click", (e) => {
		const btn = e.target.closest(".info-details-btn");
		if (btn) {
			e.preventDefault();
			e.stopPropagation();
			const infoType = btn.getAttribute("data-info-type");
			if (infoType) {
				openInfoModal(infoType);
			}
		}
	});

	// Expose functions to global window scope for tab switching
	window.loadRegistrationModuleData = loadRegistrationModuleData;
	window.loadCommunicationsData = loadCommunicationsData;
	window.loadReportsData = loadReportsData;
	window.loadExhibitors = loadExhibitors;
	window.loadGates = loadGates;
	window.loadVolunteers = loadVolunteers;
	window.loadScanners = loadVolunteers;
	window.renderOverviewState = renderOverviewState;

	// Hash change listener for URL routing (legacy support)
	function handleHashChange() {
		if (window.__updatingHash) return;
		const hash = window.location.hash.slice(1);
		if (hash && hash.trim() !== '' && hash !== 'overview') {
			switchTab(hash);
		}
	}

	window.addEventListener('hashchange', handleHashChange);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initOrganizerDashboard);
} else {
	initOrganizerDashboard();
}

// Safety check: if no tab-section is active after init, restore URL tab or overview
setTimeout(() => {
	try {
		const sections = Array.from(document.querySelectorAll('.tab-section'));
		const anyActive = sections.some(s => s && s.classList.contains('active-tab'));
		if (!anyActive) {
			const fallbackTab = getInitialTabFromUrl() || 'overview';
			console.warn('No active tab section after init — falling back to:', fallbackTab);
			if (typeof window.switchTab === 'function') window.switchTab(fallbackTab);
		}
	} catch (e) { console.warn('Visibility fallback check failed', e); }
}, 800);
