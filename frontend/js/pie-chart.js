(() => {
	"use strict";

	const PALETTE = ["#4F7CFF", "#F5D142", "#FF7A7A", "#C084FC", "#34d399", "#f59e0b", "#6366f1", "#FF7508"];
	const watched = new Map();

	function isDark() {
		return document.documentElement.getAttribute("data-theme") === "dark";
	}

	function themeColors() {
		const dark = isDark();
		return {
			label: dark ? "#e2e8f0" : "#475569",
			empty: dark ? "#334155" : "#e2e8f0",
			emptyText: dark ? "#94a3b8" : "#64748b",
			ring: dark ? "#1e293b" : "#ffffff"
		};
	}

	function textOn(color) {
		const hex = String(color || "#888").replace("#", "");
		if (hex.length < 6) return "#ffffff";
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return lum > 0.62 ? "#1e293b" : "#ffffff";
	}

	function polar(cx, cy, r, angle) {
		return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
	}

	function fmtPct(n) {
		if (!Number.isFinite(n) || n <= 0) return "0%";
		if (n < 1) return `${n.toFixed(1)}%`;
		return `${Math.round(n)}%`;
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function normalize(slices, maxSlices) {
		const cleaned = (Array.isArray(slices) ? slices : [])
			.map((row, i) => ({
				label: String((row && row.label) || "Item"),
				value: Math.max(0, Number(row && row.value) || 0),
				color: (row && row.color) || PALETTE[i % PALETTE.length]
			}))
			.filter((row) => row.value > 0);
		const cap = Math.max(3, Number(maxSlices) || 7);
		if (cleaned.length <= cap) return cleaned;
		const ranked = cleaned.slice().sort((a, b) => b.value - a.value);
		const keep = ranked.slice(0, cap - 1);
		const rest = ranked.slice(cap - 1);
		const otherVal = rest.reduce((sum, row) => sum + row.value, 0);
		keep.push({ label: "Other", value: otherVal, color: "#94a3b8" });
		return keep;
	}

	function ensureTooltip() {
		let tip = document.getElementById("jodPieTooltip");
		if (tip) return tip;
		if (!document.getElementById("jodPieTooltipStyle")) {
			const style = document.createElement("style");
			style.id = "jodPieTooltipStyle";
			style.textContent = `
				.jod-pie-tooltip{position:fixed;z-index:5000;pointer-events:none;min-width:158px;padding:.7rem .9rem .75rem;border-radius:12px;background:#0f172a;color:#f8fafc;box-shadow:0 16px 36px rgba(15,23,42,.38);border:1px solid rgba(255,255,255,.1);opacity:0;visibility:hidden;transform:translate(-50%,calc(-100% - 14px));transition:opacity .12s ease}
				.jod-pie-tooltip.is-visible{opacity:1;visibility:visible}
				.jod-pie-tip-head{display:flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:700;color:#e2e8f0}
				.jod-pie-tip-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,.18)}
				.jod-pie-tip-value{margin-top:.38rem;font-size:1.18rem;font-weight:800;letter-spacing:-.02em;line-height:1.1}
				.jod-pie-tip-pct{margin-top:.18rem;font-size:.72rem;font-weight:600;color:#94a3b8}
			`;
			document.head.appendChild(style);
		}
		tip = document.createElement("div");
		tip.id = "jodPieTooltip";
		tip.className = "jod-pie-tooltip";
		tip.setAttribute("aria-hidden", "true");
		document.body.appendChild(tip);
		return tip;
	}

	function showTooltip(row, clientX, clientY, options) {
		const tip = ensureTooltip();
		const noun = String((options && options.valueNoun) || "").trim();
		const count = Number(row.value || 0).toLocaleString("en-IN");
		const unit = noun ? ` ${escapeHtml(noun)}` : "";
		tip.innerHTML = `
			<div class="jod-pie-tip-head">
				<span class="jod-pie-tip-dot" style="background:${escapeHtml(row.color)}"></span>
				<span>${escapeHtml(row.label)}</span>
			</div>
			<div class="jod-pie-tip-value">${count}${unit}</div>
			<div class="jod-pie-tip-pct">${fmtPct(row.pct)} of total</div>
		`;
		tip.classList.add("is-visible");
		const pad = 12;
		const width = tip.offsetWidth || 170;
		let left = clientX;
		if (left - width / 2 < pad) left = pad + width / 2;
		if (left + width / 2 > window.innerWidth - pad) left = window.innerWidth - pad - width / 2;
		tip.style.left = `${left}px`;
		tip.style.top = `${Math.max(pad + 8, clientY)}px`;
	}

	function hideTooltip() {
		const tip = document.getElementById("jodPieTooltip");
		if (tip) tip.classList.remove("is-visible");
	}

	function hitSlice(mx, my, hit) {
		if (!hit || !hit.laid || !hit.laid.length) return -1;
		const dx = mx - hit.cx;
		const dy = my - hit.cy;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist > hit.radius + 10) return -1;
		let theta = Math.atan2(dy, dx) + Math.PI / 2;
		if (theta < 0) theta += Math.PI * 2;
		let acc = 0;
		for (let i = 0; i < hit.laid.length; i += 1) {
			acc += hit.laid[i].sweep;
			if (theta <= acc + 0.0001) return i;
		}
		return hit.laid.length - 1;
	}

	function paint(canvas, slices, options, hoverIndex) {
		if (!canvas || !canvas.getContext) return;
		const ctx = canvas.getContext("2d");
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 8 || rect.height < 8) return;

		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(rect.width * dpr);
		const targetH = Math.round(rect.height * dpr);
		if (canvas.width !== targetW || canvas.height !== targetH) {
			canvas.width = targetW;
			canvas.height = targetH;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, rect.width, rect.height);

		const theme = themeColors();
		const opts = options || {};
		const rows = normalize(slices, opts.maxSlices);
		const total = rows.reduce((sum, row) => sum + row.value, 0);
		const cx = rect.width / 2;
		const cy = rect.height / 2;
		const pad = Number(opts.pad) > 0 ? opts.pad : Math.max(48, Math.min(rect.width, rect.height) * 0.22);
		const radius = Math.max(28, Math.min(cx, cy) - pad);
		const hover = Number.isInteger(hoverIndex) ? hoverIndex : -1;

		if (!rows.length || total <= 0) {
			ctx.beginPath();
			ctx.arc(cx, cy, radius, 0, Math.PI * 2);
			ctx.fillStyle = theme.empty;
			ctx.fill();
			ctx.fillStyle = theme.emptyText;
			ctx.font = "600 13px Inter, Segoe UI, sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(opts.emptyText || "No data yet", cx, cy);
			canvas.setAttribute("aria-label", opts.emptyText || "No data yet");
			canvas._jodPieHit = null;
			return;
		}

		const summary = rows.map((row) => `${row.label} ${fmtPct((row.value / total) * 100)}`).join(", ");
		canvas.setAttribute("aria-label", summary);

		let angle = -Math.PI / 2;
		const laid = rows.map((row) => {
			const sweep = (row.value / total) * Math.PI * 2;
			const start = angle;
			const mid = start + sweep / 2;
			angle += sweep;
			return { ...row, start, sweep, mid, pct: (row.value / total) * 100 };
		});
		canvas._jodPieHit = { cx, cy, radius, laid };

		laid.forEach((row, i) => {
			const active = hover === i;
			ctx.save();
			ctx.globalAlpha = hover >= 0 && !active ? 0.42 : 1;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, active ? radius + 7 : radius, row.start, row.start + row.sweep);
			ctx.closePath();
			ctx.fillStyle = row.color;
			ctx.fill();
			ctx.strokeStyle = theme.ring;
			ctx.lineWidth = active ? 3 : 2.5;
			ctx.stroke();
			ctx.restore();
		});

		laid.forEach((row) => {
			const showInside = row.pct >= 8;
			if (showInside) {
				const p = polar(cx, cy, radius * 0.55, row.mid);
				ctx.fillStyle = textOn(row.color);
				ctx.font = "700 13px Inter, Segoe UI, sans-serif";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(fmtPct(row.pct), p.x, p.y);
			}

			const right = Math.cos(row.mid) >= 0;
			const lp = polar(cx, cy, radius + 14, row.mid);
			ctx.fillStyle = theme.label;
			ctx.font = "600 12px Inter, Segoe UI, sans-serif";
			ctx.textAlign = right ? "left" : "right";
			ctx.textBaseline = "middle";
			const label = showInside ? row.label : `${row.label}  ${fmtPct(row.pct)}`;
			ctx.fillText(label, lp.x, lp.y);
		});
	}

	function bindHover(canvas) {
		if (!canvas || canvas._jodPieHoverBound) return;
		canvas._jodPieHoverBound = true;
		canvas.addEventListener("mousemove", (event) => {
			const stored = watched.get(canvas);
			if (!stored) return;
			const rect = canvas.getBoundingClientRect();
			const mx = event.clientX - rect.left;
			const my = event.clientY - rect.top;
			const next = hitSlice(mx, my, canvas._jodPieHit);
			if (next !== canvas._jodPieHover) {
				canvas._jodPieHover = next;
				paint(canvas, stored.slices, stored.options, next);
			}
			if (next >= 0 && canvas._jodPieHit && canvas._jodPieHit.laid[next]) {
				canvas.style.cursor = "pointer";
				showTooltip(canvas._jodPieHit.laid[next], event.clientX, event.clientY, stored.options);
			} else {
				canvas.style.cursor = "default";
				hideTooltip();
			}
		});
		canvas.addEventListener("mouseleave", () => {
			const stored = watched.get(canvas);
			canvas._jodPieHover = -1;
			canvas.style.cursor = "default";
			hideTooltip();
			if (stored) paint(canvas, stored.slices, stored.options, -1);
		});
	}

	function draw(canvas, slices, options) {
		if (!canvas) return;
		watched.set(canvas, { slices: slices || [], options: options || {} });
		canvas._jodPieHover = -1;
		if (!canvas._jodPieObserved && typeof ResizeObserver === "function") {
			canvas._jodPieObserved = true;
			const ro = new ResizeObserver(() => {
				const stored = watched.get(canvas);
				if (stored) paint(canvas, stored.slices, stored.options, canvas._jodPieHover || -1);
			});
			ro.observe(canvas);
		}
		bindHover(canvas);
		paint(canvas, slices, options, -1);
	}

	function redrawAll() {
		watched.forEach((stored, canvas) => paint(canvas, stored.slices, stored.options, canvas._jodPieHover || -1));
	}

	let resizeTimer = 0;
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(redrawAll, 80);
	});
	window.addEventListener("jod-theme-change", redrawAll);

	window.JodPieChart = { draw, redrawAll, PALETTE };
})();
