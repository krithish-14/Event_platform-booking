(function initVolunteerScanner() {
	"use strict";

	const V = window.JodVolunteer;
	if (!V) return;

	V.getPortalToken();

	const portalLink = document.getElementById("portalLink");
	if (portalLink) portalLink.href = V.portalUrl();
	const brandLink = document.getElementById("brandLink");
	if (brandLink) brandLink.href = V.portalUrl();

	const eventTitleEl  = document.getElementById("eventTitle");
	const roleLabelEl   = document.getElementById("roleLabel");
	const scannerStatus = document.getElementById("scannerStatus");
	const todayCountEl  = document.getElementById("todayCount");
	const resultCard    = document.getElementById("resultCard");
	const resultEl      = document.getElementById("scanResult");
	const cameraCard    = document.getElementById("cameraCard");
	const cameraWrap    = document.getElementById("cameraWrap");
	const cameraFallback = document.getElementById("cameraFallback");
	const camHint       = document.getElementById("camHint");
	const scanRing      = document.getElementById("scanRing");
	const video         = document.getElementById("scannerVideo");
	const ticketInput   = document.getElementById("ticketCodeInput");
	const btnVerify     = document.getElementById("btnVerifyCode");
	const btnBack       = document.getElementById("btnBackToScanner");

	let assignment        = null;
	let isProcessingToken = false;
	let lastToken         = "";
	let lastTokenAt       = 0;
	let videoStream       = null;
	let isScanningActive  = false;
	let resultTimeout     = null;

	// ── helpers ──────────────────────────────────────────────────────────────

	function setTodayCount(n) {
		if (todayCountEl) todayCountEl.textContent = String(Number(n || 0));
	}

	function pulse(on) {
		if (!scanRing) return;
		if (on) scanRing.classList.add("is-pulsing");
		else     scanRing.classList.remove("is-pulsing");
	}

	function setHint(text) {
		if (camHint) camHint.textContent = text;
	}

	// ── camera ───────────────────────────────────────────────────────────────

	function processScanFrame() {
		if (!isScanningActive || !video) return;
		if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessingToken && typeof jsQR !== "undefined") {
			const canvas = document.createElement("canvas");
			canvas.width  = video.videoWidth;
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

	// ── ticket verification ───────────────────────────────────────────────────

	function renderVerifyResult(data) {
		const statusCode = String((data && data.status) || "").toUpperCase();
		const name       = V.escapeHtml((data && (data.customer_name || data.attendee_name)) || "Guest");
		const bookingRef = V.escapeHtml((data && (data.booking_ref || data.ticket_code)) || "");
		const category   = V.escapeHtml((data && data.ticket_type) || "");
		const verifiedBy = V.escapeHtml((data && (data.verified_by || data.scanned_by)) || "");
		const when       = V.escapeHtml(
			V.formatTime(data && data.used_at) ||
			new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
		);

		if (data && data.valid) {
			if (typeof data.today_checkins === "number") {
				setTodayCount(data.today_checkins);
			} else {
				setTodayCount(Number(todayCountEl ? todayCountEl.textContent : 0) + 1);
			}
			showResult("ok", `
				<div class="res-icon">✓</div>
				<h3>CHECK-IN SUCCESSFUL</h3>
				<p class="res-name">${name}</p>
				${bookingRef ? `<div class="res-row"><span>Booking ID</span><strong>${bookingRef}</strong></div>` : ""}
				${category ? `<div class="res-row"><span>Category</span><strong>${category}</strong></div>` : ""}
				<div class="res-row"><span>Checked in at</span><strong>${when}</strong></div>
				${verifiedBy ? `<div class="res-row"><span>Verified by</span><strong>${verifiedBy}</strong></div>` : ""}
				<p class="res-auto">Returning to scanner automatically…</p>
			`);
			return;
		}

		if (statusCode === "ALREADY_USED" || statusCode === "DUPLICATE" || (data && (data.duplicate || data.already_checked_in))) {
			showResult("warn", `
				<div class="res-icon">⚠</div>
				<h3>DUPLICATE</h3>
				<p class="res-name">${name}</p>
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
		lastToken    = token;
		lastTokenAt  = now;

		pulse(true);
		setHint("Verifying…");

		try {
			const { ok, status, data } = await V.verifyPortalTicket({
				token,
				qr_token: token,
				method: method || "TICKET_CODE"
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

	// ── load assignment then start camera ─────────────────────────────────────

	(async function loadAssignment() {
		const { ok, status, data } = await V.fetchPortal();
		if (!ok) {
			if (eventTitleEl) eventTitleEl.textContent = status === 410 ? "Access unavailable" : "Volunteer link required";
			if (scannerStatus) scannerStatus.textContent = V.apiError(data, "Open the volunteer link from your invitation email.");
			if (cameraCard) cameraCard.style.display = "none";
			return;
		}
		assignment = data;
		if (eventTitleEl) eventTitleEl.textContent = data.event_title || "Event";
		if (roleLabelEl) {
			roleLabelEl.textContent = data.gate_name
				? `${data.role || "Scanner Volunteer"} · ${data.gate_name}`
				: (data.role || "Scanner Volunteer");
		}
		if (scannerStatus) scannerStatus.textContent = data.volunteer_name
			? `${data.volunteer_name} · Ready to scan`
			: "Ready to scan";
		setTodayCount(data.today_checkins || 0);

		// auto-start camera
		await startCamera();
	})().catch((err) => {
		console.warn(err);
		if (eventTitleEl) eventTitleEl.textContent = "Could not load scanner";
		if (scannerStatus) scannerStatus.textContent = "A network or server error occurred.";
	});
})();
