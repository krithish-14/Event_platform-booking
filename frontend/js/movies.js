/* Public Movies page: now showing in the visitor's state / district, by day. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;
	const state = { movies: [], day: null, openKey: null, region: null };

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
			$("mvDetail").hidden = true;
			return;
		}
		$("mvEmpty").hidden = true;
		$("mvGrid").innerHTML = movies.map((m) => {
			const theatres = m.theatres.filter((t) => showsOnDay(t).length).length;
			return `<button type="button" class="mv-card${m.key === state.openKey ? " is-on" : ""}" data-movie="${esc(m.key)}">
				<div class="mv-poster">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="" loading="lazy">` : `<span>${esc(m.title.slice(0, 1))}</span>`}
				${m.certificate ? `<em class="mv-cert">${esc(m.certificate)}</em>` : ""}
				${m.trailers && m.trailers.length ? '<em class="mv-has-trailer" title="Trailer available">\u25B6</em>' : ""}</div>
				<strong>${esc(m.title)}</strong>
				<small>${esc([m.language, m.duration_min ? `${Math.floor(m.duration_min / 60)}h ${m.duration_min % 60}m` : "", m.genres].filter(Boolean).join(" \u00b7 "))}</small>
				<span class="mv-card-foot">${theatres} ${theatres === 1 ? "theatre" : "theatres"}</span>
			</button>`;
		}).join("");
		$("mvGrid").querySelectorAll("[data-movie]").forEach((b) => b.addEventListener("click", () => {
			state.openKey = state.openKey === b.getAttribute("data-movie") ? null : b.getAttribute("data-movie");
			renderMovies();
			if (state.openKey) $("mvDetail").scrollIntoView({ behavior: "smooth", block: "start" });
		}));
		renderDetail();
	}

	function availability(s) {
		if (s.seats_left <= 0) return ["Sold out", "is-sold"];
		if (s.seats_left / Math.max(1, s.seat_count) < 0.2) return ["Filling fast", "is-fast"];
		return ["Available", ""];
	}

	function renderDetail() {
		const m = state.movies.find((x) => x.key === state.openKey);
		if (!m) {
			$("mvDetail").hidden = true;
			return;
		}
		$("mvDetail").hidden = false;
		const theatres = m.theatres.filter((t) => showsOnDay(t).length);
		const trailers = m.trailers || [];
		$("mvDetail").innerHTML = `
			<div class="mv-detail-head">
				<div class="mv-poster is-lg">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="">` : `<span>${esc(m.title.slice(0, 1))}</span>`}</div>
				<div><h2>${esc(m.title)}</h2>
					<p class="mv-tags">${[m.certificate, m.language, m.duration_min ? m.duration_min + " min" : "", m.genres].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</p>
					${m.description ? `<p class="mv-desc">${esc(m.description)}</p>` : ""}
					${trailers.length ? `<button type="button" class="mv-watch" data-play="0">\u25B6 Watch ${esc(trailers[0].label.toLowerCase())}</button>` : ""}</div>
			</div>
			${trailers.length ? `
			<h3 class="mv-sub">Trailers &amp; videos</h3>
			<div class="mv-player" id="mvPlayer"></div>
			<a class="mv-yt-link" id="mvYtLink" target="_blank" rel="noopener noreferrer">Not playing? Open on YouTube \u2197</a>
			${trailers.length > 1 ? `<div class="mv-videos">${trailers.map((t, i) => `
				<button type="button" class="mv-video${i === 0 ? " is-on" : ""}" data-play="${i}">
					<img src="${esc(C.youtubeThumb(t.youtube_id))}" alt="" loading="lazy"><span>${esc(t.label)}</span>
				</button>`).join("")}</div>` : ""}` : ""}
			${peopleRow("Cast", m.cast)}
			${peopleRow("Crew", m.crew)}
			<h3 class="mv-sub">Showtimes \u00b7 ${esc(days().find((d) => d.key === state.day).label)}</h3>
			${theatres.map((t) => `
				<div class="mv-theatre">
					<div class="mv-theatre-name"><strong>${esc(t.name)}</strong><small>${esc([t.address, t.district].filter(Boolean).join(", "))}</small></div>
					<div class="mv-times">${showsOnDay(t).map((s) => {
						const [label, cls] = availability(s);
						return `<a class="mv-time ${cls}" ${s.seats_left > 0 ? `href="seat-booking.html?show=${encodeURIComponent(s.show_id)}"` : 'aria-disabled="true"'}>
							<strong>${esc(C.time(s.starts_at))}</strong><span>${esc(s.format)}${s.min_price ? ` \u00b7 from ${C.money(s.min_price)}` : ""}</span><em>${esc(label)}</em></a>`;
					}).join("")}</div>
				</div>`).join("")}`;
		if (trailers.length) {
			showTrailer(trailers, 0, false);
			$("mvDetail").querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => {
				showTrailer(trailers, Number(b.getAttribute("data-play")), true);
				$("mvPlayer").scrollIntoView({ behavior: "smooth", block: "center" });
			}));
		}
	}

	function peopleRow(title, people) {
		if (!people || !people.length) return "";
		return `<h3 class="mv-sub">${title}</h3><div class="mv-people">${people.map((p) => `
			<div class="mv-person">
				<div class="mv-face">${p.photo_url ? `<img src="${esc(C.resolveMedia(p.photo_url))}" alt="" loading="lazy">` : `<span>${esc(C.initials(p.name))}</span>`}</div>
				<strong>${esc(p.name)}</strong>${p.role ? `<small>${esc(p.role)}</small>` : ""}
			</div>`).join("")}</div>`;
	}

	/* The YouTube player loads only when the visitor presses play; until then it's a thumbnail. */
	function showTrailer(trailers, index, play) {
		const t = trailers[index];
		const box = $("mvPlayer");
		if (!t || !box) return;
		$("mvDetail").querySelectorAll(".mv-video").forEach((b) => b.classList.toggle("is-on", Number(b.getAttribute("data-play")) === index));
		$("mvYtLink").href = "https://www.youtube.com/watch?v=" + encodeURIComponent(t.youtube_id);
		if (play) {
			box.innerHTML = `<iframe src="${esc(C.youtubeEmbed(t.youtube_id))}" title="${esc(t.label)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
			return;
		}
		box.innerHTML = `<button type="button" class="mv-player-cover" aria-label="Play ${esc(t.label)}">
			<img src="${esc(C.youtubeThumb(t.youtube_id))}" alt=""><span class="mv-play">\u25B6</span><em>${esc(t.label)}</em></button>`;
		box.querySelector("button").addEventListener("click", () => showTrailer(trailers, index, true));
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
