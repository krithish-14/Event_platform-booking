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
	const API_BASE = window.location.origin.includes("5500") || window.location.origin.includes("127.0.0.1")
		? "http://127.0.0.1:8001/api/organizers"
		: "/api/organizers";

	const HOST_EVENTS_API_BASE = window.location.origin.includes("5500") || window.location.origin.includes("127.0.0.1")
		? "http://127.0.0.1:8001/api/host-events"
		: "/api/host-events";

	function getUploadOrigin() {
		if (HOST_EVENTS_API_BASE.startsWith("http")) {
			return HOST_EVENTS_API_BASE.replace(/\/api\/host-events\/?$/, "");
		}
		return window.location.origin;
	}

	function resolveUploadUrl(url) {
		if (!url) return "";
		if (url.startsWith("blob:") || url.startsWith("data:")) return url;
		if (url.startsWith("http://") || url.startsWith("https://")) return url;
		if (url.startsWith("/api/media") || url.startsWith("/uploads/") || url.startsWith("uploads/")) {
			return `${getUploadOrigin()}/${String(url).replace(/^\//, "")}`;
		}
		return url;
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
	let activeCustomerId = null;
	let activeHostId = null;
	let bannerImageUrl = null;
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

	function collectTicketsJson() {
		const rows = document.querySelectorAll(".ticket-tier-row");
		const out = [];
		rows.forEach((row) => {
			const name = row.querySelector(".ticket-type-input")?.value?.trim();
			if (!name) return;
			out.push({
				name,
				price: Number(row.querySelector(".ticket-price-input")?.value || 0),
				qty: Number(row.querySelector(".ticket-qty-input")?.value || 0)
			});
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
	const BANNER_DIM_MSG = "Your image is not in this standard size. Recommended size is 1200 × 630 px.";

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
			if (Math.abs(dims.width - 1200) > 20 || Math.abs(dims.height - 630) > 20) {
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

	function collectPoliciesJson() {
		return {
			event_policy: document.getElementById("policyEventInput")?.value?.trim() || "",
			cancellation_policy: document.getElementById("policyCancellationInput")?.value?.trim() || "",
			refund_policy: document.getElementById("policyRefundInput")?.value?.trim() || "",
			terms_and_conditions: document.getElementById("policyTermsInput")?.value?.trim() || "",
			privacy_policy: document.getElementById("policyPrivacyInput")?.value?.trim() || "",
			age_policy: document.getElementById("policyAgeInput")?.value?.trim() || ""
		};
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
		sectionEventday
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
		} else if (tabName === 'settings') {
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
			loadScanners();
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
			eventday: sectionEventday
		};

		const targetSection = targetSections[tabName] || sectionOverview;

		allTabSections.forEach(section => {
			setSectionVisible(section, section === targetSection);
		});

		loadTabModuleData(tabName);

		window.scrollTo({ top: 0, behavior: "smooth" });

		try {
			const sectionIds = ['sectionOverview','sectionManage','sectionSettings','sectionDesign','sectionRegistrations','sectionExhibitors','sectionCommunicate','sectionReports','sectionEventday'];
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
				if (d.has_event) {
					hasEvent = true;
					if (d.event_id) activeEventId = d.event_id;
					if (d.event_title && dashEventTitle) dashEventTitle.textContent = d.event_title;

					// Top 3 KPI Cards
					if (kpiSales) kpiSales.textContent = `₹${(d.total_sales || 0).toLocaleString("en-IN", {minimumFractionDigits: 2})}`;
					if (kpiRegs) kpiRegs.textContent = (d.total_registrations || 0).toLocaleString("en-IN");
					if (kpiDays) kpiDays.textContent = d.days_to_event !== undefined ? d.days_to_event : 0;

					// Registrations Donut Legend
					const valSold = document.getElementById("valSold");
					const valAvail = document.getElementById("valAvail");
					const sold = d.tickets_sold || 0;
					const avail = d.tickets_available || 0;
					const totalTix = sold + avail;
					const soldPct = totalTix > 0 ? Math.round((sold / totalTix) * 100) : 0;
					const availPct = totalTix > 0 ? 100 - soldPct : 100;

					if (valSold) valSold.textContent = `${sold.toLocaleString()} (${soldPct}%)`;
					if (valAvail) valAvail.textContent = `${avail.toLocaleString()} (${availPct}%)`;

					const donutSoldPath = document.getElementById("donutSoldPath");
					if (donutSoldPath) donutSoldPath.setAttribute("stroke-dasharray", `${soldPct}, 100`);

					// Attendance Donut Legend
					const valCheckedIn = document.getElementById("valCheckedIn");
					const valYetToCheckIn = document.getElementById("valYetToCheckIn");
					const checked = d.checked_in || 0;
					const yetCheck = d.yet_to_checkin || 0;

					if (valCheckedIn) valCheckedIn.textContent = checked.toLocaleString();
					if (valYetToCheckIn) valYetToCheckIn.textContent = yetCheck.toLocaleString();

					// Website Preview Box
					const webTitleBadge = document.getElementById("webTitleBadge");
					const webHeadline = document.getElementById("webHeadline");
					const webDate = document.getElementById("webDate");

					if (webTitleBadge) webTitleBadge.textContent = d.event_status === "published" ? "Live" : "Draft";
					if (webHeadline) webHeadline.textContent = d.event_title || "My Event";
					if (webDate) webDate.textContent = `${d.venue || "Venue TBD"}`;

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

			const totalSubmissionsEl = document.getElementById("kpiTotalSubmissions");
			if (totalSubmissionsEl) totalSubmissionsEl.textContent = total.toLocaleString("en-IN");
			const completionRateEl = document.getElementById("kpiCompletionRate");
			if (completionRateEl) completionRateEl.textContent = completion;
			const avgTimeEl = document.getElementById("kpiAvgTime");
			if (avgTimeEl) avgTimeEl.textContent = avgTime;

			const submissionsTableBody = document.getElementById("submissionsTableBody");
			if (submissionsTableBody) {
				const regList = data.registrations || [];
				if (regList.length === 0) {
					submissionsTableBody.innerHTML = `
						<tr>
							<td colspan="5" style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8;">
								<div style="font-size: 1.5rem; margin-bottom: 0.4rem;">📝</div>
								<div style="font-weight: 700; color: #475569;">No Registrations Yet</div>
								<div style="font-size: 0.82rem; margin-top: 0.2rem;">Attendee registrations and submissions will appear here once attendees register.</div>
							</td>
						</tr>
					`;
				} else {
					submissionsTableBody.innerHTML = regList.map(r => `
						<tr style="border-bottom: 1px solid #f1f5f9;">
							<td style="padding: 0.85rem 1.2rem; font-weight: 700; color: #0f172a;">${r.registration_number || r.registration_id || 'REG-001'}</td>
							<td style="padding: 0.85rem 1.2rem; color: #475569;">${r.attendee_name || 'Attendee'} <br/><span style="font-size: 0.78rem; color: #94a3b8;">${r.attendee_email || ''}</span></td>
							<td style="padding: 0.85rem 1.2rem; color: #64748b;">${r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Just now'}</td>
							<td style="padding: 0.85rem 1.2rem;">
								<span style="background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">
									${r.status || 'Confirmed'}
								</span>
							</td>
							<td style="padding: 0.85rem 1.2rem; text-align: right;">
								<button type="button" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #2563eb; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">View</button>
							</td>
						</tr>
					`).join('');
				}
			}
		} catch (err) {
			console.warn("Could not load registration module data:", err);
		}
	}

	async function loadReportsData() {
		if (!email) return;
		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/reports?email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (!res.ok) return;
			const data = await res.json();
			const grossRevenueEl = document.getElementById("repGrossRevenue");
			const netEarningsEl = document.getElementById("repNetEarnings");
			const attendanceRateEl = document.getElementById("repAttendanceRate");
			const conversionRateEl = document.getElementById("repConversionRate");
			if (grossRevenueEl) grossRevenueEl.textContent = `₹${Number(data.gross_revenue || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
			if (netEarningsEl) netEarningsEl.textContent = `₹${Number(data.net_earnings || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
			if (attendanceRateEl) attendanceRateEl.textContent = `${Number(data.attendance_rate || 0).toFixed(1)}%`;
			if (conversionRateEl) conversionRateEl.textContent = `${Number(data.conversion_rate || 0).toFixed(1)}%`;
		} catch (err) {
			console.warn("Could not load reports data:", err);
		}
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
			const audienceSelect = document.getElementById("commAudienceSelect");
			if (audienceSelect) {
				audienceSelect.options[0].text = `All Registered Attendees (${communications.length})`;
			}

			const commHistoryContainer = document.getElementById("commHistoryContainer");
			if (commHistoryContainer) {
				if (communications.length === 0) {
					commHistoryContainer.innerHTML = `
						<div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8; border: 2px dashed #e2e8f0; border-radius: 8px;">
							<div style="font-size: 1.5rem; margin-bottom: 0.4rem;">📢</div>
							<div style="font-weight: 700; color: #475569;">No Communications Sent Yet</div>
							<div style="font-size: 0.82rem; margin-top: 0.2rem;">Use the composer above to broadcast updates to attendees, VIPs, or exhibitors.</div>
						</div>
					`;
				} else {
					commHistoryContainer.innerHTML = communications.map(c => `
						<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
							<div>
								<div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${c.subject || 'Broadcast Message'}</div>
								<div style="font-size: 0.82rem; color: #64748b; margin-top: 0.2rem;">Channel: ${c.channel || 'Email'} | Audience: ${c.audience || 'All Attendees'}</div>
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
				<td style="padding: 0.85rem 1.2rem; font-weight: 700; color: #0f172a;">${ex.company_name}</td>
				<td style="padding: 0.85rem 1.2rem; color: #475569;">${ex.category}</td>
				<td style="padding: 0.85rem 1.2rem; color: #475569;">${ex.contact_name} <br/><span style="font-size: 0.78rem; color: #94a3b8;">${ex.contact_email}</span></td>
				<td style="padding: 0.85rem 1.2rem;">
					<span style="background: ${ex.status === 'confirmed' ? '#f0fdf4' : '#fffbe6'}; border: 1px solid ${ex.status === 'confirmed' ? '#bbf7d0' : '#ffe58f'}; color: ${ex.status === 'confirmed' ? '#166534' : '#873800'}; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">
						${ex.status === 'confirmed' ? 'Confirmed' : 'Pending Approval'}
					</span>
				</td>
				<td style="padding: 0.85rem 1.2rem; text-align: right;">
					<button type="button" class="btn-delete-exhibitor" data-id="${ex.exhibitor_id}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Remove</button>
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
				<td style="padding: 0.75rem 1rem; font-weight: 700; color: #0f172a;">${g.gate_name}</td>
				<td style="padding: 0.75rem 1rem; color: #475569;">${g.gate_code || '—'}</td>
				<td style="padding: 0.75rem 1rem; color: #64748b;">${g.gate_description || '—'}</td>
				<td style="padding: 0.75rem 1rem;">
					<span style="background: ${g.status === 'Active' ? '#f0fdf4' : '#fee2e2'}; border: 1px solid ${g.status === 'Active' ? '#bbf7d0' : '#fecaca'}; color: ${g.status === 'Active' ? '#166534' : '#991b1b'}; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700; cursor: pointer;" class="btn-toggle-gate-status" data-id="${g.gate_id}" data-status="${g.status}">
						${g.status}
					</span>
				</td>
				<td style="padding: 0.75rem 1rem; text-align: right; display: flex; gap: 0.4rem; justify-content: flex-end;">
					<button type="button" class="btn-edit-gate" data-id="${g.gate_id}" style="background: #ffffff; border: 1px solid #cbd5e1; color: #2563eb; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Edit</button>
					<button type="button" class="btn-delete-gate" data-id="${g.gate_id}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Delete</button>
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
		if (!volunteerGateSelect) return;
		// Filter only Active gates for dropdown selection
		const activeGates = gates.filter(g => g.status === "Active");
		if (activeGates.length === 0) {
			volunteerGateSelect.innerHTML = `<option value="" disabled selected>No active gates configured yet</option>`;
			return;
		}
		volunteerGateSelect.innerHTML = activeGates.map(g => `
			<option value="${g.gate_id}">${g.gate_name} ${g.gate_code ? '(' + g.gate_code + ')' : ''}</option>
		`).join('');
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

	async function loadScanners() {
		if (!email) return;
		const tableBody = document.getElementById("volunteerTableBody");
		if (!tableBody) return;

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/scanners?organizer_email=${encodeURIComponent(email)}${activeEventId ? '&event_id=' + activeEventId : ''}`, {
				headers: getAuthHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				cachedScanners = data.scanners || [];
				renderScannersTable(cachedScanners);
			}
		} catch (err) {
			console.warn("Could not load volunteer scanners:", err);
		}
	}

	function renderScannersTable(scanners) {
		const tableBody = document.getElementById("volunteerTableBody");
		if (!tableBody) return;

		if (!scanners || scanners.length === 0) {
			tableBody.innerHTML = `
				<tr>
					<td colspan="5" style="text-align: center; padding: 1.5rem; color: #94a3b8;">
						No volunteer scanners connected yet. Generate a scanner link above to assign staff.
					</td>
				</tr>
			`;
			return;
		}

		tableBody.innerHTML = scanners.map(s => `
			<tr style="border-bottom: 1px solid #f1f5f9;">
				<td style="padding: 0.8rem 1rem; font-weight: 700; color: #0f172a;">${s.name}</td>
				<td style="padding: 0.8rem 1rem; color: #475569;">${s.gate_name}</td>
				<td style="padding: 0.8rem 1rem; font-weight: 700; color: #2563eb;">${s.scans_processed} Check-ins</td>
				<td style="padding: 0.8rem 1rem;"><span style="background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">${s.status || 'Live Scanning'}</span></td>
				<td style="padding: 0.8rem 1rem; text-align: right;"><button type="button" class="btn-revoke-scanner" data-id="${s.scanner_id}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Revoke</button></td>
			</tr>
		`).join('');

		tableBody.querySelectorAll(".btn-revoke-scanner").forEach(btn => {
			btn.addEventListener("click", async () => {
				const scannerId = btn.getAttribute("data-id");
				if (confirm("Revoke access for this scanner?")) {
					try {
						const res = await fetch(`${HOST_EVENTS_API_BASE}/scanners/${scannerId}`, {
							method: "DELETE",
							headers: getAuthHeaders()
						});
						if (res.ok) {
							loadScanners();
							showNotification("Scanner revoked successfully.");
						} else {
							alert("Could not revoke scanner.");
						}
					} catch (err) {
						console.warn(err);
					}
				}
			});
		});
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
			const audience = document.getElementById("commAudienceSelect")?.value || "all_attendees";
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
						audience: document.getElementById("commAudienceSelect")?.value || "all_attendees",
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
			if (!value) {
				if (qrScanResult) {
					qrScanResult.style.display = "block";
					qrScanResult.textContent = "Enter an attendee email or ticket code to validate.";
				}
				return;
			}
			try {
				const res = await fetch(`${HOST_EVENTS_API_BASE}/registrations/checkin`, {
					method: "POST",
					headers: Object.assign({"Content-Type": "application/json"}, getAuthHeaders()),
					body: JSON.stringify({
						organizer_email: email,
						event_id: activeEventId,
						attendee_email: value,
						attendee_name: value,
						scan_method: "manual",
						status: "checked_in",
						notes: "Validated from organizer dashboard"
					})
				});
				if (qrScanResult) {
					qrScanResult.style.display = "block";
					qrScanResult.textContent = res.ok ? `✓ ${value} checked in successfully.` : "Could not validate this attendee right now.";
				}
			} catch (err) {
				console.warn("Could not validate QR/check-in:", err);
			}
		});
	}

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
	function drawTrendChart() {
		const canvas = document.getElementById("trendChartCanvas");
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		
		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0) return;

		canvas.width = rect.width * 2;
		canvas.height = rect.height * 2;
		ctx.scale(2, 2);

		const width = rect.width;
		const height = rect.height;

		ctx.clearRect(0, 0, width, height);

		const trendData = [
			{ date: "Mar 19", value: 400 },
			{ date: "Mar 22", value: 2800 },
			{ date: "Mar 25", value: 600 },
			{ date: "Mar 28", value: 1800 },
			{ date: "Mar 30", value: 3600 },
			{ date: "Sat", value: 2400 }
		];

		const paddingX = 35;
		const paddingY = 25;
		const chartW = width - paddingX * 2;
		const chartH = height - paddingY * 2;
		const maxVal = 4000;

		const points = trendData.map((d, i) => {
			const x = paddingX + (i / (trendData.length - 1)) * chartW;
			const y = height - paddingY - (d.value / maxVal) * chartH;
			return { x, y, date: d.date };
		});

		// Horizontal Grid Lines
		ctx.strokeStyle = "#e2e8f0";
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);

		[0, 1000, 2000, 3000, 4000].forEach(val => {
			const y = height - paddingY - (val / maxVal) * chartH;
			ctx.beginPath();
			ctx.moveTo(paddingX, y);
			ctx.lineTo(width - paddingX, y);
			ctx.stroke();

			ctx.fillStyle = "#94a3b8";
			ctx.font = "10px sans-serif";
			ctx.textAlign = "right";
			ctx.fillText(val, paddingX - 6, y + 3);
		});

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
		points.forEach(p => {
			ctx.fillStyle = "#3b82f6";
			ctx.beginPath();
			ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
			ctx.fill();

			ctx.fillStyle = "#64748b";
			ctx.font = "10px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText(p.date, p.x, height - 6);
		});
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
				activeEventId = hostData.event.event_id;
				sessionStorage.setItem(`active_event_id_${email}`, String(activeEventId));
				currentLifecycle = hostData.lifecycle || hostData.event.lifecycle || hostData.event.event_status || "draft";
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
				if (hostData.event.policies) {
					populatePoliciesFromJson(hostData.event.policies);
				}
				if (hostData.event.event_status === "published" || currentLifecycle === "published" || currentLifecycle === "live" || currentLifecycle === "ended") {
					hasEvent = true;
					sessionStorage.setItem(`has_event_${email}`, "true");
					renderOverviewState();
				} else {
					hasEvent = false;
					sessionStorage.removeItem(`has_event_${email}`);
					renderOverviewState();
				}
			} else {
				hasEvent = false;
				activeEventId = null;
				currentLifecycle = "draft";
				canPublishNew = true;
				canCreateNew = true;
				pendingManageEvent = null;
				sessionStorage.removeItem(`has_event_${email}`);
				sessionStorage.removeItem(`active_event_id_${email}`);
				renderOverviewState();
			}
			if (hostData.design) {
				pendingHostDesignData = hostData.design;
				if (hostData.design.about_event) {
					const descEl = document.getElementById("eventDescInput");
					if (descEl) descEl.value = hostData.design.about_event;
				}
			}
			if (hostData.registration_form) {
				pendingRegistrationForm = hostData.registration_form;
				if (window.JodFormBuilder && typeof window.JodFormBuilder.loadFromHost === "function") {
					window.JodFormBuilder.loadFromHost(hostData.registration_form);
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
		const descEl = document.getElementById("eventDescInput");
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
			event_start_date: event_start_date,
			event_end_date: event_end_date,
			event_start_time: timeFromDatetimeLocal(dateInput && dateInput.value),
			event_end_time: timeFromDatetimeLocal(endDateInput && endDateInput.value),
			tickets_json: collectTicketsJson(),
			agenda_json: collectAgendaJson(),
			policies_json: collectPoliciesJson(),
			about_event: descEl ? descEl.value : undefined
		};

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/manage`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
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
				return true;
			}
			if (notifyError) showNotification(apiErrorMessage(data, "Could not save Manage details."));
		} catch (e) {
			console.warn("Manage live auto-save warning:", e);
		}
		return false;
	}

	async function autoSaveEventDesign(notifyError = false) {
		if (!email) return false;
		if (!activeEventId) {
			const manageSaved = await autoSaveManageEvent(notifyError);
			if (!manageSaved || !activeEventId) return false;
		}
		const descEl = document.getElementById("eventDescInput");
		const payload = {
			event_id: activeEventId,
			organizer_email: email,
			theme_color: "#2563eb",
			font: "Inter",
			banner_image: bannerImageUrl || undefined,
			gallery_images: galleryImageUrls.length ? galleryImageUrls : undefined,
			sponsor_details: collectSponsorDetails(),
			speaker_details: collectSpeakerDetails(),
			about_event: descEl ? descEl.value : undefined
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

		const webTitleBadge = document.getElementById("webTitleBadge");
		const webHeadline = document.getElementById("webHeadline");
		if (webTitleBadge) webTitleBadge.textContent = title.split(" ")[0];
		if (webHeadline) webHeadline.textContent = title;
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
				showNotification("Could not save event details. Check your connection and try again.");
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
	const formatPills = document.querySelectorAll(".format-pill");
	const eventFormatInput = document.getElementById("eventFormatInput");
	formatPills.forEach(pill => {
		pill.addEventListener("click", () => {
			formatPills.forEach(p => p.classList.remove("active"));
			pill.classList.add("active");
			if (eventFormatInput) eventFormatInput.value = pill.getAttribute("data-value");
		});
	});

	// Dynamic Ticket Tier Rows Adder
	const ticketTiersRows = document.getElementById("ticketTiersRows");
	const btnAddTicketTier = document.getElementById("btnAddTicketTier");

	function createTicketTierRowHtml(type = "", price = "", qty = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 ticket-tier-row";
		div.style.alignItems = "flex-end";
		div.style.marginBottom = "0.8rem";
		div.innerHTML = `
			<div class="setup-form-group">
				<label>Ticket Type / Name <span style="color: #ef4444;">*</span></label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#127915;</span>
					<input type="text" class="setup-input ticket-type-input" placeholder="e.g. VIP Pass, Early Bird, General" required value="${type}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Ticket Price (₹) <span style="color: #ef4444;">*</span></label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#8377;</span>
					<input type="number" class="setup-input ticket-price-input" placeholder="e.g. 499" min="0" required value="${price}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Capacity <span style="color: #ef4444;">*</span></label>
				<div style="display: flex; gap: 0.5rem;">
					<div class="input-icon-wrap" style="flex: 1;">
						<span class="input-icon">&#128101;</span>
						<input type="number" class="setup-input ticket-qty-input" placeholder="e.g. 100" min="1" required value="${qty}" />
					</div>
					<button type="button" class="btn-remove-ticket" title="Remove Ticket" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 0 0.8rem; cursor: pointer; font-weight: 700; height: 44px;">&times;</button>
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-ticket");
		removeBtn.addEventListener("click", () => {
			if (ticketTiersRows.children.length > 1) {
				div.remove();
			} else {
				div.querySelector(".ticket-type-input").value = "";
				div.querySelector(".ticket-price-input").value = "";
				div.querySelector(".ticket-qty-input").value = "";
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
					row.querySelector(".ticket-type-input").value = "";
					row.querySelector(".ticket-price-input").value = "";
					row.querySelector(".ticket-qty-input").value = "";
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
		document.querySelectorAll(".format-pill").forEach((pill) => {
			pill.classList.toggle("active", pill.getAttribute("data-value") === mode);
		});
		const dateInput = document.getElementById("eventDateInput");
		if (dateInput && event.event_start_date) {
			dateInput.value = String(event.event_start_date).slice(0, 16);
		}
		const endDateInput = document.getElementById("eventEndDateInput");
		if (endDateInput && event.event_end_date) {
			endDateInput.value = String(event.event_end_date).slice(0, 16);
		}
		const locationInput = document.getElementById("eventLocationInput");
		if (locationInput) locationInput.value = event.venue || event.address || "";
		if (event.policies) populatePoliciesFromJson(event.policies);
		if (ticketTiersRows && Array.isArray(event.tickets) && event.tickets.length) {
			ticketTiersRows.innerHTML = "";
			event.tickets.forEach((t) => {
				ticketTiersRows.appendChild(createTicketTierRowHtml(
					t.name || t.ticket_name || t.type || "",
					t.price != null ? t.price : "",
					t.qty != null ? t.qty : (t.quantity != null ? t.quantity : "")
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
			activeEventId = null;
			currentLifecycle = "draft";
			hasEvent = false;
			sessionStorage.removeItem(`active_event_id_${email}`);
			sessionStorage.removeItem(`has_event_${email}`);
			if (createEventForm) createEventForm.reset();
			if (eventTitleInput) eventTitleInput.value = "";
			const catSel = document.getElementById("eventCategorySelect");
			if (catSel) catSel.value = "";
			if (ticketTiersRows) {
				ticketTiersRows.innerHTML = "";
				ticketTiersRows.appendChild(createTicketTierRowHtml("", "", ""));
			}
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

	// Load Profile & Bank Details for Settings Tab (status-aware: only lock when VERIFIED)
	async function loadProfileAndBankDetails() {
		const profEmail = document.getElementById("profEmail");
		if (profEmail) profEmail.value = email;

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
					if (acc.contact_mobile && profMobile) profMobile.value = acc.contact_mobile;
					if (acc.gstin_number && profGstin) profGstin.value = acc.gstin_number;
					if (acc.pan_number && profPan) profPan.value = acc.pan_number;
					if (acc.org_address && profAddress) profAddress.value = acc.org_address;

					// Bank Details: Read-only if VERIFIED; editable placeholders otherwise via banner CTA
					const profBankBeneficiary = document.getElementById("profBankBeneficiary");
					const profBankName = document.getElementById("profBankName");
					const profBankAccountType = document.getElementById("profBankAccountType");
					const profBankAccountNumber = document.getElementById("profBankAccountNumber");
					const profBankIfsc = document.getElementById("profBankIfsc");

					const isVerified = vs === "VERIFIED";

					[profBankBeneficiary, profBankName, profBankAccountType, profBankAccountNumber, profBankIfsc].forEach(inp => {
						if (!inp) return;
						if (isVerified) {
							inp.setAttribute("readonly", "readonly");
							inp.setAttribute("disabled", "disabled");
							inp.style.backgroundColor = "#f1f5f9";
							inp.style.cursor = "not-allowed";
							inp.style.color = "#334155";
							inp.style.fontWeight = "700";
						} else {
							inp.removeAttribute("readonly");
							inp.removeAttribute("disabled");
							inp.style.backgroundColor = "";
							inp.style.cursor = "";
							inp.style.color = "";
							inp.style.fontWeight = "";
						}
					});

					if (acc.beneficiary_name && profBankBeneficiary) profBankBeneficiary.value = acc.beneficiary_name;
					if (acc.bank_name && profBankName) profBankName.value = acc.bank_name;
					if (acc.account_type && profBankAccountType) profBankAccountType.value = acc.account_type.toUpperCase();
					if (acc.account_number && profBankAccountNumber) {
						const rawAcc = acc.account_number;
						profBankAccountNumber.value = isVerified
							? (rawAcc.length > 4 ? `•••• •••• ${rawAcc.slice(-4)}` : rawAcc)
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
				hasEvent = false;
				activeEventId = null;
				currentLifecycle = "draft";
				canPublishNew = true;
				canCreateNew = true;
				if (dashEventTitle) dashEventTitle.textContent = "My Events Dashboard";
				if (typeof renderOverviewState === "function") renderOverviewState();
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

	if (bannerDropzone && bannerFileInput) {
		bannerDropzone.addEventListener("click", (e) => {
			if (e.target.id !== "btnClearBanner") bannerFileInput.click();
		});

		bannerFileInput.addEventListener("change", async (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			const host = document.getElementById("bannerUploadHost");
			setInlineUploadError(host, "");
			try {
				bannerDropzoneContent.style.opacity = "0.6";
				const url = await uploadDesignAsset(file, "banner");
				bannerImageUrl = url;
				bannerPreviewImg.src = resolveUploadUrl(url);
				bannerDropzoneContent.style.display = "none";
				bannerPreviewBox.style.display = "block";
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

	// Dynamic Sponsor Row Adder
	const sponsorsRows = document.getElementById("sponsorsRows");
	const btnAddSponsor = document.getElementById("btnAddSponsor");

	function createSponsorRowHtml(name = "", tier = "Title Sponsor", logoUrl = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 sponsor-row";
		div.style.alignItems = "start";
		div.style.marginBottom = "0.9rem";
		div.style.background = "#f8fafc";
		div.style.border = "1px solid #e2e8f0";
		div.style.padding = "1rem";
		div.style.borderRadius = "10px";
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
		div.style.alignItems = "start";
		div.style.marginBottom = "0.9rem";
		div.style.background = "#f8fafc";
		div.style.border = "1px solid #e2e8f0";
		div.style.padding = "1rem";
		div.style.borderRadius = "10px";
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
			if (d.about_event) {
				const desc = document.getElementById("eventDescInput");
				if (desc && !desc.value) desc.value = d.about_event;
			}
			if (d.banner_image) {
				bannerImageUrl = d.banner_image;
				if (bannerPreviewImg) bannerPreviewImg.src = resolveUploadUrl(d.banner_image);
				if (bannerDropzoneContent) bannerDropzoneContent.style.display = "none";
				if (bannerPreviewBox) bannerPreviewBox.style.display = "block";
			}
			if (d.gallery_images && Array.isArray(d.gallery_images) && d.gallery_images.length) {
				galleryImageUrls = d.gallery_images.slice();
				galleryThumbnailsGrid.innerHTML = "";
				d.gallery_images.forEach((url) => addThumbnail(url));
			}
			populateDesignRows(d.sponsor_details || [], d.speaker_details || []);
			pendingHostDesignData = null;
		}
		applyPendingHostDesign();
	} else if (pendingHostDesignData) {
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
		const color = status === "valid" ? "#10b981" : "#f59e0b";
		const label = status === "valid" ? "✔ Valid" : "⚠ Duplicate";
		const row = document.createElement("div");
		row.style.cssText = "display:flex;justify-content:space-between;align-items:center;background:#1e293b;border-radius:6px;padding:0.4rem 0.7rem;font-size:0.8rem;";
		row.innerHTML = `<span style="color:#f1f5f9;font-weight:600;">${name}</span><span style="color:#94a3b8;font-size:0.75rem;">${code.slice(0,18)}…</span><span style="color:${color};font-weight:700;">${label}</span><span style="color:#64748b;font-size:0.72rem;">${now}</span>`;
		scanHistoryList.insertBefore(row, scanHistoryList.firstChild);
	}

	if (btnVerifyQr && modalScanResult && cameraQrInput) {
		btnVerifyQr.addEventListener("click", () => {
			const code = cameraQrInput.value.trim();
			if (!code) {
				cameraQrInput.style.borderColor = "#ef4444";
				cameraQrInput.focus();
				setTimeout(() => (cameraQrInput.style.borderColor = "#334155"), 1500);
				return;
			}

			const existing = _scanRegistry.get(code);
			const attendee = _mockLookup(code);
			const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

			if (!existing) {
				// First scan – VALID
				_scanRegistry.set(code, { count: 1, name: attendee.name, firstTime: now });
				modalScanResult.style.display = "block";
				modalScanResult.style.background = "#064e3b";
				modalScanResult.style.borderColor = "#059669";
				modalScanResult.style.color = "#a7f3d0";
				modalScanResult.innerHTML = `
					<strong style="font-size:1rem;">✔ VALID TICKET PASS!</strong><br/>
					Attendee: <strong>${attendee.name}</strong> &mdash; <em>${attendee.type}</em><br/>
					Ticket Code: <strong>${code}</strong><br/>
					Gate Status: <strong>Verified &amp; Checked‑in</strong> at ${attendee.gate} &mdash; ${now}
				`;
				_addHistoryRow(code, "valid", attendee.name);
			} else {
				// 2nd or more scan – ALREADY SCANNED
				existing.count += 1;
				_scanRegistry.set(code, existing);
				modalScanResult.style.display = "block";
				modalScanResult.style.background = "#7c2d12";
				modalScanResult.style.borderColor = "#dc2626";
				modalScanResult.style.color = "#fecaca";
				modalScanResult.innerHTML = `
					<strong style="font-size:1rem;">⚠ ALREADY SCANNED!</strong><br/>
					Attendee: <strong>${existing.name}</strong><br/>
					Ticket Code: <strong>${code}</strong><br/>
					This ticket was first verified at <strong>${existing.firstTime}</strong> at ${attendee.gate}.<br/>
					<span style="opacity:.85;">Total scan attempts: <strong>${existing.count}</strong> &mdash; Entry Denied.</span>
				`;
				_addHistoryRow(code, "duplicate", existing.name);
			}

			// Clear input for next scan
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

	// Manual QR Code Validation
	if (btnValidateQr && liveQrInput && qrScanResult) {
		btnValidateQr.addEventListener("click", () => {
			const val = liveQrInput.value.trim();
			if (!val) {
				alert("Please enter or scan a QR Ticket Code first.");
				return;
			}
			qrScanResult.style.display = "block";
			qrScanResult.style.background = "#f0fdf4";
			qrScanResult.style.borderColor = "#bbf7d0";
			qrScanResult.style.color = "#166534";
			qrScanResult.innerHTML = `Verified &amp; Checked In: Code <strong>${val}</strong> is Valid.`;
		});
	}

	// Generate Volunteer Scanner Access Link & Passcode
	if (btnCreateVolunteerLink && volunteerNameInput && generatedLinkContainer) {
		btnCreateVolunteerLink.addEventListener("click", async () => {
			const name = volunteerNameInput.value.trim() || "Volunteer Staff";
			const gateId = volunteerGateSelect.value;
			if (!gateId) {
				alert("Please configure and select an entry gate first.");
				return;
			}
			const code = "VOL-2026-" + Math.floor(1000 + Math.random() * 9000);

			try {
				const res = await fetch(`${HOST_EVENTS_API_BASE}/scanners`, {
					method: "POST",
					headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
					body: JSON.stringify({
						organizer_email: email,
						event_id: activeEventId,
						name: name,
						gate_id: gateId,
						passcode: code
					})
				});

				if (res.ok) {
					const scannerData = await res.json();
					const gateName = scannerData.gate_name || "Assigned Gate";
					const link = `${window.location.origin}/volunteer-scanner.html?code=${code}&gate=${encodeURIComponent(gateName)}`;

					passcodeBadge.textContent = `Passcode: ${code}`;
					volunteerPortalUrl.value = link;
					const btnOpen = document.getElementById("btnOpenVolunteerPortal");
					if (btnOpen) btnOpen.href = link;
					generatedLinkContainer.style.display = "block";

					loadScanners();
					showNotification(`Volunteer Scanner link created for ${name} (${gateName})!`);
				} else {
					const err = await res.json();
					alert(err.detail || "Could not generate volunteer scanner link.");
				}
			} catch (err) {
				console.warn(err);
			}
		});
	}

	if (btnCopyVolunteerUrl && volunteerPortalUrl) {
		btnCopyVolunteerUrl.addEventListener("click", () => {
			volunteerPortalUrl.select();
			navigator.clipboard.writeText(volunteerPortalUrl.value);
			showNotification("Volunteer Scanner Link copied to clipboard!");
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

	function storePublishAuthToken(token) {
		if (!token) return;
		try {
			sessionStorage.setItem("jod_access_token", token);
			localStorage.setItem("jod_access_token", token);
		} catch (_) {}
	}

	function hasPublishAuthToken() {
		const token = window.JodAuth && typeof window.JodAuth.getToken === "function"
			? window.JodAuth.getToken()
			: (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));
		return !!(token && token !== "null" && token !== "undefined" && String(token).length > 10);
	}

	function isPublishAuthError(msg) {
		return /authentication required|not authenticated|could not validate credentials|unauthorized/i.test(msg || "");
	}

	function showPublishAuthOtpModal(options) {
		const opts = Object.assign({
			badge: "Verify to Publish",
			title: "Confirm your email",
			purpose: "authenticate and publish this event",
			verifyLabel: "Verify & Publish",
			headerBg: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
			verifyBg: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
		}, options || {});
		return new Promise(async (resolve) => {
			const hostEmail = email || (window.JodAuth && window.JodAuth.getUser && window.JodAuth.getUser() && window.JodAuth.getUser().email) || "";
			const modal = ensurePublishModal();
			let settled = false;
			let verifying = false;
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
							A 6-digit OTP has been sent to
							<strong id="publishOtpEmail" style="color:#0f172a;"></strong>.
							Enter the code below to <span id="publishOtpPurpose"></span>.
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
			if (emailEl) emailEl.textContent = hostEmail || "your registered email";
			const purposeEl = document.getElementById("publishOtpPurpose");
			if (purposeEl) purposeEl.textContent = opts.purpose;
			const verifyBtn = document.getElementById("publishOtpVerify");
			if (verifyBtn) verifyBtn.textContent = opts.verifyLabel;

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
				setStatus("Sending OTP…", true);
				try {
					const res = await fetch(`${API_BASE}/send-otp`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email: hostEmail })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(apiErrorMessage(data, "Failed to send OTP."));
					const banner = document.getElementById("publishOtpDevBanner");
					const devVal = document.getElementById("publishOtpDevValue");
					if (data.dev_otp && banner && devVal) {
						devVal.textContent = data.dev_otp;
						banner.style.display = "block";
					}
					setStatus(`OTP sent to ${hostEmail}.`, true);
					if (fields[0]) fields[0].focus();
				} catch (err) {
					setStatus(err.message || "Failed to send OTP.");
				}
			}

			async function verifyPublishOtp() {
				if (verifying || settled) return;
				const code = readOtp();
				if (code.length !== 6) {
					setStatus("Enter the 6-digit OTP sent to your email.");
					return;
				}
				verifying = true;
				setStatus("Verifying…", true);
				try {
					const res = await fetch(`${API_BASE}/verify-otp`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email: hostEmail, otp_code: code })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(apiErrorMessage(data, "Invalid OTP."));
					if (!data.access_token) {
						throw new Error("No login account found for this email. Please log in, then publish.");
					}
					storePublishAuthToken(data.access_token);
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
					const descEl = document.getElementById("eventDescInput");

					const payload = {
						organizer_email: email,
						event_id: event_id || undefined,
						event_title: manageData.event_title,
						event_category: categorySelect ? categorySelect.value : undefined,
						event_mode: formatInput ? formatInput.value : undefined,
						venue: locationInput ? locationInput.value.trim() : undefined,
						address: locationInput ? locationInput.value.trim() : undefined,
						event_start_date: toIstIsoFromDatetimeLocal(dateInput && dateInput.value),
						event_end_date: toIstIsoFromDatetimeLocal(endDateInput && endDateInput.value),
						event_start_time: timeFromDatetimeLocal(dateInput && dateInput.value),
						event_end_time: timeFromDatetimeLocal(endDateInput && endDateInput.value),
						event_status: "published",
						tickets_json: collectTicketsJson(),
						agenda_json: collectAgendaJson(),
						policies_json: collectPoliciesJson(),
						about_event: descEl ? descEl.value : undefined
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
					if (!hasPublishAuthToken()) {
						await authenticateThenPublish();
						return;
					}
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
					content: "• <strong>Gross Revenue:</strong> Sum of all ticket tier transactions.<br/>• <strong>Platform Fee:</strong> 5% service fee.<br/>• <strong>Taxes/GST:</strong> 5% statutory tax deduction.<br/>• <strong>Net Payout:</strong> Transferred to verified bank account after reconciliation."
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
	window.loadScanners = loadScanners;
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
