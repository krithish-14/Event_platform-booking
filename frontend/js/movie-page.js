/* Movie page: poster, trailers, cast, crew and showtimes near the visitor; showtimes lead to seat booking. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;
	const key = C.param("m") || "";
	const listParam = (name) => new Set((C.param(name) || "").split(",").map((v) => v.trim()).filter(Boolean));
	const state = { movie: null, day: C.param("day"), region: null, nationwide: false, times: listParam("time"), screens: listParam("screen") };

	function show(id) {
		["mpLoading", "mpMissing", "mpApp"].forEach((x) => { $(x).hidden = x !== id; });
	}

	function runtime(min) {
		return min ? `${Math.floor(min / 60)}h ${min % 60}m` : "";
	}

	function releaseText(iso) {
		const d = iso ? new Date(iso + "T00:00:00Z") : null;
		return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
	}

	function poster(m, cls) {
		return `<div class="mv-poster ${cls || ""}">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="${esc(m.title)} poster">` : `<span>${esc(m.title.slice(0, 1))}</span>`}</div>`;
	}

	function renderHero(m) {
		const trailers = m.trailers || [];
		const facts = [m.certificate, m.language, runtime(m.duration_min), m.genres].filter(Boolean);
		const release = releaseText(m.release_date);
		$("mpHero").innerHTML = `
			${m.poster_url ? `<div class="mp-backdrop" style="background-image:url('${esc(C.resolveMedia(m.poster_url))}')"></div>` : ""}
			<div class="mp-hero-inner">
				${poster(m, "mp-poster")}
				<div class="mp-info">
					<span class="mv-kicker">Now showing</span>
					<h1>${esc(m.title)}</h1>
					<p class="mp-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>
					${release ? `<p class="mp-release">Released ${esc(release)}</p>` : ""}
					${m.description ? `<p class="mp-desc">${esc(m.description)}</p>` : ""}
					<div class="mp-actions">
						<a class="mp-book" href="#mpShows">Book tickets</a>
						${trailers.length ? `<button type="button" class="mp-trailer-btn" data-play="0">\u25B6 Watch ${esc(trailers[0].label.toLowerCase())}</button>` : ""}
						<button type="button" class="mp-trailer-btn mp-share-btn" id="mpShare" aria-haspopup="menu" aria-expanded="false">${SHARE_ICON}<span>Share</span></button>
					</div>
				</div>
			</div>`;
		$("mpHero").querySelector(".mp-book").addEventListener("click", (e) => {
			e.preventDefault();
			$("mpShows").scrollIntoView({ behavior: "smooth", block: "start" });
		});
		$("mpShare").addEventListener("click", (e) => {
			e.stopPropagation();
			shareMovie();
		});
	}

	/* ── Share ───────────────────────────────────────────── */
	const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>';

	function shareLink() {
		return `${window.location.origin}/movie?m=${encodeURIComponent(key)}`;
	}
	function shareText() {
		const m = state.movie;
		return `${m.title}${m.language ? ` (${m.language})` : ""} \u2014 watch the trailer and book tickets on JOD Events`;
	}

	/* Phones get the system share sheet; desktops get a menu of apps plus copy link. */
	async function shareMovie() {
		const url = shareLink();
		const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
		if (navigator.share && coarse) {
			try {
				await navigator.share({ title: state.movie.title, text: shareText(), url });
				return;
			} catch (err) {
				if (err && err.name === "AbortError") return;
			}
		}
		toggleShareMenu();
	}

	function closeShareMenu() {
		const menu = document.getElementById("mpShareMenu");
		if (menu) menu.remove();
		const btn = $("mpShare");
		if (btn) btn.setAttribute("aria-expanded", "false");
	}

	function toggleShareMenu() {
		if (document.getElementById("mpShareMenu")) return closeShareMenu();
		const url = shareLink();
		const text = shareText();
		const enc = encodeURIComponent;
		const apps = [
			["WhatsApp", `https://wa.me/?text=${enc(`${text}\n${url}`)}`, "#25d366"],
			["Telegram", `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`, "#229ed9"],
			["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, "#1877f2"],
			["X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, "#111"],
			["Email", `mailto:?subject=${enc(state.movie.title)}&body=${enc(`${text}\n${url}`)}`, "#64748b"]
		];
		const menu = document.createElement("div");
		menu.id = "mpShareMenu";
		menu.className = "mp-share-menu";
		menu.setAttribute("role", "menu");
		menu.innerHTML = `
			<p class="mp-share-title">Share ${esc(state.movie.title)}</p>
			<div class="mp-share-apps">${apps.map(([name, href, color]) => `
				<a role="menuitem" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-share="${esc(name)}"><i style="background:${color}">${esc(name.slice(0, 1))}</i><span>${esc(name)}</span></a>`).join("")}</div>
			<div class="mp-share-copy"><input type="text" readonly value="${esc(url)}" aria-label="Movie link"><button type="button" data-share-copy>Copy link</button></div>
			${navigator.share ? '<button type="button" class="mp-share-more" data-share-more>More options\u2026</button>' : ""}`;
		document.body.appendChild(menu);
		const btn = $("mpShare");
		const r = btn.getBoundingClientRect();
		const width = Math.min(320, window.innerWidth - 24);
		menu.style.width = `${width}px`;
		menu.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
		const below = r.bottom + 8;
		menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 12 ? Math.max(12, r.top - menu.offsetHeight - 8) : below}px`;
		btn.setAttribute("aria-expanded", "true");
		menu.addEventListener("click", async (e) => {
			e.stopPropagation();
			if (e.target.closest("[data-share]")) return setTimeout(closeShareMenu, 50);
			if (e.target.closest("[data-share-more]")) {
				closeShareMenu();
				try { await navigator.share({ title: state.movie.title, text, url }); } catch (_) {}
				return;
			}
			const copyBtn = e.target.closest("[data-share-copy]");
			if (!copyBtn) return;
			const input = menu.querySelector("input");
			try {
				await navigator.clipboard.writeText(url);
			} catch (_) {
				input.select();
				document.execCommand("copy");
			}
			copyBtn.textContent = "Copied \u2713";
			C.toast("Link copied. Paste it anywhere to share.", "ok");
			setTimeout(closeShareMenu, 900);
		});
		menu.querySelector("[data-share]").focus();
	}
	document.addEventListener("click", (e) => { if (!e.target.closest("#mpShareMenu")) closeShareMenu(); });
	document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeShareMenu(); });
	window.addEventListener("resize", closeShareMenu);
	window.addEventListener("scroll", closeShareMenu, { passive: true });

	function renderTrailers(m) {
		const trailers = m.trailers || [];
		$("mpTrailers").hidden = !trailers.length;
		if (!trailers.length) return;
		$("mpVideos").innerHTML = trailers.length > 1 ? trailers.map((t, i) => `
			<button type="button" class="mv-video${i === 0 ? " is-on" : ""}" data-play="${i}">
				<img src="${esc(C.youtubeThumb(t.youtube_id))}" alt="" loading="lazy"><span>${esc(t.label)}</span>
			</button>`).join("") : "";
		showTrailer(0, false);
		document.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => {
			showTrailer(Number(b.getAttribute("data-play")), true);
			$("mvPlayer").scrollIntoView({ behavior: "smooth", block: "center" });
		}));
	}

	/* The YouTube player loads only when the visitor presses play; until then it's a thumbnail. */
	function showTrailer(index, play) {
		const t = (state.movie.trailers || [])[index];
		const box = $("mvPlayer");
		if (!t) return;
		document.querySelectorAll(".mv-video").forEach((b) => b.classList.toggle("is-on", Number(b.getAttribute("data-play")) === index));
		$("mvYtLink").href = "https://www.youtube.com/watch?v=" + encodeURIComponent(t.youtube_id);
		if (play) {
			box.innerHTML = `<iframe src="${esc(C.youtubeEmbed(t.youtube_id))}" title="${esc(t.label)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
			return;
		}
		box.innerHTML = `<button type="button" class="mv-player-cover" aria-label="Play ${esc(t.label)}">
			<img src="${esc(C.youtubeThumb(t.youtube_id))}" alt=""><span class="mv-play">\u25B6</span><em>${esc(t.label)}</em></button>`;
		box.querySelector("button").addEventListener("click", () => showTrailer(index, true));
	}

	function renderPeople(sectionId, listId, people) {
		const list = people || [];
		$(sectionId).hidden = !list.length;
		$(listId).innerHTML = list.map((p) => `
			<div class="mv-person">
				<div class="mv-face">${p.photo_url ? `<img src="${esc(C.resolveMedia(p.photo_url))}" alt="" loading="lazy">` : `<span>${esc(C.initials(p.name))}</span>`}</div>
				<strong>${esc(p.name)}</strong>${p.role ? `<small>${esc(p.role)}</small>` : ""}
			</div>`).join("");
	}

	/* ── Showtimes ───────────────────────────────────────── */
	function showDays() {
		const keys = new Set();
		state.movie.theatres.forEach((t) => t.shows.forEach((s) => keys.add(C.istDateKey(s.starts_at))));
		const today = C.istDateKey(new Date().toISOString());
		const tomorrow = C.istDateKey(new Date(Date.now() + 86400000).toISOString());
		return [...keys].sort().map((k) => {
			const d = new Date(k + "T00:00:00Z");
			return {
				key: k,
				label: k === today ? "Today" : k === tomorrow ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
				date: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })
			};
		});
	}

	function availability(s) {
		if (s.seats_left <= 0) return ["Sold out", "is-sold"];
		if (s.seats_left / Math.max(1, s.seat_count) < 0.2) return ["Filling fast", "is-fast"];
		return ["Available", ""];
	}

	function renderShows() {
		const where = state.region ? state.region.label : "India";
		$("mpWhere").textContent = state.nationwide && state.region
			? `Not showing in ${where} yet \u00b7 theatres across India`
			: `Theatres in ${where}`;
		const days = showDays();
		if (!days.length) {
			$("mpDays").innerHTML = "";
			$("mpTheatres").innerHTML = '<p class="mp-empty">No upcoming shows for this movie right now.</p>';
			return;
		}
		if (!days.some((d) => d.key === state.day)) state.day = days[0].key;
		$("mpDays").innerHTML = days.map((d) => `<button type="button" class="mv-day${d.key === state.day ? " is-on" : ""}" data-day="${d.key}"><span>${esc(d.label)}</span><strong>${esc(d.date)}</strong></button>`).join("");
		$("mpDays").querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
			state.day = b.getAttribute("data-day");
			renderShows();
		}));
		const filtered = state.times.size > 0 || state.screens.size > 0;
		const keep = (s) => (!state.times.size || state.times.has(C.timeSlot(s.starts_at))) && (!state.screens.size || state.screens.has(s.format));
		const onDay = state.movie.theatres.map((t) => ({ ...t, today: t.shows.filter((s) => C.istDateKey(s.starts_at) === state.day) }));
		const theatres = onDay.map((t) => ({ ...t, today: t.today.filter(keep) })).filter((t) => t.today.length);
		const hidden = onDay.reduce((n, t) => n + t.today.length, 0) - theatres.reduce((n, t) => n + t.today.length, 0);
		const labels = [...[...state.times].map((id) => (C.TIME_SLOTS.find((t) => t.id === id) || { label: id }).label), ...state.screens];
		const note = filtered
			? `<div class="mp-filter-note"><span>${theatres.length ? "Showing" : "No"} <strong>${esc(labels.join(", "))}</strong> shows${theatres.length ? "" : " on this day"}${hidden ? ` \u00b7 ${hidden} other ${hidden === 1 ? "show" : "shows"} hidden` : ""}</span><button type="button" class="mv-link" id="mpShowAll">Show all times</button></div>`
			: "";
		$("mpTheatres").innerHTML = note + theatres.map((t) => `
			<div class="mv-theatre">
				<div class="mv-theatre-name"><strong>${esc(t.name)}</strong><small>${esc([t.address, t.district].filter(Boolean).join(", "))}</small></div>
				<div class="mv-times">${t.today.map((s) => {
					const [label, cls] = availability(s);
					return `<a class="mv-time ${cls}" ${s.seats_left > 0 ? `href="seat-booking.html?show=${encodeURIComponent(s.show_id)}"` : 'aria-disabled="true"'}>
						<strong>${esc(C.time(s.starts_at))}</strong><span>${esc(s.format)}${s.min_price ? ` \u00b7 from ${C.money(s.min_price)}` : ""}</span><em>${esc(label)}</em></a>`;
				}).join("")}</div>
			</div>`).join("");
		const showAll = $("mpShowAll");
		if (showAll) showAll.addEventListener("click", () => {
			state.times.clear();
			state.screens.clear();
			const qs = new URLSearchParams(window.location.search);
			qs.delete("time");
			qs.delete("screen");
			window.history.replaceState(null, "", window.location.pathname + "?" + qs.toString());
			renderShows();
		});
	}

	/* ── Load ────────────────────────────────────────────── */
	async function fetchMovies(region) {
		const qs = new URLSearchParams();
		if (region) {
			qs.set("state", region.state.name);
			if (region.district) qs.set("district", region.district.name);
		}
		const data = await C.api("/api/movies/now-showing?" + qs.toString());
		return data.movies || [];
	}

	async function load() {
		const picker = window.JodRegionPicker;
		state.region = picker ? picker.getRegion() : null;
		if (!key) return show("mpMissing");
		try {
			let movie = (await fetchMovies(state.region)).find((m) => m.key === key);
			state.nationwide = false;
			if (!movie && state.region) {
				movie = (await fetchMovies(null)).find((m) => m.key === key);
				state.nationwide = Boolean(movie);
			}
			if (!movie) return show("mpMissing");
			const first = !state.movie;
			state.movie = movie;
			document.title = `${movie.title} (${movie.language}) \u2014 Book tickets | JOD Events`;
			renderHero(movie);
			renderTrailers(movie);
			renderPeople("mpCast", "mpCastList", movie.cast);
			renderPeople("mpCrew", "mpCrewList", movie.crew);
			renderShows();
			show("mpApp");
			if (first && window.location.hash === "#mpShows") $("mpShows").scrollIntoView({ block: "start" });
		} catch (err) {
			$("mpMissingText").textContent = err.message;
			show("mpMissing");
		}
	}

	$("mpChangeLocation").addEventListener("click", () => { if (window.JodRegionPicker) window.JodRegionPicker.open(); });
	window.addEventListener("jod:city-changed", () => load());

	await (window.includesReady || Promise.resolve());
	for (let i = 0; i < 20 && !window.JodRegionPicker; i++) await new Promise((r) => setTimeout(r, 100));
	load();
});
