/**
 * JOD Gallery — Singapenn Marathon 2026
 * Photos from images/Picflow Images Aug 20 (WebP).
 * Layout follows media size: landscape → feature, portrait → tall,
 * remaining landscapes → square beside features, video → feature.
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

	const PHOTO_PLAN = [
		{ file: "2G5A0980.webp", layout: "feature" },
		{ file: "8I2A8909.webp", layout: "tall" },
		{ file: "773A2389.webp", layout: "feature" },
		{ file: "8I2A8969.webp", layout: "square" },
		{ file: "2G5A0951.webp", layout: "feature" },
		{ file: "2G5A1131.webp", layout: "square" },
		{ file: "773A2231.webp", layout: "feature" },
		{ file: "8I2A9088.webp", layout: "square" },
		{ file: "8I2A9521.webp", layout: "feature" },
		{ file: "8I2A9250.webp", layout: "square" },
		{ file: "773A2276.webp", layout: "wide" }
	];

	const GALLERY_ITEMS = PHOTO_PLAN.map((photo, i) => ({
		id: "singapenn-" + (i + 1),
		type: "image",
		layout: photo.layout,
		highlight: photo.layout === "feature" || photo.layout === "tall" || photo.layout === "wide",
		title: "Singapenn Marathon 2026",
		src: photoUrl(photo.file)
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

	function colSpanFor(layout) {
		if (layout === "feature" || layout === "wide") return 8;
		return 4;
	}

	function packedSpans(list) {
		const COLS = 12;
		let used = 0;
		return list.map((item, index) => {
			let span = colSpanFor(item.layout);
			if (used + span > COLS) used = 0;
			const next = list[index + 1];
			const nextSpan = next ? colSpanFor(next.layout) : COLS;
			const remain = COLS - (used + span);
			if (remain > 0 && remain < nextSpan) {
				span += remain;
				used = 0;
			} else {
				used += span;
				if (used >= COLS) used = 0;
			}
			return span;
		});
	}

	function render() {
		if (!bento) return;
		const spans = packedSpans(visible);
		bento.innerHTML = visible.map((item, index) => {
			const play = item.type === "video" ? `<span class="gallery-play" aria-hidden="true">▶</span>` : "";
			return `<button type="button" class="gallery-tile" data-layout="${escapeHtml(item.layout)}" data-type="${escapeHtml(item.type)}" data-col="${spans[index]}" data-index="${index}" aria-label="${escapeHtml(item.title)}">
				<img src="${escapeHtml(thumb(item))}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escapeHtml(FALLBACK)}'" />
				<span class="gallery-tile-shade"></span>
				${play}
				<span class="gallery-tile-copy">
					<strong>${escapeHtml(item.title)}</strong>
				</span>
			</button>`;
		}).join("");
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
		return `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.title)}" />`;
	}

	function paintLightbox() {
		const item = visible[lightboxIndex];
		if (!item || !stage) return;
		stage.innerHTML = mediaHtml(item);
		const title = document.getElementById("galleryLbTitle");
		if (title) title.textContent = item.title || "";
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
	});
})();
