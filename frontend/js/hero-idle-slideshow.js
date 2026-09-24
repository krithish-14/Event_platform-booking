/**
 * Home hero idle slideshow.
 * Quiet crossfade only — no shatter, slats, or flare.
 * Plays only when no featured event is live.
 */
(function (global) {
	"use strict";

	const FILES = ["h1.webp", "h2.webp", "h3.webp", "h4.webp", "h5.webp", "h6.webp"];
	const HOLD_MS = 3000;
	const FADE_MS = 700;

	let root = null;
	let base = null;
	let fade = null;
	let images = [];
	let index = 0;
	let started = false;
	let animating = false;
	let timer = null;
	let cleanupTimer = null;

	function assetUrl(rel) {
		if (global.JodConfig && typeof global.JodConfig.assetUrl === "function") {
			return global.JodConfig.assetUrl(rel);
		}
		return "https://assets.jodevents.com/images/" + encodeURIComponent("hero banner") + "/" + rel.replace(/^.*\//, "");
	}

	function slideshowUrls() {
		return FILES.map((name) => assetUrl("images/hero banner/" + name));
	}

	function prefersReducedMotion() {
		return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	function preload(src) {
		if (!src) return;
		const img = new Image();
		img.decoding = "async";
		img.src = src;
	}

	function setLayer(el, src) {
		if (!el || !src) return;
		el.style.backgroundImage = 'url("' + src + '")';
	}

	function advance() {
		if (animating || !started || images.length < 2) return;
		const next = images[(index + 1) % images.length];
		preload(images[(index + 2) % images.length]);
		if (prefersReducedMotion()) {
			index = (index + 1) % images.length;
			setLayer(base, images[index]);
			setLayer(fade, images[index]);
			if (fade) fade.classList.remove("is-fading");
			return;
		}
		animating = true;
		setLayer(fade, images[index]);
		setLayer(base, next);
		if (fade) {
			fade.classList.remove("is-fading");
			void fade.offsetWidth;
			fade.classList.add("is-fading");
		}
		if (cleanupTimer) global.clearTimeout(cleanupTimer);
		cleanupTimer = global.setTimeout(() => {
			index = (index + 1) % images.length;
			setLayer(fade, images[index]);
			if (fade) fade.classList.remove("is-fading");
			animating = false;
		}, FADE_MS + 20);
	}

	function tick() {
		if (!started || animating) return;
		if (document.hidden) return;
		advance();
	}

	function start() {
		root = document.querySelector(".hero-idle-slideshow");
		if (!root) return;
		images = slideshowUrls();
		if (!images.length) return;
		base = root.querySelector(".hero-idle-base");
		fade = root.querySelector(".hero-idle-fade");
		root.hidden = false;
		if (!started) {
			started = true;
			index = 0;
			setLayer(base, images[0]);
			setLayer(fade, images[0]);
			images.forEach(preload);
		}
		if (!timer) timer = global.setInterval(tick, HOLD_MS);
	}

	function stop() {
		started = false;
		animating = false;
		if (timer) {
			global.clearInterval(timer);
			timer = null;
		}
		if (cleanupTimer) {
			global.clearTimeout(cleanupTimer);
			cleanupTimer = null;
		}
		if (fade) fade.classList.remove("is-fading");
		if (root) root.hidden = true;
	}

	global.JodHeroIdleSlideshow = {
		start: start,
		stop: stop,
		advance: tick
	};

	function boot() {
		const hero = document.querySelector(".hero");
		if (!hero || hero.classList.contains("has-live-event")) return;
		start();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})(window);
