/* Crop-before-upload: drag to position, zoom (slider, wheel, pinch), rotate.
 * JodImageCropper.open(file, { aspect, shape, width, height, minBytes, maxBytes, title })
 * resolves to a JPEG/PNG Blob of exactly width x height, or null when cancelled. */
(function (global) {
	"use strict";

	var MAX_ZOOM = 5;
	var PAD = 28;
	var root = null;
	var el = {};
	var s = null;
	var pointers = new Map();
	var pinch = null;
	var lastFocus = null;

	function q(sel) { return root.querySelector(sel); }

	function build() {
		if (root) return;
		root = document.createElement("div");
		root.className = "jod-crop";
		root.hidden = true;
		root.innerHTML =
			'<div class="jod-crop-backdrop"></div>' +
			'<div class="jod-crop-box" role="dialog" aria-modal="true" aria-labelledby="jodCropTitle">' +
			'<div class="jod-crop-head"><h3 id="jodCropTitle">Adjust photo</h3><button type="button" class="jod-crop-x" data-crop="cancel" aria-label="Cancel">&times;</button></div>' +
			'<p class="jod-crop-hint">Drag to move. Zoom with the slider, mouse wheel or a pinch. Only the bright area is uploaded.</p>' +
			'<div class="jod-crop-stage"><canvas tabindex="0" aria-label="Photo position. Arrow keys move, plus and minus zoom."></canvas></div>' +
			'<div class="jod-crop-tools">' +
			'<button type="button" class="jod-crop-btn" data-crop="zoom-out" aria-label="Zoom out">&minus;</button>' +
			'<input type="range" min="0" max="100" step="1" value="0" aria-label="Zoom">' +
			'<button type="button" class="jod-crop-btn" data-crop="zoom-in" aria-label="Zoom in">+</button>' +
			'<button type="button" class="jod-crop-btn" data-crop="rotate" aria-label="Rotate" title="Rotate">&#8635;</button>' +
			'<button type="button" class="jod-crop-btn is-text" data-crop="reset">Reset</button>' +
			'</div>' +
			'<div class="jod-crop-foot"><button type="button" class="jod-crop-cancel" data-crop="cancel">Cancel</button><button type="button" class="jod-crop-ok" data-crop="ok">Use photo</button></div>' +
			'</div>';
		document.body.appendChild(root);
		el.canvas = q("canvas");
		el.ctx = el.canvas.getContext("2d");
		el.range = q('input[type="range"]');
		el.title = q("#jodCropTitle");
		el.ok = q('[data-crop="ok"]');

		root.addEventListener("click", function (e) {
			var b = e.target.closest("[data-crop]");
			if (!b) return;
			var act = b.getAttribute("data-crop");
			if (act === "cancel") finish(null);
			else if (act === "ok") exportBlob();
			else if (act === "zoom-in") setZoom(zoomT() + 10);
			else if (act === "zoom-out") setZoom(zoomT() - 10);
			else if (act === "rotate") rotate();
			else if (act === "reset") reset();
		});
		root.addEventListener("keydown", function (e) {
			if (e.key === "Escape") return finish(null);
			if (e.target !== el.canvas) return;
			var step = e.shiftKey ? 30 : 8;
			var moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
			if (moves[e.key]) { e.preventDefault(); move(moves[e.key][0], moves[e.key][1]); }
			else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoomT() + 5); }
			else if (e.key === "-") { e.preventDefault(); setZoom(zoomT() - 5); }
		});
		el.range.addEventListener("input", function () { setZoom(Number(el.range.value)); });
		el.canvas.addEventListener("wheel", function (e) {
			e.preventDefault();
			setZoom(zoomT() + (e.deltaY < 0 ? 4 : -4));
		}, { passive: false });
		el.canvas.addEventListener("pointerdown", function (e) {
			try { el.canvas.setPointerCapture(e.pointerId); } catch (_) {}
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pointers.size === 2) {
				var p = Array.from(pointers.values());
				pinch = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), scale: s.scale };
			}
		});
		el.canvas.addEventListener("pointermove", function (e) {
			var prev = pointers.get(e.pointerId);
			if (!prev || !s) return;
			var cur = { x: e.clientX, y: e.clientY };
			pointers.set(e.pointerId, cur);
			if (pointers.size === 2 && pinch) {
				var p = Array.from(pointers.values());
				var dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
				setScale(pinch.scale * dist / Math.max(1, pinch.dist));
			} else if (pointers.size === 1) {
				var k = el.canvas.width / el.canvas.getBoundingClientRect().width;
				move((cur.x - prev.x) * k, (cur.y - prev.y) * k);
			}
		});
		["pointerup", "pointercancel"].forEach(function (type) {
			el.canvas.addEventListener(type, function (e) {
				pointers.delete(e.pointerId);
				if (pointers.size < 2) pinch = null;
			});
		});
	}

	/* ── Geometry: offsets are in canvas pixels from the frame centre ── */
	function dims() {
		var turned = s.rot % 180 !== 0;
		return { w: turned ? s.img.naturalHeight : s.img.naturalWidth, h: turned ? s.img.naturalWidth : s.img.naturalHeight };
	}
	function minScale() {
		var d = dims();
		return Math.max(s.fw / d.w, s.fh / d.h);
	}
	function clamp() {
		var d = dims();
		var mx = Math.max(0, (d.w * s.scale - s.fw) / 2);
		var my = Math.max(0, (d.h * s.scale - s.fh) / 2);
		s.ox = Math.min(mx, Math.max(-mx, s.ox));
		s.oy = Math.min(my, Math.max(-my, s.oy));
	}
	function zoomT() {
		return Math.round(100 * Math.log(s.scale / minScale()) / Math.log(MAX_ZOOM));
	}
	function setScale(scale) {
		var lo = minScale();
		var next = Math.min(lo * MAX_ZOOM, Math.max(lo, scale));
		var ratio = next / s.scale;
		s.ox *= ratio;
		s.oy *= ratio;
		s.scale = next;
		clamp();
		el.range.value = String(zoomT());
		draw();
	}
	function setZoom(t) {
		setScale(minScale() * Math.pow(MAX_ZOOM, Math.min(100, Math.max(0, t)) / 100));
	}
	function move(dx, dy) {
		s.ox += dx;
		s.oy += dy;
		clamp();
		draw();
	}
	function rotate() {
		s.rot = (s.rot + 90) % 360;
		s.ox = 0;
		s.oy = 0;
		s.scale = Math.max(s.scale, minScale());
		setScale(s.scale);
	}
	function reset() {
		s.rot = 0;
		s.ox = 0;
		s.oy = 0;
		s.scale = minScale();
		setScale(s.scale);
	}

	function paintImage(ctx, cx, cy, k) {
		ctx.save();
		ctx.translate(cx + s.ox * k, cy + s.oy * k);
		ctx.rotate(s.rot * Math.PI / 180);
		ctx.scale(s.scale * k, s.scale * k);
		ctx.drawImage(s.img, -s.img.naturalWidth / 2, -s.img.naturalHeight / 2);
		ctx.restore();
	}

	function framePath(ctx) {
		var x = PAD, y = PAD;
		if (s.shape === "circle") {
			ctx.moveTo(x + s.fw, y + s.fh / 2);
			ctx.ellipse(x + s.fw / 2, y + s.fh / 2, s.fw / 2, s.fh / 2, 0, 0, Math.PI * 2);
		} else {
			ctx.rect(x, y, s.fw, s.fh);
		}
	}

	function draw() {
		var c = el.canvas, ctx = el.ctx;
		ctx.clearRect(0, 0, c.width, c.height);
		ctx.fillStyle = "#111";
		ctx.fillRect(0, 0, c.width, c.height);
		paintImage(ctx, c.width / 2, c.height / 2, 1);
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, c.width, c.height);
		framePath(ctx);
		ctx.fillStyle = "rgba(0,0,0,0.6)";
		ctx.fill("evenodd");
		ctx.beginPath();
		framePath(ctx);
		ctx.lineWidth = 2;
		ctx.strokeStyle = "rgba(255,255,255,0.9)";
		ctx.stroke();
		if (s.shape !== "circle") {
			ctx.beginPath();
			for (var i = 1; i < 3; i++) {
				ctx.moveTo(PAD + s.fw * i / 3, PAD);
				ctx.lineTo(PAD + s.fw * i / 3, PAD + s.fh);
				ctx.moveTo(PAD, PAD + s.fh * i / 3);
				ctx.lineTo(PAD + s.fw, PAD + s.fh * i / 3);
			}
			ctx.lineWidth = 1;
			ctx.strokeStyle = "rgba(255,255,255,0.3)";
			ctx.stroke();
		}
		ctx.restore();
	}

	/* ── Output ── */
	function toBlob(canvas, type, quality) {
		return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
	}

	async function exportBlob() {
		el.ok.disabled = true;
		el.ok.textContent = "Preparing\u2026";
		var out = document.createElement("canvas");
		out.width = s.opts.width;
		out.height = s.opts.height;
		var ctx = out.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, out.width, out.height);
		ctx.imageSmoothingQuality = "high";
		paintImage(ctx, out.width / 2, out.height / 2, out.width / s.fw);
		var blob = null;
		var qualities = [0.9, 0.82, 0.72, 0.6];
		for (var i = 0; i < qualities.length; i++) {
			blob = await toBlob(out, "image/jpeg", qualities[i]);
			if (blob && blob.size <= s.opts.maxBytes) break;
		}
		if (blob && blob.size < s.opts.minBytes) {
			var richer = await toBlob(out, "image/jpeg", 0.98);
			if (richer && richer.size >= s.opts.minBytes) blob = richer;
			else blob = (await toBlob(out, "image/png")) || blob;
		}
		finish(blob);
	}

	function finish(blob) {
		if (!root || root.hidden) return;
		root.hidden = true;
		document.documentElement.classList.remove("jod-crop-open");
		el.ok.disabled = false;
		el.ok.textContent = "Use photo";
		if (s && s.url) URL.revokeObjectURL(s.url);
		var done = s && s.resolve;
		s = null;
		pointers.clear();
		pinch = null;
		if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
		if (done) done(blob);
	}

	function loadImage(url) {
		return new Promise(function (resolve, reject) {
			var img = new Image();
			img.onload = function () { resolve(img); };
			img.onerror = function () { reject(new Error("That file couldn't be opened as an image. Try a JPG, PNG or WEBP.")); };
			img.src = url;
		});
	}

	async function open(file, options) {
		if (!file || !/^image\//.test(file.type || "")) throw new Error("Choose a JPG, PNG or WEBP image.");
		if (file.size > 25 * 1024 * 1024) throw new Error("That image is over 25 MB. Choose a smaller one.");
		var opts = Object.assign({ aspect: 1, shape: "rect", width: 400, height: 400, minBytes: 0, maxBytes: 3 * 1024 * 1024, title: "Adjust photo" }, options || {});
		build();
		if (s) finish(null);
		var url = URL.createObjectURL(file);
		var img;
		try {
			img = await loadImage(url);
		} catch (err) {
			URL.revokeObjectURL(url);
			throw err;
		}
		var maxW = Math.min(360, global.innerWidth - 80);
		var maxH = Math.min(420, global.innerHeight - 300);
		var fw = maxW, fh = maxW / opts.aspect;
		if (fh > maxH) { fh = maxH; fw = fh * opts.aspect; }
		fw = Math.round(fw);
		fh = Math.round(fh);
		el.canvas.width = fw + PAD * 2;
		el.canvas.height = fh + PAD * 2;
		el.title.textContent = opts.title;
		return new Promise(function (resolve) {
			s = { img: img, url: url, opts: opts, shape: opts.shape, fw: fw, fh: fh, rot: 0, ox: 0, oy: 0, scale: 1, resolve: resolve };
			s.scale = minScale();
			lastFocus = document.activeElement;
			root.hidden = false;
			document.documentElement.classList.add("jod-crop-open");
			setScale(s.scale);
			el.canvas.focus();
		});
	}

	global.JodImageCropper = { open: open };
})(window);
