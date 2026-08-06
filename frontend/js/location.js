/**
 * JOD Events — Location Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles geolocation detection, city resolution, manual fallback, backend sync,
 * location confirmation UI, and event recommendation filtering (20 km Haversine).
 *
 * Public API (window.JodLocation):
 *   getUserLocation()              → Promise<{lat, lon}> or throws
 *   sendLocationToBackend(lat,lon) → Promise<{city, ...}>
 *   fallbackManualEntry()          → opens manual entry modal
 *   showLocationConfirmation(city) → renders the toast confirmation
 *   updateRecommendations(loc)     → filters event cards within 20 km
 *   initLocationFlow(opts?)        → master orchestrator (call post-login)
 *   applyCachedRecommendations()   → re-apply filters for returning users
 */

window.JodLocation = (() => {
  "use strict";

  /* ── Config ─────────────────────────────────────────────── */
  const RADIUS_KM = 20;
  function getApiBase() {
    if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
      return window.JodHealth.getApiBaseUrl();
    }
    const API_PORT = "8001";
    const host = window.location.hostname && window.location.hostname !== "localhost" ? window.location.hostname : "127.0.0.1";
    return window.JOD_API_BASE_OVERRIDE || `http://${host}:${API_PORT}`;
  }
  const API_BASE = getApiBase();


  const LS_CITY_KEY    = "jod_user_city";
  const LS_PINCODE_KEY = "jod_user_pincode";
  const LS_LAT_KEY     = "jod_user_lat";
  const LS_LON_KEY     = "jod_user_lon";
  const LS_ASKED_KEY   = "jod_location_asked";
  const SS_PENDING_KEY = "jod_location_pending";

  /* ── Haversine (client-side, mirrors backend) ─────────── */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Helpers ────────────────────────────────────────────── */
  function getToken() {
    try {
      return (
        localStorage.getItem("jod_access_token") ||
        sessionStorage.getItem("jod_access_token") ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function authHeaders() {
    const token = getToken();
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }

  function cacheLocation(city, pincode, lat, lon) {
    try {
      if (city) {
        localStorage.setItem(LS_CITY_KEY, city);
        try { sessionStorage.setItem(LS_CITY_KEY, city); } catch (_) {}
        // Sync user object in storage
        ["jod_user"].forEach((key) => {
          const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
          if (raw) {
            try {
              const u = JSON.parse(raw);
              u.city = city;
              if (localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(u));
              if (sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(u));
            } catch (_) {}
          }
        });
      }
      if (pincode) {
        localStorage.setItem(LS_PINCODE_KEY, pincode);
        try { sessionStorage.setItem(LS_PINCODE_KEY, pincode); } catch (_) {}
      }
      if (lat != null && !Number.isNaN(lat)) {
        localStorage.setItem(LS_LAT_KEY, String(lat));
        try { sessionStorage.setItem(LS_LAT_KEY, String(lat)); } catch (_) {}
      }
      if (lon != null && !Number.isNaN(lon)) {
        localStorage.setItem(LS_LON_KEY, String(lon));
        try { sessionStorage.setItem(LS_LON_KEY, String(lon)); } catch (_) {}
      }
      markAsked();
      try { sessionStorage.setItem("jod_location_acquired", "true"); } catch (_) {}
    } catch (_) {}
  }

  function getCachedCity() {
    try {
      const direct = sessionStorage.getItem(LS_CITY_KEY) || localStorage.getItem(LS_CITY_KEY);
      if (direct) return direct;
      const rawUser = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
      if (rawUser) {
        const u = JSON.parse(rawUser);
        if (u && u.city) return u.city;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function getCachedLocation() {
    let lat = null;
    let lon = null;
    try {
      const rawLat = sessionStorage.getItem(LS_LAT_KEY) || localStorage.getItem(LS_LAT_KEY);
      const rawLon = sessionStorage.getItem(LS_LON_KEY) || localStorage.getItem(LS_LON_KEY);
      if (rawLat) lat = parseFloat(rawLat);
      if (rawLon) lon = parseFloat(rawLon);
    } catch (_) {}
    return {
      city: getCachedCity(),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    };
  }

  function hasAcquiredLocation() {
    const cached = getCachedLocation();
    return Boolean(cached.city || (cached.lat != null && cached.lon != null));
  }

  function clearLocationSession() {
    try {
      sessionStorage.removeItem(LS_ASKED_KEY);
      sessionStorage.removeItem("jod_location_acquired");
      sessionStorage.removeItem(LS_CITY_KEY);
      sessionStorage.removeItem(LS_PINCODE_KEY);
      sessionStorage.removeItem(LS_LAT_KEY);
      sessionStorage.removeItem(LS_LON_KEY);
    } catch (_) {}
  }

  function markAsked() {
    try { sessionStorage.setItem(LS_ASKED_KEY, "1"); } catch (_) {}
  }

  function wasAskedThisSession() {
    try { return sessionStorage.getItem(LS_ASKED_KEY) === "1" || sessionStorage.getItem("jod_location_acquired") === "true"; } catch (_) { return false; }
  }

  function consumePendingFlag() {
    try {
      const pending = sessionStorage.getItem(SS_PENDING_KEY) === "1";
      if (pending) sessionStorage.removeItem(SS_PENDING_KEY);
      return pending;
    } catch (_) {
      return false;
    }
  }

  function normalizeLocArg(cityOrLoc) {
    if (typeof cityOrLoc === "string") {
      const cached = getCachedLocation();
      return { city: cityOrLoc, lat: cached.lat, lon: cached.lon };
    }
    if (cityOrLoc && typeof cityOrLoc === "object") {
      return {
        city: cityOrLoc.city || getCachedCity(),
        lat: cityOrLoc.lat ?? cityOrLoc.location_lat ?? null,
        lon: cityOrLoc.lon ?? cityOrLoc.location_lon ?? null,
      };
    }
    return getCachedLocation();
  }

  /* ── DOM injection helpers ──────────────────────────────── */
  function ensureLocationUI() {
    if (document.getElementById("jodLocationToast")) return;

    const toast = document.createElement("div");
    toast.id = "jodLocationToast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
      <div class="jod-loc-toast-inner">
        <span class="jod-loc-icon" aria-hidden="true">📍</span>
        <div class="jod-loc-text">
          <p class="jod-loc-title">Your Location</p>
          <p class="jod-loc-city" id="jodLocationCity">Detecting…</p>
        </div>
        <div class="jod-loc-actions">
          <button class="jod-loc-btn jod-loc-change" id="jodLocationChange" type="button">
            Change
          </button>
          <button class="jod-loc-btn jod-loc-dismiss" id="jodLocationDismiss" type="button" aria-label="Dismiss">
            ✕
          </button>
        </div>
      </div>`;
    document.body.appendChild(toast);

    const modal = document.createElement("div");
    modal.id = "jodLocationModal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "jodLocModalTitle");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="jod-loc-modal-backdrop" id="jodLocModalBackdrop"></div>
      <div class="jod-loc-modal-box">
        <button class="jod-loc-modal-close" id="jodLocModalClose" type="button" aria-label="Close">✕</button>
        <div class="jod-loc-modal-header">
          <span class="jod-loc-modal-icon" aria-hidden="true">🗺️</span>
          <h2 class="jod-loc-modal-title" id="jodLocModalTitle">Enter Your Location</h2>
          <p class="jod-loc-modal-sub">Help us show events near you by entering your city or pincode.</p>
        </div>
        <div class="jod-loc-modal-body">
          <div class="jod-loc-field">
            <label class="jod-loc-label" for="jodLocCityInput">City Name</label>
            <input
              class="jod-loc-input"
              type="text"
              id="jodLocCityInput"
              placeholder="e.g. Chennai, Mumbai, Bangalore…"
              autocomplete="address-level2"
            />
          </div>
          <div class="jod-loc-field">
            <label class="jod-loc-label" for="jodLocPincodeInput">Pincode <span class="jod-loc-optional">(optional)</span></label>
            <input
              class="jod-loc-input"
              type="text"
              id="jodLocPincodeInput"
              placeholder="e.g. 600001"
              inputmode="numeric"
              maxlength="10"
            />
          </div>
          <p class="jod-loc-field-error" id="jodLocFieldError" hidden></p>
          <button class="jod-loc-submit" id="jodLocSubmit" type="button">
            <span class="jod-loc-submit-spinner" id="jodLocSpinner" hidden></span>
            <span>Confirm Location</span>
            <span aria-hidden="true">→</span>
          </button>
          <button class="jod-loc-gps-retry" id="jodLocGpsRetry" type="button">
            <span aria-hidden="true">📡</span> Try GPS again
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById("jodLocModalClose").addEventListener("click", closeModal);
    document.getElementById("jodLocModalBackdrop").addEventListener("click", closeModal);
    document.getElementById("jodLocationChange").addEventListener("click", () => {
      hideToast();
      openModal();
    });
    document.getElementById("jodLocationDismiss").addEventListener("click", hideToast);
    document.getElementById("jodLocSubmit").addEventListener("click", handleManualSubmit);
    document.getElementById("jodLocGpsRetry").addEventListener("click", () => {
      closeModal();
      getUserLocation()
        .then(({ lat, lon }) => sendLocationToBackend(lat, lon))
        .then((loc) => {
          if (loc?.city) {
            showLocationConfirmation(loc.city);
            updateRecommendations(loc);
          }
        })
        .catch(() => openModal());
    });
    document.getElementById("jodLocCityInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleManualSubmit();
    });
    document.getElementById("jodLocPincodeInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleManualSubmit();
    });
  }

  function showToast() {
    const t = document.getElementById("jodLocationToast");
    if (t) t.classList.add("is-visible");
  }

  function hideToast() {
    const t = document.getElementById("jodLocationToast");
    if (t) t.classList.remove("is-visible");
  }

  function openModal() {
    const m = document.getElementById("jodLocationModal");
    if (m) {
      m.hidden = false;
      document.body.classList.add("jod-loc-modal-open");
      void m.offsetWidth;
      m.classList.add("is-open");
      const inp = document.getElementById("jodLocCityInput");
      if (inp) inp.focus();
    }
  }

  function closeModal() {
    const m = document.getElementById("jodLocationModal");
    if (m) {
      m.classList.remove("is-open");
      document.body.classList.remove("jod-loc-modal-open");
      setTimeout(() => { m.hidden = true; }, 300);
    }
  }

  async function handleManualSubmit() {
    const cityInput    = document.getElementById("jodLocCityInput");
    const pincodeInput = document.getElementById("jodLocPincodeInput");
    const errEl        = document.getElementById("jodLocFieldError");
    const spinner      = document.getElementById("jodLocSpinner");
    const submitBtn    = document.getElementById("jodLocSubmit");

    const city    = cityInput?.value.trim() || "";
    const pincode = pincodeInput?.value.trim() || "";

    if (!city && !pincode) {
      if (errEl) { errEl.textContent = "Please enter a city name or pincode."; errEl.hidden = false; }
      cityInput?.focus();
      return;
    }
    if (errEl) errEl.hidden = true;

    if (spinner) spinner.hidden = false;
    if (submitBtn) submitBtn.disabled = true;

    try {
      const result = await fallbackManualEntry(city || pincode, pincode || undefined);
      closeModal();
      if (result?.city) {
        showLocationConfirmation(result.city);
        updateRecommendations(result);
      }
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || "Could not save location. Please try again.";
        errEl.hidden = false;
      }
    } finally {
      if (spinner) spinner.hidden = true;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function _updateSectionHeading(city, matchCount, usedRadius) {
    const sectionPill = document.querySelector(".upcoming-section .pill");
    if (!sectionPill) return;
    if (usedRadius && matchCount > 0) {
      sectionPill.textContent = `📍 Events within ${RADIUS_KM} km of ${city}`;
    } else if (matchCount > 0) {
      sectionPill.textContent = `📍 Events near ${city}`;
    } else {
      sectionPill.textContent = `✨ Events near ${city}`;
    }
  }

  function _applyCardFilter(cards, loc) {
    const { city, lat: userLat, lon: userLon } = loc;
    const cityLower = (city || "").toLowerCase();
    let matchCount = 0;
    let usedRadius = false;

    cards.forEach((card) => {
      const cardLat = parseFloat(card.dataset.lat);
      const cardLon = parseFloat(card.dataset.lon);
      let isMatch = false;

      if (
        Number.isFinite(userLat) &&
        Number.isFinite(userLon) &&
        Number.isFinite(cardLat) &&
        Number.isFinite(cardLon)
      ) {
        isMatch = haversineKm(userLat, userLon, cardLat, cardLon) <= RADIUS_KM;
        usedRadius = true;
      } else if (cityLower) {
        const locationText = (card.querySelector(".event-meta")?.textContent || "").toLowerCase();
        const titleText    = (card.querySelector("h3")?.textContent || "").toLowerCase();
        isMatch = locationText.includes(cityLower) || titleText.includes(cityLower);
      } else {
        isMatch = true;
      }

      if (isMatch) matchCount += 1;
      card.classList.toggle("loc-hidden", !isMatch);
      card.classList.toggle("loc-matched", isMatch);
    });

    if (matchCount === 0) {
      cards.forEach((card) => {
        card.classList.remove("loc-hidden");
        card.classList.add("loc-matched");
      });
    }

    if (city) _updateSectionHeading(city, matchCount || cards.length, usedRadius);
    return matchCount;
  }

  /* ═══════════════════════════════════════════════════════════
   *  PUBLIC API
   * ═══════════════════════════════════════════════════════════ */

  function getUserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false }
      );
    });
  }

  async function sendLocationToBackend(lat, lon) {
    const res = await fetch(`${API_BASE}/api/location/update/coords`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ lat, lon }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || `Location update failed (${res.status})`);
    }
    const result = await res.json();
    cacheLocation(
      result.city,
      result.location_pincode,
      result.location_lat ?? lat,
      result.location_lon ?? lon
    );
    return {
      city: result.city,
      location_pincode: result.location_pincode,
      lat: result.location_lat ?? lat,
      lon: result.location_lon ?? lon,
    };
  }

  async function fallbackManualEntry(city, pincode) {
    if (!city) {
      openModal();
      return null;
    }
    const res = await fetch(`${API_BASE}/api/location/update/manual`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ city, pincode: pincode || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = data?.detail;
      throw new Error(
        typeof detail === "string" ? detail : "Could not save location. Please try again."
      );
    }
    const result = await res.json();
    cacheLocation(
      result.city,
      result.location_pincode,
      result.location_lat,
      result.location_lon
    );
    return {
      city: result.city,
      location_pincode: result.location_pincode,
      lat: result.location_lat,
      lon: result.location_lon,
    };
  }

  function showLocationConfirmation(city) {
    ensureLocationUI();
    const cityEl = document.getElementById("jodLocationCity");
    if (cityEl) cityEl.textContent = `You are in ${city}, India — Change location?`;
    showToast();
    setTimeout(hideToast, 8000);
  }

  function updateProfileLocation(cityOrLoc) {
    let city = "";
    if (typeof cityOrLoc === "string") {
      city = cityOrLoc.trim();
    } else if (cityOrLoc && typeof cityOrLoc === "object") {
      city = (cityOrLoc.city || "").trim();
    }
    if (!city) {
      const cached = getCachedCity();
      if (cached) city = cached.trim();
    }
    if (!city) return;

    const formattedLocation = city.toLowerCase().includes("india") ? city : `${city}, India`;

    // 1. Update dashboard profile section (#dashUserLocation)
    const dashLocEl = document.getElementById("dashUserLocation");
    if (dashLocEl) {
      dashLocEl.textContent = `📍 ${formattedLocation}`;
      dashLocEl.classList.add("is-set");
    }

    // 2. Update top-right navbar profile location and dropdown location (.profile-location-text, .pd-location)
    document.querySelectorAll(".profile-location-text, .pd-location, .mobile-pd-location").forEach((el) => {
      el.textContent = `📍 ${formattedLocation}`;
    });

    // 3. Update generic user profile location indicators
    document.querySelectorAll(".user-profile-location").forEach((el) => {
      el.textContent = formattedLocation;
    });
  }

  function updateRecommendations(cityOrLoc) {
    const loc = normalizeLocArg(cityOrLoc);
    if (!loc.city && loc.lat == null) return;

    updateProfileLocation(loc);

    const cards = document.querySelectorAll(".event-card");
    if (cards.length) _applyCardFilter(cards, loc);

    if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
      _fetchNearbyFromApi(loc.lat, loc.lon, loc.city).catch(() => {});
    }
  }

  async function _fetchNearbyFromApi(lat, lon, city) {
    const res = await fetch(
      `${API_BASE}/api/events/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius_km=${RADIUS_KM}&limit=20`
    );
    if (!res.ok) return;
    const events = await res.json();
    if (!events.length) return;

    const apiIds = new Set(events.map((e) => e.id));
    document.querySelectorAll(".event-card[data-event-id]").forEach((card) => {
      const id = card.dataset.eventId;
      if (apiIds.has(id)) {
        card.classList.remove("loc-hidden");
        card.classList.add("loc-matched");
      }
    });
  }

  async function initLocationFlow(options = {}) {
    ensureLocationUI();

    const force = options.force || consumePendingFlag();

    // If location is already acquired or asked this session, and force is false:
    // DO NOT show toast confirmation, DO NOT open modal, DO NOT prompt for GPS!
    if (!force && (hasAcquiredLocation() || wasAskedThisSession())) {
      applyCachedRecommendations();
      return;
    }

    markAsked();

    const cached = getCachedLocation();
    if (!force && cached.city) {
      updateRecommendations(cached);
      _syncFromBackend().catch(() => {});
      return;
    }

    try {
      const { lat, lon } = await getUserLocation();
      const loc = await sendLocationToBackend(lat, lon);
      if (loc?.city) {
        showLocationConfirmation(loc.city);
        updateRecommendations(loc);
      }
    } catch (_geoErr) {
      // GPS failed or denied, open manual entry modal ONCE for this session
      openModal();
    }
  }

  async function _syncFromBackend() {
    try {
      const res = await fetch(`${API_BASE}/api/location/me`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.city) {
        cacheLocation(data.city, data.location_pincode, data.location_lat, data.location_lon);
        updateRecommendations({
          city: data.city,
          lat: data.location_lat,
          lon: data.location_lon,
        });
      }
    } catch (_) {}
  }

  function applyCachedRecommendations() {
    const cached = getCachedLocation();
    if (cached.city || cached.lat != null) {
      updateRecommendations(cached);
      return;
    }
    _syncFromBackend().catch(() => {});
  }

  return {
    getUserLocation,
    sendLocationToBackend,
    fallbackManualEntry,
    showLocationConfirmation,
    updateRecommendations,
    updateProfileLocation,
    initLocationFlow,
    applyCachedRecommendations,
    hasAcquiredLocation,
    clearLocationSession,
    haversineKm,
    RADIUS_KM,
  };
})();

// Expose modular functions directly on window for global availability
window.getUserLocation = window.JodLocation.getUserLocation;
window.sendLocationToBackend = window.JodLocation.sendLocationToBackend;
window.fallbackManualEntry = window.JodLocation.fallbackManualEntry;
window.updateRecommendations = window.JodLocation.updateRecommendations;
window.updateProfileLocation = window.JodLocation.updateProfileLocation;
window.showLocationConfirmation = window.JodLocation.showLocationConfirmation;
window.initLocationFlow = window.JodLocation.initLocationFlow;

// Automatically sync location on DOM content loaded silently
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (window.JodLocation) {
      if (window.JodLocation.hasAcquiredLocation()) {
        window.JodLocation.applyCachedRecommendations();
      } else {
        window.JodLocation.initLocationFlow().catch(() => {});
      }
    }
  });
}





