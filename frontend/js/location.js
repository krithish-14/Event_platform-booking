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
  // Public location toast + map modal. Host venue map is separate and stays on.
  const USER_MAP_POPUP_ENABLED = false;
  function getApiBase() {
    if (typeof window !== "undefined" && window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
      return window.JodConfig.getApiOrigin();
    }
    if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
      return window.JodHealth.getApiBaseUrl();
    }
    if (window.JOD_API_BASE_OVERRIDE) return String(window.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
    return "";
  }
  const API_BASE = getApiBase();


  const LS_CITY_KEY    = "jod_user_city";
  const LS_PINCODE_KEY = "jod_user_pincode";
  const LS_ADDRESS_KEY = "jod_user_address";
  const LS_LAT_KEY     = "jod_user_lat";
  const LS_LON_KEY     = "jod_user_lon";
  const LS_ASKED_KEY   = "jod_location_asked";
  const SS_PENDING_KEY = "jod_location_pending";
  const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  const INDIA_CENTER = [20.5937, 78.9629];
  const CITY_COORDS = {
    chennai: [13.0827, 80.2707],
    mumbai: [19.076, 72.8777],
    bangalore: [12.9716, 77.5946],
    bengaluru: [12.9716, 77.5946],
    hyderabad: [17.385, 78.4867],
    delhi: [28.6139, 77.209],
    "new delhi": [28.6139, 77.209],
    kolkata: [22.5726, 88.3639],
    pune: [18.5204, 73.8567],
    ahmedabad: [23.0225, 72.5714],
    jaipur: [26.9124, 75.7873],
    coimbatore: [11.0168, 76.9558],
    kochi: [9.9312, 76.2673],
    cochin: [9.9312, 76.2673],
    madurai: [9.9252, 78.1198],
    trichy: [10.7905, 78.7047],
    tiruchirappalli: [10.7905, 78.7047],
  };
  const PIN_PREFIX_CITY = {
    "110": "delhi", "121": "delhi", "122": "delhi",
    "400": "mumbai", "401": "mumbai", "410": "mumbai",
    "560": "bangalore", "561": "bangalore", "562": "bangalore",
    "600": "chennai", "601": "chennai", "602": "chennai", "603": "chennai",
    "500": "hyderabad", "501": "hyderabad",
    "700": "kolkata",
    "411": "pune",
    "380": "ahmedabad",
    "302": "jaipur",
    "641": "coimbatore",
    "682": "kochi",
    "625": "madurai",
    "620": "trichy",
  };

  let locMap = null;
  let locMarker = null;
  let locAreaLayer = null;
  let previewTimer = null;
  let lastPreview = null;
  let mapInitPromise = null;
  let previewSeq = 0;
  let mapPickBound = false;
  let fillingFromMap = false;
  let locationFlowStarted = false;

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
      if (window.JodAuth && typeof window.JodAuth.getToken === "function") {
        return window.JodAuth.getToken();
      }
      return null;
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

  function extractCityFromAddress(address) {
    const cleaned = cleanCityName(address);
    const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
    const useful = parts.filter((p) => {
      const digits = p.replace(/\D/g, "");
      if (digits.length === 6 && digits === p.replace(/\s/g, "")) return false;
      return !/^(india|tamil nadu|karnataka|maharashtra|delhi|nct of delhi|west bengal|telangana|kerala|andhra pradesh)$/i.test(p);
    });
    for (let i = useful.length - 1; i >= 0; i--) {
      if (CITY_COORDS[useful[i].toLowerCase()]) return useful[i];
    }
    return useful[useful.length - 1] || cleaned;
  }

  function fullAreaAddress(preview) {
    if (!preview) return "";
    const formatted = String(preview.formatted || preview.area_address || preview.display_name || "").trim();
    const pin = String(preview.location_pincode || preview.pincode || "").replace(/\D/g, "");
    const city = cleanCityName(preview.city || "");
    if (formatted && !/^\d+(\.\d+)?,\s*\d+(\.\d+)?$/.test(formatted)) return formatted;
    if (city && pin) return `${city}, ${pin}`;
    return city || pin || "";
  }

  function cacheLocation(city, pincode, lat, lon, address) {
    try {
      const fullAddress = String(address || "").trim();
      const shortCity = extractCityFromAddress(fullAddress || city);
      if (shortCity) {
        localStorage.setItem(LS_CITY_KEY, shortCity);
        try { sessionStorage.setItem(LS_CITY_KEY, shortCity); } catch (_) {}
        ["jod_user"].forEach((key) => {
          const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
          if (raw) {
            try {
              const u = JSON.parse(raw);
              u.city = shortCity;
              if (fullAddress) u.location_address = fullAddress;
              if (pincode) u.location_pincode = pincode;
              if (lat != null && !Number.isNaN(lat)) u.location_lat = lat;
              if (lon != null && !Number.isNaN(lon)) u.location_lon = lon;
              if (localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(u));
              if (sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(u));
            } catch (_) {}
          }
        });
      }
      if (fullAddress) {
        localStorage.setItem(LS_ADDRESS_KEY, fullAddress);
        try { sessionStorage.setItem(LS_ADDRESS_KEY, fullAddress); } catch (_) {}
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
      try {
        window.dispatchEvent(new CustomEvent("jod-location-updated", {
          detail: {
            city: shortCity || city || null,
            pincode: pincode || null,
            address: fullAddress || null,
            lat: lat ?? null,
            lon: lon ?? null
          }
        }));
      } catch (_) {}
    } catch (_) {}
  }

  function getCachedCity() {
    try {
      const rawUser = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
      if (rawUser) {
        const u = JSON.parse(rawUser);
        if (u && (u.email || u.customer_id || u.id)) {
          return u.city || sessionStorage.getItem(LS_CITY_KEY) || localStorage.getItem(LS_CITY_KEY) || null;
        }
      }
      return sessionStorage.getItem(LS_CITY_KEY) || localStorage.getItem(LS_CITY_KEY) || null;
    } catch (_) {
      return null;
    }
  }

  function getCachedLocation() {
    let lat = null;
    let lon = null;
    let city = getCachedCity();
    let pincode = "";
    let address = "";
    try {
      const rawUser = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
      const user = rawUser ? JSON.parse(rawUser) : null;
      const signedIn = Boolean(user && (user.email || user.customer_id || user.id));
      if (signedIn) {
        city = user.city || sessionStorage.getItem(LS_CITY_KEY) || city || "";
        pincode = user.location_pincode || user.location_pin || sessionStorage.getItem(LS_PINCODE_KEY) || "";
        address = user.location_address || sessionStorage.getItem(LS_ADDRESS_KEY) || "";
        const rawLat = user.location_lat || user.latitude || sessionStorage.getItem(LS_LAT_KEY);
        const rawLon = user.location_lon || user.longitude || sessionStorage.getItem(LS_LON_KEY);
        if (rawLat) lat = parseFloat(rawLat);
        if (rawLon) lon = parseFloat(rawLon);
      } else {
        pincode = sessionStorage.getItem(LS_PINCODE_KEY) || localStorage.getItem(LS_PINCODE_KEY) || "";
        address = sessionStorage.getItem(LS_ADDRESS_KEY) || localStorage.getItem(LS_ADDRESS_KEY) || "";
        const rawLat = sessionStorage.getItem(LS_LAT_KEY) || localStorage.getItem(LS_LAT_KEY);
        const rawLon = sessionStorage.getItem(LS_LON_KEY) || localStorage.getItem(LS_LON_KEY);
        if (rawLat) lat = parseFloat(rawLat);
        if (rawLon) lon = parseFloat(rawLon);
      }
    } catch (_) {}
    return {
      city: city || null,
      pincode,
      address,
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
      [sessionStorage, localStorage].forEach((store) => {
        store.removeItem(LS_ASKED_KEY);
        store.removeItem("jod_location_acquired");
        store.removeItem("jod_location_pending");
        store.removeItem(LS_CITY_KEY);
        store.removeItem(LS_PINCODE_KEY);
        store.removeItem(LS_ADDRESS_KEY);
        store.removeItem(LS_LAT_KEY);
        store.removeItem(LS_LON_KEY);
      });
    } catch (_) {}
  }

  function markAsked() {
    try {
      sessionStorage.setItem(LS_ASKED_KEY, "1");
      localStorage.setItem(LS_ASKED_KEY, "1");
    } catch (_) {}
  }

  function wasAskedThisSession() {
    try {
      return (
        sessionStorage.getItem(LS_ASKED_KEY) === "1" ||
        sessionStorage.getItem("jod_location_acquired") === "true" ||
        localStorage.getItem(LS_ASKED_KEY) === "1"
      );
    } catch (_) {
      return false;
    }
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
  function ensureLocationStyles() {
    if (document.getElementById("jodLocMapStyles")) return;
    const style = document.createElement("style");
    style.id = "jodLocMapStyles";
    style.textContent = `
      .jod-loc-modal-box { width: min(100%, 34rem); max-height: calc(100vh - 2rem); overflow-y: auto; }
      .jod-loc-map-panel { margin: 0 0 .9rem; border: 1px solid rgba(37,33,28,.12); border-radius: .85rem; overflow: hidden; background: #f6f3ef; }
      .jod-loc-map { width: 100%; height: 13.5rem; background: #e8efe6; }
      .jod-loc-map-status { margin: 0; padding: .55rem .75rem; font-size: .78rem; line-height: 1.4; color: rgba(37,33,28,.62); background: #fff; border-top: 1px solid rgba(37,33,28,.08); }
      .jod-loc-map-status.is-address { color: var(--dark, #25211c); font-weight: 600; }
      .jod-loc-pin-wrap { background: none !important; border: none !important; cursor: grab; }
      .jod-loc-pin-wrap.leaflet-marker-draggable { cursor: grab; }
      .leaflet-dragging .jod-loc-pin-wrap { cursor: grabbing; }
      .jod-loc-pin {
        width: 22px; height: 22px;
        background: #ff7508;
        border: 3px solid #fff;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureLocationUI() {
    ensureLocationStyles();
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
          <p class="jod-loc-modal-sub">Enter your area or pincode, then drag the pin (or tap the map) to fill the exact address.</p>
        </div>
        <div class="jod-loc-modal-body">
          <div class="jod-loc-field">
            <label class="jod-loc-label" for="jodLocCityInput">Area / Address</label>
            <input
              class="jod-loc-input"
              type="text"
              id="jodLocCityInput"
              placeholder="e.g. Old Washermanpet, Royapuram, Chennai"
              autocomplete="street-address"
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
          <div class="jod-loc-map-panel" id="jodLocMapPanel">
            <div class="jod-loc-map" id="jodLocMap" role="img" aria-label="Location map"></div>
            <p class="jod-loc-map-status" id="jodLocMapStatus">Enter a city or pincode to plot it on the map.</p>
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
    document.getElementById("jodLocGpsRetry").addEventListener("click", handleGpsRetry);
    document.getElementById("jodLocCityInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleManualSubmit();
    });
    document.getElementById("jodLocPincodeInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleManualSubmit();
    });
    document.getElementById("jodLocCityInput").addEventListener("input", scheduleMapPreview);
    document.getElementById("jodLocPincodeInput").addEventListener("input", scheduleMapPreview);
    document.getElementById("jodLocCityInput").addEventListener("change", scheduleMapPreview);
    document.getElementById("jodLocPincodeInput").addEventListener("change", scheduleMapPreview);
  }

  function showToast() {
    const t = document.getElementById("jodLocationToast");
    if (t) t.classList.add("is-visible");
  }

  function hideToast() {
    const t = document.getElementById("jodLocationToast");
    if (t) t.classList.remove("is-visible");
  }

  function openModal(options) {
    if (!USER_MAP_POPUP_ENABLED && !(options && options.force)) return;
    const m = document.getElementById("jodLocationModal");
    if (m) {
      m.hidden = false;
      document.body.classList.add("jod-loc-modal-open");
      void m.offsetWidth;
      m.classList.add("is-open");
      const inp = document.getElementById("jodLocCityInput");
      const pin = document.getElementById("jodLocPincodeInput");
      const cached = getCachedLocation();
      if (inp && !inp.value) {
        const area = cached.address || String(cached.city || "").replace(/\s+(municipal\s+)?corporation$/i, "").trim();
        if (area) inp.value = area;
      }
      if (pin && !pin.value) {
        try {
          pin.value = sessionStorage.getItem(LS_PINCODE_KEY) || localStorage.getItem(LS_PINCODE_KEY) || "";
        } catch (_) {}
      }
      if (inp) inp.focus();
      initLocationMap().then(() => {
        if ((inp && inp.value.trim()) || (pin && pin.value.trim())) {
          previewAndPlotMap();
        } else if (cached.lat != null && cached.lon != null) {
          plotOnMap({
            location_lat: cached.lat,
            location_lon: cached.lon,
            city: cached.city,
            display_name: cached.address || (cached.city ? `${cached.city}, India` : ""),
            formatted: cached.address || "",
          });
        } else {
          setMapStatus("Enter a city or pincode to plot it on the map.");
        }
      }).catch(() => {
        setMapStatus("Map could not load. You can still confirm your city.");
      });
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

  function setMapStatus(text, isAddress) {
    const el = document.getElementById("jodLocMapStatus");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-address", Boolean(isAddress && text));
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (mapInitPromise) return mapInitPromise;
    mapInitPromise = new Promise((resolve, reject) => {
      if (!document.getElementById("jodLeafletCss")) {
        const link = document.createElement("link");
        link.id = "jodLeafletCss";
        link.rel = "stylesheet";
        link.href = LEAFLET_CSS;
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.async = true;
      script.onload = () => {
        if (!window.L) {
          reject(new Error("Leaflet failed to initialize"));
          return;
        }
        try {
          window.L.Icon.Default.mergeOptions({
            iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
            iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
          });
        } catch (_) {}
        resolve(window.L);
      };
      script.onerror = () => reject(new Error("Could not load map library"));
      document.head.appendChild(script);
    });
    return mapInitPromise;
  }

  async function initLocationMap() {
    const L = await loadLeaflet();
    const el = document.getElementById("jodLocMap");
    if (!el) throw new Error("Map container missing");
    if (!locMap) {
      locMap = L.map(el, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: true,
      }).setView(INDIA_CENTER, 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
      }).addTo(locMap);
      bindMapPickHandlers();
    }
    setTimeout(() => {
      if (locMap) locMap.invalidateSize();
    }, 80);
    setTimeout(() => {
      if (locMap) locMap.invalidateSize();
    }, 340);
    return locMap;
  }

  function clearMapLayers() {
    if (!locMap) return;
    if (locMarker) {
      locMap.removeLayer(locMarker);
      locMarker = null;
    }
    if (locAreaLayer) {
      locMap.removeLayer(locAreaLayer);
      locAreaLayer = null;
    }
  }

  function plotOnMap(preview, opts) {
    opts = opts || {};
    if (!preview || preview.location_lat == null || preview.location_lon == null) return;
    const lat = Number(preview.location_lat);
    const lon = Number(preview.location_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    lastPreview = Object.assign({}, preview, { location_lat: lat, location_lon: lon });
    applyPreviewToInputs(lastPreview);
    const L = window.L;
    if (!L || !locMap) {
      initLocationMap().then(() => plotOnMap(preview, opts)).catch(() => {});
      return;
    }

    clearMapLayers();
    locMap.invalidateSize();

    const pin = String(preview.location_pincode || "").replace(/\D/g, "");
    const zoom = pin.length === 6 ? 16 : 14;
    const radius = pin.length === 6 ? 900 : 3500;

    locAreaLayer = L.circle([lat, lon], {
      radius,
      color: "#ff7508",
      weight: 2,
      fillColor: "#ff7508",
      fillOpacity: 0.18,
    }).addTo(locMap);

    const address = formatLocationLabel(preview.city, preview.location_pincode, preview.display_name);
    const pinIcon = L.divIcon({
      className: "jod-loc-pin-wrap",
      html: '<div class="jod-loc-pin"></div>',
      iconSize: [30, 42],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    });
    locMarker = L.marker([lat, lon], {
      icon: pinIcon,
      draggable: true,
      autoPan: true,
      autoPanPadding: [48, 48],
      riseOnDrag: true,
      zIndexOffset: 600,
      title: "Drag to set your exact location",
    }).addTo(locMap);

    locMarker.on("drag", (e) => {
      const p = e.target.getLatLng();
      if (locAreaLayer && typeof locAreaLayer.setLatLng === "function") {
        locAreaLayer.setLatLng(p);
      }
    });
    locMarker.on("dragstart", () => {
      if (locMarker.closePopup) locMarker.closePopup();
      setMapStatus("Drop the pin on your exact location.");
    });
    locMarker.on("dragend", (e) => {
      const p = e.target.getLatLng();
      lastPreview = Object.assign({}, lastPreview || {}, {
        location_lat: p.lat,
        location_lon: p.lng,
      });
      reverseGeocodeDroppedPin(p.lat, p.lng);
    });

    if (address) {
      locMarker.bindPopup(escapeHtml(address) + "<br><small>Drag the pin to adjust</small>").openPopup();
    }
    setMapStatus(address ? `📍 ${address} — drag the pin to adjust` : "Drag the pin to your exact spot.", true);
    const parsed = parseCityAndPin(lastPreview);
    if (!opts.skipReverse && (!parsed.city || !parsed.pincode)) {
      reverseGeocodeDroppedPin(lat, lon);
    }

    if (opts.keepView) return;
    const move = () => {
      if (!locMap) return;
      locMap.invalidateSize();
      if (typeof locMap.flyTo === "function") {
        locMap.flyTo([lat, lon], zoom, { duration: 0.85 });
      } else {
        locMap.setView([lat, lon], zoom);
      }
    };
    requestAnimationFrame(move);
    setTimeout(move, 120);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function bindMapPickHandlers() {
    if (!locMap || mapPickBound) return;
    mapPickBound = true;
    locMap.on("click", (e) => {
      if (!e || !e.latlng) return;
      placePinAt(e.latlng.lat, e.latlng.lng, { keepView: true });
    });
  }

  function placePinAt(lat, lon, opts) {
    opts = opts || {};
    const alreadyHadPin = Boolean(locMarker);
    if (alreadyHadPin && locAreaLayer) {
      locMarker.setLatLng([lat, lon]);
      if (typeof locAreaLayer.setLatLng === "function") locAreaLayer.setLatLng([lat, lon]);
      lastPreview = Object.assign({}, lastPreview || {}, {
        location_lat: lat,
        location_lon: lon,
      });
      reverseGeocodeDroppedPin(lat, lon);
      return;
    }
    plotOnMap({
      city: (document.getElementById("jodLocCityInput")?.value || "").trim(),
      location_pincode: (document.getElementById("jodLocPincodeInput")?.value || "").trim(),
      location_lat: lat,
      location_lon: lon,
      display_name: "",
    }, { keepView: Boolean(opts.keepView && alreadyHadPin) });
  }

  async function reverseGeocodeDroppedPin(lat, lon) {
    setMapStatus("Updating address for this pin…");
    try {
      const preview = await fetchCoordsPreview(lat, lon);
      preview.location_lat = lat;
      preview.location_lon = lon;
      lastPreview = preview;
      applyPreviewToInputs(preview);
      const parsed = parseCityAndPin(preview);
      const address = formatLocationLabel(parsed.city, parsed.pincode, preview.display_name);
      if (locMarker) {
        locMarker.bindPopup(escapeHtml(address || "Dropped pin") + "<br><small>Drag the pin to adjust</small>").openPopup();
      }
      setMapStatus(address ? `📍 ${address} — drag the pin to adjust` : "Pin moved. Drag again or confirm this spot.", true);
    } catch (_) {
      lastPreview = Object.assign({}, lastPreview || {}, {
        location_lat: lat,
        location_lon: lon,
      });
      setMapStatus("Pin moved. Drag again or confirm this spot.", true);
    }
  }

  function applyPreviewToInputs(preview) {
    if (!preview) return;
    const parsed = parseCityAndPin(preview);
    const cityInput = document.getElementById("jodLocCityInput");
    const pinInput = document.getElementById("jodLocPincodeInput");
    const area = fullAreaAddress(Object.assign({}, preview, {
      location_pincode: parsed.pincode || preview.location_pincode,
    }));
    fillingFromMap = true;
    try {
      if (cityInput && area) cityInput.value = area;
      if (pinInput && parsed.pincode) pinInput.value = parsed.pincode;
    } finally {
      fillingFromMap = false;
    }
    lastPreview = Object.assign({}, lastPreview || {}, preview, {
      city: parsed.city || preview.city,
      location_pincode: parsed.pincode || preview.location_pincode,
      formatted: area || preview.formatted,
    });
  }

  function cleanCityName(name) {
    return String(name || "")
      .replace(/^(greater|brihan)\s+/i, "")
      .replace(/\s+(municipal\s+)?corporation$/i, "")
      .trim();
  }

  function parseCityAndPin(preview) {
    const rawCity = cleanCityName(preview && (preview.city || preview.town));
    let pin = String((preview && (preview.location_pincode || preview.pincode)) || "").replace(/\D/g, "");
    let city = rawCity && !/^\d+$/.test(rawCity) ? rawCity : "";
    const display = String((preview && preview.display_name) || "");
    if (!pin) {
      const m = display.match(/\b(\d{6})\b/);
      if (m) pin = m[1];
    }
    if (!city) {
      const first = display.split(",")[0] || "";
      city = cleanCityName(first.replace(/\b\d{6}\b/g, ""));
    }
    return { city, pincode: pin };
  }

  function scheduleMapPreview() {
    if (fillingFromMap) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewAndPlotMap().catch(() => {});
    }, 400);
  }

  async function previewAndPlotMap() {
    const city = (document.getElementById("jodLocCityInput")?.value || "").trim();
    const pincode = (document.getElementById("jodLocPincodeInput")?.value || "").trim();
    const errEl = document.getElementById("jodLocFieldError");
    if (!city && pincode.replace(/\D/g, "").length < 6) {
      setMapStatus("Enter a city or pincode to plot it on the map.");
      return null;
    }
    if (city && city.length < 2 && pincode.replace(/\D/g, "").length < 6) return null;

    const seq = ++previewSeq;
    setMapStatus("Finding this area on the map…");
    try {
      const preview = await fetchLocationPreview(city, pincode);
      if (seq !== previewSeq) return null;
      if (errEl) errEl.hidden = true;
      await initLocationMap();
      if (seq !== previewSeq) return null;
      plotOnMap(preview);
      return preview;
    } catch (err) {
      if (seq !== previewSeq) return null;
      setMapStatus(err.message || "Could not find that area. Try another city or pincode.");
      return null;
    }
  }

  async function fetchLocationPreview(city, pincode) {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (pincode) params.set("pincode", pincode);
    try {
      const res = await fetch(`${API_BASE}/api/location/preview?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Number.isFinite(Number(data.location_lat)) && Number.isFinite(Number(data.location_lon))) {
          return data;
        }
      }
    } catch (_) {}
    return geocodeWithFallbacks(city, pincode);
  }

  async function fetchCoordsPreview(lat, lon) {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    try {
      const venueRes = await fetch(`${API_BASE}/api/location/venue-reverse?${params.toString()}`);
      if (venueRes.ok) {
        const data = await venueRes.json();
        const addr = data.address || {};
        const pin = String(addr.postcode || "").replace(/\D/g, "");
        const city = cleanCityName(addr.city || addr.town || addr.municipality || "");
        return {
          city,
          location_pincode: pin,
          location_lat: lat,
          location_lon: lon,
          display_name: data.formatted || data.display_name,
          formatted: data.formatted || "",
          boundingbox: null,
        };
      }
    } catch (_) {}
    try {
      const res = await fetch(`${API_BASE}/api/location/preview/coords?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          data.location_lat = lat;
          data.location_lon = lon;
          return data;
        }
      }
    } catch (_) {}
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&namedetails=1&accept-language=en&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
      const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
      if (res.ok) {
        const hit = await res.json();
        const address = hit.address || {};
        const city = cleanCityName(
          address.city || address.town || address.village || address.suburb ||
          address.municipality || address.state_district || address.county || hit.name
        );
        const pin = String(address.postcode || "").replace(/\D/g, "") || (String(hit.name || "").match(/\d{6}/) || [])[0] || null;
        const skipAdmin = /^(cmwssb\b|ward\s+\d+|zone\s+\d+|division\s+\d+|circle\s+\d+)/i;
        const neighbourhoodRaw = address.neighbourhood || address.quarter || "";
        const neighbourhood = skipAdmin.test(neighbourhoodRaw) ? "" : neighbourhoodRaw;
        const suburb = String(address.suburb || "").replace(/^zone\s+\d+\s+/i, "");
        const road = [address.house_number, address.road || address.pedestrian].filter(Boolean).join(" ");
        const parts = [road, neighbourhood, suburb, city, pin].map((p) => String(p || "").trim()).filter((p) => p && !skipAdmin.test(p));
        const unique = [];
        parts.forEach((p) => {
          if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) unique.push(p);
        });
        const formatted = unique.join(", ");
        return {
          city,
          location_pincode: pin,
          location_lat: lat,
          location_lon: lon,
          display_name: formatted || formatLocationLabel(city, pin, hit.display_name),
          formatted: formatted || hit.display_name || "",
          boundingbox: null,
        };
      }
    } catch (_) {}
    return {
      city: (document.getElementById("jodLocCityInput")?.value || "").trim() || null,
      location_pincode: (document.getElementById("jodLocPincodeInput")?.value || "").trim() || null,
      location_lat: lat,
      location_lon: lon,
      display_name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      boundingbox: null,
    };
  }

  async function geocodeWithFallbacks(city, pincode) {
    const pin = String(pincode || "").replace(/\D/g, "");
    const cityQ = String(city || "").replace(/\s+(municipal\s+)?corporation$/i, "").trim();
    const queries = [];
    if (cityQ && pin.length === 6) queries.push(`${cityQ} ${pin}`);
    if (pin.length === 6) queries.push(pin);
    if (cityQ) queries.push(`${cityQ}, India`);

    let results = [];
    for (const q of queries) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=5&accept-language=en&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          results = data;
          break;
        }
      } catch (_) {}
    }

    if (results.length) {
      const cityL = cityQ.toLowerCase();
      const hit = results.slice().sort((a, b) => {
        const score = (item) => {
          const addr = item.address || {};
          const post = String(addr.postcode || item.name || "").replace(/\D/g, "");
          let n = Number(item.importance || 0);
          if (pin && (post === pin || String(item.name || "") === pin)) n += 90;
          const name = `${item.name || ""} ${item.display_name || ""}`.toLowerCase();
          if (cityL && name.includes(cityL)) n += 40;
          if ((item.addresstype || item.type) === "postcode") n += 50;
          if (/corporation/i.test(name)) n -= 25;
          return n;
        };
        return score(b) - score(a);
      })[0];
      const address = hit.address || {};
      const resolvedCity = (cityQ && !/^\d+$/.test(cityQ))
        ? cityQ
        : (address.city || address.town || address.village || cityQ || null);
      const resolvedPin = pin || address.postcode || null;
      return {
        city: resolvedCity,
        location_pincode: resolvedPin,
        location_lat: parseFloat(hit.lat),
        location_lon: parseFloat(hit.lon),
        display_name: formatLocationLabel(resolvedCity, resolvedPin, hit.display_name),
        boundingbox: null,
      };
    }

    const cityKey = cityQ.toLowerCase();
    const prefix = pin.slice(0, 3);
    const mapped = CITY_COORDS[cityKey] ? cityKey : PIN_PREFIX_CITY[prefix];
    const coords = mapped ? CITY_COORDS[mapped] : null;
    if (coords) {
      const labelCity = cityQ || mapped;
      return {
        city: labelCity,
        location_pincode: pin || null,
        location_lat: coords[0],
        location_lon: coords[1],
        display_name: formatLocationLabel(labelCity, pin),
        boundingbox: null,
      };
    }
    throw new Error("Could not find that city or pincode. Please try another.");
  }

  async function handleGpsRetry() {
    const errEl = document.getElementById("jodLocFieldError");
    const gpsBtn = document.getElementById("jodLocGpsRetry");
    if (gpsBtn) gpsBtn.disabled = true;
    setMapStatus("Locating you with GPS…");
    try {
      const { lat, lon } = await getUserLocation();
      const preview = await fetchCoordsPreview(lat, lon);
      if (errEl) errEl.hidden = true;
      await initLocationMap();
      plotOnMap(preview);
    } catch (_) {
      setMapStatus("GPS unavailable. Enter a city or pincode to plot the area.");
      if (errEl) {
        errEl.textContent = "GPS is blocked or unavailable. Enter your city instead.";
        errEl.hidden = false;
      }
    } finally {
      if (gpsBtn) gpsBtn.disabled = false;
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
    const dropped = locMarker && typeof locMarker.getLatLng === "function" ? locMarker.getLatLng() : null;

    if (!city && !pincode && !dropped) {
      if (errEl) { errEl.textContent = "Please enter a city name or pincode, or drop a pin on the map."; errEl.hidden = false; }
      cityInput?.focus();
      return;
    }
    if (errEl) errEl.hidden = true;

    if (spinner) spinner.hidden = false;
    if (submitBtn) submitBtn.disabled = true;

    try {
      let result = null;
      if (dropped && Number.isFinite(dropped.lat) && Number.isFinite(dropped.lng)) {
        await reverseGeocodeDroppedPin(dropped.lat, dropped.lng);
        const filledCity = (cityInput?.value || "").trim() || city;
        const filledPin = (pincodeInput?.value || "").trim() || pincode;
        try {
          result = await sendLocationToBackend(dropped.lat, dropped.lng);
        } catch (_) {
          cacheLocation(filledCity, filledPin, dropped.lat, dropped.lng, filledCity);
          result = {
            city: filledCity,
            location_pincode: filledPin,
            lat: dropped.lat,
            lon: dropped.lng,
            address: filledCity,
          };
        }
      } else {
        await previewAndPlotMap();
        if (locMarker) {
          const p = locMarker.getLatLng();
          await reverseGeocodeDroppedPin(p.lat, p.lng);
          const filledCity = (cityInput?.value || "").trim() || city;
          const filledPin = (pincodeInput?.value || "").trim() || pincode;
          try {
            result = await sendLocationToBackend(p.lat, p.lng);
          } catch (_) {
            cacheLocation(filledCity, filledPin, p.lat, p.lng, filledCity);
            result = { city: filledCity, location_pincode: filledPin, lat: p.lat, lon: p.lng, address: filledCity };
          }
        } else {
          result = await fallbackManualEntry(city || pincode, pincode || undefined);
        }
      }
      closeModal();
      if (result?.city || result?.location_pincode || result?.lat != null) {
        showLocationConfirmation(result.city, result.location_pincode);
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
    const area = (lastPreview && (lastPreview.formatted || lastPreview.display_name))
      || (document.getElementById("jodLocCityInput")?.value || "").trim()
      || result.city;
    cacheLocation(
      result.city,
      result.location_pincode,
      result.location_lat ?? lat,
      result.location_lon ?? lon,
      area
    );
    return {
      city: result.city,
      location_pincode: result.location_pincode,
      lat: result.location_lat ?? lat,
      lon: result.location_lon ?? lon,
      address: area,
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
      result.location_lon,
      city
    );
    return {
      city: result.city,
      location_pincode: result.location_pincode,
      lat: result.location_lat,
      lon: result.location_lon,
      address: city,
    };
  }

  function formatLocationLabel(city, pincode, displayName) {
    let name = String(city || "").replace(/\s+(municipal\s+)?corporation$/i, "").trim();
    const pin = String(pincode || "").replace(/\D/g, "");
    if (name && pin) return `${name}, ${pin}, India`;
    if (name) return name.toLowerCase().includes("india") ? name : `${name}, India`;
    if (pin) return `${pin}, India`;
    const fallback = String(displayName || "").replace(/\s+(municipal\s+)?corporation/ig, "").trim();
    return fallback;
  }

  function showLocationConfirmation(city, pincode) {
    if (!USER_MAP_POPUP_ENABLED) return;
    ensureLocationUI();
    const cityEl = document.getElementById("jodLocationCity");
    const label = formatLocationLabel(city, pincode);
    if (cityEl) cityEl.textContent = label
      ? `You are in ${label} — Change location?`
      : "Location saved — Change location?";
    showToast();
    setTimeout(hideToast, 8000);
  }

  function updateProfileLocation(cityOrLoc) {
    let city = "";
    let pincode = "";
    if (typeof cityOrLoc === "string") {
      city = cityOrLoc.trim();
    } else if (cityOrLoc && typeof cityOrLoc === "object") {
      city = (cityOrLoc.city || "").trim();
      pincode = cityOrLoc.location_pincode || cityOrLoc.pincode || "";
    }
    if (!city) {
      const cached = getCachedCity();
      if (cached) city = cached.trim();
    }
    if (!pincode) {
      try {
        pincode = sessionStorage.getItem(LS_PINCODE_KEY) || localStorage.getItem(LS_PINCODE_KEY) || "";
      } catch (_) {}
    }
    const formattedLocation = formatLocationLabel(city, pincode);
    if (!formattedLocation) return;

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

    const pending = consumePendingFlag();
    const force = Boolean(options.force || pending);

    if (hasAcquiredLocation()) {
      applyCachedRecommendations();
      return;
    }

    if (locationFlowStarted && !force) {
      return;
    }

    if (!force && wasAskedThisSession()) {
      applyCachedRecommendations();
      return;
    }

    locationFlowStarted = true;
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
        showLocationConfirmation(loc.city, loc.location_pincode);
        updateRecommendations(loc);
      }
    } catch (_geoErr) {
      if (USER_MAP_POPUP_ENABLED) openModal();
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
    getCachedCity,
    getCachedLocation,
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
    if (!window.JodLocation) return;
    if (window.JodLocation.hasAcquiredLocation()) {
      window.JodLocation.applyCachedRecommendations();
      return;
    }
    // Let the featured event popup show first after login.
    let delayMs = 0;
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (
        params.get("show_featured") === "1" ||
        sessionStorage.getItem("jod-show-featured-modal-after-login") === "1" ||
        localStorage.getItem("jod-show-featured-modal-after-login") === "1"
      ) {
        delayMs = 3500;
      }
    } catch (_) {}
    window.setTimeout(() => {
      window.JodLocation.initLocationFlow().catch(() => {});
    }, delayMs);
  });
}





