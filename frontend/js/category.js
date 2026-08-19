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

	const EP = window.JodEventsPublic;

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
			try {
				if (window.JodLocation && typeof window.JodLocation.getCachedCity === "function") {
					return window.JodLocation.getCachedCity() || "Chennai";
				}
				return sessionStorage.getItem("jod_user_city") || localStorage.getItem("jod_user_city") || "Chennai";
			} catch (_) {
				return "Chennai";
			}
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
			const canonical = {
				sports: "Sports",
				conferences: "Conferences",
				performances: "Performances",
				experiences: "Experiences",
				expositions: "Expositions",
				parties: "Parties"
			};
			filterState.category = canonical[initialCategory.toLowerCase()] || initialCategory;
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
		if (!EP) throw new Error("Events module not loaded.");
		const params = { limit: 50 };

		if (filterState.category && filterState.category !== "all") {
			params.category = filterState.category;
		}
		if (filterState.format && filterState.format !== "all") {
			const formatMap = { "in-person": "In-person", "online": "Online", "hybrid": "Hybrid" };
			params.event_format = formatMap[filterState.format] || filterState.format;
		}
		if (filterState.date && filterState.date !== "all") {
			params.date_filter = filterState.date;
		}
		if (filterState.price && filterState.price !== "all") {
			if (filterState.price === "free") params.max_price = 0;
			else if (filterState.price === "0-500") { params.min_price = 0; params.max_price = 500; }
			else if (filterState.price === "501-2000") { params.min_price = 501; params.max_price = 2000; }
			else if (filterState.price === "above-2000") params.min_price = 2001;
		}

		return EP.fetchPublishedEvents(params);
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
			if (emptyState) {
				const catName = filterState.category !== "all" ? filterState.category : "this category";
				const hasFilters = Object.values(filterState).some(v => v && v !== "all");
				const titleEl = emptyState.querySelector("h3");
				const msgEl = emptyState.querySelector("p");
				if (titleEl) titleEl.textContent = hasFilters ? "No Events Found" : "No events available in this category";
				if (msgEl) {
					msgEl.textContent = hasFilters
						? "We couldn't find any published events matching your filters. Try clearing some filters."
						: `No published events in ${catName} yet. Check back later for upcoming events.`;
				}
				emptyState.hidden = false;
			}
			return;
		}

		if (emptyState) emptyState.hidden = true;

		grid.innerHTML = events.map((item) => EP ? EP.buildCategoryCard(item) : "").join("");
		if (window.JodWishlist && typeof window.JodWishlist.refreshButtons === "function") {
			window.JodWishlist.refreshButtons(grid);
		}
		if (EP && typeof EP.startCountdownTicker === "function") {
			EP.startCountdownTicker();
		}
	}

	async function updateAndRender() {
		const grid = document.getElementById("categoryEventsGrid");
		const countEl = document.getElementById("resultsCount");
		if (grid && EP) EP.showLoadingState(grid, "Loading events…");
		if (countEl) countEl.textContent = "Loading events…";
		try {
			const events = await fetchEventsFromBackend();
			if (typeof console !== "undefined" && console.debug) {
				console.debug("[CATEGORY EVENTS]", filterState.category, "returned", events.length);
			}
			renderEvents(events);
		} catch (err) {
			console.warn("[Category]", err);
			if (grid && EP) {
				EP.showErrorState(grid, err.message || "Unable to load events. Please try again.", updateAndRender);
			}
			if (countEl) countEl.textContent = "Unable to load events";
		}
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

		const filterToggle = document.getElementById("catFilterToggle");
		const sidebar = document.getElementById("catSidebar");
		filterToggle?.addEventListener("click", () => {
			const open = sidebar?.classList.toggle("is-open");
			filterToggle.setAttribute("aria-expanded", String(Boolean(open)));
			filterToggle.textContent = open ? "Hide filters" : "Filters";
		});

		document.querySelectorAll(".filter-group-header").forEach((header) => {
			header.addEventListener("click", (event) => {
				if (event.target.closest(".btn-clear-group")) return;
				if (window.innerWidth > 1024) return;
				header.parentElement?.classList.toggle("is-expanded");
			});
		});
		const firstGroup = document.querySelector(".filter-group");
		if (firstGroup) firstGroup.classList.add("is-expanded");
	}

	document.addEventListener("DOMContentLoaded", () => {
		initCategoryHeader();
		bindFilterEvents();
		updateAndRender();
	});

})();
