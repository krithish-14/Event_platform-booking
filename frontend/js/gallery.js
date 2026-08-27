/**
 * JOD Gallery — Singapenn Marathon 2026
 * Photos from images/Picflow Images Aug 20 (WebP).
 * Board layout: repeating 5-cell sets — tall portrait left, 2×2 squares right.
 */
(function () {
	"use strict";

	function asset(path) {
		if (window.JodConfig && typeof window.JodConfig.assetUrl === "function") {
			return window.JodConfig.assetUrl(path);
		}
		return "https://assets.jodevents.com/images/" + String(path || "").replace(/^images\//, "");
	}

	function photoUrl(name) {
		return asset("images/Picflow Images Aug 20/" + name);
	}

	const FALLBACK = photoUrl("2G5A0980.webp");
	const SET_SLOTS = ["hero", "a", "b", "c", "d"];

	const PHOTO_FILES = [
		"8I2A8909.webp",
		"2G5A0980.webp",
		"773A2389.webp",
		"8I2A8969.webp",
		"2G5A0951.webp",
		"2G5A1131.webp",
		"773A2231.webp",
		"8I2A9088.webp",
		"8I2A9521.webp",
		"8I2A9250.webp",
		"773A2276.webp"
	];

	const GALLERY_ITEMS = PHOTO_FILES.map((file, i) => ({
		id: "singapenn-" + (i + 1),
		type: "image",
		highlight: i % 5 === 0,
		title: "Singapenn Marathon 2026",
		src: photoUrl(file)
	}));

	let items = GALLERY_ITEMS.slice();
	let visible = items.slice();
	let activeFilter = "all";
	let lightboxIndex = 0;

	const bento = document.getElementById("galleryBento");
	const empty = document.getElementById("galleryEmpty");
	const lightbox = document.getElementById("galleryLightbox");
	const stage = document.getElementById("galleryLbStage");

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function thumb(item) {
		return item.poster || item.src || FALLBACK;
	}

	function tileMarkup(item, index, slot) {
		const play = item.type === "video" ? `<span class="gallery-play" aria-hidden="true">▶</span>` : "";
		return `<button type="button" class="gallery-tile" data-slot="${escapeHtml(slot)}" data-type="${escapeHtml(item.type)}" data-index="${index}" aria-label="${escapeHtml(item.title)}">
			<img src="${escapeHtml(thumb(item))}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escapeHtml(FALLBACK)}'" />
			<span class="gallery-tile-shade"></span>
			${play}
			<span class="gallery-tile-copy">
				<strong>${escapeHtml(item.title)}</strong>
			</span>
		</button>`;
	}

	function render() {
		if (!bento) return;
		const sets = [];
		for (let start = 0; start < visible.length; start += 5) {
			const group = visible.slice(start, start + 5);
			const tiles = group.map((item, i) => tileMarkup(item, start + i, SET_SLOTS[i] || "extra")).join("");
			sets.push(`<div class="gallery-set" data-count="${group.length}">${tiles}</div>`);
		}
		bento.innerHTML = sets.join("");
		if (empty) empty.hidden = visible.length > 0;
		bento.querySelectorAll(".gallery-tile").forEach((tile) => {
			tile.addEventListener("click", () => openLightbox(Number(tile.dataset.index)));
		});
	}

	function applyFilter(filter) {
		activeFilter = filter;
		if (filter === "image" || filter === "video") {
			visible = items.filter((item) => item.type === filter);
		} else if (filter === "highlight") {
			visible = items.filter((item) => item.highlight);
		} else {
			visible = items.slice();
		}
		document.querySelectorAll(".gallery-filter").forEach((btn) => {
			const on = btn.dataset.filter === filter;
			btn.classList.toggle("is-active", on);
			btn.setAttribute("aria-selected", String(on));
		});
		render();
	}

	function setStats() {
		const photos = items.filter((i) => i.type === "image").length;
		const videos = items.filter((i) => i.type === "video").length;
		const all = document.getElementById("galleryStatAll");
		const p = document.getElementById("galleryStatPhotos");
		const v = document.getElementById("galleryStatVideos");
		if (all) all.textContent = String(items.length);
		if (p) p.textContent = String(photos);
		if (v) v.textContent = String(videos);
	}

	function mediaHtml(item) {
		if (item.type === "video" && item.youtube) {
			return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.youtube)}?autoplay=1&rel=0" title="${escapeHtml(item.title)}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
		}
		if (item.type === "video") {
			return `<video src="${escapeHtml(item.src)}" poster="${escapeHtml(thumb(item))}" controls autoplay playsinline preload="metadata"></video>`;
		}
		return `<img class="gallery-lb-photo" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.title)}" decoding="async" />`;
	}

	let lightboxPhoto = null;

	function fitLightboxPhoto(img) {
		if (!img) return;
		const maxW = Math.min(window.innerWidth * 0.92, 1100);
		const maxH = window.innerHeight * 0.82;
		const nw = img.naturalWidth || 0;
		const nh = img.naturalHeight || 0;
		const set = (prop, value) => img.style.setProperty(prop, value, "important");
		if (!nw || !nh) {
			set("width", "auto");
			set("height", "auto");
			set("max-width", maxW + "px");
			set("max-height", maxH + "px");
			set("object-fit", "contain");
			return;
		}
		const scale = Math.min(1, maxW / nw, maxH / nh);
		set("width", Math.round(nw * scale) + "px");
		set("height", Math.round(nh * scale) + "px");
		set("max-width", "none");
		set("max-height", "none");
		set("object-fit", "contain");
	}

	function paintLightbox() {
		const item = visible[lightboxIndex];
		if (!item || !stage) return;
		stage.innerHTML = mediaHtml(item);
		lightboxPhoto = stage.querySelector(".gallery-lb-photo");
		if (!lightboxPhoto) return;
		const apply = () => fitLightboxPhoto(lightboxPhoto);
		if (lightboxPhoto.complete && lightboxPhoto.naturalWidth) apply();
		else lightboxPhoto.addEventListener("load", apply, { once: true });
	}

	function openLightbox(index) {
		lightboxIndex = index;
		if (!lightbox) return;
		lightbox.hidden = false;
		document.body.style.overflow = "hidden";
		paintLightbox();
	}

	function closeLightbox() {
		if (!lightbox) return;
		lightbox.hidden = true;
		if (stage) stage.innerHTML = "";
		lightboxPhoto = null;
		document.body.style.overflow = "";
	}

	function stepLightbox(dir) {
		if (!visible.length) return;
		lightboxIndex = (lightboxIndex + dir + visible.length) % visible.length;
		paintLightbox();
	}

	function bindUi() {
		document.querySelectorAll(".gallery-filter").forEach((btn) => {
			btn.addEventListener("click", () => applyFilter(btn.dataset.filter || "all"));
		});
		document.getElementById("galleryLbClose")?.addEventListener("click", closeLightbox);
		document.getElementById("galleryLbPrev")?.addEventListener("click", () => stepLightbox(-1));
		document.getElementById("galleryLbNext")?.addEventListener("click", () => stepLightbox(1));
		lightbox?.addEventListener("click", (e) => {
			if (e.target === lightbox) closeLightbox();
		});
		document.addEventListener("keydown", (e) => {
			if (lightbox && !lightbox.hidden) {
				if (e.key === "Escape") closeLightbox();
				if (e.key === "ArrowLeft") stepLightbox(-1);
				if (e.key === "ArrowRight") stepLightbox(1);
			}
		});
	}

	document.addEventListener("DOMContentLoaded", () => {
		bindUi();
		setStats();
		applyFilter("all");
		window.addEventListener("resize", () => {
			if (lightbox && !lightbox.hidden && lightboxPhoto) fitLightboxPhoto(lightboxPhoto);
		});
	});
})();
