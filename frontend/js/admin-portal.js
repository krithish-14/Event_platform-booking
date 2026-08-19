(() => {
	"use strict";

	function apiBase() {
		if (window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		const host = (window.location.hostname && window.location.hostname !== "localhost") ? window.location.hostname : "127.0.0.1";
		return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;
	}

	function token() {
		return window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));
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

	function formatWhen(iso) {
		if (!iso) return "—";
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "—";
		return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
	}

	async function requireAdmin() {
		const current = user();
		if (!token() || !current) {
			window.location.href = "login.html";
			return null;
		}
		try {
			const res = await fetch(`${apiBase()}/api/admin/me`, {
				headers: { Authorization: `Bearer ${token()}` },
			});
			if (!res.ok) {
				window.location.href = "login.html";
				return null;
			}
			const me = await res.json();
			const label = document.getElementById("adminUserLabel");
			if (label) label.textContent = me.email || current.email || "Admin";
			return me;
		} catch (_) {
			window.location.href = "login.html";
			return null;
		}
	}

	async function loadRows(query) {
		const qs = query ? `?q=${encodeURIComponent(query)}` : "";
		const res = await fetch(`${apiBase()}/api/admin/submissions${qs}`, {
			headers: { Authorization: `Bearer ${token()}` },
		});
		if (res.status === 401 || res.status === 403) {
			window.location.href = "login.html";
			return null;
		}
		if (!res.ok) throw new Error("Could not load submissions.");
		return res.json();
	}

	function rowHtml(row, options) {
		const ready = Boolean(row.has_qr);
		const kind = row.kind || "form";
		const recordId = row.id || row.submission_id;
		const showGenerate = Boolean(options && options.showGenerate);
		const generateLabel = ready ? "Resend QR" : "Generate QR";
		return `<tr data-id="${recordId}" data-kind="${escapeHtml(kind)}">
			<td>
				<div class="admin-name">${escapeHtml(row.attendee_name)}</div>
				<div class="admin-muted">${escapeHtml(row.user_email)}</div>
				<div class="admin-muted">${escapeHtml(row.attendee_phone || "No phone")}</div>
			</td>
			<td>
				<div>${escapeHtml(row.event_title)}</div>
				<div class="admin-muted">${escapeHtml(row.event_venue || "")}</div>
			</td>
			<td>
				<div>${escapeHtml(row.ticket_type || "Ticket")}</div>
				<div class="admin-muted">₹${Number(row.ticket_price || 0).toLocaleString("en-IN")}</div>
				${row.transaction_id ? `<div class="admin-muted">Txn ${escapeHtml(row.transaction_id)}</div>` : ""}
			</td>
			<td>${escapeHtml(formatWhen(row.submitted_at))}</td>
			<td><span class="admin-badge ${ready ? "ready" : "pending"}">${ready ? "QR ready" : "Needs QR"}</span></td>
			<td>
				<div class="admin-actions">
					${showGenerate ? `<button type="button" class="admin-btn" data-kind="${escapeHtml(kind)}" data-generate="${recordId}">${generateLabel}</button>` : ""}
					<button type="button" class="admin-btn ghost" data-kind="${escapeHtml(kind)}" data-answers="${recordId}">View form</button>
				</div>
			</td>
		</tr>`;
	}

	function currentSection() {
		const select = document.getElementById("adminSection");
		return select && select.value === "payment" ? "payment" : "host";
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

	function applySection(data) {
		const payload = data || window.__adminData || { submissions: [] };
		const rows = payload.submissions || [];
		const hostRows = rows.filter((row) => (row.kind || "form") !== "payment");
		const payRows = rows.filter((row) => row.kind === "payment");
		const isPayment = currentSection() === "payment";
		const visible = isPayment ? payRows : hostRows;
		const setText = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = String(value);
		};
		setText("statHost", hostRows.length);
		setText("statPay", payRows.length);
		setText("statPending", payload.pending_qr || 0);
		setText("statReady", payload.qr_ready || 0);
		setText("sectionCount", visible.length);
		const title = document.getElementById("adminSectionTitle");
		const copy = document.getElementById("adminSectionCopy");
		const hint = document.getElementById("adminSectionHint");
		const ticketCol = document.getElementById("ticketCol");
		if (isPayment) {
			if (title) title.textContent = "Payment forms";
			if (copy) copy.textContent = "UPI payment details and screenshot. Use Generate QR after you verify the payment.";
			if (hint) hint.textContent = "Attendees scan the UPI QR, submit payment details, then you generate their ticket QR.";
			if (ticketCol) ticketCol.textContent = "Ticket / Txn";
			fillTable(visible, "No payment forms yet.", { showGenerate: true });
		} else {
			if (title) title.textContent = "Host form";
			if (copy) copy.textContent = "Registered details from the event host form.";
			if (hint) hint.textContent = "People who submitted the event host registration form.";
			if (ticketCol) ticketCol.textContent = "Ticket";
			fillTable(visible, "No host form registrations yet.", { showGenerate: false });
		}
		window.__adminRows = visible;
		window.__adminData = payload;
	}

	function renderRows(data) {
		applySection(data);
	}

	function findRow(id, kind) {
		return (window.__adminRows || []).find((item) => {
			const itemId = String(item.id || item.submission_id);
			const itemKind = item.kind || "form";
			return itemId === String(id) && itemKind === String(kind || itemKind);
		});
	}

	function mediaUrl(path) {
		if (!path) return "";
		if (/^https?:\/\//i.test(path)) return path;
		return `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
	}

	async function openAnswers(id, kind) {
		const row = findRow(id, kind);
		const modal = document.getElementById("answersModal");
		const body = document.getElementById("answersBody");
		if (!row || !modal || !body) return;
		const answers = row.answers || {};
		const keys = Object.keys(answers);
		const shot = row.screenshot_url || answers.Screenshot;
		body.innerHTML = (keys.length
			? keys.filter((key) => String(key).toLowerCase() !== "screenshot").map((key) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof answers[key] === "object" ? JSON.stringify(answers[key]) : answers[key])}</dd>`).join("")
			: "<p>No extra answers stored.</p>") +
			(shot ? `<dt>Screenshot</dt><dd><img id="proofShot" alt="Payment screenshot" style="max-width:100%;border-radius:10px;margin-top:0.4rem;display:none;" /></dd>` : "");
		modal.hidden = false;
		if (!shot) return;
		try {
			const res = await fetch(mediaUrl(shot), { headers: { Authorization: `Bearer ${token()}` } });
			if (!res.ok) return;
			const blob = await res.blob();
			const img = body.querySelector("#proofShot");
			if (img) {
				img.src = URL.createObjectURL(blob);
				img.style.display = "block";
			}
		} catch (_) {}
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
			btn.textContent = "Generating…";
		}
		try {
			const path = kind === "payment"
				? `/api/admin/payments/${id}/generate-qr`
				: `/api/admin/submissions/${id}/generate-qr`;
			const res = await fetch(`${apiBase()}${path}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token()}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ resend: true }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				alert(data.detail || "Could not generate QR.");
				return;
			}
			showQrResult(data);
			await refresh();
			if (data.delivery && data.delivery.whatsapp_url && !data.delivery.whatsapp_sent) {
				window.open(data.delivery.whatsapp_url, "_blank", "noopener");
			}
		} catch (err) {
			alert("Could not generate QR. Check that the backend is running.");
		} finally {
			if (btn) {
				btn.disabled = false;
				if (!btn.isConnected) return;
				btn.textContent = btn.getAttribute("data-generate") && btn.closest("tr")?.querySelector(".admin-badge.ready")
					? "Resend QR"
					: "Generate QR";
			}
		}
	}

	async function refresh() {
		const query = (document.getElementById("adminSearch") || {}).value || "";
		try {
			const data = await loadRows(query.trim());
			if (data) renderRows(data);
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
		document.getElementById("adminLogout")?.addEventListener("click", async () => {
			if (window.JodAuth && typeof window.JodAuth.logout === "function") {
				await window.JodAuth.logout();
			}
			window.location.href = "login.html";
		});
		document.getElementById("adminRefresh")?.addEventListener("click", refresh);
		document.getElementById("adminSection")?.addEventListener("change", () => {
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
			if (answersBtn) openAnswers(answersBtn.getAttribute("data-answers"), answersBtn.getAttribute("data-kind") || "form");
		});
		document.getElementById("closeAnswersModal")?.addEventListener("click", () => {
			document.getElementById("answersModal").hidden = true;
		});
		document.getElementById("closeQrModal")?.addEventListener("click", () => {
			document.getElementById("qrModal").hidden = true;
		});
		document.getElementById("answersModal")?.addEventListener("click", (event) => {
			if (event.target.id === "answersModal") event.currentTarget.hidden = true;
		});
		document.getElementById("qrModal")?.addEventListener("click", (event) => {
			if (event.target.id === "qrModal") event.currentTarget.hidden = true;
		});
		await refresh();
	});
})();
