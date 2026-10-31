/* Camera QR scanner: JodQrScanner.create(video, onCode) -> { start, stop, pause, resume, flip, running }.
 * Uses the browser's BarcodeDetector when it reads QR codes, otherwise jsQR (loaded on first start). */
(function (global) {
	"use strict";

	var JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
	var SCAN_EVERY_MS = 160;
	var REPEAT_AFTER_MS = 3000;
	var jsqrLoading = null;

	function loadJsQR() {
		if (global.jsQR) return Promise.resolve();
		if (!jsqrLoading) {
			jsqrLoading = new Promise(function (resolve, reject) {
				var s = document.createElement("script");
				s.src = JSQR_URL;
				s.async = true;
				s.onload = function () { resolve(); };
				s.onerror = function () {
					jsqrLoading = null;
					reject(new Error("Couldn't load the QR reader. Check the internet connection and try again."));
				};
				document.head.appendChild(s);
			});
		}
		return jsqrLoading;
	}

	async function makeDetector() {
		if (!("BarcodeDetector" in global)) return null;
		try {
			var formats = await global.BarcodeDetector.getSupportedFormats();
			return formats.indexOf("qr_code") !== -1 ? new global.BarcodeDetector({ formats: ["qr_code"] }) : null;
		} catch (_) {
			return null;
		}
	}

	function cameraError(err) {
		var name = err && err.name;
		if (name === "NotAllowedError" || name === "SecurityError") return new Error("Camera access is blocked. Allow the camera for this site in the browser's address bar, then try again.");
		if (name === "NotFoundError" || name === "OverconstrainedError") return new Error("No camera was found on this device. Type the booking code instead.");
		if (name === "NotReadableError") return new Error("The camera is being used by another app. Close it and try again.");
		return err instanceof Error ? err : new Error("Couldn't start the camera.");
	}

	function create(video, onCode) {
		var stream = null;
		var detector = null;
		var timer = null;
		var paused = false;
		var facing = "environment";
		var lastValue = "";
		var lastAt = 0;
		var canvas = document.createElement("canvas");
		var ctx = canvas.getContext("2d", { willReadFrequently: true });

		function emit(value) {
			var text = String(value || "").trim();
			if (!text) return;
			var now = Date.now();
			if (text === lastValue && now - lastAt < REPEAT_AFTER_MS) return;
			lastValue = text;
			lastAt = now;
			onCode(text);
		}

		async function scanOnce() {
			if (paused || !stream || video.readyState < 2 || !video.videoWidth) return;
			if (detector) {
				var found = await detector.detect(video);
				if (found && found[0]) emit(found[0].rawValue);
				return;
			}
			var scale = Math.min(1, 640 / video.videoWidth);
			canvas.width = Math.round(video.videoWidth * scale);
			canvas.height = Math.round(video.videoHeight * scale);
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
			var code = global.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
			if (code && code.data) emit(code.data);
		}

		function loop() {
			timer = setTimeout(async function () {
				try { await scanOnce(); } catch (_) {}
				if (stream) loop();
			}, SCAN_EVERY_MS);
		}

		async function start() {
			if (stream) return;
			if (!global.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
				throw new Error("This browser can't use the camera here. Open the dashboard over https in Chrome, Edge or Safari.");
			}
			detector = await makeDetector();
			if (!detector) await loadJsQR();
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }
				});
			} catch (err) {
				throw cameraError(err);
			}
			video.setAttribute("playsinline", "");
			video.muted = true;
			video.srcObject = stream;
			await video.play().catch(function () {});
			paused = false;
			loop();
		}

		function stop() {
			clearTimeout(timer);
			timer = null;
			if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
			stream = null;
			video.srcObject = null;
		}

		async function flip() {
			facing = facing === "environment" ? "user" : "environment";
			stop();
			await start();
		}

		return {
			start: start,
			stop: stop,
			flip: flip,
			pause: function () { paused = true; },
			resume: function () { paused = false; lastValue = ""; },
			running: function () { return Boolean(stream); }
		};
	}

	global.JodQrScanner = { create: create };
})(window);
