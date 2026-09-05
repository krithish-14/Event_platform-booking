(() => {
	"use strict";

	function apiBase() {
		if (typeof window !== "undefined" && window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			return window.JodConfig.getApiOrigin();
		}
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		if (window.JOD_API_BASE_OVERRIDE) return String(window.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
		return "";
	}

	function token() {
		return window.JodAuth && typeof window.JodAuth.getToken === "function"
			? window.JodAuth.getToken()
			: null;
	}

	function user() {
		return window.JodAuth ? window.JodAuth.getUser() : null;
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function compactEventId(value) {
		return String(value || "").replace(/-/g, "").toLowerCase().trim();
	}

	function formatWhen(iso) {
		if (!iso) return "—";
		let raw = String(iso).trim();
		if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
			raw = raw.replace(" ", "T") + "Z";
		}
		const d = new Date(raw);
		if (Number.isNaN(d.getTime())) return "—";
		return d.toLocaleString("en-IN", {
			timeZone: "Asia/Kolkata",
			day: "2-digit",
			month: "short",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		});
	}

	function authHeaders(extra) {
		const headers = Object.assign({}, extra || {});
		const tok = token();
		if (tok && tok !== "null" && tok !== "undefined") {
			headers.Authorization = "Bearer " + tok;
		}
		return headers;
	}

	async function adminFetch(url, options) {
		const opts = Object.assign({ credentials: "include" }, options || {});
		opts.headers = authHeaders(opts.headers);
		if (window.JodAuth && typeof window.JodAuth.fetchAuth === "function") {
			return window.JodAuth.fetchAuth(url, opts);
		}
		return fetch(url, opts);
	}

	async function requireAdmin() {
		const current = user();
		if (!token() && !(window.JodAuth && window.JodAuth.isLoggedIn && window.JodAuth.isLoggedIn()) && !current) {
			window.location.href = "login.html";
			return null;
		}
		try {
			const res = await adminFetch(`${apiBase()}/api/admin/me`);
			if (!res.ok) {
				window.location.href = "login.html";
				return null;
			}
			const me = await res.json();
			const label = document.getElementById("adminUserLabel");
			if (label) label.textContent = me.email || (current && current.email) || "Admin";
			return me;
		} catch (_) {
			window.location.href = "login.html";
			return null;
		}
	}

	async function loadRows(query) {
		const qs = query ? `?q=${encodeURIComponent(query)}` : "";
		const res = await adminFetch(`${apiBase()}/api/admin/submissions${qs}`);
		if (res.status === 401 || res.status === 403) {
			window.location.href = "login.html";
			return null;
		}
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			const detail = data && data.detail;
			throw new Error(typeof detail === "string" ? detail : "Could not load submissions.");
		}
		return res.json();
	}

	function looksLikeName(value) {
		const t = String(value || "").trim();
		if (t.length < 2 || t.length > 80 || t.includes("@")) return false;
		if (/[%$&#*!?=^+]{2,}/.test(t) || /\d{5,}/.test(t)) return false;
		const letters = (t.match(/[A-Za-z]/g) || []).length;
		const digits = (t.match(/\d/g) || []).length;
		return letters >= 2 && letters >= digits;
	}

	function looksLikePhone(value) {
		const digits = String(value || "").replace(/\D/g, "");
		return digits.length >= 8 && digits.length <= 15;
	}

	function displayAttendee(row) {
		const email = String((row && (row.user_email || row.attendee_email)) || "").trim();
		const rawName = String((row && row.attendee_name) || "").trim();
		const name = looksLikeName(rawName)
			? rawName
			: (email.includes("@") ? email.split("@")[0].replace(/[._+-]+/g, " ") : "Guest");
		const phone = looksLikePhone(row && row.attendee_phone) ? String(row.attendee_phone).trim() : "";
		return { name, email, phone };
	}

	function attendeeCellHtml(row) {
		const person = displayAttendee(row);
		return `<div class="admin-name">${escapeHtml(person.name)}</div>
			${person.email ? `<div class="admin-muted">${escapeHtml(person.email)}</div>` : ""}
			${person.phone ? `<div class="admin-muted">${escapeHtml(person.phone)}</div>` : ""}`;
	}

	function rowHtml(row, options) {
		const kind = row.kind || "form";
		const recordId = row.id || row.submission_id || row.booking_id;
		if (kind === "cancel") {
			return `<tr data-id="${escapeHtml(recordId)}" data-kind="cancel">
				<td>${attendeeCellHtml(row)}</td>
				<td>
					<button type="button" class="admin-event-title" data-event-key="${escapeHtml(eventKey(row))}" title="Show only this event">${escapeHtml(row.event_title)}</button>
					<div class="admin-muted">${escapeHtml(row.event_venue || "")}</div>
				</td>
				<td>
					<div class="admin-ticket-title">${escapeHtml(row.ticket_type || "Ticket")}</div>
					<div class="admin-muted">₹${Number(row.ticket_price || 0).toLocaleString("en-IN")}</div>
				</td>
				<td class="admin-submitted">${escapeHtml(formatWhen(row.submitted_at))}</td>
				<td><span class="admin-badge cancel">Cancellation requested</span></td>
				<td>
					<div class="admin-actions">
						<button type="button" class="admin-btn ghost" data-attendee-form="${escapeHtml(recordId)}">Attendees form</button>
						<button type="button" class="admin-btn ghost" data-payment-form="${escapeHtml(recordId)}">Payment form</button>
						<button type="button" class="admin-btn accept" data-accept-cancel="${escapeHtml(recordId)}">Accept request</button>
					</div>
				</td>
			</tr>`;
		}
		const ready = Boolean(row.has_qr);
		const showGenerate = Boolean(options && options.showGenerate);
		const generateLabel = "Resend QR";
		return `<tr data-id="${recordId}" data-kind="${escapeHtml(kind)}">
			<td>${attendeeCellHtml(row)}</td>
			<td>
				<button type="button" class="admin-event-title" data-event-key="${escapeHtml(eventKey(row))}" title="Show only this event">${escapeHtml(row.event_title)}</button>
				<div class="admin-muted">${escapeHtml(row.event_venue || "")}</div>
			</td>
			<td>
				<div class="admin-ticket-title">${escapeHtml(row.ticket_type || "Ticket")}</div>
				<div class="admin-muted">₹${Number(row.ticket_price || 0).toLocaleString("en-IN")}</div>
				${row.transaction_id ? `<div class="admin-muted">Txn ${escapeHtml(row.transaction_id)}</div>` : ""}
			</td>
			<td class="admin-submitted">${escapeHtml(formatWhen(row.submitted_at))}</td>
			<td><span class="admin-badge ${ready ? "ready" : "pending"}">${ready ? "QR ready" : "Pending"}</span></td>
			<td>
				<div class="admin-actions">
					${showGenerate ? `<button type="button" class="admin-btn" data-kind="${escapeHtml(kind)}" data-generate="${recordId}">${generateLabel}</button>` : ""}
					<button type="button" class="admin-btn ghost" data-kind="${escapeHtml(kind)}" data-answers="${recordId}">View form</button>
				</div>
			</td>
		</tr>`;
	}

	const SECTION_KEY = "jod_admin_section";
	const VALID_SECTIONS = ["overview", "host", "payment", "cancel", "support"];

	function currentSection() {
		const raw = window.__adminSection || sessionStorage.getItem(SECTION_KEY) || "overview";
		return VALID_SECTIONS.includes(raw) ? raw : "overview";
	}

	function setNavOpen(open) {
		const shell = document.querySelector(".admin-shell");
		const toggle = document.getElementById("adminNavToggle");
		const backdrop = document.getElementById("adminSidebarBackdrop");
		if (shell) shell.classList.toggle("is-nav-open", Boolean(open));
		if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
		if (backdrop) backdrop.hidden = !open;
	}

	function setSection(section, options) {
		const next = VALID_SECTIONS.includes(section) ? section : "overview";
		window.__adminSection = next;
		try { sessionStorage.setItem(SECTION_KEY, next); } catch (_) {}
		document.querySelectorAll(".admin-nav-item[data-section]").forEach((btn) => {
			const active = btn.getAttribute("data-section") === next;
			btn.classList.toggle("is-active", active);
			btn.setAttribute("aria-selected", active ? "true" : "false");
		});
		if (!(options && options.skipApply)) applySection(window.__adminData);
		if (!(options && options.keepNavOpen)) setNavOpen(false);
	}

	function updateOverview(stats) {
		const bars = document.getElementById("adminWorkloadBars");
		if (bars) {
			const items = [
				{ label: "Attendees", value: stats.host },
				{ label: "Payments", value: stats.pay },
				{ label: "Cancels", value: stats.cancel },
				{ label: "Help open", value: stats.supportOpen },
			];
			const max = Math.max(1, ...items.map((row) => row.value));
			bars.innerHTML = items.map((row) => {
				const pct = Math.round((row.value / max) * 100);
				return `<div class="admin-bar-row">
					<span>${escapeHtml(row.label)}</span>
					<div class="admin-bar-track"><div class="admin-bar-fill" style="width:${pct}%"></div></div>
					<em>${row.value}</em>
				</div>`;
			}).join("");
		}

		const totalPay = Math.max(0, Number(stats.pay) || 0);
		const ready = Math.max(0, Number(stats.ready) || 0);
		const pending = Math.max(0, Number(stats.pending) || 0);
		const readyPct = totalPay ? (ready / totalPay) * 100 : 0;
		const pendingPct = totalPay ? (pending / totalPay) * 100 : 0;
		const readyPath = document.getElementById("adminDonutReady");
		const pendingPath = document.getElementById("adminDonutPending");
		if (readyPath) readyPath.setAttribute("stroke-dasharray", `${readyPct.toFixed(2)}, 100`);
		if (pendingPath) {
			pendingPath.setAttribute("stroke-dasharray", `${pendingPct.toFixed(2)}, 100`);
			pendingPath.setAttribute("stroke-dashoffset", String((-readyPct).toFixed(2)));
		}
		const setText = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = String(value);
		};
		setText("adminDonutValue", totalPay);
		setText("adminDonutLabel", "payments");
		setText("legendReady", ready);
		setText("legendPending", pending);

		const recent = document.getElementById("adminRecentSupport");
		if (recent) {
			const tickets = (window.__supportTickets || []).slice(0, 5);
			if (!tickets.length) {
				recent.innerHTML = `<div class="admin-recent-empty">No help tickets yet.</div>`;
			} else {
				recent.innerHTML = tickets.map((ticket) => {
					const status = ticket.status || "open";
					return `<button type="button" class="admin-recent-item" data-support-view="${escapeHtml(ticket.ticket_code)}">
						<div>
							<strong>${escapeHtml(ticket.ticket_code)} · ${escapeHtml(ticket.subject || "Support issue")}</strong>
							<span>${escapeHtml(ticket.name || "")} · ${escapeHtml(formatWhen(ticket.created_at))}</span>
						</div>
						<span class="admin-badge ${escapeHtml(status)}">${escapeHtml(supportStatusLabel(status))}</span>
					</button>`;
				}).join("");
			}
		}
	}

	function applySection(data) {
		const payload = data || window.__adminData || { submissions: [] };
		const rows = payload.submissions || [];
		const cancelRows = window.__cancelRequests || [];
		fillEventFilter(rows.concat(cancelRows));
		const eventFilter = currentEventFilter();
		const scoped = rowsForEvent(rows, eventFilter);
		const scopedCancel = rowsForEvent(cancelRows, eventFilter);
		const hostRows = scoped.filter((row) => (row.kind || "form") !== "payment");
		const payRows = scoped.filter((row) => row.kind === "payment");
		const section = currentSection();
		const supportRows = window.__supportTickets || [];
		const supportOpen = (window.__supportMeta && window.__supportMeta.open)
			|| supportRows.filter((t) => (t.status || "open") !== "resolved").length;
		const eventLabel = (() => {
			const select = document.getElementById("adminEventFilter");
			if (!select || select.value === "all") return "";
			const opt = select.options[select.selectedIndex];
			return opt ? opt.textContent.trim() : "";
		})();
		const setText = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = String(value);
		};
		const payPending = payRows.filter((row) => !row.has_qr).length;
		const payReady = payRows.filter((row) => row.has_qr).length;
		setText("statHost", hostRows.length);
		setText("statPay", payRows.length);
		setText("statPending", payPending);
		setText("statReady", payReady);
		setText("statCancel", scopedCancel.length);
		setText("statSupport", supportOpen);
		setText("navCountHost", hostRows.length);
		setText("navCountPay", payRows.length);
		setText("navCountCancel", scopedCancel.length);
		setText("navCountSupport", supportOpen);

		const title = document.getElementById("adminSectionTitle");
		const pageTitle = document.getElementById("adminPageTitle");
		const copy = document.getElementById("adminSectionCopy");
		const hint = document.getElementById("adminSectionHint");
		const ticketCol = document.getElementById("ticketCol");
		const eventFilterWrap = document.getElementById("adminEventFilterWrap");
		const searchInput = document.getElementById("adminSearch");
		const overviewPanel = document.getElementById("adminOverviewPanel");
		const dataPanel = document.getElementById("adminDataPanel");
		const eventNote = eventLabel ? ` for ${eventLabel}` : "";
		const showingOverview = section === "overview";

		if (overviewPanel) overviewPanel.hidden = !showingOverview;
		if (dataPanel) dataPanel.hidden = showingOverview;
		if (searchInput) searchInput.hidden = showingOverview;
		if (eventFilterWrap) eventFilterWrap.hidden = section === "support";

		updateOverview({
			host: hostRows.length,
			pay: payRows.length,
			cancel: scopedCancel.length,
			supportOpen,
			ready: payReady,
			pending: payPending,
		});

		if (showingOverview) {
			if (pageTitle) pageTitle.textContent = "Overview";
			if (hint) hint.textContent = eventLabel
				? `Dashboard snapshot${eventNote}.`
				: "Snapshot of attendees, payments, cancellations, and help tickets.";
			window.__adminData = payload;
			return;
		}

		if (section === "support") {
			setText("sectionCount", supportRows.length);
			if (pageTitle) pageTitle.textContent = "Help & Support";
			if (title) title.textContent = "Help & Support";
			if (copy) copy.textContent = "Tickets raised from Help & Support (THP- IDs). Open an issue, then mark it solved to email the customer.";
			if (hint) hint.textContent = "Review customer issues from the Help page and mark them solved when fixed.";
			if (ticketCol) ticketCol.textContent = "Issue preview";
			if (searchInput) searchInput.placeholder = "Search THP- ID, name, email, or subject";
			const head = document.querySelector("#adminTableWrap thead tr");
			if (head) {
				head.innerHTML = "<th>Ticket / Customer</th><th>Subject</th><th>Issue preview</th><th>Submitted</th><th>Status</th><th>Action</th>";
			}
			fillSupportTable(supportRows);
			window.__adminRows = supportRows;
		} else if (section === "cancel") {
			if (searchInput) searchInput.placeholder = "Search name, email, phone, or event";
			const head = document.querySelector("#adminTableWrap thead tr");
			if (head) {
				head.innerHTML = "<th>Attendee</th><th>Event</th><th id=\"ticketCol\">Ticket</th><th>Submitted</th><th>Status</th><th>Action</th>";
			}
			setText("sectionCount", scopedCancel.length);
			if (pageTitle) pageTitle.textContent = "Cancellation request";
			if (title) title.textContent = "Cancellation request";
			if (copy) copy.textContent = eventLabel
				? `Pending cancellation requests for ${eventLabel}. Review the attendee and payment forms, then accept.`
				: "Pending cancellation requests. Review the attendee form and payment form, then accept the request.";
			if (hint) hint.textContent = eventLabel
				? `Cancellation requests${eventNote}.`
				: "Select an event to view that event's cancellation requests, or keep All events.";
			if (ticketCol) ticketCol.textContent = "Ticket";
			fillTable(scopedCancel, eventLabel ? `No cancellation requests for ${eventLabel}.` : "No cancellation requests yet.", { showGenerate: false });
			window.__adminRows = scopedCancel;
		} else if (section === "payment") {
			if (searchInput) searchInput.placeholder = "Search name, email, phone, or event";
			const head = document.querySelector("#adminTableWrap thead tr");
			if (head) {
				head.innerHTML = "<th>Attendee</th><th>Event</th><th id=\"ticketCol\">Ticket / Txn</th><th>Submitted</th><th>Status</th><th>Action</th>";
			}
			setText("sectionCount", payRows.length);
			if (pageTitle) pageTitle.textContent = "Payment Data";
			if (title) title.textContent = "Payment Data";
			if (copy) copy.textContent = eventLabel
				? `Payment records for ${eventLabel}. QR is issued automatically after payment; use Resend QR if needed.`
				: "Payment records. QR is issued automatically after payment; use Resend QR to email/WhatsApp again.";
			if (hint) hint.textContent = eventLabel
				? `Payment data${eventNote}.`
				: "Select an event to view that event's payment data, or keep All events.";
			if (ticketCol) ticketCol.textContent = "Ticket / Txn";
			fillTable(payRows, eventLabel ? `No payment data for ${eventLabel} yet.` : "No payment data yet.", { showGenerate: true });
			window.__adminRows = payRows;
		} else {
			if (searchInput) searchInput.placeholder = "Search name, email, phone, or event";
			const head = document.querySelector("#adminTableWrap thead tr");
			if (head) {
				head.innerHTML = "<th>Attendee</th><th>Event</th><th id=\"ticketCol\">Ticket</th><th>Submitted</th><th>Status</th><th>Action</th>";
			}
			setText("sectionCount", hostRows.length);
			if (pageTitle) pageTitle.textContent = "Attendees Data";
			if (title) title.textContent = "Attendees Data";
			if (copy) copy.textContent = eventLabel
				? `Registered attendees for ${eventLabel}.`
				: "Registered details from the event host form. Choose an event to see only that event's attendees.";
			if (hint) hint.textContent = eventLabel
				? `Attendee data${eventNote}.`
				: "Select an event to view that event's attendee data, or keep All events.";
			if (ticketCol) ticketCol.textContent = "Ticket";
			fillTable(hostRows, eventLabel ? `No attendee data for ${eventLabel} yet.` : "No attendee data yet.", { showGenerate: false });
			window.__adminRows = hostRows;
		}
		window.__adminData = payload;
	}
	function eventKey(row) {
		const compact = compactEventId(row && row.event_id);
		if (compact) return `id:${compact}`;
		const title = String((row && row.event_title) || "Event").trim() || "Event";
		return `title:${title.toLowerCase()}`;
	}

	function currentEventFilter() {
		const select = document.getElementById("adminEventFilter");
		return (select && select.value) || "all";
	}

	function persistEventFilter(value) {
		try { sessionStorage.setItem("jod_admin_event_filter", value || "all"); } catch (_) {}
	}

	function readPersistedEventFilter() {
		try { return sessionStorage.getItem("jod_admin_event_filter") || "all"; } catch (_) { return "all"; }
	}

	function rowsForEvent(rows, key) {
		if (!key || key === "all") return rows;
		return rows.filter((row) => eventKey(row) === key);
	}

	function fillEventFilter(rows) {
		const select = document.getElementById("adminEventFilter");
		if (!select) return;
		const prev = (select.dataset.bound === "1" ? select.value : readPersistedEventFilter()) || "all";
		select.dataset.bound = "1";
		const seen = new Map();
		(rows || []).forEach((row) => {
			const key = eventKey(row);
			if (seen.has(key)) return;
			const title = String(row.event_title || "Event").trim() || "Event";
			seen.set(key, title);
		});
		const options = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));
		select.innerHTML = `<option value="all">All events</option>` +
			options.map(([key, title]) => `<option value="${escapeHtml(key)}">${escapeHtml(title)}</option>`).join("");
		const valid = prev === "all" || seen.has(prev);
		select.value = valid ? prev : "all";
		persistEventFilter(select.value);
	}

	function fillTable(rows, emptyText, options) {
		const body = document.getElementById("adminTableBody");
		const wrap = document.getElementById("adminTableWrap");
		const empty = document.getElementById("adminEmpty");
		if (!body) return;
		if (!rows.length) {
			body.innerHTML = "";
			if (empty) {
				empty.hidden = false;
				empty.textContent = emptyText;
			}
			if (wrap) wrap.hidden = true;
			return;
		}
		if (empty) empty.hidden = true;
		if (wrap) wrap.hidden = false;
		body.innerHTML = rows.map((row) => rowHtml(row, options)).join("");
	}

	function renderRows(data) {
		applySection(data);
	}

	function findRow(id, kind) {
		return (window.__adminRows || []).find((item) => {
			const itemId = String(item.id || item.submission_id || item.booking_id);
			const itemKind = item.kind || "form";
			return itemId === String(id) && itemKind === String(kind || itemKind);
		});
	}

	function pairsHtml(pairs) {
		const rows = (pairs || []).filter((row) => row && row[0] && row[1] != null && row[1] !== "");
		if (!rows.length) return "<p>No extra answers stored.</p>";
		return rows.map(([key, value]) => (
			`<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</dd>`
		)).join("");
	}

	function setAnswersTitle(title) {
		const heading = document.querySelector("#answersModal h2");
		if (heading) heading.textContent = title || "Form answers";
	}

	async function openLabeled(title, pairs, screenshotUrl) {
		const modal = document.getElementById("answersModal");
		const body = document.getElementById("answersBody");
		if (!modal || !body) return;
		setAnswersTitle(title);
		const shot = screenshotUrl || "";
		body.innerHTML = pairsHtml(pairs) +
			(shot ? `<dt>Screenshot</dt><dd><img id="proofShot" alt="Payment screenshot" style="max-width:100%;border-radius:10px;margin-top:0.4rem;display:none;" /></dd>` : "");
		modal.hidden = false;
		if (!shot) return;
		try {
			const res = await adminFetch(mediaUrl(shot));
			if (!res.ok) return;
			const blob = await res.blob();
			const img = body.querySelector("#proofShot");
			if (img) {
				img.src = URL.createObjectURL(blob);
				img.style.display = "block";
			}
		} catch (_) {}
	}

	function mediaUrl(path) {
		if (!path) return "";
		if (/^https?:\/\//i.test(path)) return path;
		return `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
	}

	async function openAnswers(id, kind) {
		const row = findRow(id, kind);
		if (!row) return;
		const answers = row.answers || {};
		const keys = Object.keys(answers).filter((key) => String(key).toLowerCase() !== "screenshot");
		const shot = row.screenshot_url || answers.Screenshot;
		await openLabeled("Form answers", keys.map((key) => [key, answers[key]]), shot);
	}

	async function openCancelAttendeeForm(id) {
		const row = findRow(id, "cancel");
		if (!row) return;
		const answers = row.answers || {};
		const keys = Object.keys(answers).filter((key) => String(key).toLowerCase() !== "screenshot");
		await openLabeled(
			`Attendees form: ${displayAttendee(row).name}`,
			keys.map((key) => [key, answers[key]])
		);
	}

	async function openCancelPaymentForm(id) {
		const row = findRow(id, "cancel");
		if (!row) return;
		const answers = row.payment_answers || {};
		const keys = Object.keys(answers).filter((key) => String(key).toLowerCase() !== "screenshot");
		await openLabeled(
			`Payment form: ${displayAttendee(row).name}`,
			keys.map((key) => [key, answers[key]]),
			row.screenshot_url || answers.Screenshot
		);
	}

	function showQrResult(row) {
		const modal = document.getElementById("qrModal");
		const body = document.getElementById("qrBody");
		if (!modal || !body) return;
		const d = row.delivery || {};
		const waBtn = d.whatsapp_url
			? `<a class="admin-btn" href="${escapeHtml(d.whatsapp_url)}" target="_blank" rel="noopener">Open WhatsApp</a>`
			: "";
		body.innerHTML = `
			<div class="qr-preview">
				<img src="${escapeHtml(d.qr_image_url || row.qr_image_url || "")}" alt="Generated QR" />
				<p><strong>${escapeHtml(row.attendee_name)}</strong><br/>${escapeHtml(row.event_title)}</p>
			</div>
			<div class="delivery-list">
				<div class="delivery-item"><span>Website ticket</span><span class="ok">Ready</span></div>
				<div class="delivery-item"><span>Email ${escapeHtml(d.email_to || "")}</span><span class="${d.email_sent ? "ok" : "warn"}">${d.email_sent ? "Sent" : "Logged (SMTP not configured)"}</span></div>
				<div class="delivery-item"><span>WhatsApp ${escapeHtml(d.whatsapp_to || "no number")}</span><span class="${d.whatsapp_sent ? "ok" : "warn"}">${d.whatsapp_sent ? "Sent" : (d.whatsapp_url ? "Open chat to send" : "No phone")}</span></div>
			</div>
			<div class="admin-actions">
				${row.ticket_url ? `<a class="admin-btn ghost" href="${escapeHtml(row.ticket_url)}" target="_blank" rel="noopener">View on website</a>` : ""}
				${waBtn}
			</div>
		`;
		modal.hidden = false;
	}

	async function generateQr(id, kind, btn) {
		if (btn) {
			btn.disabled = true;
			btn.textContent = "Resending…";
		}
		try {
			const path = kind === "payment"
				? `/api/admin/payments/${id}/generate-qr`
				: `/api/admin/submissions/${id}/generate-qr`;
			const res = await adminFetch(`${apiBase()}${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resend: true }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const detail = data && data.detail;
				alert(typeof detail === "string" ? detail : "Could not resend QR.");
				return;
			}
			showQrResult(data);
			await refresh();
			if (data.delivery && data.delivery.whatsapp_url && !data.delivery.whatsapp_sent) {
				window.open(data.delivery.whatsapp_url, "_blank", "noopener");
			}
		} catch (err) {
			alert("Could not resend QR. Check that the backend is running.");
		} finally {
			if (btn) {
				btn.disabled = false;
				if (!btn.isConnected) return;
				btn.textContent = "Resend QR";
			}
		}
	}

	async function acceptCancellation(id, btn) {
		if (!id) return;
		if (!window.confirm("Accept this cancellation request? The ticket will be cancelled, the attendee can buy again, and this QR will stop working.")) {
			return;
		}
		if (btn) {
			btn.disabled = true;
			btn.textContent = "Accepting…";
		}
		try {
			const res = await adminFetch(`${apiBase()}/api/admin/bookings/${encodeURIComponent(id)}/accept-cancellation`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const detail = data && data.detail;
				alert(typeof detail === "string" ? detail : "Could not accept this cancellation request.");
				return;
			}
			await refresh();
		} catch (_) {
			alert("Could not accept this cancellation request. Check that the backend is running.");
		} finally {
			if (btn && btn.isConnected) {
				btn.disabled = false;
				btn.textContent = "Accept request";
			}
		}
	}

	async function loadCancelRequests(query) {
		const qs = query ? `?q=${encodeURIComponent(query)}` : "";
		const res = await adminFetch(`${apiBase()}/api/admin/cancellation-requests${qs}`);
		if (!res.ok) return { requests: [] };
		return res.json().catch(() => ({ requests: [] }));
	}

	async function loadSupportTickets(query) {
		const qs = query ? `?q=${encodeURIComponent(query)}` : "";
		const res = await adminFetch(`${apiBase()}/api/admin/support-tickets${qs}`);
		if (res.status === 401 || res.status === 403) {
			window.location.href = "login.html";
			return null;
		}
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			const detail = data && data.detail;
			throw new Error(typeof detail === "string" ? detail : "Could not load support tickets.");
		}
		return res.json();
	}

	function supportStatusLabel(status) {
		if (status === "in_progress") return "In progress";
		if (status === "resolved") return "Resolved";
		return "Open";
	}

	function supportRowHtml(row) {
		const status = row.status || "open";
		const priority = row.priority || "normal";
		const preview = String(row.message || "");
		return `<tr data-id="${escapeHtml(row.ticket_code)}" data-kind="support">
			<td>
				<div class="admin-name">${escapeHtml(row.ticket_code)}</div>
				<div class="admin-muted">${escapeHtml(row.name || "")}</div>
				<div class="admin-muted">${escapeHtml(row.email || "")}</div>
			</td>
			<td>
				<button type="button" class="admin-event-title" data-support-view="${escapeHtml(row.ticket_code)}" title="View issue">${escapeHtml(row.subject || "Support issue")}</button>
				<div class="admin-muted">${escapeHtml(row.category || "")} · ${escapeHtml(priority)}</div>
			</td>
			<td>${escapeHtml(preview.slice(0, 90))}${preview.length > 90 ? "…" : ""}</td>
			<td class="admin-submitted">${escapeHtml(formatWhen(row.created_at))}</td>
			<td><span class="admin-badge ${escapeHtml(status)}">${escapeHtml(supportStatusLabel(status))}</span></td>
			<td>
				<div class="admin-actions">
					<button type="button" class="admin-btn ghost" data-support-view="${escapeHtml(row.ticket_code)}">View issue</button>
					${status !== "resolved" ? `<button type="button" class="admin-btn accept" data-support-resolve="${escapeHtml(row.ticket_code)}">Mark solved</button>` : ""}
				</div>
			</td>
		</tr>`;
	}

	function fillSupportTable(rows) {
		const body = document.getElementById("adminTableBody");
		const wrap = document.getElementById("adminTableWrap");
		const empty = document.getElementById("adminEmpty");
		if (!body) return;
		if (!rows.length) {
			body.innerHTML = "";
			if (empty) {
				empty.hidden = false;
				empty.textContent = "No Help & Support tickets yet.";
			}
			if (wrap) wrap.hidden = true;
			return;
		}
		if (empty) empty.hidden = true;
		if (wrap) wrap.hidden = false;
		body.innerHTML = rows.map(supportRowHtml).join("");
	}

	function findSupportTicket(code) {
		return (window.__supportTickets || []).find((item) => String(item.ticket_code) === String(code));
	}

	function openSupportTicket(code, preferResolve) {
		const row = findSupportTicket(code);
		const modal = document.getElementById("supportModal");
		const body = document.getElementById("supportBody");
		const title = document.getElementById("supportModalTitle");
		const resolveWrap = document.getElementById("supportResolveWrap");
		const noteEl = document.getElementById("supportResolveNote");
		const resolveBtn = document.getElementById("supportResolveBtn");
		if (!row || !modal || !body) return;
		if (title) title.textContent = row.ticket_code || "Support ticket";
		body.innerHTML = `
			<dt>Status</dt><dd><span class="admin-badge ${escapeHtml(row.status || "open")}">${escapeHtml(supportStatusLabel(row.status))}</span></dd>
			<dt>Customer</dt><dd>${escapeHtml(row.name || "")}<br>${escapeHtml(row.email || "")}</dd>
			<dt>Category / Priority</dt><dd>${escapeHtml(row.category || "")} · ${escapeHtml(row.priority || "normal")}</dd>
			<dt>Subject</dt><dd>${escapeHtml(row.subject || "")}</dd>
			<dt>Issue details</dt><dd>${escapeHtml(row.message || "")}</dd>
			<dt>Submitted</dt><dd>${escapeHtml(formatWhen(row.created_at))}</dd>
			${row.resolution_note ? `<dt>Resolution note</dt><dd>${escapeHtml(row.resolution_note)}</dd>` : ""}
			${row.resolved_at ? `<dt>Resolved</dt><dd>${escapeHtml(formatWhen(row.resolved_at))}</dd>` : ""}
		`;
		const canResolve = (row.status || "open") !== "resolved";
		if (resolveWrap) resolveWrap.hidden = !canResolve;
		if (noteEl) noteEl.value = "";
		if (resolveBtn) {
			resolveBtn.dataset.code = row.ticket_code;
			resolveBtn.disabled = false;
			resolveBtn.textContent = "Mark as solved & notify";
		}
		modal.hidden = false;
		if (preferResolve && canResolve && noteEl) noteEl.focus();
	}

	async function resolveSupportTicket(code, btn) {
		const noteEl = document.getElementById("supportResolveNote");
		const note = noteEl ? noteEl.value.trim() : "";
		if (btn) {
			btn.disabled = true;
			btn.textContent = "Saving…";
		}
		try {
			const res = await adminFetch(`${apiBase()}/api/admin/support-tickets/${encodeURIComponent(code)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resolution_note: note || null }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const detail = data && data.detail;
				throw new Error(typeof detail === "string" ? detail : "Could not mark ticket as solved.");
			}
			alert(data.message || "Ticket marked as solved.");
			document.getElementById("supportModal").hidden = true;
			await refresh();
		} catch (err) {
			alert(err.message || "Could not mark ticket as solved.");
			if (btn && btn.isConnected) {
				btn.disabled = false;
				btn.textContent = "Mark as solved & notify";
			}
		}
	}

	async function refresh() {
		const query = (document.getElementById("adminSearch") || {}).value || "";
		try {
			const [data, cancelData, supportData] = await Promise.all([
				loadRows(query.trim()),
				loadCancelRequests(query.trim()),
				loadSupportTickets(query.trim()),
			]);
			window.__cancelRequests = Array.isArray(cancelData && cancelData.requests) ? cancelData.requests : [];
			window.__supportTickets = Array.isArray(supportData && supportData.tickets) ? supportData.tickets : [];
			window.__supportMeta = supportData || { open: 0, total: 0 };
			if (data) renderRows(data);
			else applySection(window.__adminData);
		} catch (err) {
			const empty = document.getElementById("adminEmpty");
			if (empty) {
				empty.hidden = false;
				empty.textContent = err.message || "Could not load forms.";
			}
		}
	}

	document.addEventListener("DOMContentLoaded", async () => {
		if (!(await requireAdmin())) return;
		setSection(currentSection(), { skipApply: true, keepNavOpen: true });
		document.getElementById("adminLogout")?.addEventListener("click", async () => {
			if (window.JodAuth && typeof window.JodAuth.logout === "function") {
				await window.JodAuth.logout();
			}
			window.location.href = "login.html";
		});
		document.getElementById("adminRefresh")?.addEventListener("click", refresh);
		document.getElementById("adminNavToggle")?.addEventListener("click", () => {
			const shell = document.querySelector(".admin-shell");
			setNavOpen(!(shell && shell.classList.contains("is-nav-open")));
		});
		document.getElementById("adminSidebarBackdrop")?.addEventListener("click", () => setNavOpen(false));
		document.querySelectorAll(".admin-nav-item[data-section]").forEach((btn) => {
			btn.addEventListener("click", () => setSection(btn.getAttribute("data-section")));
		});
		document.querySelectorAll("[data-jump]").forEach((btn) => {
			btn.addEventListener("click", () => setSection(btn.getAttribute("data-jump")));
		});
		document.getElementById("adminEventFilter")?.addEventListener("change", () => {
			persistEventFilter(currentEventFilter());
			applySection(window.__adminData);
		});
		let searchTimer = null;
		document.getElementById("adminSearch")?.addEventListener("input", () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(refresh, 250);
		});
		document.querySelector(".admin-main")?.addEventListener("click", (event) => {
			const generateBtn = event.target.closest("[data-generate]");
			if (generateBtn) {
				generateQr(generateBtn.getAttribute("data-generate"), generateBtn.getAttribute("data-kind") || "form", generateBtn);
				return;
			}
			const answersBtn = event.target.closest("[data-answers]");
			if (answersBtn) {
				openAnswers(answersBtn.getAttribute("data-answers"), answersBtn.getAttribute("data-kind") || "form");
				return;
			}
			const attendeeFormBtn = event.target.closest("[data-attendee-form]");
			if (attendeeFormBtn) {
				openCancelAttendeeForm(attendeeFormBtn.getAttribute("data-attendee-form"));
				return;
			}
			const paymentFormBtn = event.target.closest("[data-payment-form]");
			if (paymentFormBtn) {
				openCancelPaymentForm(paymentFormBtn.getAttribute("data-payment-form"));
				return;
			}
			const acceptBtn = event.target.closest("[data-accept-cancel]");
			if (acceptBtn) {
				acceptCancellation(acceptBtn.getAttribute("data-accept-cancel"), acceptBtn);
				return;
			}
			const supportViewBtn = event.target.closest("[data-support-view]");
			if (supportViewBtn) {
				const code = supportViewBtn.getAttribute("data-support-view");
				if (currentSection() !== "support") setSection("support", { skipApply: true, keepNavOpen: true });
				applySection(window.__adminData);
				openSupportTicket(code, false);
				return;
			}
			const supportResolveBtn = event.target.closest("[data-support-resolve]");
			if (supportResolveBtn) {
				openSupportTicket(supportResolveBtn.getAttribute("data-support-resolve"), true);
				return;
			}
			const eventBtn = event.target.closest("[data-event-key]");
			if (eventBtn) {
				const key = eventBtn.getAttribute("data-event-key");
				const select = document.getElementById("adminEventFilter");
				if (select && key) {
					select.value = key;
					persistEventFilter(key);
					applySection(window.__adminData);
				}
			}
		});
		document.getElementById("closeAnswersModal")?.addEventListener("click", () => {
			document.getElementById("answersModal").hidden = true;
		});
		document.getElementById("closeQrModal")?.addEventListener("click", () => {
			document.getElementById("qrModal").hidden = true;
		});
		document.getElementById("closeSupportModal")?.addEventListener("click", () => {
			document.getElementById("supportModal").hidden = true;
		});
		document.getElementById("supportResolveBtn")?.addEventListener("click", (event) => {
			const btn = event.currentTarget;
			const code = btn && btn.dataset ? btn.dataset.code : "";
			if (code) resolveSupportTicket(code, btn);
		});
		document.getElementById("answersModal")?.addEventListener("click", (event) => {
			if (event.target.id === "answersModal") event.currentTarget.hidden = true;
		});
		document.getElementById("qrModal")?.addEventListener("click", (event) => {
			if (event.target.id === "qrModal") event.currentTarget.hidden = true;
		});
		document.getElementById("supportModal")?.addEventListener("click", (event) => {
			if (event.target.id === "supportModal") event.currentTarget.hidden = true;
		});
		await refresh();
	});
})();
