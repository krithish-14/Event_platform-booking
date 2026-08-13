/**
 * JOD Events — Staff QR Ticket Scanner & Entry Controller
 * Handles camera stream, QR token extraction via jsQR, backend verification & atomic check-in APIs.
 */

(function initScannerApp() {
	"use strict";

	let isCheckinMode = true; // true = Scan & Check-in, false = Verify Only
	let videoStream = null;
	let currentFacingMode = "environment"; // "user" or "environment"
	let isScanningActive = false;
	let isProcessingToken = false;
	let scanSessionHistory = [];

	function getApiBase() {
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		const host = (window.location && window.location.hostname && window.location.hostname !== "localhost") ? window.location.hostname : "127.0.0.1";
		return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;
	}

	function playAudioBeep(type) {
		try {
			const ctx = new (window.AudioContext || window.webkitAudioContext)();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);

			if (type === "success") {
				osc.type = "sine";
				osc.frequency.setValueAtTime(880, ctx.currentTime);
				osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
				gain.gain.setValueAtTime(0.3, ctx.currentTime);
				gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
				osc.start(ctx.currentTime);
				osc.stop(ctx.currentTime + 0.25);
			} else {
				osc.type = "sawtooth";
				osc.frequency.setValueAtTime(220, ctx.currentTime);
				osc.frequency.setValueAtTime(180, ctx.currentTime + 0.15);
				gain.gain.setValueAtTime(0.4, ctx.currentTime);
				gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
				osc.start(ctx.currentTime);
				osc.stop(ctx.currentTime + 0.35);
			}
		} catch (_) {}
	}

	async function startCamera() {
		const video = document.getElementById("scannerVideo");
		if (!video) return;

		if (videoStream) {
			stopCamera();
		}

		try {
			const constraints = {
				video: {
					facingMode: currentFacingMode,
					width: { ideal: 1280 },
					height: { ideal: 720 }
				}
			};
			videoStream = await navigator.mediaDevices.getUserMedia(constraints);
			video.srcObject = videoStream;
			await video.play();
			isScanningActive = true;
			requestAnimationFrame(processScanFrame);
		} catch (err) {
			console.warn("Camera start warning:", err);
			alert("Camera access notice: Could not start camera stream. You can use the manual token input field below to verify tickets.");
		}
	}

	function stopCamera() {
		isScanningActive = false;
		if (videoStream) {
			videoStream.getTracks().forEach(track => track.stop());
			videoStream = null;
		}
	}

	function processScanFrame() {
		if (!isScanningActive) return;

		const video = document.getElementById("scannerVideo");
		if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
			if (!isProcessingToken) {
				const canvas = document.createElement("canvas");
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

				const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
				if (typeof jsQR !== "undefined") {
					const code = jsQR(imageData.data, imageData.width, imageData.height, {
						inversionAttempts: "dontInvert"
					});
					if (code && code.data) {
						const rawToken = code.data.trim();
						if (rawToken.startsWith("JOD-TKT-") || rawToken.startsWith("JOD-")) {
							handleScannedToken(rawToken);
						}
					}
				}
			}
		}

		if (isScanningActive) {
			requestAnimationFrame(processScanFrame);
		}
	}

	async function handleScannedToken(tokenStr) {
		if (isProcessingToken || !tokenStr) return;
		isProcessingToken = true;

		const apiBase = getApiBase();
		const authToken = window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));
		const staffUser = window.JodAuth ? window.JodAuth.getUser() : null;
		const staffName = staffUser ? (staffUser.full_name || staffUser.username) : "Gate Scanner Staff";

		const endpoint = isCheckinMode ? `${apiBase}/api/tickets/checkin` : `${apiBase}/api/tickets/verify`;

		try {
			const headers = { "Content-Type": "application/json" };
			if (authToken) {
				headers["Authorization"] = `Bearer ${authToken}`;
			}

			const res = await fetch(endpoint, {
				method: "POST",
				headers: headers,
				body: JSON.stringify({
					qr_token: tokenStr,
					scanned_by: staffName
				})
			});

			const data = await res.json();
			renderResultBanner(data, tokenStr);
			addScanHistoryItem(data, tokenStr);

		} catch (err) {
			renderResultBanner({
				valid: false,
				status: "INVALID",
				message: `Network error verifying ticket token (${err.message}).`
			}, tokenStr);
		}
	}

	function renderResultBanner(res, tokenStr) {
		const banner = document.getElementById("resultBanner");
		const titleEl = document.getElementById("resultStatusTitle");
		const tagEl = document.getElementById("resultBadgeTag");
		const msgEl = document.getElementById("resultMessageText");

		const resEvent = document.getElementById("resEvent");
		const resCustomer = document.getElementById("resCustomer");
		const resCategory = document.getElementById("resCategory");
		const resSeat = document.getElementById("resSeat");
		const resToken = document.getElementById("resToken");
		const resTime = document.getElementById("resTime");

		if (!banner) return;
		banner.style.display = "block";

		const nowStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

		if (res.valid && (res.status === "VALID" || res.status === "USED")) {
			playAudioBeep("success");
			banner.className = "result-banner result-valid";
			titleEl.textContent = isCheckinMode ? "✅ ENTRY ALLOWED" : "✅ VALID TICKET";
			tagEl.textContent = isCheckinMode ? "CHECK-IN SUCCESS" : "VALID";
			tagEl.className = "badge-mini badge-mini-valid";
			msgEl.textContent = res.message || "Ticket successfully verified for venue entry.";
		} else if (res.status === "ALREADY_USED") {
			playAudioBeep("error");
			banner.className = "result-banner result-used";
			titleEl.textContent = "⚠️ TICKET ALREADY USED";
			tagEl.textContent = "ALREADY CHECKED IN";
			tagEl.className = "badge-mini badge-mini-used";
			msgEl.textContent = res.message || "This ticket has already passed gate check-in earlier!";
		} else {
			playAudioBeep("error");
			banner.className = "result-banner result-invalid";
			titleEl.textContent = "❌ INVALID TICKET";
			tagEl.textContent = res.status || "DENIED";
			tagEl.className = "badge-mini badge-mini-invalid";
			msgEl.textContent = res.message || "Ticket token is invalid or cancelled.";
		}

		if (resEvent) resEvent.textContent = res.event || "--";
		if (resCustomer) resCustomer.textContent = res.customer_name || "--";
		if (resCategory) resCategory.textContent = res.ticket_type || "--";
		if (resSeat) resSeat.textContent = res.seat || "--";
		if (resToken) resToken.textContent = tokenStr;
		if (resTime) resTime.textContent = nowStr;

		banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	function addScanHistoryItem(res, tokenStr) {
		const container = document.getElementById("scanHistoryContainer");
		if (!container) return;

		const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		let badgeClass = "badge-mini-valid";
		let badgeLabel = "VALID";

		if (!res.valid) {
			if (res.status === "ALREADY_USED") {
				badgeClass = "badge-mini-used";
				badgeLabel = "USED";
			} else {
				badgeClass = "badge-mini-invalid";
				badgeLabel = "INVALID";
			}
		}

		const itemHtml = `
			<div class="history-item">
				<div>
					<div style="font-weight: 700; color: #fff;">${res.event || 'Ticket Scan'} &bull; ${res.customer_name || 'Guest'}</div>
					<div style="font-size: 0.75rem; color: #9ca3af; font-family: monospace; margin-top: 0.15rem;">${tokenStr}</div>
				</div>
				<div style="text-align: right;">
					<span class="badge-mini ${badgeClass}">${badgeLabel}</span>
					<div style="font-size: 0.75rem; color: #6b7280; margin-top: 0.2rem;">${timeStr}</div>
				</div>
			</div>`;

		if (scanSessionHistory.length === 0) {
			container.innerHTML = itemHtml;
		} else {
			container.insertAdjacentHTML("afterbegin", itemHtml);
		}
		scanSessionHistory.unshift({ res, tokenStr });
	}

	function bindUIEvents() {
		const btnModeCheckin = document.getElementById("btnModeCheckin");
		const btnModeVerify = document.getElementById("btnModeVerify");
		const btnStartCamera = document.getElementById("btnStartCamera");
		const btnSwitchCamera = document.getElementById("btnSwitchCamera");
		const btnSubmitManual = document.getElementById("btnSubmitManualToken");
		const manualInput = document.getElementById("manualTokenInput");
		const btnScanNext = document.getElementById("btnScanNext");

		btnModeCheckin?.addEventListener("click", () => {
			isCheckinMode = true;
			btnModeCheckin.classList.add("active");
			btnModeVerify.classList.remove("active");
		});

		btnModeVerify?.addEventListener("click", () => {
			isCheckinMode = false;
			btnModeVerify.classList.add("active");
			btnModeCheckin.classList.remove("active");
		});

		btnStartCamera?.addEventListener("click", () => {
			startCamera();
		});

		btnSwitchCamera?.addEventListener("click", () => {
			currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
			startCamera();
		});

		btnSubmitManual?.addEventListener("click", () => {
			const tok = manualInput ? manualInput.value.trim() : "";
			if (tok) {
				handleScannedToken(tok);
			} else {
				alert("Please enter a valid JOD-TKT-... token code.");
			}
		});

		manualInput?.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				btnSubmitManual?.click();
			}
		});

		btnScanNext?.addEventListener("click", () => {
			isProcessingToken = false;
			const banner = document.getElementById("resultBanner");
			if (banner) banner.style.display = "none";
			if (manualInput) manualInput.value = "";
		});
	}

	document.addEventListener("DOMContentLoaded", () => {
		bindUIEvents();
		// Auto-start camera if available
		startCamera();
	});

})();
