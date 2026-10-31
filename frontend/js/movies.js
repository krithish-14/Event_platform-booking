/* Public Movies page: now showing in the visitor's state / district, by day, with filters. Each card opens its movie page. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;

	const FORMAT_ORDER = ["2D", "3D", "IMAX", "4DX", "ScreenX", "Dolby Cinema"];
	const CERT_ORDER = ["U", "UA", "UA 7+", "UA 13+", "UA 16+", "A", "S"];
	const CERT_HINTS = {
		U: "All ages", UA: "Parental guidance", "UA 7+": "7 years and above", "UA 13+": "13 years and above",
		"UA 16+": "16 years and above", A: "Adults only", S: "Special audience",
	};
	const GROUPS = [
		{ id: "genre", label: "Genre", param: "genre" },
		{ id: "time", label: "Timing", param: "time" },
		{ id: "format", label: "Screen type", param: "screen" },
		{ id: "cert", label: "Category", param: "cert" },
		{ id: "lang", label: "Language", param: "lang" },
	];
	const query = new URLSearchParams(window.location.search);
	const state = {
		movies: [],
		day: null,
		region: null,
		open: null,
		filters: Object.fromEntries(GROUPS.map((g) => [g.id, new Set((query.get(g.param) || "").split(",").map((v) => v.trim()).filter(Boolean))])),
	};

	function days() {
		const out = [];
		const base = new Date(Date.now() + 330 * 60000);
		for (let i = 0; i < 7; i++) {
			const d = new Date(base.getTime() + i * 86400000);
			const key = d.toISOString().slice(0, 10);
			const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
			out.push({ key, label, date: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) });
		}
		return out;
	}

	function renderDays() {
		const list = days();
		if (!state.day) state.day = list[0].key;
		$("mvDays").innerHTML = list.map((d) => `<button type="button" class="mv-day${d.key === state.day ? " is-on" : ""}" data-day="${d.key}"><span>${esc(d.label)}</span><strong>${esc(d.date)}</strong></button>`).join("");
		$("mvDays").querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
			state.day = b.getAttribute("data-day");
			renderDays();
			render();
		}));
	}

	/* ── Filtering ───────────────────────────────────────── */
	function moviesOnDay() {
		return state.movies
			.map((m) => ({ ...m, genreList: C.splitGenres(m.genres), dayShows: m.theatres.flatMap((t) => t.shows.filter((s) => C.istDateKey(s.starts_at) === state.day).map((s) => ({ ...s, theatre_id: t.theatre_id }))) }))
			.filter((m) => m.dayShows.length);
	}

	function active(group, skip) {
		return group !== skip && state.filters[group].size > 0;
	}

	function showMatches(s, skip) {
		if (active("time", skip) && !state.filters.time.has(C.timeSlot(s.starts_at))) return false;
		if (active("format", skip) && !state.filters.format.has(s.format)) return false;
		return true;
	}

	function movieMatches(m, skip) {
		if (active("genre", skip) && !m.genreList.some((g) => state.filters.genre.has(g))) return false;
		if (active("cert", skip) && !state.filters.cert.has(m.certificate || "")) return false;
		if (active("lang", skip) && !state.filters.lang.has(m.language || "")) return false;
		return m.dayShows.some((s) => showMatches(s, skip));
	}

	function valuesOf(m, group) {
		if (group === "genre") return m.genreList;
		if (group === "cert") return m.certificate ? [m.certificate] : [];
		if (group === "lang") return m.language ? [m.language] : [];
		if (group === "time") return [...new Set(m.dayShows.filter((s) => showMatches(s, "time")).map((s) => C.timeSlot(s.starts_at)))];
		return [...new Set(m.dayShows.filter((s) => showMatches(s, "format")).map((s) => s.format))];
	}

	function options(group, list) {
		const counts = new Map();
		list.filter((m) => movieMatches(m, group)).forEach((m) => valuesOf(m, group).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
		let values;
		if (group === "time") values = C.TIME_SLOTS.map((t) => t.id);
		else {
			const all = (m) => group === "format" ? m.dayShows.map((s) => s.format) : valuesOf(m, group);
			values = [...new Set([...list.flatMap(all), ...state.filters[group]])];
			const order = group === "format" ? FORMAT_ORDER : group === "cert" ? CERT_ORDER : null;
			values.sort((a, b) => order ? ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b) : a.localeCompare(b));
		}
		return values.map((v) => {
			const slot = group === "time" ? C.TIME_SLOTS.find((t) => t.id === v) : null;
			return {
				value: v,
				label: slot ? slot.label : v,
				hint: slot ? slot.hint : group === "cert" ? CERT_HINTS[v] || "" : "",
				count: counts.get(v) || 0,
			};
		});
	}

	function optionLabel(group, value) {
		const slot = group === "time" ? C.TIME_SLOTS.find((t) => t.id === value) : null;
		return slot ? slot.label : value;
	}

	function anyFilter() {
		return GROUPS.some((g) => state.filters[g.id].size);
	}

	function syncUrl() {
		const qs = new URLSearchParams(window.location.search);
		GROUPS.forEach((g) => {
			const set = state.filters[g.id];
			if (set.size) qs.set(g.param, [...set].join(","));
			else qs.delete(g.param);
		});
		const next = window.location.pathname + (qs.toString() ? "?" + qs.toString() : "") + window.location.hash;
		window.history.replaceState(null, "", next);
	}

	function renderFilters(list) {
		const bar = $("mvFilters");
		if (!list.length) {
			bar.hidden = true;
			return;
		}
		bar.hidden = false;
		const pills = GROUPS.map((g) => {
			const opts = options(g.id, list);
			if (!opts.length) return "";
			const chosen = [...state.filters[g.id]];
			const summary = chosen.length === 1 ? optionLabel(g.id, chosen[0]) : chosen.length > 1 ? `${chosen.length} selected` : "";
			const open = state.open === g.id;
			return `<div class="mv-filter${open ? " is-open" : ""}${chosen.length ? " is-active" : ""}" data-group="${g.id}">
				<button type="button" class="mv-filter-btn" aria-expanded="${open}" aria-controls="mvPanel-${g.id}" data-toggle="${g.id}">
					<span>${esc(g.label)}</span>${summary ? `<strong>${esc(summary)}</strong>` : ""}<i aria-hidden="true"></i>
				</button>
				<div class="mv-filter-panel" id="mvPanel-${g.id}" role="group" aria-label="${esc(g.label)}"${open ? "" : " hidden"}>
					${opts.map((o) => `<label class="mv-opt${o.count || state.filters[g.id].has(o.value) ? "" : " is-empty"}">
						<input type="checkbox" data-group="${g.id}" value="${esc(o.value)}"${state.filters[g.id].has(o.value) ? " checked" : ""}>
						<span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ""}</span><em>${o.count}</em></label>`).join("")}
					<div class="mv-filter-actions"><button type="button" class="mv-link" data-clear="${g.id}"${chosen.length ? "" : " disabled"}>Clear</button><button type="button" class="td-btn" data-close>Done</button></div>
				</div>
			</div>`;
		}).join("");
		bar.innerHTML = `<span class="mv-filters-label">Filters</span>${pills}${anyFilter() ? '<button type="button" class="mv-link mv-clear-all" data-clear="*">Clear all</button>' : ""}`;
	}

	function cardHref(m) {
		const qs = new URLSearchParams({ m: m.key, day: state.day });
		if (state.filters.time.size) qs.set("time", [...state.filters.time].join(","));
		if (state.filters.format.size) qs.set("screen", [...state.filters.format].join(","));
		return "movie.html?" + qs.toString();
	}

	function renderMovies(list) {
		const where = state.region ? state.region.label : "India";
		$("mvWhere").textContent = where;
		if (!list.length) {
			$("mvGrid").innerHTML = "";
			$("mvCount").textContent = "";
			$("mvEmpty").hidden = false;
			$("mvEmptyText").textContent = state.movies.length
				? `No shows on this day in ${where}. Try another date.`
				: `No movies are showing in ${where} yet.`;
			return;
		}
		$("mvEmpty").hidden = true;
		const shown = list.filter((m) => movieMatches(m));
		$("mvCount").textContent = anyFilter() ? `${shown.length} of ${list.length} ${list.length === 1 ? "movie" : "movies"}` : "";
		if (!shown.length) {
			$("mvGrid").innerHTML = `<div class="mv-nomatch"><p>No movies match these filters on this day.</p><button type="button" class="td-btn is-ghost" data-clear="*">Clear filters</button></div>`;
			return;
		}
		$("mvGrid").innerHTML = shown.map((m) => {
			const matching = m.dayShows.filter((s) => showMatches(s));
			const theatres = new Set(matching.map((s) => s.theatre_id)).size;
			const showText = state.filters.time.size || state.filters.format.size
				? `${matching.length} ${matching.length === 1 ? "show" : "shows"} \u00b7 ` : "";
			return `<a class="mv-card" href="${cardHref(m)}">
				<div class="mv-poster">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="" loading="lazy">` : `<span>${esc(m.title.slice(0, 1))}</span>`}
				${m.certificate ? `<em class="mv-cert">${esc(m.certificate)}</em>` : ""}
				${m.trailers && m.trailers.length ? '<em class="mv-has-trailer" title="Trailer available">\u25B6</em>' : ""}</div>
				<strong>${esc(m.title)}</strong>
				<small>${esc([m.language, m.duration_min ? `${Math.floor(m.duration_min / 60)}h ${m.duration_min % 60}m` : "", m.genreList.join(", ")].filter(Boolean).join(" \u00b7 "))}</small>
				<span class="mv-card-foot">${showText}${theatres} ${theatres === 1 ? "theatre" : "theatres"} \u00b7 Book now</span>
			</a>`;
		}).join("");
	}

	function render() {
		const list = moviesOnDay();
		renderFilters(list);
		renderMovies(list);
	}

	function clearGroup(group) {
		if (group === "*") GROUPS.forEach((g) => state.filters[g.id].clear());
		else state.filters[group].clear();
		syncUrl();
		render();
	}

	/* ── Events (delegated, so they survive re-renders) ──── */
	$("mvFilters").addEventListener("click", (e) => {
		const toggle = e.target.closest("[data-toggle]");
		if (toggle) {
			const group = toggle.getAttribute("data-toggle");
			state.open = state.open === group ? null : group;
			render();
			if (state.open) {
				const first = $("mvFilters").querySelector(`#mvPanel-${group} input`);
				if (first) first.focus();
			}
			return;
		}
		const clear = e.target.closest("[data-clear]");
		if (clear) {
			clearGroup(clear.getAttribute("data-clear"));
			return;
		}
		if (e.target.closest("[data-close]")) {
			const group = state.open;
			state.open = null;
			render();
			const btn = group && $("mvFilters").querySelector(`[data-toggle="${group}"]`);
			if (btn) btn.focus();
		}
	});
	$("mvFilters").addEventListener("change", (e) => {
		const box = e.target.closest("input[type=checkbox][data-group]");
		if (!box) return;
		const group = box.getAttribute("data-group");
		if (box.checked) state.filters[group].add(box.value);
		else state.filters[group].delete(box.value);
		syncUrl();
		render();
		const again = [...$("mvFilters").querySelectorAll(`input[data-group="${group}"]`)].find((i) => i.value === box.value);
		if (again) again.focus();
	});
	$("mvGrid").addEventListener("click", (e) => {
		if (e.target.closest("[data-clear]")) clearGroup("*");
	});
	document.addEventListener("click", (e) => {
		if (state.open && !e.target.closest(".mv-filter")) {
			state.open = null;
			render();
		}
	});
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape" || !state.open) return;
		const group = state.open;
		state.open = null;
		render();
		const btn = $("mvFilters").querySelector(`[data-toggle="${group}"]`);
		if (btn) btn.focus();
	});

	async function load() {
		const picker = window.JodRegionPicker;
		state.region = picker ? picker.getRegion() : null;
		const qs = new URLSearchParams();
		if (state.region) {
			qs.set("state", state.region.state.name);
			if (state.region.district) qs.set("district", state.region.district.name);
		}
		$("mvGrid").innerHTML = '<p class="mv-loading">Loading movies\u2026</p>';
		$("mvEmpty").hidden = true;
		try {
			const data = await C.api("/api/movies/now-showing?" + qs.toString());
			state.movies = data.movies || [];
		} catch (err) {
			state.movies = [];
			$("mvFilters").hidden = true;
			$("mvGrid").innerHTML = `<p class="mv-loading">${esc(err.message)}</p>`;
			return;
		}
		render();
	}

	$("mvChangeLocation").addEventListener("click", () => { if (window.JodRegionPicker) window.JodRegionPicker.open(); });
	$("mvAllIndia").addEventListener("click", () => { if (window.JodRegionPicker) window.JodRegionPicker.setCity(null); });
	window.addEventListener("jod:city-changed", () => load());

	renderDays();
	await (window.includesReady || Promise.resolve());
	for (let i = 0; i < 20 && !window.JodRegionPicker; i++) await new Promise((r) => setTimeout(r, 100));
	load();
});
