(function initVolunteerPortal() {
	"use strict";

	const V = window.JodVolunteer;
	const card = document.getElementById("portalCard");
	if (!V || !card) return;

	V.getPortalToken();

	const brandLink = document.querySelector(".vol-brand");
	if (brandLink) brandLink.href = V.portalUrl();

	const REFRESH_MS = 8000;
	const ACTIVITY_FILTERS = [
		{ label: "Last 5 mins", mins: 5 },
		{ label: "Last 10 mins", mins: 10 },
		{ label: "Last 30 mins", mins: 30 },
		{ label: "Last 1 hour", mins: 60 }
	];

	let refreshTimer = null;
	let refreshInFlight = false;
	let portalRecentItems = [];
	let activityFilterMins = 30;

	function greetingName(name) {
		const hour = new Date().getHours();
		const hello = hour < 12 ? "Good morning" : (hour < 17 ? "Good afternoon" : "Good evening");
		return `${hello}, ${name || "Volunteer"}`;
	}

	function statusLabel(status) {
		const s = String(status || "").toLowerCase();
		if (s === "checked_in") return "✓";
		if (s === "already_checked_in") return "⚠ Already checked in";
		if (s === "wrong_event") return "✕ Wrong event";
		if (s === "cancelled") return "✕ Not valid";
		return "✕";
	}

	function itemTimestamp(item) {
		const ts = new Date(item.checked_in_at).getTime();
		return Number.isNaN(ts) ? 0 : ts;
	}

	function filterLabel(mins) {
		const match = ACTIVITY_FILTERS.find((f) => f.mins === mins);
		return match ? match.label.toLowerCase() : `last ${mins} mins`;
	}

	function filterByMinutes(items, mins) {
		const cutoff = Date.now() - mins * 60 * 1000;
		return (items || []).filter((item) => itemTimestamp(item) >= cutoff);
	}

	function recentCheckins(items) {
		return (items || [])
			.filter((item) => String(item.status || "").toLowerCase() === "checked_in")
			.sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
			.slice(0, 8);
	}

	function renderRow(item) {
		const ref = item.booking_ref || "";
		const name = item.attendee_name || "";
		const label = name && ref ? `${name} · ${ref}` : (name || ref || "Guest");
		return `
			<div class="vol-row">
				<span>${V.escapeHtml(V.formatTime(item.checked_in_at))} · ${V.escapeHtml(label)}</span>
				<span>${V.escapeHtml(statusLabel(item.status))}</span>
			</div>
		`;
	}

	function renderCheckinsHtml(items) {
		const rows = recentCheckins(items);
		if (!rows.length) {
			return `<p class="vol-muted">No check-ins yet.</p>`;
		}
		return rows.map(renderRow).join("");
	}

	function renderFilteredActivityHtml(items) {
		const filtered = filterByMinutes(items, activityFilterMins)
			.sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
			.slice(0, 12);
		if (!filtered.length) {
			return `<p class="vol-muted">No activity in the ${V.escapeHtml(filterLabel(activityFilterMins))}.</p>`;
		}
		return filtered.map(renderRow).join("");
	}

	function renderActivityFilterDropdown() {
		return `<label class="vol-filter-select-wrap">
			<span class="vol-filter-select-label">Show activity from</span>
			<select class="vol-filter-select" id="portalActivityFilter" aria-label="Filter recent activity">
				${ACTIVITY_FILTERS.map((f) => `
					<option value="${f.mins}"${activityFilterMins === f.mins ? " selected" : ""}>${V.escapeHtml(f.label)}</option>
				`).join("")}
			</select>
		</label>`;
	}

	function renderActivitySections() {
		return `
			<div class="vol-recent-block">
				<h3 class="vol-recent-subtitle">Recent Check-ins</h3>
				<div class="vol-list" id="portalCheckinsList">${renderCheckinsHtml(portalRecentItems)}</div>
			</div>
			<div class="vol-recent-block">
				<div class="vol-recent-head vol-recent-head-split">
					<h3 class="vol-recent-subtitle">All Activity</h3>
					${renderActivityFilterDropdown()}
				</div>
				<div class="vol-list" id="portalRecentList">${renderFilteredActivityHtml(portalRecentItems)}</div>
			</div>
		`;
	}

	function renderPortal(data) {
		portalRecentItems = data.recent || [];
		card.innerHTML = `
			<div class="vol-kicker">Volunteer Portal</div>
			<h1 class="vol-title">${V.escapeHtml(greetingName(data.volunteer_name))}</h1>
			<div class="vol-meta">
				<div><strong>Assigned Event</strong><br>${V.escapeHtml(data.event_title || "Event")}</div>
				<div><strong>Role</strong><br>${V.escapeHtml(data.role || "Scanner Volunteer")}</div>
				${data.gate_name ? `<div><strong>Assigned Gate</strong><br>${V.escapeHtml(data.gate_name)}</div>` : ""}
			</div>
			<div class="vol-stat">
				<span>Today's Check-ins</span>
				<strong id="portalTodayCount">${Number(data.today_checkins || 0)}</strong>
			</div>
			<div class="vol-actions">
				<a class="vol-btn vol-btn-ok" href="${V.scannerUrl()}">Open Scanner</a>
			</div>
			<div class="vol-recent-head">
				<h2>Recent Activity</h2>
			</div>
			${renderActivitySections()}
		`;
		bindActivityFilter();
	}

	function renderError(title, message) {
		portalRecentItems = [];
		card.innerHTML = `
			<div class="vol-kicker">Volunteer Portal</div>
			<h1 class="vol-title">${V.escapeHtml(title)}</h1>
			<p class="vol-sub">${V.escapeHtml(message)}.</p>
		`;
	}

	function updateActivityLists() {
		const checkinsEl = document.getElementById("portalCheckinsList");
		const listEl = document.getElementById("portalRecentList");
		if (checkinsEl) checkinsEl.innerHTML = renderCheckinsHtml(portalRecentItems);
		if (listEl) listEl.innerHTML = renderFilteredActivityHtml(portalRecentItems);
	}

	function updateLiveStats(data) {
		portalRecentItems = data.recent || [];
		const countEl = document.getElementById("portalTodayCount");
		if (countEl) countEl.textContent = String(Number(data.today_checkins || 0));
		updateActivityLists();
	}

	function bindActivityFilter() {
		const select = document.getElementById("portalActivityFilter");
		if (!select || select.dataset.bound === "1") return;
		select.dataset.bound = "1";
		select.addEventListener("change", () => {
			activityFilterMins = Number(select.value) || 30;
			updateActivityLists();
		});
	}

	async function refreshPortal(forceFullRender) {
		if (refreshInFlight) return;
		refreshInFlight = true;
		try {
			const { ok, status, data } = await V.fetchPortal();
			if (!ok) {
				if (forceFullRender) {
					const title = status === 410 ? "Access unavailable" : (V.getPortalToken() ? "Could not load portal" : "Volunteer link required");
					renderError(title, V.apiError(data, "This volunteer link is invalid or has expired."));
				}
				return;
			}
			if (forceFullRender || !document.getElementById("portalTodayCount")) {
				renderPortal(data);
			} else {
				updateLiveStats(data);
			}
		} catch (_) {
			if (forceFullRender) {
				renderError("Could not load portal", "A network or server error occurred. Try again in a moment");
			}
		} finally {
			refreshInFlight = false;
		}
	}

	function startAutoRefresh() {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(() => {
			if (document.visibilityState === "visible") refreshPortal(false);
		}, REFRESH_MS);
	}

	window.addEventListener("pageshow", () => refreshPortal(false));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") refreshPortal(false);
	});
	window.addEventListener("focus", () => refreshPortal(false));

	refreshPortal(true).then(startAutoRefresh);
})();
