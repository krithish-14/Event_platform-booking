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

	let activeEventId = null;
	let activeCustomerId = null;
	let activeHostId = null;

	function getAuthHeaders() {
		const token = window.JodAuth ? window.JodAuth.getToken() : null;
		return token ? { "Authorization": `Bearer ${token}` } : {};
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
		window.location.href = "login.html";
		return;
	}

	// Persist session to guarantee returning to index.html or other pages maintains logged-in state
	try {
		sessionStorage.setItem("verified_organizer_email", email);
		const existingUser = window.JodAuth ? window.JodAuth.getUser() : null;
		if (!existingUser || !existingUser.email) {
			const uObj = {
				email: email,
				username: email.split("@")[0],
				full_name: email.split("@")[0],
				is_organizer: true
			};
			localStorage.setItem("jod_user", JSON.stringify(uObj));
			sessionStorage.setItem("jod_user", JSON.stringify(uObj));
		}
		if (!localStorage.getItem("jod_access_token") && !sessionStorage.getItem("jod_access_token")) {
			const tok = "organizer_token_" + btoa(email);
			localStorage.setItem("jod_access_token", tok);
			sessionStorage.setItem("jod_access_token", tok);
		}
	} catch (_) {}

	// ── Access Control: verify account status gracefully ──────
	try {
		const checkRes = await fetch(`${API_BASE}/account-setup?email=${encodeURIComponent(email)}`, {
			headers: getAuthHeaders()
		});

		if (checkRes.ok) {
			const checkData = await checkRes.json();
			const accStatus = checkData.account ? checkData.account.status : "draft";

			if (accStatus !== "submitted" && accStatus !== "verified") {
				console.log("Account setup in draft mode:", accStatus);
			}
		}
	} catch (err) {
		console.log("Dashboard authorization check warning:", err);
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

	function renderOverviewState() {
		if (window.__renderingOverview) return;
		window.__renderingOverview = true;
		try {
			if (!hasEvent) {
				if (emptyStateCard) emptyStateCard.style.display = "flex";
				if (populatedOverviewGrid) populatedOverviewGrid.style.display = "none";
				if (dashEventStatus) {
					dashEventStatus.textContent = "No Event";
					dashEventStatus.className = "status-badge-published";
					dashEventStatus.style.background = "#f1f5f9";
					dashEventStatus.style.color = "#64748b";
					dashEventStatus.style.borderColor = "#cbd5e1";
				}
			} else {
				if (emptyStateCard) emptyStateCard.style.display = "none";
				if (populatedOverviewGrid) populatedOverviewGrid.style.display = "flex";
				if (dashEventStatus) {
					dashEventStatus.textContent = "Published";
					dashEventStatus.className = "status-badge-published";
					dashEventStatus.style.background = "#10b98122";
					dashEventStatus.style.color = "#10b981";
					dashEventStatus.style.borderColor = "#10b98166";
				}
				loadDashboardData();
				setTimeout(drawTrendChart, 100);
			}
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
				if (hostData.event.event_title && eventTitleInput) {
					eventTitleInput.value = hostData.event.event_title;
					dashEventTitle.textContent = hostData.event.event_title;
				}
				if (hostData.event.event_status === "published") {
					hasEvent = true;
					sessionStorage.setItem(`has_event_${email}`, "true");
					renderOverviewState();
				}
			}
		}
	} catch (err) {
		console.warn("Could not fetch current host event:", err);
	}

	// ── Live Auto-Save / UPSERT Synchronization ────────────────────────────────
	let autoSaveTimer = null;

	async function autoSaveManageEvent() {
		if (!email) return;
		const payload = {
			event_id: activeEventId,
			organizer_email: email,
			event_title: eventTitleInput ? eventTitleInput.value.trim() : "My New Event 2026",
			event_category: document.getElementById("eventCategorySelect") ? document.getElementById("eventCategorySelect").value : "Conferences",
			event_mode: document.getElementById("eventFormatInput") ? document.getElementById("eventFormatInput").value : "Hybrid",
			venue: document.getElementById("eventLocationInput") ? document.getElementById("eventLocationInput").value : "",
			address: document.getElementById("eventLocationInput") ? document.getElementById("eventLocationInput").value : "",
			event_status: hasEvent ? "published" : "draft"
		};

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/manage`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
				body: JSON.stringify(payload)
			});
			if (res.ok) {
				const data = await res.json();
				if (data.event_id) activeEventId = data.event_id;
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
			}
		} catch (e) {
			console.warn("Manage live auto-save warning:", e);
		}
	}

	async function autoSaveEventDesign() {
		if (!email) return;
		const payload = {
			event_id: activeEventId,
			organizer_email: email,
			theme_color: "#2563eb",
			font: "Inter"
		};

		try {
			const res = await fetch(`${HOST_EVENTS_API_BASE}/design`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
				body: JSON.stringify(payload)
			});
			if (res.ok) {
				const data = await res.json();
				if (data.event_id) activeEventId = data.event_id;
			}
		} catch (e) {
			console.warn("Design live auto-save warning:", e);
		}
	}

	function triggerLiveAutoSave() {
		clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			autoSaveManageEvent();
			autoSaveEventDesign();
		}, 800);
	}

	// Attach input auto-save listener to manage & design form controls
	if (createEventForm) {
		createEventForm.addEventListener("input", triggerLiveAutoSave);
		createEventForm.addEventListener("change", triggerLiveAutoSave);
	}

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

	// Step 1: Manage Form Handler -> Save and move to Design (Step 2)
	if (createEventForm) {
		createEventForm.addEventListener("submit", (e) => {
			e.preventDefault();
			const title = eventTitleInput.value.trim() || "My New Event 2026";
			const format = eventFormatInput ? eventFormatInput.value : "Hybrid";

			dashEventTitle.textContent = title;
			dashEventMeta.textContent = `Aug 19, 2026 - 09:00 AM • ${format}`;

			const webTitleBadge = document.getElementById("webTitleBadge");
			const webHeadline = document.getElementById("webHeadline");
			if (webTitleBadge) webTitleBadge.textContent = title.split(' ')[0];
			if (webHeadline) webHeadline.textContent = title;

			showNotification(`Step 1 of 4 Complete: Event details saved! Continuing to Design studio...`);
			switchTab("design");
		});
	}

	// Load Profile & Locked Bank Details for Settings Tab
	async function loadProfileAndBankDetails() {
		const profEmail = document.getElementById("profEmail");
		if (profEmail) profEmail.value = email;

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

					// Locked Read-Only Bank Details
					const profBankBeneficiary = document.getElementById("profBankBeneficiary");
					const profBankName = document.getElementById("profBankName");
					const profBankAccountType = document.getElementById("profBankAccountType");
					const profBankAccountNumber = document.getElementById("profBankAccountNumber");
					const profBankIfsc = document.getElementById("profBankIfsc");

					if (acc.beneficiary_name && profBankBeneficiary) profBankBeneficiary.value = acc.beneficiary_name;
					if (acc.bank_name && profBankName) profBankName.value = acc.bank_name;
					if (acc.account_type && profBankAccountType) profBankAccountType.value = acc.account_type.toUpperCase();
					if (acc.account_number && profBankAccountNumber) {
						const rawAcc = acc.account_number;
						profBankAccountNumber.value = rawAcc.length > 4 ? `•••• •••• ${rawAcc.slice(-4)}` : rawAcc;
					}
					if (acc.bank_ifsc && profBankIfsc) profBankIfsc.value = acc.bank_ifsc;

					// Documents Links
					const profPanDocLink = document.getElementById("profPanDocLink");
					const profChequeDocLink = document.getElementById("profChequeDocLink");
					if (acc.pan_card_url && profPanDocLink) profPanDocLink.href = acc.pan_card_url;
					if (acc.cancelled_cheque_url && profChequeDocLink) profChequeDocLink.href = acc.cancelled_cheque_url;
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
			if (confirm("Are you sure you want to permanently clear/reset all event data for this account? This action cannot be undone.")) {
				try {
					await fetch(`${HOST_EVENTS_API_BASE}/clear?email=${encodeURIComponent(email)}`, { method: "DELETE" });
					sessionStorage.removeItem(`has_event_${email}`);
					hasEvent = false;
					activeEventId = null;
					showNotification("✓ Event data cleared successfully!");
					switchTab("overview");
				} catch (err) {
					console.warn("Could not clear event data:", err);
				}
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

		bannerFileInput.addEventListener("change", (e) => {
			if (e.target.files[0]) {
				const reader = new FileReader();
				reader.onload = (evt) => {
					bannerPreviewImg.src = evt.target.result;
					bannerDropzoneContent.style.display = "none";
					bannerPreviewBox.style.display = "block";
				};
				reader.readAsDataURL(e.target.files[0]);
			}
		});

		if (btnClearBanner) {
			btnClearBanner.addEventListener("click", (e) => {
				e.stopPropagation();
				bannerFileInput.value = "";
				bannerDropzoneContent.style.display = "flex";
				bannerPreviewBox.style.display = "none";
			});
		}
	}

	// Dynamic Sponsor Row Adder
	const sponsorsRows = document.getElementById("sponsorsRows");
	const btnAddSponsor = document.getElementById("btnAddSponsor");

	function createSponsorRowHtml(name = "", tier = "Title Sponsor") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 sponsor-row";
		div.style.alignItems = "flex-end";
		div.style.marginBottom = "0.9rem";
		div.style.background = "#f8fafc";
		div.style.border = "1px solid #e2e8f0";
		div.style.padding = "1rem";
		div.style.borderRadius = "10px";
		div.innerHTML = `
			<div class="setup-form-group">
				<label>Sponsor Name</label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#127970;</span>
					<input type="text" class="setup-input sponsor-name-input" placeholder="e.g. Red Bull" value="${name}" />
				</div>
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
				<div style="display: flex; gap: 0.5rem;">
					<input type="file" class="sponsor-file-input" accept="image/*" style="display: none;" />
					<button type="button" class="btn-upload-sponsor-logo" style="background: #ffffff; border: 1.5px solid #cbd5e1; color: #2563eb; font-weight: 700; border-radius: 8px; padding: 0 0.8rem; flex: 1; height: 44px; font-size: 0.85rem; cursor: pointer;">&#128444; Upload Logo</button>
					<button type="button" class="btn-remove-sponsor" title="Remove Sponsor" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 0 0.8rem; cursor: pointer; font-weight: 700; height: 44px;">&times;</button>
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-sponsor");
		removeBtn.addEventListener("click", () => {
			if (sponsorsRows.children.length > 1) {
				div.remove();
			} else {
				div.querySelector(".sponsor-name-input").value = "";
			}
		});

		const uploadBtn = div.querySelector(".btn-upload-sponsor-logo");
		const fileInput = div.querySelector(".sponsor-file-input");
		uploadBtn.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", (e) => {
			if (e.target.files[0]) {
				uploadBtn.textContent = `✓ ${e.target.files[0].name.substring(0, 12)}...`;
				uploadBtn.style.color = "#10b981";
			}
		});

		return div;
	}

	if (btnAddSponsor && sponsorsRows) {
		btnAddSponsor.addEventListener("click", () => {
			sponsorsRows.appendChild(createSponsorRowHtml());
		});

		const initialRemoveBtn = sponsorsRows.querySelector(".btn-remove-sponsor");
		if (initialRemoveBtn) {
			initialRemoveBtn.addEventListener("click", (e) => {
				const row = e.target.closest(".sponsor-row");
				if (sponsorsRows.children.length > 1) {
					row.remove();
				} else {
					row.querySelector(".sponsor-name-input").value = "";
				}
			});
		}
	}

	// Dynamic Artist Row Adder
	const artistsRows = document.getElementById("artistsRows");
	const btnAddArtist = document.getElementById("btnAddArtist");

	function createArtistRowHtml(name = "", role = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-3 artist-row";
		div.style.alignItems = "flex-end";
		div.style.marginBottom = "0.9rem";
		div.style.background = "#f8fafc";
		div.style.border = "1px solid #e2e8f0";
		div.style.padding = "1rem";
		div.style.borderRadius = "10px";
		div.innerHTML = `
			<div class="setup-form-group">
				<label>Artist / Speaker Name</label>
				<div class="input-icon-wrap">
					<span class="input-icon">&#128587;</span>
					<input type="text" class="setup-input artist-name-input" placeholder="e.g. Artist / Speaker Name" value="${name}" />
				</div>
			</div>
			<div class="setup-form-group">
				<label>Role / Category</label>
				<input type="text" class="setup-input artist-role-input" placeholder="e.g. Headliner / Keynote Speaker" value="${role}" />
			</div>
			<div class="setup-form-group">
				<label>Photo / Headshot</label>
				<div style="display: flex; gap: 0.5rem;">
					<input type="file" class="artist-file-input" accept="image/*" style="display: none;" />
					<button type="button" class="btn-upload-artist-photo" style="background: #ffffff; border: 1.5px solid #cbd5e1; color: #2563eb; font-weight: 700; border-radius: 8px; padding: 0 0.8rem; flex: 1; height: 44px; font-size: 0.85rem; cursor: pointer;">&#128247; Upload Photo</button>
					<button type="button" class="btn-remove-artist" title="Remove Artist" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 0 0.8rem; cursor: pointer; font-weight: 700; height: 44px;">&times;</button>
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-artist");
		removeBtn.addEventListener("click", () => {
			if (artistsRows.children.length > 1) {
				div.remove();
			} else {
				div.querySelector(".artist-name-input").value = "";
				div.querySelector(".artist-role-input").value = "";
			}
		});

		const uploadBtn = div.querySelector(".btn-upload-artist-photo");
		const fileInput = div.querySelector(".artist-file-input");
		uploadBtn.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", (e) => {
			if (e.target.files[0]) {
				uploadBtn.textContent = `✓ ${e.target.files[0].name.substring(0, 12)}...`;
				uploadBtn.style.color = "#10b981";
			}
		});

		return div;
	}

	if (btnAddArtist && artistsRows) {
		btnAddArtist.addEventListener("click", () => {
			artistsRows.appendChild(createArtistRowHtml());
		});

		const initialRemoveBtn = artistsRows.querySelector(".btn-remove-artist");
		if (initialRemoveBtn) {
			initialRemoveBtn.addEventListener("click", (e) => {
				const row = e.target.closest(".artist-row");
				if (artistsRows.children.length > 1) {
					row.remove();
				} else {
					row.querySelector(".artist-name-input").value = "";
					row.querySelector(".artist-role-input").value = "";
				}
			});
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
			thumbDiv.style.position = 'relative';
			thumbDiv.style.height = '110px';
			thumbDiv.style.borderRadius = '8px';
			thumbDiv.style.overflow = 'hidden';
			thumbDiv.style.border = '1px solid #cbd5e1';
			thumbDiv.innerHTML = `
				<img src="${src}" style="width: 100%; height: 100%; object-fit: cover;" />
				<button type="button" class="btn-remove-thumb" style="position: absolute; top: 5px; right: 5px; background: rgba(220,38,38,0.85); color: #fff; border: none; width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 0.8rem; font-weight: 800;">&times;</button>
			`;
			thumbDiv.querySelector('.btn-remove-thumb').addEventListener('click', () => {
				thumbDiv.remove();
				if (!galleryThumbnailsGrid.querySelector('.gallery-thumb-item')) renderGalleryHint();
			});
			galleryThumbnailsGrid.appendChild(thumbDiv);
		};

		const handleGalleryFiles = (files) => {
			const existingCount = galleryThumbnailsGrid.querySelectorAll('.gallery-thumb-item').length;
			const allowedCount = Math.max(0, maxGalleryPhotos - existingCount);
			if (allowedCount === 0) {
				alert(`You can upload up to ${maxGalleryPhotos} gallery photos.`);
				return;
			}

			const selectedFiles = Array.from(files).slice(0, allowedCount);
			selectedFiles.forEach((file) => {
				if (!file.type.startsWith('image/')) return;
				const reader = new FileReader();
				reader.onload = (evt) => addThumbnail(evt.target.result);
				reader.readAsDataURL(file);
			});
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
	}


// ── EVENT DAY LIVE QR SCANNER & VOLUNTEER PORTAL HANDLERS ────────────────
	const btnLaunchCameraScanner = document.getElementById("btnLaunchCameraScanner");
	const cameraScannerModal = document.getElementById("cameraScannerModal");
	const btnCloseCameraModal = document.getElementById("btnCloseCameraModal");
	const modalScanResult = document.getElementById("modalScanResult");
	const btnSimulateScanSuccess = document.getElementById("btnSimulateScanSuccess");
	const btnSimulateScanDuplicate = document.getElementById("btnSimulateScanDuplicate");

const btnCreateVolunteerLink = document.getElementById("btnCreateVolunteerLink");
	const volunteerNameInput = document.getElementById("volunteerNameInput");
	const generatedLinkContainer = document.getElementById("generatedLinkContainer");
	const volunteerPortalUrl = document.getElementById("volunteerPortalUrl");
	const passcodeBadge = document.getElementById("passcodeBadge");
	const btnCopyVolunteerUrl = document.getElementById("btnCopyVolunteerUrl");
	const volunteerTableBody = document.getElementById("volunteerTableBody");

	// Open / Close Camera Modal
	if (btnLaunchCameraScanner && cameraScannerModal) {
		btnLaunchCameraScanner.addEventListener("click", () => {
			cameraScannerModal.style.display = "flex";
			if (modalScanResult) modalScanResult.style.display = "none";
		});
	}

	if (btnCloseCameraModal && cameraScannerModal) {
		btnCloseCameraModal.addEventListener("click", () => {
			cameraScannerModal.style.display = "none";
		});
	}

	// Simulate Camera QR Scans
	if (btnSimulateScanSuccess && modalScanResult) {
		btnSimulateScanSuccess.addEventListener("click", () => {
			modalScanResult.style.display = "block";
			modalScanResult.style.background = "#064e3b";
			modalScanResult.style.borderColor = "#059669";
			modalScanResult.style.color = "#a7f3d0";
			modalScanResult.innerHTML = `
				<strong>VALID TICKET PASS!</strong><br />
				Attendee: <strong>Demo Attendee</strong> (VIP Access Pass)<br />
				Ticket Code: <strong>TICKET-DEMO-VIP</strong><br />
				Gate Status: Verified &amp; Checked-in at Gate 1 (09:44 AM)
			`;
		});
	}

	if (btnSimulateScanDuplicate && modalScanResult) {
		btnSimulateScanDuplicate.addEventListener("click", () => {
			modalScanResult.style.display = "block";
			modalScanResult.style.background = "#7f1d1d";
			modalScanResult.style.borderColor = "#dc2626";
			modalScanResult.style.color = "#fecaca";
			modalScanResult.innerHTML = `
				<strong>DUPLICATE ENTRY ALERT!</strong><br />
				Attendee: <strong>Ananya Sharma</strong><br />
				Ticket Code: <strong>TICKET-55412-GEN</strong><br />
				Warning: Already scanned &amp; verified at Gate 1 at 09:12 AM! Entry Denied.
			`;
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
	if (designAssetsForm) {
		designAssetsForm.addEventListener("submit", (e) => {
			e.preventDefault();
			showNotification("Step 2 of 4 Complete: Design assets saved! Continuing to Registration Form Builder...");
			switchTab("registrations");
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

	// Final Step 4: Publish Event Handler
	const btnPublishForm = document.getElementById("btnPublishForm");
	const btnTopPublish = document.getElementById("btnTopPublish");

	function handleFinalPublish() {
		hasEvent = true;
		sessionStorage.setItem(`has_event_${email}`, "true");
		const title = eventTitleInput ? eventTitleInput.value.trim() : "My Published Event";
		dashEventTitle.textContent = title;

		showNotification(`🎉 Event "${title}" successfully created, designed & published live!`);
		switchTab("overview");
	}

	if (btnPublishForm) {
		btnPublishForm.addEventListener("click", () => {
			setTimeout(handleFinalPublish, 400);
		});
	}

	if (btnTopPublish) {
		btnTopPublish.addEventListener("click", () => {
			handleFinalPublish();
		});
	}

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
