/**
 * About page — each section reacts to scroll + pointer.
 * Copy and buttons stay on top; photos never cover the reading column.
 */
(function () {
	"use strict";

	var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	var sections = document.querySelectorAll("[data-about-play]");
	if (!sections.length) return;

	function clamp(v, a, b) {
		return v < a ? a : v > b ? b : v;
	}
	function lerp(a, b, t) {
		return a + (b - a) * t;
	}
	function sectionIn(el) {
		var r = el.getBoundingClientRect();
		var vh = window.innerHeight || 1;
		return clamp((vh * 0.9 - r.top) / (vh * 0.45 + r.height * 0.35), 0, 1);
	}

	var states = [];
	sections.forEach(function (sec) {
		states.push({
			el: sec,
			tx: 0,
			ty: 0,
			x: 0,
			y: 0,
			hover: false
		});
	});

	function onMove(state, e) {
		var r = state.el.getBoundingClientRect();
		if (r.width < 8 || r.height < 8) return;
		state.tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
		state.ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
		state.hover = true;
	}

	function onLeave(state) {
		state.hover = false;
		state.tx = 0;
		state.ty = 0;
	}

	states.forEach(function (state) {
		state.el.addEventListener("pointermove", function (e) {
			onMove(state, e);
		});
		state.el.addEventListener("pointerleave", function () {
			onLeave(state);
		});
	});

	var raf = 0;
	function tick() {
		raf = requestAnimationFrame(tick);
		var i;
		for (i = 0; i < states.length; i += 1) {
			var s = states[i];
			var enter = reduced ? 1 : sectionIn(s.el);
			s.x = lerp(s.x, s.tx, s.hover ? 0.12 : 0.06);
			s.y = lerp(s.y, s.ty, s.hover ? 0.12 : 0.06);
			s.el.style.setProperty("--mx", s.x.toFixed(3));
			s.el.style.setProperty("--my", s.y.toFixed(3));
			s.el.style.setProperty("--in", enter.toFixed(3));
		}
	}

	if (!reduced) {
		tick();
	} else {
		states.forEach(function (s) {
			s.el.style.setProperty("--mx", "0");
			s.el.style.setProperty("--my", "0");
			s.el.style.setProperty("--in", "1");
		});
	}
})();
