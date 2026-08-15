/**
 * JOD Events — Dynamic Home Page (hero + carousel)
 * Only published events from the API — no static fallbacks.
 */
(function initHomeEvents() {
	"use strict";

	const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
	if (page !== "index.html" && page !== "") return;

	const EP = window.JodEventsPublic;
	if (!EP) return;

	async function loadAndRender() {
		const track = document.querySelector("[data-carousel-track]");
		const carouselSection = document.getElementById("upcoming");

		if (track) EP.showLoadingState(track, "Loading events…");

		try {
			const events = await EP.fetchPublishedEvents({ limit: 12 });

			if (!events.length) {
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
			EP.renderHero(featured);
			if (EP.renderFeaturedPopup) EP.renderFeaturedPopup(featured);
			if (EP.renderAnnouncementBar) EP.renderAnnouncementBar(featured);

			if (track) {
				const delays = ["", "reveal-delay-1", "reveal-delay-2", "reveal-delay-3", "reveal-delay-4"];
				track.innerHTML = events.slice(0, 8).map((ev, i) =>
					EP.buildCarouselCard(ev, delays[i % delays.length])
				).join("");
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
			EP.renderHero(null);
			if (EP.renderFeaturedPopup) EP.renderFeaturedPopup(null);
			if (EP.renderAnnouncementBar) EP.renderAnnouncementBar(null);
			if (track) {
				EP.showErrorState(track, err.message || "Unable to load events. Please try again.", loadAndRender);
			}
		}
	}

	window.addEventListener("includesLoaded", () => {
		if (window.__jodFeaturedEvent && EP.renderAnnouncementBar) {
			EP.renderAnnouncementBar(window.__jodFeaturedEvent);
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
