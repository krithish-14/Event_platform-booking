/* Public Movies page: now showing in the visitor's state / district, by day. Each card opens its movie page. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;
	const state = { movies: [], day: null, region: null };

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
			renderMovies();
		}));
	}

	function showsOnDay(theatre) {
		return theatre.shows.filter((s) => C.istDateKey(s.starts_at) === state.day);
	}

	function renderMovies() {
		const movies = state.movies.filter((m) => m.theatres.some((t) => showsOnDay(t).length));
		const where = state.region ? state.region.label : "India";
		$("mvWhere").textContent = where;
		if (!movies.length) {
			$("mvGrid").innerHTML = "";
			$("mvEmpty").hidden = false;
			$("mvEmptyText").textContent = state.movies.length
				? `No shows on this day in ${where}. Try another date.`
				: `No movies are showing in ${where} yet.`;
			return;
		}
		$("mvEmpty").hidden = true;
		$("mvGrid").innerHTML = movies.map((m) => {
			const theatres = m.theatres.filter((t) => showsOnDay(t).length).length;
			const href = `movie.html?m=${encodeURIComponent(m.key)}&day=${encodeURIComponent(state.day)}`;
			return `<a class="mv-card" href="${href}">
				<div class="mv-poster">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="" loading="lazy">` : `<span>${esc(m.title.slice(0, 1))}</span>`}
				${m.certificate ? `<em class="mv-cert">${esc(m.certificate)}</em>` : ""}
				${m.trailers && m.trailers.length ? '<em class="mv-has-trailer" title="Trailer available">\u25B6</em>' : ""}</div>
				<strong>${esc(m.title)}</strong>
				<small>${esc([m.language, m.duration_min ? `${Math.floor(m.duration_min / 60)}h ${m.duration_min % 60}m` : "", m.genres].filter(Boolean).join(" \u00b7 "))}</small>
				<span class="mv-card-foot">${theatres} ${theatres === 1 ? "theatre" : "theatres"} \u00b7 Book now</span>
			</a>`;
		}).join("");
	}

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
			$("mvGrid").innerHTML = `<p class="mv-loading">${esc(err.message)}</p>`;
			return;
		}
		renderMovies();
	}

	$("mvChangeLocation").addEventListener("click", () => { if (window.JodRegionPicker) window.JodRegionPicker.open(); });
	$("mvAllIndia").addEventListener("click", () => { if (window.JodRegionPicker) window.JodRegionPicker.setCity(null); });
	window.addEventListener("jod:city-changed", () => load());

	renderDays();
	await (window.includesReady || Promise.resolve());
	for (let i = 0; i < 20 && !window.JodRegionPicker; i++) await new Promise((r) => setTimeout(r, 100));
	load();
});
