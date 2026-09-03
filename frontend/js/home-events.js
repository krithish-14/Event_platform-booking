/**
 * JOD Events — Dynamic Home Page (hero + carousel)
 * Only published events from the API — no static fallbacks.
 */
(function initHomeEvents() {
	"use strict";

	const page = (window.JodUrls && window.JodUrls.currentPageFile)
		? window.JodUrls.currentPageFile()
		: (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
	if (page !== "index.html") return;

	const EP = window.JodEventsPublic;
	if (!EP) return;

	const HERO_ROTATE_MS = 15000;
	let heroTimer = null;
	let heroIndex = 0;
	let heroEvents = [];
	let heroPaused = false;
	let heroAnimating = false;
	let heroHoverBound = false;

	function stopHeroRotation() {
		if (heroTimer) {
			clearInterval(heroTimer);
			heroTimer = null;
		}
	}

	function paintHero(event) {
		EP.renderHero(event);
		if (EP.renderAnnouncementBar) EP.renderAnnouncementBar(event);
		if (typeof EP.startCountdownTicker === "function") EP.startCountdownTicker();
	}

	function bindHeroHoverPause() {
		const hero = document.querySelector(".hero");
		if (!hero || heroHoverBound) return;
		heroHoverBound = true;
		hero.addEventListener("mouseenter", () => { heroPaused = true; });
		hero.addEventListener("mouseleave", () => { heroPaused = false; });
	}

	function slideHeroTo(event) {
		const hero = document.querySelector(".hero");
		if (!hero || !event) {
			paintHero(event);
			return;
		}
		heroAnimating = true;
		hero.classList.remove("hero-slide-in");
		hero.classList.add("hero-slide-out");
		window.setTimeout(() => {
			paintHero(event);
			hero.classList.remove("hero-slide-out");
			hero.classList.add("hero-slide-in");
			window.setTimeout(() => {
				hero.classList.remove("hero-slide-in");
				heroAnimating = false;
			}, 520);
		}, 380);
	}

	function startHeroRotation(events) {
		stopHeroRotation();
		heroEvents = Array.isArray(events) ? events.filter(Boolean) : [];
		if (!heroEvents.length) {
			window.__jodFeaturedEvent = null;
			paintHero(null);
			return;
		}

		const featured = EP.pickFeaturedEvent ? EP.pickFeaturedEvent(heroEvents) : heroEvents[0];
		heroIndex = Math.max(0, heroEvents.findIndex((ev) => String(ev.id) === String(featured && featured.id)));
		if (heroIndex < 0) heroIndex = 0;
		window.__jodFeaturedEvent = heroEvents[heroIndex];
		paintHero(heroEvents[heroIndex]);
		bindHeroHoverPause();

		if (heroEvents.length < 2) return;

		heroTimer = window.setInterval(() => {
			if (heroPaused || document.hidden || heroAnimating) return;
			heroIndex = (heroIndex + 1) % heroEvents.length;
			window.__jodFeaturedEvent = heroEvents[heroIndex];
			slideHeroTo(heroEvents[heroIndex]);
		}, HERO_ROTATE_MS);
	}

	async function loadAndRender() {
		const track = document.querySelector("[data-carousel-track]");
		const carouselSection = document.getElementById("upcoming");

		if (track) EP.showLoadingState(track, "Loading events…");

		try {
			const events = await EP.fetchPublishedEvents({ limit: 24 });

			if (!events.length) {
				stopHeroRotation();
				window.__jodFeaturedEvent = null;
				EP.renderHero(null);
				if (EP.renderFeaturedPopup) EP.renderFeaturedPopup(null);
				if (EP.renderAnnouncementBar) EP.renderAnnouncementBar(null);
				document.querySelectorAll("[data-category-count]").forEach((el) => {
					el.textContent = "0 Events";
				});
				if (track) {
					EP.showEmptyState(track, "No events available", "Published events will appear here.");
				}
				return;
			}

			const featured = EP.pickFeaturedEvent ? EP.pickFeaturedEvent(events) : events[0];
			window.__jodFeaturedEvent = featured;
			startHeroRotation(events);
			if (EP.renderFeaturedPopup) EP.renderFeaturedPopup(featured);

			if (track) {
				track.classList.remove("is-empty");
				const delays = ["", "reveal-delay-1", "reveal-delay-2", "reveal-delay-3", "reveal-delay-4"];
				track.innerHTML = events.slice(0, 8).map((ev, i) =>
					EP.buildCarouselCard(ev, delays[i % delays.length])
				).join("");
				if (window.JodWishlist && typeof window.JodWishlist.refreshButtons === "function") {
					window.JodWishlist.refreshButtons(track);
				}
			}

			EP.startCountdownTicker();

			const counts = {};
			events.forEach((ev) => {
				const key = ev.category || "";
				if (!key) return;
				counts[key] = (counts[key] || 0) + 1;
			});
			document.querySelectorAll("[data-category-count]").forEach((el) => {
				const key = el.getAttribute("data-category-count");
				const n = counts[key] || 0;
				el.textContent = n === 1 ? "1 Event" : `${n} Events`;
			});

			if (carouselSection && window.dispatchEvent) {
				window.dispatchEvent(new CustomEvent("jod:events-loaded", { detail: { count: events.length, events } }));
			}
		} catch (err) {
			console.warn("[HomeEvents]", err);
			stopHeroRotation();
			EP.renderHero(null);
			if (EP.renderFeaturedPopup) EP.renderFeaturedPopup(null);
			if (EP.renderAnnouncementBar) EP.renderAnnouncementBar(null);
			if (track) {
				EP.showErrorState(track, err.message || "Unable to load events. Please try again.", loadAndRender);
			}
		}
	}

	window.addEventListener("jod:public-events-pruned", () => {
		const track = document.querySelector("[data-carousel-track]");
		if (track && !track.querySelector(".event-card")) {
			EP.showEmptyState(track, "No events available", "Timed events appear here while they are on sale.");
		}
	});
	window.addEventListener("jod:featured-expired", () => {
		const remaining = (heroEvents || []).filter((ev) => !EP.isEventCurrentlyVisible || EP.isEventCurrentlyVisible(ev));
		startHeroRotation(remaining);
	});

	window.addEventListener("includesLoaded", () => {
		const current = heroEvents[heroIndex] || window.__jodFeaturedEvent;
		if (current && EP.renderAnnouncementBar) {
			EP.renderAnnouncementBar(current);
		}
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", loadAndRender);
	} else {
		loadAndRender();
	}

	// Refetch when returning via bfcache or when tab becomes visible again
	window.addEventListener("pageshow", (e) => {
		if (e.persisted) loadAndRender();
	});
	let homeRefetchTimer = null;
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			clearTimeout(homeRefetchTimer);
			homeRefetchTimer = setTimeout(loadAndRender, 400);
		}
	});
})();
