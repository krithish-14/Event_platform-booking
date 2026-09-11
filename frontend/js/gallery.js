/**
 * JOD Events — Modern Editorial Layered Image Carousel
 * Visual Diary & Event Gallery with 4:5 Aspect Ratio, Dynamic 3D Layering,
 * Smooth Transitions, Category Filtering, and Lightbox Integration.
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

	/* Curated Visual Diary & Event Gallery Dataset with 4:5 Aspect Ratio Images */
	const GALLERY_DATA = [
		{
			id: "diary-1",
			title: "Lake Braies Mountain Reflections",
			category: "Italy",
			type: "image",
			src: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-2",
			title: "Golden Hour Over Sea of Clouds",
			category: "Dubai",
			type: "image",
			src: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-3",
			title: "Vintage Traveler Gear & Film Camera",
			category: "London",
			type: "video",
			src: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-4",
			title: "Alpine Lake & Lone Hiker",
			category: "Berlin",
			type: "image",
			src: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-5",
			title: "Dolomites Sunset Glow",
			category: "Rome",
			type: "image",
			src: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-6",
			title: "Lisbon Coastline & Ocean Breeze",
			category: "Lisbon",
			type: "image",
			src: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-7",
			title: "Singapenn Marathon 2026 Runners",
			category: "India",
			type: "image",
			src: photoUrl("8I2A8909.webp"),
			poster: photoUrl("8I2A8909.webp")
		},
		{
			id: "diary-8",
			title: "Singapenn Marathon Celebration",
			category: "India",
			type: "image",
			src: photoUrl("2G5A0980.webp"),
			poster: photoUrl("2G5A0980.webp")
		},
		{
			id: "diary-9",
			title: "Ancient Pagoda & Bamboo Groves",
			category: "China",
			type: "image",
			src: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-10",
			title: "Kyoto Lanterns & Cherry Blossoms",
			category: "Japan",
			type: "video",
			src: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&h=1500&q=85",
			poster: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=600&h=750&q=80"
		},
		{
			id: "diary-11",
			title: "Festival Lights & Stage Energy",
			category: "Concerts",
			type: "image",
			src: photoUrl("773A2389.webp"),
			poster: photoUrl("773A2389.webp")
		},
		{
			id: "diary-12",
			title: "Cheering Crowd & Live Music",
			category: "Concerts",
			type: "image",
			src: photoUrl("8I2A8969.webp"),
			poster: photoUrl("8I2A8969.webp")
		}
	];

	const CATEGORIES = [
		"Italy",
		"Dubai",
		"London",
		"Berlin",
		"Rome",
		"Lisbon",
		"India",
		"China",
		"Japan",
		"View More →"
	];

	let allItems = GALLERY_DATA.slice();
	let visibleItems = allItems.slice();
	let activeCategory = "Italy";
	let currentIndex = 0;
	let lightboxIndex = 0;

	const track = document.getElementById("carouselTrack");
	const filtersContainer = document.getElementById("galleryFilters");
	const prevBtn = document.getElementById("carouselPrevBtn");
	const nextBtn = document.getElementById("carouselNextBtn");
	const emptyMsg = document.getElementById("galleryEmpty");
	const carouselWrapper = document.getElementById("carouselWrapper");

	// Lightbox Elements
	const lightbox = document.getElementById("galleryLightbox");
	const stage = document.getElementById("galleryLbStage");
	const countEl = document.getElementById("galleryLbCount");
	const lbCloseBtn = document.getElementById("galleryLbClose");
	const lbPrevBtn = document.getElementById("galleryLbPrev");
	const lbNextBtn = document.getElementById("galleryLbNext");

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

	/* --------------------------------------------------------------------------
	   Category Filters
	   -------------------------------------------------------------------------- */
	function renderCategoryPills() {
		if (!filtersContainer) return;
		filtersContainer.innerHTML = CATEGORIES.map((cat) => {
			const isActive = cat.toLowerCase() === activeCategory.toLowerCase();
			return `<button type="button" class="gallery-pill ${isActive ? "is-active" : ""}" data-category="${escapeHtml(cat)}" role="tab" aria-selected="${isActive}">
				${escapeHtml(cat)}
			</button>`;
		}).join("");

		filtersContainer.querySelectorAll(".gallery-pill").forEach((pill) => {
			pill.addEventListener("click", () => {
				const cat = pill.getAttribute("data-category");
				selectCategory(cat);
			});
		});
	}

	function selectCategory(category) {
		activeCategory = category;

		if (category === "View More →" || category === "All") {
			visibleItems = allItems.slice();
			currentIndex = 0;
		} else {
			// Center directly on the item matching this category or reorder with category first
			const matchIdx = allItems.findIndex((it) => it.category.toLowerCase() === category.toLowerCase());
			if (matchIdx !== -1) {
				visibleItems = allItems.slice();
				currentIndex = matchIdx;
			} else {
				visibleItems = allItems.filter((it) => it.category.toLowerCase() === category.toLowerCase());
				currentIndex = 0;
			}
		}

		document.querySelectorAll(".gallery-pill").forEach((pill) => {
			const on = pill.getAttribute("data-category").toLowerCase() === category.toLowerCase();
			pill.classList.toggle("is-active", on);
			pill.setAttribute("aria-selected", String(on));
			if (on && typeof pill.scrollIntoView === "function") {
				pill.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
			}
		});

		updateCardPositions();
	}


	/* --------------------------------------------------------------------------
	   Carousel Rendering & Positioning
	   -------------------------------------------------------------------------- */
	function getPositionName(diff) {
		if (diff === 0) return "0";
		if (diff === -1) return "-1";
		if (diff === 1) return "1";
		if (diff === -2) return "-2";
		if (diff === 2) return "2";
		if (diff < -2) return "hidden-left";
		return "hidden-right";
	}

	function cardMarkup(item, index, pos) {
		const isVideo = item.type === "video";
		const playBtn = isVideo
			? `<div class="editorial-card-play" aria-label="Play video">
					<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
			   </div>`
			: "";

		return `<div class="editorial-card" data-index="${index}" data-pos="${pos}" role="button" tabindex="0" aria-label="${escapeHtml(item.title)}">
			<img src="${escapeHtml(thumb(item))}" alt="${escapeHtml(item.title)}" loading="${pos === '0' ? 'eager' : 'lazy'}" decoding="async" onerror="this.onerror=null;this.src='${escapeHtml(FALLBACK)}'" />
			<div class="editorial-card-shade"></div>
			<div class="editorial-card-info">
				<span class="editorial-card-tag">${escapeHtml(item.category)}</span>
				<h3 class="editorial-card-title">${escapeHtml(item.title)}</h3>
			</div>
			${playBtn}
		</div>`;
	}

	function updateCardPositions() {
		if (!track) return;
		const cards = track.querySelectorAll(".editorial-card");
		const N = visibleItems.length;
		if (!N) return;

		const half = Math.floor(N / 2);

		cards.forEach((card) => {
			const i = Number(card.getAttribute("data-index"));
			let diff = i - currentIndex;
			while (diff > half) diff -= N;
			while (diff < -half) diff += N;

			const pos = getPositionName(diff);
			card.setAttribute("data-pos", pos);
			card.setAttribute("aria-hidden", Math.abs(diff) > 2 ? "true" : "false");
		});
	}

	function renderCarousel() {
		if (!track) return;

		if (!visibleItems.length) {
			track.innerHTML = "";
			if (emptyMsg) emptyMsg.hidden = false;
			if (prevBtn) prevBtn.disabled = true;
			if (nextBtn) nextBtn.disabled = true;
			return;
		}

		if (emptyMsg) emptyMsg.hidden = true;
		if (prevBtn) prevBtn.disabled = false;
		if (nextBtn) nextBtn.disabled = false;

		const N = visibleItems.length;
		const half = Math.floor(N / 2);

		track.innerHTML = visibleItems.map((item, i) => {
			let diff = i - currentIndex;
			while (diff > half) diff -= N;
			while (diff < -half) diff += N;
			return cardMarkup(item, i, getPositionName(diff));
		}).join("");

		bindCardClicks();
	}

	function bindCardClicks() {
		if (!track) return;
		track.querySelectorAll(".editorial-card").forEach((card) => {
			card.addEventListener("click", () => {
				const pos = card.getAttribute("data-pos");
				const idx = Number(card.getAttribute("data-index"));

				if (pos === "0") {
					// Center card clicked -> open lightbox
					openLightbox(idx);
				} else if (pos === "-1" || pos === "-2") {
					stepTo(idx);
				} else if (pos === "1" || pos === "2") {
					stepTo(idx);
				}
			});

			card.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					card.click();
				}
			});
		});
	}

	function step(direction) {
		const N = visibleItems.length;
		if (N <= 1) return;
		currentIndex = (currentIndex + direction + N) % N;
		updateCardPositions();
	}

	function stepTo(targetIndex) {
		const N = visibleItems.length;
		if (N <= 1) return;
		currentIndex = ((targetIndex % N) + N) % N;
		updateCardPositions();
	}

	/* --------------------------------------------------------------------------
	   Touch Swipe on Carousel
	   -------------------------------------------------------------------------- */
	function bindSwipeNavigation() {
		if (!carouselWrapper) return;
		let startX = 0;
		let startY = 0;
		let tracking = false;

		carouselWrapper.addEventListener("touchstart", (e) => {
			if (!e.touches[0]) return;
			tracking = true;
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
		}, { passive: true });

		carouselWrapper.addEventListener("touchmove", (e) => {
			if (!tracking || !e.touches[0]) return;
			const dx = e.touches[0].clientX - startX;
			const dy = e.touches[0].clientY - startY;
			if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
				e.preventDefault();
			}
		}, { passive: false });

		carouselWrapper.addEventListener("touchend", (e) => {
			if (!tracking) return;
			tracking = false;
			const t = e.changedTouches && e.changedTouches[0];
			if (!t) return;
			const dx = t.clientX - startX;
			const dy = t.clientY - startY;
			if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
			step(dx < 0 ? 1 : -1);
		}, { passive: true });
	}

	/* --------------------------------------------------------------------------
	   Lightbox Modal (Preserved & Enhanced)
	   -------------------------------------------------------------------------- */
	function mediaHtml(item) {
		if (item.type === "video" && item.youtube) {
			return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.youtube)}?autoplay=1&rel=0" title="${escapeHtml(item.title)}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
		}
		if (item.type === "video") {
			return `<video src="${escapeHtml(item.src)}" poster="${escapeHtml(thumb(item))}" controls autoplay playsinline preload="metadata"></video>`;
		}
		return `<img class="gallery-lb-photo" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.title)}" decoding="async" />`;
	}

	function paintLightbox() {
		const item = visibleItems[lightboxIndex];
		if (!item || !stage) return;
		stage.innerHTML = mediaHtml(item);
		if (countEl) {
			countEl.textContent = visibleItems.length ? (lightboxIndex + 1) + " / " + visibleItems.length : "";
		}
		const showNav = visibleItems.length > 1;
		if (lbPrevBtn) lbPrevBtn.hidden = !showNav;
		if (lbNextBtn) lbNextBtn.hidden = !showNav;
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
		if (!visibleItems.length) return;
		lightboxIndex = (lightboxIndex + dir + visibleItems.length) % visibleItems.length;
		paintLightbox();
	}

	function bindLightboxSwipe() {
		if (!lightbox || lightbox.dataset.swipeBound === "1") return;
		lightbox.dataset.swipeBound = "1";
		let startX = 0;
		let startY = 0;
		let tracking = false;

		lightbox.addEventListener("touchstart", (e) => {
			if (lightbox.hidden || !e.touches[0]) return;
			if (e.target.closest(".gallery-lb-close, .gallery-lb-nav")) return;
			tracking = true;
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
		}, { passive: true });

		lightbox.addEventListener("touchend", (e) => {
			if (!tracking) return;
			tracking = false;
			const t = e.changedTouches && e.changedTouches[0];
			if (!t) return;
			const dx = t.clientX - startX;
			const dy = t.clientY - startY;
			if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
			stepLightbox(dx < 0 ? 1 : -1);
		}, { passive: true });
	}

	/* --------------------------------------------------------------------------
	   Init UI
	   -------------------------------------------------------------------------- */
	function bindControls() {
		prevBtn?.addEventListener("click", () => step(-1));
		nextBtn?.addEventListener("click", () => step(1));

		// Lightbox controls
		lbCloseBtn?.addEventListener("click", closeLightbox);
		lbPrevBtn?.addEventListener("click", () => stepLightbox(-1));
		lbNextBtn?.addEventListener("click", () => stepLightbox(1));
		lightbox?.addEventListener("click", (e) => {
			if (e.target === lightbox) closeLightbox();
		});

		// Keyboard controls
		document.addEventListener("keydown", (e) => {
			if (lightbox && !lightbox.hidden) {
				if (e.key === "Escape") closeLightbox();
				if (e.key === "ArrowLeft") stepLightbox(-1);
				if (e.key === "ArrowRight") stepLightbox(1);
				return;
			}
			if (e.key === "ArrowLeft") step(-1);
			if (e.key === "ArrowRight") step(1);
		});

		bindSwipeNavigation();
		bindLightboxSwipe();
	}

	document.addEventListener("DOMContentLoaded", () => {
		renderCategoryPills();
		renderCarousel();
		bindControls();
	});
})();
