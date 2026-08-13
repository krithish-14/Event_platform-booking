/**
 * JOD Events — Category Listing & Filtering Module
 * Handles category carousel navigation, BookMyShow-style filtering, and event grid rendering.
 */

(function initCategoryPage() {
	"use strict";

	function getApiBase() {
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		const host = (window.location && window.location.hostname && window.location.hostname !== "localhost") ? window.location.hostname : "127.0.0.1";
		return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;
	}

	// Active filter state
	const filterState = {
		category: "all",
		subtopic: "all",
		date: "all",
		format: "all",
		price: "all",
	};

	// Fallback rich dataset if backend is offline or returns empty
	const SEED_FALLBACK_EVENTS = [
		{
			id: "22222222-2222-2222-2222-222222222222",
			title: "Chennai Business Leaders Summit 2026",
			description: "The city's most anticipated corporate gathering",
			category: "Corporate Conference",
			venue: "ITC Grand Chola",
			location: "Chennai",
			start_date: "2026-08-15T04:30:00Z",
			price: 4999,
			event_format: "Hybrid",
			image_url: "images/hero-event.jpg",
			target_url: "event-details.html?id=22222222-2222-2222-2222-222222222222"
		},
		{
			id: "66666666-6666-6666-6666-666666666666",
			title: "Makeup & Boutique Masterclass Workshop",
			description: "Masterclass on beauty glam, boutique styling & fashion",
			category: "Workshop & Fashion",
			venue: "Express Avenue",
			location: "Chennai",
			start_date: "2026-09-25T10:00:00Z",
			price: 499,
			event_format: "In-person",
			image_url: "images/event-workshop.png",
			target_url: "makeup-boutique-workshop.html?id=66666666-6666-6666-6666-666666666666"
		},
		{
			id: "33333333-3333-3333-3333-333333333333",
			title: "BrandLaunchpad - Product Reveal Night",
			description: "An immersive launch experience for D2C brands",
			category: "Product Launch",
			venue: "Phoenix MarketCity",
			location: "Chennai",
			start_date: "2026-09-12T13:30:00Z",
			price: 1299,
			event_format: "In-person",
			image_url: "images/event-launch.jpg",
			target_url: "event-details.html?id=33333333-3333-3333-3333-333333333333"
		},
		{
			id: "44444444-4444-4444-4444-444444444444",
			title: "The Royal Soiree - Signature Wedding Showcase",
			description: "Curated ideas for couples planning something extraordinary",
			category: "Wedding Showcase",
			venue: "Leela Palace",
			location: "Chennai",
			start_date: "2026-10-05T13:00:00Z",
			price: 2499,
			event_format: "In-person",
			image_url: "images/event-wedding.jpg",
			target_url: "event-details.html?id=44444444-4444-4444-4444-444444444444"
		},
		{
			id: "11111111-1111-1111-1111-111111111111",
			title: "VIR DAS - SOUNDS OF INDIA - CHENNAI",
			description: "Live standup comedy special featuring Vir Das",
			category: "Standup Comedy",
			venue: "Sir Mutha Venkatasubba Rao Hall",
			location: "Chennai",
			start_date: "2026-08-20T19:00:00Z",
			price: 1999,
			event_format: "In-person",
			image_url: "images/hero-event.jpg",
			target_url: "event-details.html?id=11111111-1111-1111-1111-111111111111"
		},
		{
			id: "55555555-5555-5555-5555-555555555555",
			title: "Marina Cultural Fest 2026",
			description: "A community celebration of music, food and heritage",
			category: "Cultural Festival",
			venue: "Marina Grounds",
			location: "Chennai",
			start_date: "2026-11-22T11:30:00Z",
			price: 499,
			event_format: "In-person",
			image_url: "images/event-festival.jpg",
			target_url: "event-details.html?id=55555555-5555-5555-5555-555555555555"
		},
		{
			id: "77777777-7777-7777-7777-777777777777",
			title: "Doughnuts & Sweets Making Masterclass",
			description: "Interactive dessert & pastry hands-on session",
			category: "Workshop & Food",
			venue: "Kreate By Kraft",
			location: "Chennai",
			start_date: "2026-08-18T10:00:00Z",
			price: 2500,
			event_format: "In-person",
			image_url: "images/event-workshop.png",
			target_url: "makeup-boutique-workshop.html?id=66666666-6666-6666-6666-666666666666"
		},
		{
			id: "88888888-8888-8888-8888-888888888888",
			title: "Tie Dye & Resin Lamp Art Workshop",
			description: "Creative crafting & resin glow lamp building masterclass",
			category: "Workshop & Arts",
			venue: "Cafe Coffee Day",
			location: "Chennai",
			start_date: "2026-08-25T14:00:00Z",
			price: 899,
			event_format: "In-person",
			image_url: "images/event-workshop.png",
			target_url: "makeup-boutique-workshop.html?id=66666666-6666-6666-6666-666666666666"
		}
	];

	function getQueryParam(name) {
		const params = new URLSearchParams(window.location.search);
		return params.get(name) || "";
	}

	function formatDateShort(dateStr) {
		if (!dateStr) return "Upcoming";
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return "Upcoming";
			return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
		} catch (_) {
			return "Upcoming";
		}
	}

	function initCategoryHeader() {
		const initialCategory = getQueryParam("name") || getQueryParam("category") || "Events";
		const userCity = (() => {
			try { return sessionStorage.getItem("jod_user_city") || "Chennai"; } catch (_) { return "Chennai"; }
		})();

		const titleEl = document.getElementById("categoryTitle");
		const badgeEl = document.getElementById("categoryPillBadge");
		const subtitleEl = document.getElementById("categorySubtitle");

		if (titleEl) {
			const displayCategory = initialCategory.charAt(0).toUpperCase() + initialCategory.slice(1);
			titleEl.textContent = `${displayCategory} In ${userCity}`;
		}
		if (badgeEl) {
			badgeEl.textContent = `✨ ${initialCategory} Category`;
		}
		if (subtitleEl) {
			subtitleEl.textContent = `Discover top ${initialCategory.toLowerCase()} events, masterclasses, and curated experiences in ${userCity}.`;
		}

		if (initialCategory && initialCategory.toLowerCase() !== "events") {
			filterState.category = initialCategory.toLowerCase();
			syncSidebarChipState("filterCategoriesList", filterState.category);
		}
	}

	function syncSidebarChipState(containerId, activeVal) {
		const container = document.getElementById(containerId);
		if (!container) return;
		container.querySelectorAll(".filter-chip").forEach((chip) => {
			const val = chip.dataset.category || chip.dataset.date || chip.dataset.format || chip.dataset.price || "all";
			if (val === activeVal || (val === "all" && activeVal === "all")) {
				chip.classList.add("active");
			} else {
				chip.classList.remove("active");
			}
		});
	}

	async function fetchEventsFromBackend() {
		const apiBase = getApiBase();
		const queryParts = [];

		if (filterState.category && filterState.category !== "all") {
			queryParts.push(`category=${encodeURIComponent(filterState.category)}`);
		}
		if (filterState.format && filterState.format !== "all") {
			const formatMap = { "in-person": "In-person", "online": "Online", "hybrid": "Hybrid" };
			const fmt = formatMap[filterState.format] || filterState.format;
			queryParts.push(`event_format=${encodeURIComponent(fmt)}`);
		}
		if (filterState.date && filterState.date !== "all") {
			queryParts.push(`date_filter=${encodeURIComponent(filterState.date)}`);
		}
		if (filterState.price && filterState.price !== "all") {
			if (filterState.price === "free") queryParts.push("max_price=0");
			else if (filterState.price === "0-500") { queryParts.push("min_price=0"); queryParts.push("max_price=500"); }
			else if (filterState.price === "501-2000") { queryParts.push("min_price=501"); queryParts.push("max_price=2000"); }
			else if (filterState.price === "above-2000") queryParts.push("min_price=2001");
		}

		const queryString = queryParts.length ? "?" + queryParts.join("&") : "";
		try {
			const res = await fetch(`${apiBase}/api/events/${queryString}`);
			if (res.ok) {
				const data = await res.json();
				if (Array.isArray(data) && data.length > 0) {
					return data;
				}
			}
		} catch (_) {}

		// Client-side fallback filter over seed dataset
		return filterFallbackEvents();
	}

	function filterFallbackEvents() {
		return SEED_FALLBACK_EVENTS.filter((e) => {
			if (filterState.category !== "all") {
				const catLower = (e.category || "").toLowerCase();
				const qCat = filterState.category.toLowerCase();
				if (!catLower.includes(qCat) && !qCat.includes(catLower)) {
					// Soft matching logic for subtopics
					if (qCat === "workshop" && !catLower.includes("workshop") && !catLower.includes("masterclass")) return false;
					if (qCat === "corporate" && !catLower.includes("corporate") && !catLower.includes("conference")) return false;
					if (qCat === "comedy" && !catLower.includes("comedy") && !catLower.includes("standup")) return false;
					if (qCat === "wedding" && !catLower.includes("wedding") && !catLower.includes("soiree")) return false;
					if (qCat === "festival" && !catLower.includes("festival") && !catLower.includes("cultural")) return false;
					if (qCat === "launch" && !catLower.includes("launch") && !catLower.includes("product")) return false;
				}
			}
			if (filterState.subtopic !== "all") {
				const catLower = (e.category || "").toLowerCase();
				const sub = filterState.subtopic.toLowerCase();
				if (!catLower.includes(sub)) {
					if (sub === "arts" && !catLower.includes("arts") && !catLower.includes("workshop")) return false;
					if (sub === "food" && !catLower.includes("food") && !catLower.includes("sweets")) return false;
					if (sub === "fashion" && !catLower.includes("fashion") && !catLower.includes("boutique")) return false;
				}
			}
			if (filterState.format !== "all") {
				const fmtMap = { "in-person": "In-person", "online": "Online", "hybrid": "Hybrid" };
				const targetFmt = (fmtMap[filterState.format] || "").toLowerCase();
				if (targetFmt && !(e.event_format || "").toLowerCase().includes(targetFmt)) return false;
			}
			if (filterState.price !== "all") {
				const p = e.price || 0;
				if (filterState.price === "free" && p > 0) return false;
				if (filterState.price === "0-500" && (p < 0 || p > 500)) return false;
				if (filterState.price === "501-2000" && (p < 501 || p > 2000)) return false;
				if (filterState.price === "above-2000" && p <= 2000) return false;
			}
			return true;
		});
	}

	function renderEvents(events) {
		const grid = document.getElementById("categoryEventsGrid");
		const countEl = document.getElementById("resultsCount");
		const emptyState = document.getElementById("catEmptyState");
		const tagsContainer = document.getElementById("activeTagsContainer");

		if (!grid) return;

		if (countEl) {
			countEl.textContent = `Showing ${events.length} ${events.length === 1 ? "Event" : "Events"}`;
		}

		// Active tags bar
		if (tagsContainer) {
			tagsContainer.innerHTML = "";
			Object.entries(filterState).forEach(([key, val]) => {
				if (val && val !== "all") {
					const tag = document.createElement("span");
					tag.className = "active-tag";
					tag.innerHTML = `${key}: <strong>${val}</strong> <button type="button" data-clear-key="${key}">&times;</button>`;
					tagsContainer.appendChild(tag);
				}
			});
			tagsContainer.querySelectorAll("button[data-clear-key]").forEach((btn) => {
				btn.addEventListener("click", () => {
					const k = btn.dataset.clearKey;
					if (k) {
						filterState[k] = "all";
						syncSidebarChipState(`filter${k.charAt(0).toUpperCase() + k.slice(1)}List`, "all");
						updateAndRender();
					}
				});
			});
		}

		if (events.length === 0) {
			grid.innerHTML = "";
			if (emptyState) emptyState.hidden = false;
			return;
		}

		if (emptyState) emptyState.hidden = true;

		grid.innerHTML = events.map((item) => {
			const targetUrl = item.target_url || (item.category && item.category.toLowerCase().includes("workshop") ? `makeup-boutique-workshop.html?id=${item.id}` : `event-details.html?id=${item.id}`);
			const priceDisplay = item.price === 0 ? "Free" : `₹${Number(item.price).toLocaleString("en-IN")} onwards`;
			const dateShort = formatDateShort(item.start_date);
			const formatLabel = item.event_format || "In-person";
			const imgUrl = item.image_url || "images/hero-event.jpg";

			return `
				<article class="cat-event-card" onclick="window.location.href='${targetUrl}'">
					<div class="cat-card-image">
						<img src="${imgUrl}" alt="${item.title}" loading="lazy" />
						<span class="date-overlay-badge">📅 ${dateShort}</span>
						<span class="format-overlay-badge">${formatLabel}</span>
					</div>
					<div class="cat-card-body">
						<h3>${item.title}</h3>
						<p class="cat-card-venue">📍 ${item.venue || item.location || "Chennai"}</p>
						<span class="cat-card-cat-badge">${item.category || "Event"}</span>
						<div class="cat-card-price">${priceDisplay}</div>
					</div>
				</article>
			`;
		}).join("");
	}

	async function updateAndRender() {
		const events = await fetchEventsFromBackend();
		renderEvents(events);
	}

	function bindFilterEvents() {
		// Subtopics top chips
		document.querySelectorAll("#subtopicsBar .subtopic-chip").forEach((chip) => {
			chip.addEventListener("click", () => {
				document.querySelectorAll("#subtopicsBar .subtopic-chip").forEach((c) => c.classList.remove("active"));
				chip.classList.add("active");
				filterState.subtopic = chip.dataset.subtopic || "all";
				updateAndRender();
			});
		});

		// Sidebar chip groups
		const wireChipGroup = (containerId, stateKey) => {
			const container = document.getElementById(containerId);
			if (!container) return;
			container.querySelectorAll(".filter-chip").forEach((chip) => {
				chip.addEventListener("click", () => {
					container.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
					chip.classList.add("active");
					filterState[stateKey] = chip.dataset[stateKey] || "all";
					updateAndRender();
				});
			});
		};

		wireChipGroup("filterCategoriesList", "category");
		wireChipGroup("filterDateList", "date");
		wireChipGroup("filterFormatList", "format");
		wireChipGroup("filterPriceList", "price");

		// Clear group buttons
		document.querySelectorAll(".btn-clear-group").forEach((btn) => {
			btn.addEventListener("click", () => {
				const groupKey = btn.dataset.clear;
				if (groupKey) {
					filterState[groupKey] = "all";
					syncSidebarChipState(`filter${groupKey.charAt(0).toUpperCase() + groupKey.slice(1)}List`, "all");
					updateAndRender();
				}
			});
		});

		// Clear all filters
		const clearAllBtn = document.getElementById("btnClearAllFilters");
		const resetFiltersBtn = document.getElementById("btnResetFilters");
		const resetAll = () => {
			filterState.category = "all";
			filterState.subtopic = "all";
			filterState.date = "all";
			filterState.format = "all";
			filterState.price = "all";

			syncSidebarChipState("filterCategoriesList", "all");
			syncSidebarChipState("filterDateList", "all");
			syncSidebarChipState("filterFormatList", "all");
			syncSidebarChipState("filterPriceList", "all");

			document.querySelectorAll("#subtopicsBar .subtopic-chip").forEach((c, idx) => {
				c.classList.toggle("active", idx === 0);
			});

			updateAndRender();
		};

		clearAllBtn?.addEventListener("click", resetAll);
		resetFiltersBtn?.addEventListener("click", resetAll);
	}

	document.addEventListener("DOMContentLoaded", () => {
		initCategoryHeader();
		bindFilterEvents();
		updateAndRender();
	});

})();
