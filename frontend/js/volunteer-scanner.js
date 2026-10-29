(function initVolunteerScanner() {
	"use strict";

	const V = window.JodVolunteer;
	if (!V) return;

	V.getPortalToken();

	const portalLink = document.getElementById("portalLink");
	if (portalLink) portalLink.href = V.portalUrl();
	const brandLink = document.getElementById("brandLink");
	if (brandLink) brandLink.href = V.portalUrl();

	const eventTitleEl = document.getElementById("eventTitle");
	const roleLabelEl = document.getElementById("roleLabel");
	const scannerStatus = document.getElementById("scannerStatus");
	const todayCountEl = document.getElementById("todayCount");
	const resultCard = document.getElementById("resultCard");
	const resultEl = document.getElementById("scanResult");
	const cameraCard = document.getElementById("cameraCard");
	const cameraWrap = document.getElementById("cameraWrap");
	const cameraFallback = document.getElementById("cameraFallback");
	const camHint = document.getElementById("camHint");
	const scanRing = document.getElementById("scanRing");
	const video = document.getElementById("scannerVideo");
	const ticketInput = document.getElementById("ticketCodeInput");
	const btnVerify = document.getElementById("btnVerifyCode");
	const btnBack = document.getElementById("btnBackToScanner");

	let assignment = null;
	let isProcessingToken = false;
	let lastToken = "";
	let lastTokenAt = 0;
	let videoStream = null;
	let isScanningActive = false;
	let resultTimeout = null;

	// ── helpers ──────────────────────────────────────────────────────────────

	function setTodayCount(n) {
 if (todayCountEl) todayCountEl.textContent = String(Number(n || 0));
	}

	function pulse(on) {
 if (!scanRing) return;
 if (on) scanRing.classList.add("is-pulsing");
 else scanRing.classList.remove("is-pulsing");
	}

	function setHint(text) {
 if (camHint) camHint.textContent = text;
	}

	// ── camera ───────────────────────────────────────────────────────────────

	function processScanFrame() {
 if (!isScanningActive || !video) return;
 if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessingToken && typeof jsQR !== "undefined") {
 const canvas = document.createElement("canvas");
 canvas.width = video.videoWidth;
 canvas.height = video.videoHeight;
 const ctx = canvas.getContext("2d");
 ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
 const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
 const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
 if (code && code.data) {
 verifyTicket(code.data.trim(), "QR");
 }
 }
 if (isScanningActive) requestAnimationFrame(processScanFrame);
	}

	async function startCamera() {
 if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
 if (cameraFallback) cameraFallback.style.display = "block";
 if (cameraCard) cameraCard.style.display = "block";
 return;
 }
 // stop any existing stream first
 if (videoStream) {
 videoStream.getTracks().forEach((t) => t.stop());
 videoStream = null;
 }
 isScanningActive = false;
 if (video) video.srcObject = null;

 try {
 videoStream = await navigator.mediaDevices.getUserMedia({
 video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
 audio: false
 });
 if (cameraFallback) cameraFallback.style.display = "none";
 if (cameraWrap) cameraWrap.classList.add("is-open");
 video.srcObject = videoStream;
 await video.play();
 isScanningActive = true;
 setHint("Point camera at a QR code");
 requestAnimationFrame(processScanFrame);
 } catch (err) {
 console.warn("Camera unavailable:", err);
 if (cameraFallback) cameraFallback.style.display = "block";
 if (cameraWrap) cameraWrap.classList.remove("is-open");
 }
	}

	function pauseCamera() {
 isScanningActive = false;
	}

	function resumeCamera() {
 if (videoStream && video) {
 isScanningActive = true;
 setHint("Point camera at a QR code");
 requestAnimationFrame(processScanFrame);
 } else {
 startCamera();
 }
	}

	function stopCamera() {
 isScanningActive = false;
 if (videoStream) {
 videoStream.getTracks().forEach((t) => t.stop());
 videoStream = null;
 }
 if (video) video.srcObject = null;
 if (cameraWrap) cameraWrap.classList.remove("is-open");
	}

	// ── result display ───────────────────────────────────────────────────────

	function showResult(kind, html) {
 if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }

 // swap views: hide camera, show result
 if (cameraCard) cameraCard.style.display = "none";
 pauseCamera();
 pulse(false);

 if (resultEl) {
 resultEl.className = `vol-result is-visible ${kind}`;
 resultEl.innerHTML = html;
 }
 if (resultCard) resultCard.style.display = "block";

 // auto-dismiss and return to scanner after 8 s (for "ok" results only)
 if (kind === "ok") {
 resultTimeout = setTimeout(() => returnToScanner(), 8000);
 }
	}

	function returnToScanner() {
 if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
 isProcessingToken = false;
 lastToken = "";
 if (resultCard) resultCard.style.display = "none";
 if (cameraCard) cameraCard.style.display = "block";
 if (ticketInput) ticketInput.value = "";
 resumeCamera();
	}

	// ── session picker (multi-session events) ─────────────────────────────────

	let sessionWrap = null;

	function assignmentSessions() {
 return (assignment && Array.isArray(assignment.sessions)) ? assignment.sessions : [];
	}

	function sessionStoreKey() {
 return "jod_vol_session_" + ((assignment && assignment.event_id) || "");
	}

	function selectedSessionId() {
 const sel = document.getElementById("volSessionSelect");
 return (sel && sel.value) || "";
	}

	function selectedSession() {
 const id = selectedSessionId();
 return assignmentSessions().find((s) => s.session_id === id) || null;
	}

	function paintSessionInfo() {
 const info = document.getElementById("volSessionInfo");
 if (!info) return;
 const s = selectedSession();
 if (!s) {
 info.textContent = assignmentSessions().length > 1 ? "Pick the session you are checking attendees in to." : "";
 return;
 }
 const windowNote = s.checkin_window && s.checkin_window !== "open"
 ? ` · <span class="vol-session-warn">${V.escapeHtml(String(s.checkin_window).replace("_", " "))}</span>`
 : "";
 info.innerHTML = `<strong>${V.escapeHtml(s.session_name)}</strong><br/>${V.escapeHtml(s.session_date || "")} · ${V.escapeHtml(s.time_label || "")} · ${V.escapeHtml(s.venue_name || "")}<br/>Eligible ${Number(s.eligible_count || 0)} · Checked in <span id="volSessionChecked">${Number(s.checked_in_count || 0)}</span>${windowNote}`;
	}

	function renderSessionPicker() {
 const list = assignmentSessions();
 if (!sessionWrap && cameraCard && cameraCard.parentNode) {
 sessionWrap = document.createElement("div");
 sessionWrap.className = "vol-session";
 sessionWrap.innerHTML = '<label for="volSessionSelect">Checking in to</label><select id="volSessionSelect"></select><div class="vol-session-info" id="volSessionInfo"></div>';
 cameraCard.parentNode.insertBefore(sessionWrap, cameraCard);
 sessionWrap.querySelector("select").addEventListener("change", (e) => {
 try { sessionStorage.setItem(sessionStoreKey(), e.target.value || ""); } catch (_) {}
 paintSessionInfo();
 });
 }
 if (!sessionWrap) return;
 sessionWrap.hidden = list.length === 0;
 const sel = sessionWrap.querySelector("select");
 let stored = "";
 try { stored = sessionStorage.getItem(sessionStoreKey()) || ""; } catch (_) {}
 const current = sel.value || stored;
 sel.innerHTML = (list.length > 1 ? '<option value="">Select a session…</option>' : "") + list.map((s) =>
 `<option value="${V.escapeHtml(s.session_id)}">${V.escapeHtml(s.session_name)} · ${V.escapeHtml(s.time_label || "")}</option>`
 ).join("");
 if (current && list.some((s) => s.session_id === current)) sel.value = current;
 paintSessionInfo();
	}

	// ── ticket verification ───────────────────────────────────────────────────

	const SESSION_HOLD_CODES = new Set(["SESSION_REQUIRED", "SESSION_NOT_OPEN", "SESSION_NOT_ACTIVE", "SESSION_FULL"]);

	function renderVerifyResult(data) {
 const errorCode = String((data && data.error_code) || "").toUpperCase();
 const sessionName = V.escapeHtml((data && data.session_name) || "");
 const sessionRow = sessionName ? `<div class="res-row"><span>Session</span><strong>${sessionName}</strong></div>` : "";
 if (SESSION_HOLD_CODES.has(errorCode)) {
 showResult("hold", `
 <div class="res-icon">!</div>
 <h3>SESSION NOT ACCEPTING CHECK-INS</h3>
 ${sessionRow}
 <p>${V.escapeHtml(data.message || "This session is not accepting check-ins right now.")}</p>
 `);
 return;
 }
 if (errorCode === "SESSION_NOT_ELIGIBLE") {
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>NOT REGISTERED FOR THIS SESSION</h3>
 ${sessionRow}
 <p class="res-name">${V.escapeHtml((data && (data.customer_name || data.attendee_name)) || "Guest")}</p>
 <p>This attendee is not registered for this session. Do not admit.</p>
 `);
 return;
 }
 if (errorCode === "SESSION_NOT_AUTHORIZED" || errorCode === "SESSION_NOT_FOUND") {
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>SESSION NOT AVAILABLE</h3>
 <p>${V.escapeHtml(data.message || "You cannot check in attendees for this session.")}</p>
 `);
 return;
 }
 const statusCode = String((data && data.status) || "").toUpperCase();
 const name = V.escapeHtml((data && (data.customer_name || data.attendee_name)) || "Guest");
 const bookingRef = V.escapeHtml((data && (data.booking_ref || data.ticket_code)) || "");
 const ticketId = V.escapeHtml((data && data.ticket_id) || "");
 const category = V.escapeHtml((data && data.ticket_type) || "");
 const verifiedBy = V.escapeHtml((data && (data.verified_by || data.scanned_by)) || "");
 const when = V.escapeHtml(
 V.formatTime(data && data.used_at) ||
 new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
 );

 if (data && data.valid) {
 if (typeof data.today_checkins === "number") {
 setTodayCount(data.today_checkins);
 } else {
 setTodayCount(Number(todayCountEl ? todayCountEl.textContent : 0) + 1);
 }
 const picked = selectedSession();
 if (picked && data.session_id === picked.session_id) {
 picked.checked_in_count = Number(picked.checked_in_count || 0) + 1;
 paintSessionInfo();
 }
 showResult("ok", `
 <div class="res-icon">✓</div>
 <h3>NEW CHECK-IN</h3>
 <p class="res-name">${name}</p>
 ${sessionRow}
 ${ticketId ? `<div class="res-row"><span>Ticket ID</span><strong>${ticketId}</strong></div>` : ""}
 ${bookingRef ? `<div class="res-row"><span>Booking ID</span><strong>${bookingRef}</strong></div>` : ""}
 ${category ? `<div class="res-row"><span>Category</span><strong>${category}</strong></div>` : ""}
 <div class="res-row"><span>Checked in at</span><strong>${when}</strong></div>
 ${verifiedBy ? `<div class="res-row"><span>Verified by</span><strong>${verifiedBy}</strong></div>` : ""}
 <p class="res-auto">Returning to scanner automatically…</p>
 `);
 return;
 }

 if (statusCode === "ALREADY_USED" || statusCode === "DUPLICATE" || statusCode === "ALREADY_CHECKED_IN" || (data && (data.duplicate || data.already_checked_in))) {
 showResult(sessionName ? "bad" : "warn", `
 <div class="res-icon">⚠</div>
 <h3>${sessionName ? "ALREADY CHECKED IN TO THIS SESSION" : "DUPLICATE CHECK-IN"}</h3>
 <p class="res-name">${name}</p>
 ${sessionRow}
 ${ticketId ? `<div class="res-row"><span>Ticket ID</span><strong>${ticketId}</strong></div>` : ""}
 ${bookingRef ? `<div class="res-row"><span>Booking ID</span><strong>${bookingRef}</strong></div>` : ""}
 <div class="res-row"><span>Checked in at</span><strong>${when}</strong></div>
 ${verifiedBy ? `<div class="res-row"><span>Scanned by</span><strong>${verifiedBy}</strong></div>` : ""}
 <p class="res-auto">This ticket was already used. Do not admit again.</p>
 `);
 return;
 }

 if (statusCode === "WRONG_EVENT") {
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>WRONG EVENT</h3>
 <p>This ticket belongs to a different event.</p>
 `);
 return;
 }

 if (statusCode === "CANCELLED") {
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>TICKET NOT VALID</h3>
 <p>This ticket has been cancelled or refunded.</p>
 `);
 return;
 }

 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>INVALID TICKET</h3>
 <p>${V.escapeHtml((data && data.message) || "This ticket could not be verified.")}</p>
 `);
	}

	async function verifyTicket(tokenStr, method) {
 const token = String(tokenStr || "").trim();
 if (!token || !assignment) return;
 const now = Date.now();
 if (isProcessingToken) return;
 if (token === lastToken && now - lastTokenAt < 2500) return;

 isProcessingToken = true;
 lastToken = token;
 lastTokenAt = now;

 if (assignmentSessions().length > 1 && !selectedSessionId()) {
 isProcessingToken = false;
 showResult("hold", `
 <div class="res-icon">!</div>
 <h3>SELECT A SESSION</h3>
 <p>Pick the session you are checking attendees in to, then scan again.</p>
 `);
 return;
 }

 pulse(true);
 setHint("Verifying…");

 try {
 const { ok, status, data } = await V.verifyPortalTicket({
 token,
 qr_token: token,
 method: method || "TICKET_CODE",
 session_id: selectedSessionId() || undefined
 });
 pulse(false);

 if (status === 403 || status === 410) {
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>Access Denied</h3>
 <p>${V.escapeHtml(V.apiError(data, "Your volunteer access is no longer active."))}.</p>
 `);
 return;
 }
 if (!ok && !data.status) {
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>Could Not Verify</h3>
 <p>${V.escapeHtml(V.apiError(data, "A server error occurred. Try again."))}.</p>
 `);
 return;
 }
 renderVerifyResult(data);
 } catch (err) {
 pulse(false);
 showResult("bad", `
 <div class="res-icon">✕</div>
 <h3>Network Error</h3>
 <p>Check your connection and try again.</p>
 `);
 } finally {
 setTimeout(() => { isProcessingToken = false; }, 1200);
 }
	}

	// ── button listeners ──────────────────────────────────────────────────────

	btnBack?.addEventListener("click", returnToScanner);

	btnVerify?.addEventListener("click", () => {
 const value = ticketInput ? ticketInput.value.trim() : "";
 if (!value) { ticketInput?.focus(); return; }
 verifyTicket(value, "TICKET_CODE");
	});

	ticketInput?.addEventListener("keydown", (e) => {
 if (e.key === "Enter") btnVerify?.click();
	});

	window.addEventListener("pagehide", stopCamera);

	function applyAssignment(data) {
 assignment = data || assignment;
 if (!assignment) return;
 if (eventTitleEl) eventTitleEl.textContent = assignment.event_title || "Event";
 if (roleLabelEl) {
 roleLabelEl.textContent = assignment.gate_name
 ? `${assignment.role || "Scanner Volunteer"} · ${assignment.gate_name}`
 : (assignment.role || "Scanner Volunteer");
 }
 if (scannerStatus) scannerStatus.textContent = assignment.volunteer_name
 ? `${assignment.volunteer_name} · Ready to scan`
 : "Ready to scan";
 setTodayCount(assignment.today_checkins || 0);
 renderSessionPicker();
	}

	async function loadAssignment() {
 const { ok, status, data } = await V.fetchPortal();
 if (!ok) {
 if (eventTitleEl) eventTitleEl.textContent = status === 410 ? "Access unavailable" : "Volunteer link required";
 if (scannerStatus) scannerStatus.textContent = V.apiError(data, "Open the volunteer link from your invitation email.");
 if (cameraCard) cameraCard.style.display = "none";
 return false;
 }
 let payload = data;
 if (payload && payload.needs_accept && typeof V.acceptPortal === "function") {
 const accepted = await V.acceptPortal();
 if (accepted.ok) payload = accepted.data;
 }
 applyAssignment(payload);
 return true;
	}

	let started = false;
	let startPromise = null;

	async function start(assignmentData) {
 if (started) {
 if (assignmentData) applyAssignment(assignmentData);
 await startCamera();
 return;
 }
 if (startPromise) return startPromise;
 startPromise = (async () => {
 started = true;
 try {
 if (assignmentData) {
 applyAssignment(assignmentData);
 } else {
 const ok = await loadAssignment();
 if (!ok) return;
 }
 await startCamera();
 } catch (err) {
 console.warn(err);
 if (eventTitleEl) eventTitleEl.textContent = "Could not load scanner";
 if (scannerStatus) scannerStatus.textContent = "A network or server error occurred.";
 }
 })();
 return startPromise;
	}

	window.JodVolunteerScanner = { start, stop: stopCamera };

	if (!document.body || !document.body.hasAttribute("data-defer-scanner")) {
 start();
	}
})();
