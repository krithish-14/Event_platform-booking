// Auth check &#8212; confirm cookie session
		(async function guardSettingsPage() {
			const currentTarget = window.location.pathname + window.location.search + window.location.hash;
			if (!(window.JodAuth && typeof window.JodAuth.requireAuthOrRedirect === "function")) {
				try { sessionStorage.setItem("jod_redirect_after_login", currentTarget); } catch (_) {}
				window.location.replace(`login.html?redirect=${encodeURIComponent(currentTarget)}`);
				return;
			}
			await window.JodAuth.requireAuthOrRedirect({ redirectTo: currentTarget });
		})();

		function getUser() {
			try {
				const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
				return raw ? JSON.parse(raw) : null;
			} catch (_) { return null; }
		}

		function apiBase() {
			if (window.JodAuth && window.JodAuth.API_BASE) return window.JodAuth.API_BASE;
			return (window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "";
		}

		function cleanCityName(name) {
			return String(name || "")
				.replace(/^(greater|brihan)\s+/i, "")
				.replace(/\s+(municipal\s+)?corporation$/i, "")
				.trim();
		}

		function readStoredLocation() {
			const user = getUser() || {};
			let city = user.city || "";
			let pin = user.location_pincode || user.location_pin || "";
			let address = user.location_address || "";
			let lat = Number.isFinite(user.location_lat) ? Number(user.location_lat) : (Number.isFinite(user.latitude) ? Number(user.latitude) : null);
			let lon = Number.isFinite(user.location_lon) ? Number(user.location_lon) : (Number.isFinite(user.longitude) ? Number(user.longitude) : null);
			try {
				if (window.JodLocation && typeof window.JodLocation.getCachedLocation === "function") {
					const cached = window.JodLocation.getCachedLocation() || {};
					if (!city) city = cached.city || "";
					if (!address) address = cached.address || "";
					if (!pin) pin = cached.pincode || "";
					if (lat == null) lat = cached.lat;
					if (lon == null) lon = cached.lon;
				}
			} catch (_) {}
			return {
				city: cleanCityName(city),
				pin: String(pin || "").replace(/\D/g, "").slice(0, 6),
				address: String(address || "").trim(),
				lat: Number.isFinite(lat) ? lat : null,
				lon: Number.isFinite(lon) ? lon : null,
			};
		}

		function isAdminAddress(text) {
			return /cmwssb|ward\s+\d+|zone\s+\d+|division\s+\d+|circle\s+\d+/i.test(String(text || ""));
		}

		function pinFromAddress(text) {
			const m = String(text || "").match(/\b(\d{6})\b/);
			return m ? m[1] : "";
		}

		function extractCityFromSavedAddress(address) {
			const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
			const useful = parts.filter((p) => {
				const digits = p.replace(/\D/g, "");
				if (digits.length === 6 && digits === p.replace(/\s/g, "")) return false;
				if (isAdminAddress(p)) return false;
				return !/^(india|tamil nadu|karnataka|maharashtra|delhi|nct of delhi|west bengal|telangana|kerala|andhra pradesh)$/i.test(p);
			});
			return useful[useful.length - 1] || "";
		}

		function writeVenuePlaceId(placeId) {
			const el = document.getElementById("settingsVenuePlaceId");
			if (el) el.value = placeId ? String(placeId) : "";
		}

		function writeVenueCoords(lat, lon, placeId) {
			const latEl = document.getElementById("settingsVenueLat");
			const lonEl = document.getElementById("settingsVenueLon");
			if (latEl && Number.isFinite(lat)) latEl.value = String(lat);
			if (lonEl && Number.isFinite(lon)) lonEl.value = String(lon);
			if (arguments.length >= 3) writeVenuePlaceId(placeId);
		}

		function readVenueCoord(id) {
			const raw = document.getElementById(id) && document.getElementById(id).value;
			const n = parseFloat(raw);
			return Number.isFinite(n) ? n : null;
		}

		function setVenueHint(text, isAddress) {
			const hint = document.getElementById("settingsVenueMapHint");
			if (!hint) return;
			hint.textContent = text || "";
			hint.classList.toggle("is-address", !!isAddress);
		}

		function setVenueStatus(text) {
			const el = document.getElementById("settingsVenueMapStatus");
			if (el) el.textContent = text || "";
		}

		const CHENNAI_CENTER = { lat: 13.0827, lng: 80.2707 };
		let venueMap = null;
		let venueMarker = null;
		let venueAutocomplete = null;
		let venueFillingFromMap = false;
		let venueAdjustMode = false;
		let venueInputBound = false;

		function invalidateVenueMap() {
			if (!venueMap || !window.google || !window.google.maps) return;
			window.google.maps.event.trigger(venueMap, "resize");
			if (venueMarker && venueMarker.getPosition()) {
				venueMap.setCenter(venueMarker.getPosition());
			}
		}

		function persistVenueLocal(lat, lon, address, placeId) {
			try {
				if (Number.isFinite(lat)) {
					localStorage.setItem("jod_user_lat", String(lat));
					sessionStorage.setItem("jod_user_lat", String(lat));
				}
				if (Number.isFinite(lon)) {
					localStorage.setItem("jod_user_lon", String(lon));
					sessionStorage.setItem("jod_user_lon", String(lon));
				}
				if (address) {
					localStorage.setItem("jod_user_address", address);
					sessionStorage.setItem("jod_user_address", address);
					const pin = pinFromAddress(address);
					if (pin) {
						localStorage.setItem("jod_user_pincode", pin);
						sessionStorage.setItem("jod_user_pincode", pin);
					}
				}
				if (placeId) {
					localStorage.setItem("jod_user_place_id", placeId);
					sessionStorage.setItem("jod_user_place_id", placeId);
				}
			} catch (_) {}
		}

		function fillVenueAddress(text, opts) {
			opts = opts || {};
			const input = document.getElementById("setLocationCity");
			if (!input || !text) return;
			venueFillingFromMap = true;
			input.value = text;
			delete input.dataset.dirty;
			venueFillingFromMap = false;
			setVenueHint(opts.hint || "Location detected automatically", Boolean(opts.detected));
			if (opts.status !== undefined) setVenueStatus(opts.status);
			persistVenueLocal(readVenueCoord("settingsVenueLat"), readVenueCoord("settingsVenueLon"), text, (document.getElementById("settingsVenuePlaceId") || {}).value || "");
		}

		function ensureVenueMap() {
			if (!window.google || !window.google.maps || typeof window.google.maps.Map !== "function") return null;
			const el = document.getElementById("settingsVenueMap");
			if (!el) return null;
			if (!venueMap) {
				venueMap = new window.google.maps.Map(el, {
					center: CHENNAI_CENTER,
					zoom: 12,
					mapTypeControl: false,
					streetViewControl: false,
					fullscreenControl: false,
					clickableIcons: false,
					gestureHandling: "greedy",
				});
			}
			setTimeout(() => invalidateVenueMap(), 60);
			return venueMap;
		}

		function plotVenuePin(lat, lon, opts) {
			opts = opts || {};
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
			if (!ensureVenueMap()) return;
			writeVenueCoords(lat, lon, opts.placeId);
			persistVenueLocal(lat, lon, null, opts.placeId || "");
			const position = { lat: lat, lng: lon };
			if (venueMarker) {
				venueMarker.setPosition(position);
			} else {
				venueMarker = new window.google.maps.Marker({
					map: venueMap,
					position: position,
					draggable: true,
					animation: window.google.maps.Animation.DROP,
					title: "Drag to adjust your exact location",
				});
				venueMarker.addListener("dragstart", () => {
					venueAdjustMode = true;
					setVenueHint("Drag the marker to adjust your exact location.");
					setVenueStatus("");
				});
				venueMarker.addListener("dragend", () => {
					const pos = venueMarker.getPosition();
					if (!pos) return;
					writeVenueCoords(pos.lat(), pos.lng(), "");
					reverseGeocodeVenue(pos.lat(), pos.lng());
				});
			}
			if (opts.fly !== false) {
				const zoom = Math.max(venueMap.getZoom() || 12, 16);
				venueMap.panTo(position);
				venueMap.setZoom(zoom);
			}
			if (opts.reverse) reverseGeocodeVenue(lat, lon);
			else setTimeout(() => invalidateVenueMap(), 80);
		}

		function reverseGeocodeVenue(lat, lon) {
			if (!window.google || !window.google.maps || !window.google.maps.Geocoder) {
				setVenueHint("Location updated. Save to keep this pin.");
				return;
			}
			setVenueHint("Updating your exact location\u2026");
			const geocoder = new window.google.maps.Geocoder();
			geocoder.geocode({ location: { lat: lat, lng: lon } }, (results, status) => {
				if (status === "OK" && results && results[0]) {
					const hit = results[0];
					if (hit.place_id) writeVenuePlaceId(hit.place_id);
					fillVenueAddress(hit.formatted_address || "", {
						detected: true,
						hint: "Drag the marker to adjust your exact location.",
						status: "Location updated",
					});
				} else {
					setVenueHint("Location updated. You can still edit the address above.");
				}
			});
		}

		function geocodeVenueQuery(query) {
			const q = String(query || "").trim();
			if (q.length < 3 || !window.google || !window.google.maps || !window.google.maps.Geocoder) return;
			setVenueHint("Finding this place on the map\u2026");
			const geocoder = new window.google.maps.Geocoder();
			geocoder.geocode({ address: q, componentRestrictions: { country: "IN" } }, (results, status) => {
				if (status === "ZERO_RESULTS" || !results || !results.length) {
					setVenueHint("No matching locations found. Try a more complete address.");
					setVenueStatus("");
					return;
				}
				if (status !== "OK") {
					setVenueHint("Unable to find the location. Please try again.");
					return;
				}
				const hit = results[0];
				const loc = hit.geometry && hit.geometry.location;
				if (!loc) {
					setVenueHint("Unable to find the location. Please try again.");
					return;
				}
				plotVenuePin(loc.lat(), loc.lng(), { fly: true, reverse: false, placeId: hit.place_id || "" });
				fillVenueAddress(hit.formatted_address || q, {
					detected: true,
					hint: "Location detected automatically",
					status: "Location detected automatically",
				});
			});
		}

		function bindVenueAutocomplete(input) {
			if (!input || venueAutocomplete || !window.google || !window.google.maps || !window.google.maps.places) return;
			venueAutocomplete = new window.google.maps.places.Autocomplete(input, {
				fields: ["place_id", "formatted_address", "name", "geometry"],
				componentRestrictions: { country: "in" },
			});
			if (venueMap) venueAutocomplete.bindTo("bounds", venueMap);
			venueAutocomplete.addListener("place_changed", () => {
				const place = venueAutocomplete.getPlace();
				if (!place || !place.geometry || !place.geometry.location) {
					setVenueHint("Select a suggestion to set your location.");
					setVenueStatus("");
					return;
				}
				const loc = place.geometry.location;
				const label = place.formatted_address || place.name || input.value;
				plotVenuePin(loc.lat(), loc.lng(), { fly: true, reverse: false, placeId: place.place_id || "" });
				fillVenueAddress(label, {
					detected: true,
					hint: "Location detected automatically",
					status: "Location detected automatically",
				});
			});
		}

		function fillLocationFields(detail) {
			const fromEvent = detail && typeof detail === "object" ? detail : null;
			const stored = readStoredLocation();
			const pin = String((fromEvent && (fromEvent.pincode || fromEvent.location_pincode)) || stored.pin || "").replace(/\D/g, "").slice(0, 6);
			let address = String((fromEvent && (fromEvent.address || fromEvent.formatted)) || stored.address || "").trim();
			if (isAdminAddress(address)) address = "";
			const city = cleanCityName((fromEvent && fromEvent.city) || stored.city);
			const areaLine = address || "";
			const cityInp = document.getElementById("setLocationCity");
			if (cityInp && areaLine && !cityInp.dataset.dirty) cityInp.value = areaLine;
			const lat = fromEvent && Number.isFinite(Number(fromEvent.lat || fromEvent.location_lat))
				? Number(fromEvent.lat || fromEvent.location_lat)
				: stored.lat;
			const lon = fromEvent && Number.isFinite(Number(fromEvent.lon || fromEvent.location_lon))
				? Number(fromEvent.lon || fromEvent.location_lon)
				: stored.lon;
			if (Number.isFinite(lat) && Number.isFinite(lon)) writeVenueCoords(lat, lon);
			return { city, pin, address: areaLine, lat, lon };
		}

		async function initSettingsVenueMap() {
			const input = document.getElementById("setLocationCity");
			if (input) {
				input.setAttribute("autocomplete", "off");
				input.setAttribute("placeholder", "Search your area or address");
			}
			setVenueHint("Loading the map\u2026");
			if (!window.JodGoogleMaps || typeof window.JodGoogleMaps.load !== "function") {
				setVenueHint("Unable to load the map. Please refresh and try again.");
				return;
			}
			try {
				await window.JodGoogleMaps.load("places");
			} catch (_) {
				setVenueHint("Unable to load the map. Please refresh and try again.");
				return;
			}
			if (!ensureVenueMap()) {
				setVenueHint("Unable to load the map. Please refresh and try again.");
				return;
			}

			bindVenueAutocomplete(input);
			if (input && !venueInputBound) {
				venueInputBound = true;
				input.addEventListener("input", () => {
					if (venueFillingFromMap) return;
					input.dataset.dirty = "1";
				});
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter") e.preventDefault();
				});
				const adjustBtn = document.getElementById("btnAdjustSettingsVenue");
				if (adjustBtn) {
					adjustBtn.addEventListener("click", () => {
						if (!venueMarker) {
							setVenueHint("Select a place from the suggestions first.");
							if (input) input.focus();
							return;
						}
						venueAdjustMode = true;
						setVenueHint("Drag the marker to adjust your exact location.");
						setVenueStatus("");
						invalidateVenueMap();
						if (venueMarker.getPosition()) venueMap.panTo(venueMarker.getPosition());
					});
				}
			}

			const stored = readStoredLocation();
			const lat = stored.lat != null ? stored.lat : readVenueCoord("settingsVenueLat");
			const lon = stored.lon != null ? stored.lon : readVenueCoord("settingsVenueLon");
			let placeId = "";
			try { placeId = localStorage.getItem("jod_user_place_id") || sessionStorage.getItem("jod_user_place_id") || ""; } catch (_) {}
			if (lat != null && lon != null) {
				plotVenuePin(lat, lon, { fly: true, reverse: false, placeId: placeId || "" });
				if (input && input.value.trim() && !isAdminAddress(input.value)) {
					setVenueHint("Location detected automatically", true);
					setVenueStatus("Location detected automatically");
				} else {
					reverseGeocodeVenue(lat, lon);
				}
			} else if (input && input.value.trim().length >= 3 && !isAdminAddress(input.value)) {
				geocodeVenueQuery(input.value.trim());
			} else {
				setVenueHint("Search a place. The map moves automatically when you select a result.");
				setVenueStatus("");
			}
			setTimeout(() => invalidateVenueMap(), 120);
			setTimeout(() => invalidateVenueMap(), 400);
		}

		function renderSettingsHeader() {
			fillLocationFields();
		}

		async function refreshLocationFromServer() {
			try {
				const fetchFn = (window.JodAuth && typeof window.JodAuth.fetchAuth === "function")
					? window.JodAuth.fetchAuth
					: fetch;
				let data = null;
				const locRes = await fetchFn(`${apiBase()}/api/location/me`);
				if (locRes && locRes.ok) data = await locRes.json();
				if (!data || !(data.city || data.location_pincode)) {
					const meRes = await fetchFn(`${apiBase()}/api/auth/me`);
					if (meRes && meRes.ok) data = await meRes.json();
				}
				if (!data) return;
				const city = cleanCityName(data.city);
				const pin = String(data.location_pincode || data.location_pin || "").replace(/\D/g, "").slice(0, 6);
				if (city) {
					try {
						localStorage.setItem("jod_user_city", city);
						sessionStorage.setItem("jod_user_city", city);
					} catch (_) {}
				}
				if (pin) {
					try {
						localStorage.setItem("jod_user_pincode", pin);
						sessionStorage.setItem("jod_user_pincode", pin);
					} catch (_) {}
				}
				const u = getUser() || {};
				if (city) u.city = city;
				if (pin) u.location_pincode = pin;
				try {
					if (localStorage.getItem("jod_user")) localStorage.setItem("jod_user", JSON.stringify(u));
					if (sessionStorage.getItem("jod_user")) sessionStorage.setItem("jod_user", JSON.stringify(u));
				} catch (_) {}
				fillLocationFields({ city, pincode: pin });
			} catch (_) {}
		}

		function renderSettingsAvatar() {
			const avatarEl = document.getElementById("settingsAvatar");
			if (!avatarEl) return;
			const saved = (window.JodProfile && typeof window.JodProfile.getSavedAvatar === "function")
				? window.JodProfile.getSavedAvatar()
				: null;
			const user = getUser();
			if (saved) {
				avatarEl.innerHTML = `<img src="${saved}" alt="Profile picture" />`;
			} else {
				avatarEl.textContent = window.JodProfile ? window.JodProfile.getInitials() : "?";
			}
		}

		document.addEventListener("DOMContentLoaded", async () => {
			async function hydrateProfileFromApi() {
				try {
					const fetchFn = (window.JodAuth && typeof window.JodAuth.fetchAuth === "function")
						? window.JodAuth.fetchAuth
						: fetch;
					const res = await fetchFn(`${apiBase()}/api/users/me`);
					if (!res || !res.ok) return getUser();
					const data = await res.json();
					try {
						if (data) {
							localStorage.setItem("jod_user", JSON.stringify(data));
							sessionStorage.setItem("jod_user", JSON.stringify(data));
						}
					} catch (_) {}
					return data;
				} catch (_) {
					return getUser();
				}
			}

			const user = await hydrateProfileFromApi() || getUser();
			if (user) {
				document.getElementById("setFullName").value = user.full_name || user.username || "";

				document.getElementById("setUsername").value = user.username || "";
				document.getElementById("setEmail").value = user.email || "";
			}
			renderSettingsHeader();
			fillLocationFields();
			refreshLocationFromServer();
			initSettingsVenueMap();
			window.addEventListener("jod-location-updated", (e) => {
				const d = e.detail || {};
				fillLocationFields(d);
				const lat = Number(d.lat || d.location_lat);
				const lon = Number(d.lon || d.location_lon);
				const addr = String(d.address || d.formatted || "").trim();
				if (Number.isFinite(lat) && Number.isFinite(lon)) {
					plotVenuePin(lat, lon, { fly: true, reverse: !addr || isAdminAddress(addr) });
				}
			});

			renderSettingsAvatar();

			// Photo upload with Crop Modal
			const fileInput = document.getElementById("settingsPhotoInput");
			if (fileInput) {
				fileInput.addEventListener("change", (e) => {
					const file = e.target.files[0];
					if (!file) return;
					if (window.JodCropModal) {
						window.JodCropModal.open(file, () => {
							renderSettingsAvatar();
						});
					} else {
						const reader = new FileReader();
						reader.onload = (ev) => {
							const dataUrl = ev.target.result;
							if (window.JodProfile) {
								window.JodProfile.setProfilePicture(dataUrl);
							} else if (window.JodAuth && typeof window.JodAuth.avatarCacheKey === "function") {
								const key = window.JodAuth.avatarCacheKey();
								if (key) localStorage.setItem(key, dataUrl);
							}
							renderSettingsAvatar();
						};
						reader.readAsDataURL(file);
					}
					e.target.value = "";
				});
			}

			function notifPrefsKey() {
				if (window.JodAuth && typeof window.JodAuth.scopedKey === "function") {
					return window.JodAuth.scopedKey("jod_notif_prefs") || "jod_notif_prefs_anon";
				}
				return "jod_notif_prefs_anon";
			}

			function loadNotifPrefs() {
				const defaults = { bookingEmails: true, eventReminders: true, offers: false };
				try {
					const raw = localStorage.getItem(notifPrefsKey());
					return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
				} catch (_) {
					return defaults;
				}
			}

			function saveNotifPrefs(prefs) {
				try { localStorage.setItem(notifPrefsKey(), JSON.stringify(prefs)); } catch (_) {}
				const toast = document.getElementById("notifPrefToast");
				if (toast) {
					toast.style.display = "block";
					setTimeout(() => { toast.style.display = "none"; }, 2200);
				}
			}

			function bindNotifPrefs() {
				const prefs = loadNotifPrefs();
				const booking = document.getElementById("prefBookingEmails");
				const reminders = document.getElementById("prefEventReminders");
				const offers = document.getElementById("prefOffers");
				if (booking) booking.checked = !!prefs.bookingEmails;
				if (reminders) reminders.checked = !!prefs.eventReminders;
				if (offers) offers.checked = !!prefs.offers;
				[booking, reminders, offers].forEach((el) => {
					if (!el) return;
					el.addEventListener("change", () => {
						saveNotifPrefs({
							bookingEmails: !!(booking && booking.checked),
							eventReminders: !!(reminders && reminders.checked),
							offers: !!(offers && offers.checked),
						});
					});
				});
			}

			bindNotifPrefs();

			function checkHashScroll() {
				const hash = window.location.hash.replace("#", "");
				if (hash === "notificationSettingsSection" || hash === "notificationsSection" || hash === "notifications") {
					scrollToSection("notificationSettingsSection");
				} else if (hash === "securitySection" || hash === "security") {
					scrollToSection("securitySection");
				} else if (hash === "profileSection" || hash === "profile") {
					scrollToSection("profileSection");
				}
			}
			checkHashScroll();
			window.addEventListener("hashchange", checkHashScroll);

			// Remove photo
			const removeBtn = document.getElementById("settingsRemovePhotoBtn");
			if (removeBtn) {
				removeBtn.addEventListener("click", () => {
					if (window.JodProfile) {
						window.JodProfile.removeProfilePicture();
					} else if (window.JodAuth && typeof window.JodAuth.avatarCacheKey === "function") {
						const key = window.JodAuth.avatarCacheKey();
						if (key) localStorage.removeItem(key);
					}
					renderSettingsAvatar();
				});
			}

			// Profile form submit
			document.getElementById("profileForm").addEventListener("submit", async (e) => {
				e.preventDefault();
				const fullName = document.getElementById("setFullName").value.trim();
				const email = document.getElementById("setEmail").value.trim();
				const addressInp = document.getElementById("setLocationCity");
				const address = addressInp ? addressInp.value.trim() : "";
				const pin = pinFromAddress(address);
				const city = extractCityFromSavedAddress(address);
				const lat = readVenueCoord("settingsVenueLat");
				const lon = readVenueCoord("settingsVenueLon");
				const placeId = ((document.getElementById("settingsVenuePlaceId") || {}).value || "").trim();
				let u = getUser() || {};
				u.full_name = fullName;
				u.email = email;
				if (address) u.location_address = address;
				if (city) u.city = city;
				if (pin) u.location_pincode = pin;
				try {
					if (localStorage.getItem("jod_user")) localStorage.setItem("jod_user", JSON.stringify(u));
					if (sessionStorage.getItem("jod_user")) sessionStorage.setItem("jod_user", JSON.stringify(u));
					if (address) {
						localStorage.setItem("jod_user_address", address);
						sessionStorage.setItem("jod_user_address", address);
					}
					if (city) {
						localStorage.setItem("jod_user_city", city);
						sessionStorage.setItem("jod_user_city", city);
					}
					if (pin) {
						localStorage.setItem("jod_user_pincode", pin);
						sessionStorage.setItem("jod_user_pincode", pin);
					}
					if (lat != null) {
						localStorage.setItem("jod_user_lat", String(lat));
						sessionStorage.setItem("jod_user_lat", String(lat));
					}
					if (lon != null) {
						localStorage.setItem("jod_user_lon", String(lon));
						sessionStorage.setItem("jod_user_lon", String(lon));
					}
					if (placeId) {
						localStorage.setItem("jod_user_place_id", placeId);
						sessionStorage.setItem("jod_user_place_id", placeId);
					}
				} catch (_) {}
				if (lat != null && lon != null && typeof window.sendLocationToBackend === "function") {
					try { await window.sendLocationToBackend(lat, lon); } catch (_) {}
				} else if (address && typeof window.fallbackManualEntry === "function") {
					try { await window.fallbackManualEntry(address, pin || undefined); } catch (_) {}
				} else if (address && window.updateProfileLocation) {
					window.updateProfileLocation({ city: city || address, location_pincode: pin });
				}
				if (window.JodAuth && typeof window.JodAuth.fetchAuth === "function") {
					try {
						await window.JodAuth.fetchAuth(`${apiBase()}/api/users/me`, {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ full_name: fullName, city: city || address || null })
						});
					} catch (_) {}
				}
				if (addressInp) delete addressInp.dataset.dirty;
				renderSettingsHeader();
				if (typeof window.updateNavAuth === "function") window.updateNavAuth();
				const toast = document.getElementById("profileToast");
				toast.style.display = "block";
				setTimeout(() => toast.style.display = "none", 3000);
			});

			// Security form submit
			document.getElementById("securityForm").addEventListener("submit", (e) => {
				e.preventDefault();
				const errorToast = document.getElementById("securityErrorToast");
				const successToast = document.getElementById("securityToast");
				errorToast.style.display = "none";
				successToast.style.display = "none";

				const currentPw = document.getElementById("currentPw").value;
				const newPw = document.getElementById("newPw").value;
				const confirmPw = document.getElementById("confirmNewPw").value;

				if (!currentPw) {
					document.getElementById("currentPw").classList.add("has-error");
					showError(errorToast, "Please enter your current password.");
					return;
				}
				document.getElementById("currentPw").classList.remove("has-error");

				const rules = checkPwRules(newPw);
				const allPassed = Object.values(rules).every(Boolean);
				if (!allPassed) {
					document.getElementById("newPw").classList.add("has-error");
					showError(errorToast, "New password does not meet all requirements.");
					return;
				}
				document.getElementById("newPw").classList.remove("has-error");

				if (newPw !== confirmPw) {
					document.getElementById("confirmNewPw").classList.add("has-error");
					showError(errorToast, "Passwords do not match.");
					return;
				}
				document.getElementById("confirmNewPw").classList.remove("has-error");

				successToast.style.display = "block";
				e.target.reset();
				resetPwUI();
				setTimeout(() => successToast.style.display = "none", 3000);
			});

			/* &#9472;&#9472; Password rules check &#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472; */
			function checkPwRules(pw) {
				return {
					length:  pw.length >= 8,
					upper:   /[A-Z]/.test(pw),
					lower:   /[a-z]/.test(pw),
					number:  /[0-9]/.test(pw),
					special: /[^A-Za-z0-9]/.test(pw),
				};
			}

			function updateRuleUI(rules) {
				const ruleMap = {
					length: "ruleLength",
					upper: "ruleUpper",
					lower: "ruleLower",
					number: "ruleNumber",
					special: "ruleSpecial",
				};
				for (const [key, id] of Object.entries(ruleMap)) {
					const el = document.getElementById(id);
					if (!el) continue;
					const icon = el.querySelector(".rule-icon");
					if (rules[key]) {
						el.classList.add("is-valid");
						icon.textContent = "&#10004;";
					} else {
						el.classList.remove("is-valid");
						icon.textContent = "&#10006;";
					}
				}
			}

			function calcStrength(pw) {
				if (!pw) return 0;
				let score = 0;
				if (pw.length >= 8) score++;
				if (/[A-Z]/.test(pw)) score++;
				if (/[a-z]/.test(pw)) score++;
				if (/[0-9]/.test(pw)) score++;
				if (/[^A-Za-z0-9]/.test(pw)) score++;
				return score;
			}

			const strengthLabels = ["", "Very Weak", "Weak", "Fair", "Strong", "Very Strong"];

			function updateStrengthMeter(pw) {
				const score = calcStrength(pw);
				const bar = document.getElementById("pwMeterBar");
				const text = document.getElementById("pwStrengthText");

				bar.className = "pw-meter-bar";
				if (score > 0) bar.classList.add("score-" + score);

				if (!pw) {
					text.innerHTML = `Strength: <span>Enter password</span>`;
				} else {
					text.innerHTML = `Strength: <span class="score-${score}">${strengthLabels[score]}</span>`;
				}
			}

			function updateMatchStatus() {
				const newPw = document.getElementById("newPw").value;
				const confirmPw = document.getElementById("confirmNewPw").value;
				const el = document.getElementById("pwMatchStatus");
				if (!confirmPw) {
					el.textContent = "";
					el.className = "pw-match-status";
					document.getElementById("confirmNewPw").classList.remove("has-error");
					return;
				}
				if (newPw === confirmPw) {
					el.textContent = "&#10004; Passwords match";
					el.className = "pw-match-status match";
					document.getElementById("confirmNewPw").classList.remove("has-error");
				} else {
					el.textContent = "&#10006; Passwords do not match";
					el.className = "pw-match-status no-match";
					document.getElementById("confirmNewPw").classList.add("has-error");
				}
			}

			function resetPwUI() {
				updateRuleUI({ length: false, upper: false, lower: false, number: false, special: false });
				updateStrengthMeter("");
				document.getElementById("pwMatchStatus").textContent = "";
				document.getElementById("pwMatchStatus").className = "pw-match-status";
				["currentPw", "newPw", "confirmNewPw"].forEach(id => {
					document.getElementById(id).classList.remove("has-error");
				});
			}

			function showError(el, msg) {
				el.textContent = "&#9888; " + msg;
				el.style.display = "block";
				setTimeout(() => el.style.display = "none", 4000);
			}

			const newPwInput = document.getElementById("newPw");
			const confirmPwInput = document.getElementById("confirmNewPw");

			newPwInput.addEventListener("input", () => {
				const pw = newPwInput.value;
				updateRuleUI(checkPwRules(pw));
				updateStrengthMeter(pw);
				newPwInput.classList.remove("has-error");
				if (confirmPwInput.value) updateMatchStatus();
			});

			confirmPwInput.addEventListener("input", () => {
				updateMatchStatus();
			});
		});

		function scrollToSection(id) {
			const el = document.getElementById(id);
			if (!el) return;
			el.scrollIntoView({ behavior: 'smooth' });
			document.querySelectorAll(".snav-item").forEach(btn => {
				const attr = btn.getAttribute("onclick") || "";
				if (attr.includes(id)) {
					btn.classList.add("is-active");
				} else {
					btn.classList.remove("is-active");
				}
			});
		}

		function togglePwVisibility(inputId, btn) {
			const input = document.getElementById(inputId);
			if (!input) return;
			if (input.type === "password") {
				input.type = "text";
				btn.textContent = "\ud83d\ude48";
			} else {
				input.type = "password";
				btn.textContent = "\ud83d\udc41";
			}
		}
		window.scrollToSection = scrollToSection;
		window.togglePwVisibility = togglePwVisibility;
		window.invalidateVenueMap = invalidateVenueMap;
