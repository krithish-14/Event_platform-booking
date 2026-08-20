/**
 * JOD Events — Dynamic Search & Suggestions Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time debounced search for header search bar.
 * Groups search results by:
 *   - Events & Performances (titles, artists, hosts)
 *   - Venues & Locations
 *   - Categories
 *   - Months & Dates
 *
 * Supports:
 *   - Matched text highlighting (<mark class="search-highlight">)
 *   - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 *   - Desktop & Mobile search bars
 *   - Direct navigation to event details or category pages
 */

window.JodSearch = (() => {
  "use strict";

  const DEBOUNCE_MS = 200;

  function getApiBase() {
    if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
      return window.JodHealth.getApiBaseUrl();
    }
    const host = window.location.hostname && window.location.hostname !== "localhost" ? window.location.hostname : "127.0.0.1";
    return window.JOD_API_BASE_OVERRIDE || `http://${host}:8001`;
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightMatch(text, query) {
    if (!text || !query) return text || "";
    const cleanQuery = query.trim();
    if (!cleanQuery) return text;
    const re = new RegExp(`(${escapeRegExp(cleanQuery)})`, "gi");
    return text.replace(re, '<mark class="search-highlight">$1</mark>');
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (_) {
      return "";
    }
  }

  function formatPrice(price) {
    if (price == null || price === 0) return "Free";
    return `₹${Number(price).toLocaleString("en-IN")}`;
  }

  // Active search instances
  const activeInstances = new Map();

  class SearchController {
    constructor(rootEl) {
      this.root = rootEl;
      this.input = rootEl.querySelector("input[type='text'], input[type='search']");
      this.clearBtn = rootEl.querySelector(".search-clear");
      this.dropdown = null;
      this.debounceTimer = null;
      this.currentResults = [];
      this.selectedIndex = -1;
      this.init();
    }

    init() {
      if (!this.input) return;

      // Ensure container has relative positioning
      this.root.style.position = "relative";

      // Create or locate dropdown panel
      this.dropdown = this.root.querySelector(".search-suggestions-dropdown");
      if (!this.dropdown) {
        this.dropdown = document.createElement("div");
        this.dropdown.className = "search-suggestions-dropdown";
        this.dropdown.setAttribute("role", "listbox");
        this.dropdown.setAttribute("aria-label", "Search suggestions");
        this.root.appendChild(this.dropdown);
      }

      // Input event listener (debounced)
      this.input.addEventListener("input", () => {
        const query = this.input.value.trim();
        if (this.clearBtn) {
          this.clearBtn.style.opacity = query ? "1" : "0";
          this.clearBtn.style.visibility = query ? "visible" : "hidden";
        }
        clearTimeout(this.debounceTimer);
        if (!query) {
          this.closeDropdown();
          return;
        }
        this.debounceTimer = setTimeout(() => this.performSearch(query), DEBOUNCE_MS);
      });

      // Focus event
      this.input.addEventListener("focus", () => {
        const query = this.input.value.trim();
        if (query && this.currentResults.length > 0) {
          this.openDropdown();
        } else if (query) {
          this.performSearch(query);
        }
      });

      // Keyboard navigation
      this.input.addEventListener("keydown", (e) => this.handleKeydown(e));

      // Clear button handler
      if (this.clearBtn) {
        this.clearBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.input.value = "";
          this.input.focus();
          if (this.clearBtn) {
            this.clearBtn.style.opacity = "0";
            this.clearBtn.style.visibility = "hidden";
          }
          this.closeDropdown();
        });
      }

      // Close on outside click
      document.addEventListener("click", (e) => {
        if (!this.root.contains(e.target)) {
          this.closeDropdown();
        }
      });
    }

    async performSearch(query) {
      this.renderLoading(query);
      this.openDropdown();

      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/api/events/search?q=${encodeURIComponent(query)}&limit=15`);
        if (!res.ok) throw new Error("API search failed");
        const events = await res.json();
        this.currentResults = events || [];
        this.renderResults(query, this.currentResults);
      } catch (err) {
        this.currentResults = [];
        this.dropdown.innerHTML = `
          <div class="search-empty-state">
            <span class="empty-icon">⚠️</span>
            <p>Unable to load search results. Please try again.</p>
          </div>
        `;
      }
    }

    renderLoading(query) {
      this.dropdown.innerHTML = `
        <div class="search-dropdown-header">
          <span>Searching for "${this.escapeHtml(query)}"...</span>
          <span class="search-spinner"></span>
        </div>
      `;
    }

    renderResults(query, events) {
      this.selectedIndex = -1;
      if (!events || events.length === 0) {
        this.dropdown.innerHTML = `
          <div class="search-empty-state">
            <span class="empty-icon">🔍</span>
            <p>No events found for "<strong>${this.escapeHtml(query)}</strong>"</p>
            <small>Try searching for categories (e.g. Comedy, Music), venues (e.g. Chennai, Marina), or months (e.g. November)</small>
          </div>
        `;
        return;
      }

      // Categorize results
      const eventsList = [];
      const venuesSet = new Map();
      const categoriesSet = new Map();

      events.forEach((ev) => {
        eventsList.push(ev);
        if (ev.venue || ev.location) {
          const vName = ev.venue || ev.location;
          venuesSet.set(vName, (venuesSet.get(vName) || 0) + 1);
        }
        if (ev.category) {
          categoriesSet.set(ev.category, (categoriesSet.get(ev.category) || 0) + 1);
        }
      });

      let html = `<div class="search-dropdown-content">`;

      // 🎭 Events Section
      if (eventsList.length > 0) {
        html += `<div class="search-group-title">🎭 Events (${eventsList.length})</div>`;
        eventsList.forEach((ev) => {
          const formattedDate = formatDateShort(ev.start_date);
          const priceText = formatPrice(ev.price);
          const highlightedTitle = highlightMatch(this.escapeHtml(ev.title), query);
          const highlightedVenue = highlightMatch(this.escapeHtml(ev.venue || ev.location || ""), query);

          const safeId = encodeURIComponent(ev.id);
          const thumb = this.escapeHtml(ev.image_url || "images/JOD Events Logo.png");
          html += `
            <a href="event-details.html?id=${safeId}" class="search-suggestion-item" data-type="event" data-id="${this.escapeHtml(ev.id)}">
              <img class="suggestion-thumb" src="${thumb}" alt="" />
              <div class="suggestion-info">
                <div class="suggestion-title">${highlightedTitle}</div>
                <div class="suggestion-sub">
                  <span>📍 ${highlightedVenue}</span>
                  ${formattedDate ? `<span>• 📅 ${formattedDate}</span>` : ""}
                </div>
              </div>
              <span class="suggestion-price">${priceText}</span>
            </a>
          `;
        });
      }

      // 📍 Venues & Locations Section
      if (venuesSet.size > 0) {
        html += `<div class="search-group-title">📍 Venues & Locations</div>`;
        Array.from(venuesSet.entries()).slice(0, 3).forEach(([vName, count]) => {
          const highlightedVName = highlightMatch(this.escapeHtml(vName), query);
          html += `
            <div class="search-suggestion-item search-filter-item" data-type="venue" data-query="${this.escapeHtml(vName)}">
              <span class="suggestion-icon">📍</span>
              <div class="suggestion-info">
                <div class="suggestion-title">${highlightedVName}</div>
                <div class="suggestion-sub">${count} event${count > 1 ? "s" : ""} nearby</div>
              </div>
              <span class="suggestion-arrow">→</span>
            </div>
          `;
        });
      }

      // 🏷️ Categories Section
      if (categoriesSet.size > 0) {
        html += `<div class="search-group-title">🏷️ Categories</div>`;
        Array.from(categoriesSet.entries()).slice(0, 3).forEach(([cat, count]) => {
          const highlightedCat = highlightMatch(this.escapeHtml(cat), query);
          html += `
            <div class="search-suggestion-item search-filter-item" data-type="category" data-query="${this.escapeHtml(cat)}">
              <span class="suggestion-icon">🏷️</span>
              <div class="suggestion-info">
                <div class="suggestion-title">${highlightedCat}</div>
                <div class="suggestion-sub">${count} event${count > 1 ? "s" : ""} in this category</div>
              </div>
              <span class="suggestion-arrow">→</span>
            </div>
          `;
        });
      }

      html += `</div>`; // .search-dropdown-content

      // Dropdown footer
      html += `
        <div class="search-dropdown-footer">
          <span>Press <strong>Enter</strong> to search all events for "${this.escapeHtml(query)}"</span>
        </div>
      `;

      this.dropdown.innerHTML = html;

      // Bind click handlers on items
      this.dropdown.querySelectorAll(".search-suggestion-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          const type = item.dataset.type;
          if (type === "category") {
            e.preventDefault();
            const filterQuery = item.dataset.query;
            window.location.href = `category.html?name=${encodeURIComponent(filterQuery)}`;
          } else if (type === "venue") {
            e.preventDefault();
            const filterQuery = item.dataset.query;
            window.location.href = `index.html?q=${encodeURIComponent(filterQuery)}`;
          }
        });
      });
    }

    handleKeydown(e) {
      const items = Array.from(this.dropdown.querySelectorAll(".search-suggestion-item"));

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        this.selectedIndex = (this.selectedIndex + 1) % items.length;
        this.updateItemSelection(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        this.selectedIndex = (this.selectedIndex - 1 + items.length) % items.length;
        this.updateItemSelection(items);
      } else if (e.key === "Enter") {
        if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
          e.preventDefault();
          items[this.selectedIndex].click();
        } else {
          const q = this.input.value.trim();
          if (q) {
            e.preventDefault();
            window.location.href = `index.html?q=${encodeURIComponent(q)}`;
          }
        }
      } else if (e.key === "Escape") {
        this.closeDropdown();
      }
    }

    updateItemSelection(items) {
      items.forEach((item, idx) => {
        const isSelected = idx === this.selectedIndex;
        item.classList.toggle("is-selected", isSelected);
        if (isSelected) {
          item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    }

    openDropdown() {
      if (this.dropdown) this.dropdown.classList.add("is-visible");
    }

    closeDropdown() {
      if (this.dropdown) this.dropdown.classList.remove("is-visible");
      this.selectedIndex = -1;
    }

    escapeHtml(str) {
      if (!str) return "";
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
  }

  function initSearch(rootSelector = ".header-search, .mobile-header-search") {
    if (typeof document === "undefined") return;
    document.querySelectorAll(rootSelector).forEach((root) => {
      if (!activeInstances.has(root)) {
        activeInstances.set(root, new SearchController(root));
      }
    });
  }

  // Auto-init on DOMContentLoaded
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      initSearch();
    });
  }

  return {
    initSearch,
    SearchController,
  };
})();
