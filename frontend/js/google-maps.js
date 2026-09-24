/**
 * Load the Google Maps JavaScript API once per page.
 * The browser key comes from GET /api/maps/config (env GOOGLE_MAPS_API_KEY).
 */
(function (global) {
	"use strict";

	var pending = null;
	var configPromise = null;

	function apiOrigin() {
		if (global.JodConfig && typeof global.JodConfig.getApiOrigin === "function") {
			return String(global.JodConfig.getApiOrigin() || "").replace(/\/$/, "");
		}
		if (global.JodHealth && typeof global.JodHealth.getApiBaseUrl === "function") {
			return String(global.JodHealth.getApiBaseUrl() || "").replace(/\/api\/?$/, "");
		}
		if (global.JodAuth && global.JodAuth.API_BASE) {
			return String(global.JodAuth.API_BASE).replace(/\/$/, "");
		}
		return "";
	}

	function fetchConfig() {
		if (configPromise) return configPromise;
		var url = apiOrigin() + "/api/maps/config";
		configPromise = fetch(url, { credentials: "include" }).then(function (res) {
			if (!res.ok) throw new Error("maps config failed");
			return res.json();
		});
		return configPromise;
	}

	function load(libraries) {
		libraries = libraries || "places";
		if (global.google && global.google.maps && typeof global.google.maps.Map === "function") {
			return Promise.resolve(global.google.maps);
		}
		if (pending) return pending;
		pending = fetchConfig().then(function (cfg) {
			if (!cfg || !cfg.enabled || !cfg.apiKey) {
				var disabled = new Error("Maps not configured");
				disabled.code = "MAPS_DISABLED";
				throw disabled;
			}
			return new Promise(function (resolve, reject) {
				var cbName = "__jodGmapsReady";
				global[cbName] = function () {
					try { delete global[cbName]; } catch (_) {}
					if (global.google && global.google.maps) resolve(global.google.maps);
					else reject(new Error("Maps failed to initialize"));
				};
				var script = document.createElement("script");
				script.id = "jodGoogleMapsSdk";
				script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(cfg.apiKey)
					+ "&libraries=" + encodeURIComponent(libraries)
					+ "&callback=" + cbName
					+ "&v=weekly&loading=async";
				script.async = true;
				script.defer = true;
				script.onerror = function () {
					pending = null;
					reject(new Error("Maps failed to load"));
				};
				document.head.appendChild(script);
			});
		}).catch(function (err) {
			pending = null;
			throw err;
		});
		return pending;
	}

	global.JodGoogleMaps = {
		load: load,
		fetchConfig: fetchConfig,
	};
})(window);
