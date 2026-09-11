/**
 * JOD Events — Modern Editorial Layered Image Carousel
 * Visual Diary & Event Gallery with 4:5 Aspect Ratio, Dynamic 3D Layering,
 * Event Filtering (Singapenn Marathon, Sandd, Conference), Smooth Transitions,
 * and Fullscreen Lightbox Integration.
 */
(function () {
	"use strict";

	function asset(path) {
		if (window.JodConfig && typeof window.JodConfig.assetUrl === "function") {
			return window.JodConfig.assetUrl(path);
		}
		const clean = String(path || "").replace(/^\/+/, "");
		if (clean.startsWith("images/")) {
			return "https://assets.jodevents.com/" + clean;
		}
		return "https://assets.jodevents.com/images/" + clean;
	}

	const FALLBACK = asset("images/Picflow Images Aug 20/2G5A0980.webp");

	/* --------------------------------------------------------------------------
	   Event Galleries Data (Configured with Cloudflare R2 Folders)
	   - Singapenn Marathon 2026: images/Picflow Images Aug 20/
	   - Sandd: images/Sandd/
	   - Conference: images/Conference/
	   -------------------------------------------------------------------------- */
	const EVENT_GALLERIES = [
		{
			id: "all",
			name: "All Events"
		},
		{
			id: "marathon",
			name: "Singapenn Marathon 2026",
			folder: "images/Picflow Images Aug 20",
			items: [
				{ id: "sm-1", title: "Singapenn Marathon 2026", file: "8I2A8909.webp", type: "image" },
				{ id: "sm-2", title: "Marathon Celebration", file: "2G5A0980.webp", type: "image" },
				{ id: "sm-3", title: "Festival Stage Celebration", file: "773A2389.webp", type: "image" },
				{ id: "sm-4", title: "Runners on Route", file: "8I2A8969.webp", type: "image" },
				{ id: "sm-5", title: "Award Ceremony", file: "2G5A0951.webp", type: "image" },
				{ id: "sm-6", title: "Cheering Participants", file: "2G5A1131.webp", type: "image" },
				{ id: "sm-7", title: "Morning Warm-Up", file: "773A2231.webp", type: "image" },
				{ id: "sm-8", title: "Flag-Off Highlights", file: "8I2A9088.webp", type: "image" },
				{ id: "sm-9", title: "Community Runners", file: "8I2A9521.webp", type: "image" },
				{ id: "sm-10", title: "Medal Distribution", file: "8I2A9250.webp", type: "image" },
				{ id: "sm-11", title: "Event Grand Finale", file: "773A2276.webp", type: "image" }
			]
		},
		{
			id: "sandd",
			name: "Sandd",
			folder: "images/Sandd",
			items: [
				{ id: "sd-intro", title: "Sandd Showcase", file: "intro.webp", type: "image" },
				{ id: "sd-1", title: "Sandd Moments 01", file: "1.webp", type: "image" },
				{ id: "sd-2", title: "Sandd Moments 02", file: "2.webp", type: "image" },
				{ id: "sd-3", title: "Sandd Moments 03", file: "3.webp", type: "image" },
				{ id: "sd-4", title: "Sandd Moments 04", file: "4.webp", type: "image" },
				{ id: "sd-5", title: "Sandd Moments 05", file: "5.webp", type: "image" },
				{ id: "sd-6", title: "Sandd Moments 06", file: "6.webp", type: "image" },
				{ id: "sd-7", title: "Sandd Moments 07", file: "7.webp", type: "image" },
				{ id: "sd-8", title: "Sandd Moments 08", file: "8.webp", type: "image" },
				{ id: "sd-9", title: "Sandd Moments 09", file: "9.webp", type: "image" },
				{ id: "sd-10", title: "Sandd Moments 10", file: "10.webp", type: "image" }
			]
		},
		{
			id: "conference",
			name: "Conference",
			folder: "images/Conference",
			items: [
				{ id: "conf-1", title: "Keynote & Panel Discussion", file: "IMG_6945.JPG.webp", type: "image" },
				{ id: "conf-2", title: "Leadership Stage", file: "IMG_6961.JPG.webp", type: "image" },
				{ id: "conf-3", title: "Delegate Interactive Session", file: "IMG_7054.JPG.webp", type: "image" },
				{ id: "conf-4", title: "Speaker Address", file: "IMG_7062.JPG.webp", type: "image" },
				{ id: "conf-5", title: "Networking & Experience", file: "IMG_7073.JPG.webp", type: "image" },
				{ id: "conf-6", title: "Conference Highlights", file: "IMG_7076.JPG.webp", type: "image" }
			]
		}
	];

	// Flatten all items with full URL and event name attached
	const ALL_EVENT_ITEMS = [];
	EVENT_GALLERIES.forEach((ev) => {
		if (!ev.items) return;
		ev.items.forEach((it) => {
			const itemUrl = asset(ev.folder + "/" + it.file);
			const fullItem = {
				id: it.id,
				title: it.title,
				category: ev.name,
				eventId: ev.id,
				type: it.type || "image",
				src: itemUrl,
				poster: itemUrl
			};
			ALL_EVENT_ITEMS.push(fullItem);
		});
	});

	let activeEventId = "all";
	let visibleItems = ALL_EVENT_ITEMS.slice();
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
	   Event Buttons (Category Filter Pills)
	   -------------------------------------------------------------------------- */
	function renderEventButtons() {
		if (!filtersContainer) return;
		filtersContainer.innerHTML = EVENT_GALLERIES.map((ev) => {
			const isActive = ev.id === activeEventId;
			return `<button type="button" class="gallery-pill ${isActive ? "is-active" : ""}" data-event-id="${escapeHtml(ev.id)}" role="tab" aria-selected="${isActive}">
				${escapeHtml(ev.name)}
			</button>`;
		}).join("");

		filtersContainer.querySelectorAll(".gallery-pill").forEach((pill) => {
			pill.addEventListener("click", () => {
				const id = pill.getAttribute("data-event-id");
				selectEvent(id);
			});
		});
	}

	function selectEvent(eventId) {
		activeEventId = eventId;

		if (eventId === "all") {
			visibleItems = ALL_EVENT_ITEMS.slice();
		} else {
			visibleItems = ALL_EVENT_ITEMS.filter((it) => it.eventId === eventId);
		}

		currentIndex = 0;

		document.querySelectorAll(".gallery-pill").forEach((pill) => {
			const on = pill.getAttribute("data-event-id") === eventId;
			pill.classList.toggle("is-active", on);
			pill.setAttribute("aria-selected", String(on));
			if (on && typeof pill.scrollIntoView === "function") {
				pill.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
			}
		});

		renderCarousel();
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
				} else {
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
		renderEventButtons();
		renderCarousel();
		bindControls();
	});
})();
