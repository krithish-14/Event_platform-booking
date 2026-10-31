/* Theatre dashboard: screens + seat layout editor, movies, shows, bookings and check-in. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";
	const C = window.JodCinema;
	const SM = window.JodSeatMap;
	const $ = (id) => document.getElementById(id);
	const esc = C.esc;
	const LANGUAGES = ["Tamil", "Telugu", "Malayalam", "Kannada", "Hindi", "English", "Bengali", "Marathi", "Gujarati", "Punjabi", "Odia"];
	const COLORS = ["#64748b", "#2563eb", "#d97706", "#16a34a", "#db2777", "#7c3aed"];
	const CREW_JOBS = ["Director", "Producer", "Music Director", "Cinematographer", "Editor", "Writer", "Screenplay", "Dialogues", "Lyricist", "Art Director", "Stunt Director", "Choreographer", "Costume Designer", "Production House"];
	const TRAILER_LABELS = ["Trailer", "Teaser", "Glimpse", "Song", "Promo", "Making"];

	const state = { me: null, screens: [], movies: [], shows: [], screenId: null, layout: null, tool: null, dirty: false };

	if (!C.loggedIn()) {
		window.location.replace("login.html?redirect=" + encodeURIComponent("theatre-dashboard.html"));
		return;
	}

	/* ── Tabs ─────────────────────────────────────────────── */
	function showTab(name) {
		document.querySelectorAll("[data-td-tab]").forEach((b) => {
			const on = b.getAttribute("data-td-tab") === name;
			b.classList.toggle("active", on);
			b.setAttribute("aria-selected", on ? "true" : "false");
		});
		document.querySelectorAll(".td-panel").forEach((p) => p.classList.toggle("active-tab", p.id === "td-" + name));
		const content = document.querySelector(".dash-content");
		if (content) content.scrollTop = 0;
		try { history.replaceState(null, "", "?tab=" + name); } catch (_) {}
		if (name === "shows") renderShows();
		if (name === "bookings") loadBookings();
		else if (typeof stopScanner === "function") stopScanner();
	}
	function leaveEditorOk() {
		if (state.dirty && !confirm("You have unsaved seat layout changes. Leave without saving?")) return false;
		state.dirty = false;
		return true;
	}
	document.querySelectorAll("[data-td-tab]").forEach((b) => {
		b.addEventListener("click", (e) => {
			e.preventDefault();
			if (leaveEditorOk()) showTab(b.getAttribute("data-td-tab"));
		});
		b.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); }
		});
	});
	document.addEventListener("click", (e) => {
		const go = e.target.closest("[data-td-go]");
		if (go && leaveEditorOk()) showTab(go.getAttribute("data-td-go"));
	});

	/* ── Modal ────────────────────────────────────────────── */
	function openModal(title, html) {
		$("tdModalTitle").textContent = title;
		$("tdModalBody").innerHTML = html;
		$("tdModal").hidden = false;
	}
	function closeModal() { $("tdModal").hidden = true; }
	$("tdModal").addEventListener("click", (e) => { if (e.target.closest("[data-td-close]")) closeModal(); });

	/* ── Load ─────────────────────────────────────────────── */
	async function loadAll() {
		try {
			state.me = await C.api("/api/cinema/me");
		} catch (err) {
			$("tdLoading").hidden = true;
			$("tdBlocked").hidden = false;
			$("tdBlockedText").textContent = err.message;
			return false;
		}
		const [screens, movies, shows] = await Promise.all([
			C.api("/api/cinema/screens"),
			C.api("/api/cinema/movies"),
			C.api("/api/cinema/shows?days=30")
		]);
		state.screens = screens.screens || [];
		state.template = screens.template;
		state.movies = movies.movies || [];
		state.shows = shows.shows || [];
		$("tdLoading").hidden = true;
		$("tdApp").hidden = false;
		return true;
	}

	/* ── Overview ─────────────────────────────────────────── */
	function renderOverview() {
		const t = state.me.theatre;
		const s = state.me.stats;
		$("tdTheatreName").textContent = t.name || "Theatre Dashboard";
		$("tdTheatreMeta").textContent = [[t.district, t.state].filter(Boolean).join(", "), t.partner_code].filter(Boolean).join(" \u00b7 ");
		$("tdStatusBadge").hidden = false;
		document.title = `${t.name || "Theatre"} \u2014 Theatre Dashboard | JOD Events`;
		$("tdOverviewSub").textContent = [t.chain, t.address, [t.district, t.state, t.pincode].filter(Boolean).join(", ")].filter(Boolean).join(" \u00b7 ");
		const icon = (path) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
		const cards = [
			["Screens", s.screens, `${s.seats.toLocaleString("en-IN")} seats`, "screens", "icon-attendees", '<path d="M4 18v-2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M6 14V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5"/>'],
			["Movies", s.movies, "now playing", "movies", "icon-days", '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16"/>'],
			["Upcoming shows", s.upcoming_shows, "next 30 days", "shows", "icon-pending", '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'],
			["Tickets today", s.tickets_today, C.money(s.sales_today) + " sales", "bookings", "icon-regs", '<path d="M2 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/>'],
			["Your payout", C.money(s.payout_total), `${s.tickets_total} tickets \u00b7 after fees`, "bookings", "icon-sales", '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>']
		];
		$("tdStats").innerHTML = cards.map((c) => `<button type="button" class="kpi-card td-kpi" data-td-go="${c[3]}"><div class="kpi-icon-circle ${c[4]}">${icon(c[5])}</div><div class="kpi-details"><span class="kpi-label">${esc(c[0])}</span><span class="kpi-value">${esc(c[1])}</span><small class="td-kpi-sub">${esc(c[2])}</small></div></button>`).join("");
		const steps = [
			[state.screens.some((x) => x.updated_at), "Check each screen's seat layout and screen position", "screens"],
			[state.movies.length > 0, "Add the movies you are screening", "movies"],
			[state.shows.length > 0, "Schedule shows with prices", "shows"]
		];
		$("tdSteps").innerHTML = steps.map((st, i) => `<li class="${st[0] ? "is-done" : ""}"><span>${st[0] ? "\u2713" : i + 1}</span>${esc(st[1])}<button type="button" class="td-link" data-td-go="${st[2]}">Open</button></li>`).join("");
		const next = state.me.next_shows || [];
		$("tdNextShows").innerHTML = next.length
			? next.map((sh) => `<div class="td-row"><div><strong>${esc(sh.movie_title)}</strong><small>${esc(sh.language || "")} \u00b7 ${esc(sh.screen_name)} \u00b7 ${esc(sh.format)}</small></div><div class="td-row-end"><span>${esc(C.day(sh.starts_at))}, ${esc(C.time(sh.starts_at))}</span><small>${sh.sold}/${sh.seat_count} sold</small></div></div>`).join("")
			: '<p class="td-empty">No upcoming shows yet. <button type="button" class="td-link" data-td-go="shows">Schedule one</button></p>';
	}

	/* ── Screens & seat layout editor ─────────────────────── */
	function screenById(id) { return state.screens.find((s) => s.id === id); }

	function renderScreenList() {
		$("tdScreenList").innerHTML = state.screens.map((s) => `
			<button type="button" class="td-screen-card${s.id === state.screenId ? " is-on" : ""}" data-screen-pick="${s.id}">
				<strong>${esc(s.name)}</strong><span>${esc(s.format)} \u00b7 ${s.seat_count} seats</span>
			</button>`).join("") || '<p class="td-empty">No screens yet. Add one below.</p>';
		$("tdScreenList").querySelectorAll("[data-screen-pick]").forEach((b) => b.addEventListener("click", () => {
			if (state.dirty && !confirm("Discard unsaved layout changes?")) return;
			pickScreen(b.getAttribute("data-screen-pick"));
		}));
	}

	function pickScreen(id) {
		const screen = screenById(id);
		if (!screen) return;
		state.screenId = id;
		state.layout = JSON.parse(JSON.stringify(screen.layout || state.template));
		state.tool = state.layout.categories[0] ? state.layout.categories[0].id : null;
		state.dirty = false;
		$("tdEditor").hidden = false;
		$("tdEditorName").value = screen.name;
		$("tdEditorFormat").value = screen.format || "2D";
		renderScreenList();
		renderEditor();
	}

	function slug(name, taken) {
		let base = String(name || "seat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16) || "seat";
		let id = base;
		let n = 2;
		while (taken.includes(id)) id = (base.slice(0, 14) + "-" + n++);
		return id;
	}

	function renderCategories() {
		const L = state.layout;
		$("tdCats").innerHTML = L.categories.map((c) => `
			<label class="td-cat${state.tool === c.id ? " is-on" : ""}">
				<input type="radio" name="tdTool" value="${esc(c.id)}" ${state.tool === c.id ? "checked" : ""}>
				<input type="color" value="${esc(c.color)}" data-cat-color="${esc(c.id)}" aria-label="Colour for ${esc(c.name)}">
				<input type="text" value="${esc(c.name)}" maxlength="30" data-cat-name="${esc(c.id)}" aria-label="Category name">
				<span class="td-cat-count">${countFor(c.id)}</span>
				<button type="button" class="td-icon-btn" data-cat-remove="${esc(c.id)}" title="Remove category" ${L.categories.length < 2 ? "disabled" : ""}>&times;</button>
			</label>`).join("") +
			`<label class="td-cat is-eraser${state.tool === null ? " is-on" : ""}"><input type="radio" name="tdTool" value="" ${state.tool === null ? "checked" : ""}><span class="td-eraser-swatch"></span><span>Aisle / gap (no seat)</span></label>`;
		$("tdCats").querySelectorAll('input[name="tdTool"]').forEach((r) => r.addEventListener("change", () => {
			state.tool = r.value || null;
			renderCategories();
		}));
		$("tdCats").querySelectorAll("[data-cat-color]").forEach((inp) => inp.addEventListener("input", () => {
			const cat = L.categories.find((c) => c.id === inp.getAttribute("data-cat-color"));
			if (cat) { cat.color = inp.value; markDirty(); renderGrid(); }
		}));
		$("tdCats").querySelectorAll("[data-cat-name]").forEach((inp) => inp.addEventListener("change", () => {
			const cat = L.categories.find((c) => c.id === inp.getAttribute("data-cat-name"));
			if (cat) { cat.name = inp.value.trim() || cat.name; markDirty(); }
		}));
		$("tdCats").querySelectorAll("[data-cat-remove]").forEach((b) => b.addEventListener("click", (e) => {
			e.preventDefault();
			const id = b.getAttribute("data-cat-remove");
			if (L.categories.length < 2) return;
			const fallback = L.categories.find((c) => c.id !== id).id;
			L.cells = L.cells.map((row) => row.map((v) => (v === id ? fallback : v)));
			L.categories = L.categories.filter((c) => c.id !== id);
			if (state.tool === id) state.tool = fallback;
			markDirty();
			renderEditor();
		}));
		$("tdAddCat").disabled = L.categories.length >= 6;
	}

	function countFor(catId) {
		let n = 0;
		state.layout.cells.forEach((row) => row.forEach((v) => { if (v === catId) n++; }));
		return n;
	}

	function markDirty() {
		state.dirty = true;
		$("tdSaveLayout").classList.add("is-dirty");
		$("tdLayoutStatus").textContent = "Unsaved changes";
	}

	function renderSummary() {
		const total = SM.enumerate(state.layout).seats.length;
		$("tdLayoutSummary").innerHTML = `<strong>${total}</strong> seats \u00b7 ` +
			state.layout.categories.map((c) => `<span><i style="background:${esc(c.color)}"></i>${esc(c.name)} ${countFor(c.id)}</span>`).join(" ");
	}

	let painting = false;
	function paint(r, c) {
		const L = state.layout;
		if (L.cells[r][c] === state.tool) return;
		L.cells[r][c] = state.tool;
		const cell = $("tdGrid").querySelector(`[data-r="${r}"][data-c="${c}"]`);
		if (cell) {
			const cat = state.tool ? L.categories.find((x) => x.id === state.tool) : null;
			cell.classList.toggle("is-seat", Boolean(cat));
			cell.classList.toggle("is-gap", !cat);
			cell.style.setProperty("--cat", cat ? cat.color : "transparent");
			cell.textContent = cat ? "\u2022" : "";
		}
		markDirty();
	}

	function renderGrid() {
		SM.render($("tdGrid"), state.layout, { mode: "edit" });
		const grid = $("tdGrid");
		grid.querySelectorAll("[data-r]").forEach((cell) => {
			const r = Number(cell.getAttribute("data-r"));
			const c = Number(cell.getAttribute("data-c"));
			cell.addEventListener("mousedown", (e) => { e.preventDefault(); painting = true; paint(r, c); });
			cell.addEventListener("mouseenter", () => { if (painting) paint(r, c); });
			cell.addEventListener("click", (e) => { if (e.detail === 0) { paint(r, c); refreshAfterPaint(); } });
		});
		grid.querySelectorAll("[data-row]").forEach((lab) => lab.addEventListener("click", () => {
			const r = Number(lab.getAttribute("data-row"));
			for (let c = 0; c < state.layout.cols; c++) state.layout.cells[r][c] = state.tool;
			markDirty();
			renderEditor();
		}));
		renderSummary();
	}
	function refreshAfterPaint() { renderGrid(); renderCategories(); }
	document.addEventListener("mouseup", () => { if (painting) { painting = false; refreshAfterPaint(); } });

	function renderEditor() {
		const L = state.layout;
		$("tdRows").value = L.rows;
		$("tdCols").value = L.cols;
		$("tdScreenPos").value = L.screen || "top";
		$("tdNumbering").value = L.numbering || "ltr";
		renderCategories();
		renderGrid();
		if (!state.dirty) {
			$("tdSaveLayout").classList.remove("is-dirty");
			$("tdLayoutStatus").textContent = "Saved";
		}
	}

	$("tdApplySize").addEventListener("click", () => {
		const rows = Math.max(1, Math.min(40, Number($("tdRows").value) || 1));
		const cols = Math.max(1, Math.min(60, Number($("tdCols").value) || 1));
		const L = state.layout;
		const fill = state.tool || (L.categories[0] && L.categories[0].id) || null;
		const cells = [];
		for (let r = 0; r < rows; r++) {
			const row = [];
			for (let c = 0; c < cols; c++) row.push(r < L.rows && c < L.cols ? L.cells[r][c] : fill);
			cells.push(row);
		}
		Object.assign(L, { rows, cols, cells });
		markDirty();
		renderEditor();
	});
	$("tdTemplate").addEventListener("click", () => {
		if (!confirm("Replace this layout with the standard template (centre aisle, walkway, Classic / Prime / Recliner)? You can still edit it before saving.")) return;
		const rows = Number($("tdRows").value) || 12;
		const cols = Number($("tdCols").value) || 20;
		state.layout = buildTemplate(rows, cols, $("tdScreenPos").value);
		state.tool = "classic";
		markDirty();
		renderEditor();
	});
	function buildTemplate(rows, cols, screen) {
		rows = Math.max(1, Math.min(40, rows));
		cols = Math.max(1, Math.min(60, cols));
		const aisle = cols >= 12 ? Math.floor(cols / 2) : -1;
		const walkway = rows >= 8 ? rows - 3 : -1;
		const cells = [];
		for (let r = 0; r < rows; r++) {
			if (r === walkway) { cells.push(new Array(cols).fill(null)); continue; }
			const dist = screen === "bottom" ? rows - 1 - r : r;
			const cat = dist >= rows - 2 ? "recliner" : dist >= Math.floor(rows / 3) ? "prime" : "classic";
			const row = [];
			for (let c = 0; c < cols; c++) row.push(c === aisle ? null : cat);
			cells.push(row);
		}
		return { rows, cols, screen: screen === "bottom" ? "bottom" : "top", numbering: "ltr",
			categories: [{ id: "classic", name: "Classic", color: "#64748b" }, { id: "prime", name: "Prime", color: "#2563eb" }, { id: "recliner", name: "Recliner", color: "#d97706" }],
			cells };
	}
	$("tdScreenPos").addEventListener("change", () => { state.layout.screen = $("tdScreenPos").value; markDirty(); renderGrid(); });
	$("tdNumbering").addEventListener("change", () => { state.layout.numbering = $("tdNumbering").value; markDirty(); renderGrid(); });
	$("tdAddCat").addEventListener("click", () => {
		const L = state.layout;
		if (L.categories.length >= 6) return;
		const name = prompt("Name of the new seat category (e.g. Balcony, Sofa, Wheelchair)", "");
		if (!name) return;
		const id = slug(name, L.categories.map((c) => c.id));
		const color = COLORS.find((col) => !L.categories.some((c) => c.color === col)) || "#0ea5e9";
		L.categories.push({ id, name: name.trim().slice(0, 30), color });
		state.tool = id;
		markDirty();
		renderCategories();
	});

	$("tdSaveLayout").addEventListener("click", async () => {
		const btn = $("tdSaveLayout");
		btn.disabled = true;
		try {
			const used = new Set();
			state.layout.cells.forEach((row) => row.forEach((v) => v && used.add(v)));
			const payload = { name: $("tdEditorName").value.trim(), format: $("tdEditorFormat").value, layout: state.layout };
			const saved = await C.api(`/api/cinema/screens/${state.screenId}`, { method: "PUT", json: payload });
			const i = state.screens.findIndex((s) => s.id === saved.id);
			state.screens[i] = saved;
			state.layout = JSON.parse(JSON.stringify(saved.layout));
			if (state.tool && !state.layout.categories.some((c) => c.id === state.tool)) state.tool = state.layout.categories[0].id;
			state.dirty = false;
			renderScreenList();
			renderEditor();
			C.toast(`${saved.name} saved \u00b7 ${saved.seat_count} seats`, "ok");
		} catch (err) {
			C.toast(err.message, "bad");
		} finally {
			btn.disabled = false;
		}
	});
	$("tdArchiveScreen").addEventListener("click", async () => {
		const screen = screenById(state.screenId);
		if (!screen || !confirm(`Remove ${screen.name}? Past bookings stay in your records.`)) return;
		try {
			await C.api(`/api/cinema/screens/${screen.id}`, { method: "DELETE" });
			state.screens = state.screens.filter((s) => s.id !== screen.id);
			state.screenId = null;
			state.dirty = false;
			$("tdEditor").hidden = true;
			renderScreenList();
			C.toast("Screen removed.", "ok");
		} catch (err) {
			C.toast(err.message, "bad");
		}
	});
	$("tdNewScreen").addEventListener("submit", async (e) => {
		e.preventDefault();
		try {
			const created = await C.api("/api/cinema/screens", { method: "POST", json: {
				name: $("tdNewScreenName").value.trim(), format: $("tdNewScreenFormat").value,
				rows: Number($("tdNewScreenRows").value) || 10, cols: Number($("tdNewScreenCols").value) || 16
			} });
			state.screens.push(created);
			e.target.reset();
			pickScreen(created.id);
			C.toast(`${created.name} added. Shape the seats, then save.`, "ok");
		} catch (err) {
			C.toast(err.message, "bad");
		}
	});
	window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

	/* ── Movies ───────────────────────────────────────────── */
	function movieExtras(m) {
		const count = (list, one, many) => (list && list.length ? `${list.length} ${list.length === 1 ? one : many}` : "");
		const parts = [count(m.trailers, "video", "videos"), count(m.cast, "cast", "cast"), count(m.crew, "crew", "crew")].filter(Boolean);
		return parts.length ? parts.join(" \u00b7 ") : "No trailer or cast yet";
	}
	function renderMovies() {
		$("tdMovieList").innerHTML = state.movies.map((m) => `
			<article class="td-movie">
				<div class="td-poster">${m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="" loading="lazy">` : `<span>${esc(m.title.slice(0, 1))}</span>`}</div>
				<div class="td-movie-body">
					<strong>${esc(m.title)}</strong>
					<small>${esc([m.language, m.certificate, m.duration_min + " min", m.genres].filter(Boolean).join(" \u00b7 "))}</small>
					<small class="td-movie-extras">${esc(movieExtras(m))}</small>
					<div class="td-movie-actions">
						<button type="button" class="td-link" data-movie-edit="${m.id}">Edit</button>
						<button type="button" class="td-link is-danger" data-movie-remove="${m.id}">Remove</button>
					</div>
				</div>
			</article>`).join("") || '<p class="td-empty">No movies yet. Add the first one with the form.</p>';
		$("tdMovieList").querySelectorAll("[data-movie-edit]").forEach((b) => b.addEventListener("click", () => fillMovieForm(state.movies.find((m) => m.id === b.getAttribute("data-movie-edit")))));
		$("tdMovieList").querySelectorAll("[data-movie-remove]").forEach((b) => b.addEventListener("click", async () => {
			const m = state.movies.find((x) => x.id === b.getAttribute("data-movie-remove"));
			if (!m || !confirm(`Remove ${m.title}?`)) return;
			try {
				await C.api(`/api/cinema/movies/${m.id}`, { method: "DELETE" });
				state.movies = state.movies.filter((x) => x.id !== m.id);
				renderMovies();
				C.toast("Movie removed.", "ok");
			} catch (err) { C.toast(err.message, "bad"); }
		}));
	}
	function fillMovieForm(m) {
		const f = $("tdMovieForm");
		f.reset();
		$("tdMovieId").value = m ? m.id : "";
		$("tdMovieTitle").value = m ? m.title : "";
		$("tdMovieLang").value = m ? m.language : "";
		$("tdMovieCert").value = m ? (m.certificate || "") : "";
		$("tdMovieRuntime").value = m ? m.duration_min : "";
		$("tdMovieGenres").value = m ? (m.genres || "") : "";
		$("tdMovieRelease").value = m ? (m.release_date || "") : "";
		$("tdMovieDesc").value = m ? (m.description || "") : "";
		$("tdMoviePosterUrl").value = m ? (m.poster_url || "") : "";
		$("tdMoviePosterPreview").innerHTML = m && m.poster_url ? `<img src="${esc(C.resolveMedia(m.poster_url))}" alt="Poster preview">` : "No poster yet";
		fillPeople("cast", m ? m.cast : []);
		fillPeople("crew", m ? m.crew : []);
		fillTrailers(m ? m.trailers : []);
		$("tdMovieSubmit").textContent = m ? "Save movie" : "Add movie";
		$("tdMovieFormTitle").textContent = m ? `Edit ${m.title}` : "Add a movie";
		$("tdMovieCancel").hidden = !m;
		if (m) f.scrollIntoView({ behavior: "smooth", block: "start" });
	}
	$("tdMovieCancel").addEventListener("click", () => fillMovieForm(null));
	$("tdMovieLangList").innerHTML = LANGUAGES.map((l) => `<option value="${l}"></option>`).join("");
	$("tdCrewJobs").innerHTML = CREW_JOBS.map((j) => `<option value="${j}"></option>`).join("");

	/* Photos are framed in the cropper first; sizes match the server limits in APIs/cinema_owner.py. */
	const PHOTO_CROP = { aspect: 1, shape: "circle", width: 400, height: 400, minBytes: 2 * 1024, maxBytes: 2 * 1024 * 1024 };
	const POSTER_CROP = { aspect: 2 / 3, shape: "rect", width: 600, height: 900, minBytes: 20 * 1024, maxBytes: 3 * 1024 * 1024, title: "Adjust poster" };
	async function adjustImage(file, opts) {
		if (!window.JodImageCropper) return file;
		try {
			return await window.JodImageCropper.open(file, opts);
		} catch (err) {
			C.toast(err.message, "bad");
			return null;
		}
	}
	function uploadImage(path, blob, base) {
		const form = new FormData();
		const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
		form.append("file", blob, `${base}.${ext}`);
		return C.api(path, { method: "POST", body: form });
	}

	/* Cast and crew rows */
	function personRow(kind, p) {
		const row = document.createElement("div");
		row.className = "td-person";
		row.dataset.photo = (p && p.photo_url) || "";
		const rolePh = kind === "cast" ? "Character (optional)" : "Job, e.g. Director";
		row.innerHTML = `
			<label class="td-avatar" title="Add photo"><input type="file" accept=".jpg,.jpeg,.png,.webp" hidden><span></span></label>
			<input class="setup-input" data-p="name" maxlength="80" placeholder="${kind === "cast" ? "Actor name" : "Name"}" aria-label="${kind === "cast" ? "Actor name" : "Crew member name"}">
			<input class="setup-input" data-p="role" maxlength="80" placeholder="${rolePh}" aria-label="${rolePh}"${kind === "crew" ? ' list="tdCrewJobs"' : ""}>
			<button type="button" class="td-row-remove" aria-label="Remove">\u00d7</button>`;
		row.querySelector('[data-p="name"]').value = (p && p.name) || "";
		row.querySelector('[data-p="role"]').value = (p && p.role) || "";
		const avatar = row.querySelector(".td-avatar span");
		const paint = () => {
			const photo = row.dataset.photo;
			avatar.innerHTML = photo ? `<img src="${esc(C.resolveMedia(photo))}" alt="">` : esc(C.initials(row.querySelector('[data-p="name"]').value)).replace("?", "+");
		};
		paint();
		row.querySelector('[data-p="name"]').addEventListener("input", () => { if (!row.dataset.photo) paint(); });
		row.querySelector('input[type="file"]').addEventListener("change", async (e) => {
			const file = e.target.files[0];
			e.target.value = "";
			if (!file) return;
			const name = row.querySelector('[data-p="name"]').value.trim();
			const blob = await adjustImage(file, { ...PHOTO_CROP, title: name ? `Adjust ${name}'s photo` : "Adjust photo" });
			if (!blob) return;
			avatar.textContent = "\u2026";
			try {
				row.dataset.photo = (await uploadImage("/api/cinema/movies/photo", blob, "photo")).photo_url;
			} catch (err) { C.toast(err.message, "bad"); }
			paint();
		});
		row.querySelector(".td-row-remove").addEventListener("click", () => row.remove());
		return row;
	}
	function fillPeople(kind, rows) {
		const list = $(kind === "cast" ? "tdCastList" : "tdCrewList");
		list.innerHTML = "";
		(rows || []).forEach((p) => list.appendChild(personRow(kind, p)));
	}
	function readPeople(kind) {
		return [...$(kind === "cast" ? "tdCastList" : "tdCrewList").querySelectorAll(".td-person")].map((r) => ({
			name: r.querySelector('[data-p="name"]').value.trim(),
			role: r.querySelector('[data-p="role"]').value.trim() || null,
			photo_url: r.dataset.photo || null
		})).filter((p) => p.name);
	}
	[["cast", "tdCastAdd", "tdCastList", 30], ["crew", "tdCrewAdd", "tdCrewList", 30]].forEach(([kind, btn, list, max]) => {
		$(btn).addEventListener("click", () => {
			if ($(list).children.length >= max) return C.toast(`Up to ${max} ${kind} members.`, "bad");
			const row = personRow(kind, null);
			$(list).appendChild(row);
			row.querySelector('[data-p="name"]').focus();
		});
	});

	/* YouTube trailers */
	function trailerRow(t) {
		const row = document.createElement("div");
		row.className = "td-trailer";
		row.innerHTML = `
			<div class="td-trailer-thumb"><span>Paste a link</span></div>
			<div class="td-trailer-fields">
				<input class="setup-input" data-t="url" maxlength="300" inputmode="url" placeholder="https://youtu.be/\u2026" aria-label="YouTube link">
				<select class="setup-select" data-t="label" aria-label="Video type">${TRAILER_LABELS.map((l) => `<option>${l}</option>`).join("")}</select>
				<small class="td-trailer-msg"></small>
			</div>
			<button type="button" class="td-row-remove" aria-label="Remove video">\u00d7</button>`;
		const url = row.querySelector('[data-t="url"]');
		url.value = t ? `https://youtu.be/${t.youtube_id}` : "";
		row.querySelector('[data-t="label"]').value = (t && t.label) || "Trailer";
		const preview = () => {
			const id = C.youtubeId(url.value);
			const thumb = row.querySelector(".td-trailer-thumb");
			const msg = row.querySelector(".td-trailer-msg");
			row.classList.toggle("is-bad", Boolean(url.value.trim()) && !id);
			if (id) {
				thumb.innerHTML = `<img src="${esc(C.youtubeThumb(id))}" alt="" loading="lazy"><a href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube">\u25B6</a>`;
				msg.textContent = "";
			} else {
				thumb.innerHTML = "<span>Paste a link</span>";
				msg.textContent = url.value.trim() ? "That isn't a YouTube video link." : "";
			}
		};
		url.addEventListener("input", preview);
		preview();
		row.querySelector(".td-row-remove").addEventListener("click", () => row.remove());
		return row;
	}
	function fillTrailers(rows) {
		$("tdTrailerList").innerHTML = "";
		(rows || []).forEach((t) => $("tdTrailerList").appendChild(trailerRow(t)));
	}
	function readTrailers() {
		return [...$("tdTrailerList").querySelectorAll(".td-trailer")].map((r) => ({
			url: r.querySelector('[data-t="url"]').value.trim(),
			label: r.querySelector('[data-t="label"]').value
		})).filter((t) => t.url);
	}
	$("tdTrailerAdd").addEventListener("click", () => {
		if ($("tdTrailerList").children.length >= 5) return C.toast("Up to 5 YouTube videos per movie.", "bad");
		const row = trailerRow(null);
		$("tdTrailerList").appendChild(row);
		row.querySelector('[data-t="url"]').focus();
	});
	$("tdMoviePoster").addEventListener("change", async () => {
		const file = $("tdMoviePoster").files[0];
		$("tdMoviePoster").value = "";
		if (!file) return;
		const blob = await adjustImage(file, POSTER_CROP);
		if (!blob) return;
		$("tdMoviePosterPreview").textContent = "Uploading\u2026";
		try {
			const data = await uploadImage("/api/cinema/movies/poster", blob, "poster");
			$("tdMoviePosterUrl").value = data.poster_url;
			$("tdMoviePosterPreview").innerHTML = `<img src="${esc(C.resolveMedia(data.poster_url))}" alt="Poster preview">`;
		} catch (err) {
			$("tdMoviePosterPreview").textContent = err.message;
		}
	});
	$("tdMovieForm").addEventListener("submit", async (e) => {
		e.preventDefault();
		const id = $("tdMovieId").value;
		const payload = {
			title: $("tdMovieTitle").value.trim(),
			language: $("tdMovieLang").value.trim(),
			certificate: $("tdMovieCert").value || null,
			duration_min: Number($("tdMovieRuntime").value),
			genres: $("tdMovieGenres").value.trim() || null,
			release_date: $("tdMovieRelease").value || null,
			description: $("tdMovieDesc").value.trim() || null,
			poster_url: $("tdMoviePosterUrl").value || null,
			cast: readPeople("cast"),
			crew: readPeople("crew"),
			trailers: readTrailers()
		};
		const bad = $("tdTrailerList").querySelector(".td-trailer.is-bad [data-t='url']");
		if (bad) {
			bad.focus();
			return C.toast("Fix or remove the link that isn't a YouTube video.", "bad");
		}
		const submit = $("tdMovieSubmit");
		submit.disabled = true;
		try {
			const saved = await C.api(id ? `/api/cinema/movies/${id}` : "/api/cinema/movies", { method: id ? "PUT" : "POST", json: payload });
			if (id) state.movies = state.movies.map((m) => (m.id === id ? saved : m));
			else state.movies.unshift(saved);
			fillMovieForm(null);
			renderMovies();
			C.toast(id ? "Movie saved." : `${saved.title} added. Schedule its shows next.`, "ok");
		} catch (err) {
			C.toast(err.message, "bad");
		} finally {
			submit.disabled = false;
		}
	});

	/* ── Shows ────────────────────────────────────────────── */
	function fillShowSelects() {
		$("tdShowMovie").innerHTML = '<option value="">Choose a movie</option>' + state.movies.map((m) => `<option value="${m.id}">${esc(m.title)} (${esc(m.language)})</option>`).join("");
		$("tdShowScreen").innerHTML = '<option value="">Choose a screen</option>' + state.screens.map((s) => `<option value="${s.id}">${esc(s.name)} \u00b7 ${esc(s.format)} \u00b7 ${s.seat_count} seats</option>`).join("");
		renderPriceInputs();
	}
	function renderPriceInputs() {
		const screen = screenById($("tdShowScreen").value);
		const cats = screen && screen.layout ? screen.layout.categories : [];
		$("tdShowPrices").innerHTML = cats.length
			? cats.map((c) => `<label class="td-price"><span><i style="background:${esc(c.color)}"></i>${esc(c.name)}</span><input type="number" class="setup-input" min="1" max="10000" step="1" required data-price="${esc(c.id)}" placeholder="\u20B9"></label>`).join("")
			: '<p class="td-hint">Pick a screen to set a price for each seat category.</p>';
	}
	$("tdShowScreen").addEventListener("change", renderPriceInputs);
	function addTimeInput(value) {
		const wrap = document.createElement("span");
		wrap.className = "td-time";
		wrap.innerHTML = `<input type="time" class="setup-input" required value="${esc(value || "")}"><button type="button" class="td-icon-btn" title="Remove time">&times;</button>`;
		wrap.querySelector("button").addEventListener("click", () => { if ($("tdShowTimes").children.length > 1) wrap.remove(); });
		$("tdShowTimes").appendChild(wrap);
	}
	$("tdAddTime").addEventListener("click", () => addTimeInput(""));

	function todayIst() {
		return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
	}

	/* The form shows only while scheduling or editing; otherwise the list uses the full width. */
	function upcomingShows() {
		return state.shows.filter((s) => s.status === "scheduled");
	}
	function setShowForm(open) {
		$("tdShowForm").hidden = !open;
		$("tdShowSplit").classList.toggle("is-solo", !open);
		$("tdShowNew").hidden = open;
		$("tdShowCancel").hidden = !upcomingShows().length && !$("tdShowEditId").value;
		if (open) $("tdShowForm").scrollIntoView({ behavior: "smooth", block: "start" });
	}
	function resetShowForm() {
		$("tdShowEditId").value = "";
		$("tdShowFormTitle").textContent = "Schedule shows";
		$("tdShowFormSub").textContent = "Pick a movie and screen, add one or more show times, and set the ticket price for each seat category.";
		$("tdShowSubmit").textContent = "Schedule";
		$("tdShowLocked").hidden = true;
		["tdShowMovie", "tdShowScreen", "tdShowDate"].forEach((id) => { $(id).disabled = false; });
		$("tdAddTime").hidden = false;
		$("tdShowTimes").innerHTML = "";
		addTimeInput("");
		$("tdShowDate").value = todayIst();
		$("tdShowResult").innerHTML = "";
	}
	function openNewShow() {
		fillShowSelectsOnce();
		resetShowForm();
		setShowForm(true);
	}
	function openEditShow(id) {
		const s = state.shows.find((x) => x.id === id);
		if (!s) return;
		fillShowSelectsOnce();
		resetShowForm();
		const [date, time] = String(s.starts_at_local || "").split("T");
		$("tdShowEditId").value = s.id;
		$("tdShowFormTitle").textContent = `Edit ${s.movie_title} \u00b7 ${C.time(s.starts_at)}`;
		$("tdShowFormSub").textContent = "Change the movie, screen, time or ticket prices for this show.";
		$("tdShowSubmit").textContent = "Save changes";
		$("tdShowMovie").value = s.movie_id;
		$("tdShowScreen").value = s.screen_id;
		renderPriceInputs();
		$("tdShowDate").value = date || todayIst();
		$("tdShowTimes").innerHTML = "";
		addTimeInput(time || "");
		$("tdAddTime").hidden = true;
		$("tdShowPrices").querySelectorAll("[data-price]").forEach((i) => {
			const v = (s.prices || {})[i.getAttribute("data-price")];
			if (v != null) i.value = v;
		});
		const locked = s.sold > 0;
		$("tdShowLocked").hidden = !locked;
		["tdShowMovie", "tdShowScreen", "tdShowDate"].forEach((fid) => { $(fid).disabled = locked; });
		$("tdShowTimes").querySelectorAll("input, button").forEach((x) => { x.disabled = locked; });
		setShowForm(true);
	}
	$("tdShowNew").addEventListener("click", openNewShow);
	$("tdShowCancel").addEventListener("click", () => {
		resetShowForm();
		setShowForm(!upcomingShows().length);
	});

	$("tdShowForm").addEventListener("submit", async (e) => {
		e.preventDefault();
		const editId = $("tdShowEditId").value;
		const date = $("tdShowDate").value;
		const times = Array.from($("tdShowTimes").querySelectorAll("input")).map((i) => i.value).filter(Boolean);
		const prices = {};
		$("tdShowPrices").querySelectorAll("[data-price]").forEach((i) => { prices[i.getAttribute("data-price")] = Number(i.value); });
		if (!date || !times.length) return C.toast("Pick a date and at least one show time.", "bad");
		const body = (t) => ({ screen_id: $("tdShowScreen").value, movie_id: $("tdShowMovie").value, starts_at: `${date}T${t}`, prices });
		const btn = $("tdShowSubmit");
		btn.disabled = true;
		if (editId) {
			try {
				const updated = await C.api(`/api/cinema/shows/${editId}`, { method: "PUT", json: body(times[0]) });
				state.shows = state.shows.map((x) => (x.id === editId ? updated : x));
				state.shows.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
				resetShowForm();
				setShowForm(false);
				renderShows();
				C.toast("Show updated.", "ok");
			} catch (err) {
				C.toast(err.message, "bad");
			} finally {
				btn.disabled = false;
			}
			return;
		}
		const results = [];
		let failed = 0;
		for (const t of times) {
			try {
				const show = await C.api("/api/cinema/shows", { method: "POST", json: body(t) });
				state.shows.push(show);
				results.push(`<li class="is-ok">${esc(t)} \u2014 scheduled</li>`);
			} catch (err) {
				failed += 1;
				results.push(`<li class="is-bad">${esc(t)} \u2014 ${esc(err.message)}</li>`);
			}
		}
		btn.disabled = false;
		state.shows.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
		const scheduled = times.length - failed;
		if (failed) {
			$("tdShowResult").innerHTML = `<ul>${results.join("")}</ul>`;
			renderShows(true);
		} else {
			resetShowForm();
			renderShows();
			C.toast(scheduled === 1 ? "Show scheduled." : `${scheduled} shows scheduled.`, "ok");
		}
	});

	const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

	function renderShows(keepFormOpen) {
		fillShowSelectsOnce();
		if (!keepFormOpen && !$("tdShowEditId").value) setShowForm(!upcomingShows().length);
		const groups = {};
		state.shows.filter((s) => s.status === "scheduled").forEach((s) => {
			const key = C.istDateKey(s.starts_at);
			(groups[key] = groups[key] || []).push(s);
		});
		const keys = Object.keys(groups).sort();
		$("tdShowList").innerHTML = keys.length ? keys.map((k) => `
			<section class="td-day"><h4>${esc(C.day(groups[k][0].starts_at))}</h4>
			${groups[k].map((s) => `
				<div class="td-row">
					<div><strong>${esc(C.time(s.starts_at))} \u00b7 ${esc(s.movie_title)}</strong>
						<small>${esc(s.screen_name)} \u00b7 ${esc(s.format)} \u00b7 ${Object.entries(s.prices || {}).map(([k2, v]) => `${esc(categoryName(s.screen_id, k2))} ${C.money(v)}`).join(", ")}</small></div>
					<div class="td-row-end"><span class="td-fill"><i style="width:${s.seat_count ? Math.round((s.sold / s.seat_count) * 100) : 0}%"></i></span><small>${s.sold}/${s.seat_count} sold</small>
						<div class="td-movie-actions"><button type="button" class="td-link" data-show-seats="${s.id}">Seats</button>
						<button type="button" class="td-link is-danger" data-show-cancel="${s.id}">Cancel</button></div></div>
					<button type="button" class="td-edit-btn${s.id === $("tdShowEditId").value ? " is-on" : ""}" data-show-edit="${s.id}" aria-label="Edit ${esc(s.movie_title)} at ${esc(C.time(s.starts_at))}" title="Edit show">${EDIT_ICON}</button>
				</div>`).join("")}</section>`).join("") : '<p class="td-empty">No upcoming shows. Use the form to schedule one.</p>';
		$("tdShowList").querySelectorAll("[data-show-seats]").forEach((b) => b.addEventListener("click", () => openShowSeats(b.getAttribute("data-show-seats"))));
		$("tdShowList").querySelectorAll("[data-show-cancel]").forEach((b) => b.addEventListener("click", () => cancelShow(b.getAttribute("data-show-cancel"))));
		$("tdShowList").querySelectorAll("[data-show-edit]").forEach((b) => b.addEventListener("click", () => {
			openEditShow(b.getAttribute("data-show-edit"));
			renderShowsHighlight();
		}));
	}
	function renderShowsHighlight() {
		const id = $("tdShowEditId").value;
		$("tdShowList").querySelectorAll("[data-show-edit]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-show-edit") === id));
	}
	function categoryName(screenId, catId) {
		const screen = screenById(screenId);
		const cat = screen && screen.layout ? screen.layout.categories.find((c) => c.id === catId) : null;
		return cat ? cat.name : catId;
	}
	let selectsFilled = false;
	function fillShowSelectsOnce() {
		if (selectsFilled && $("tdShowMovie").options.length === state.movies.length + 1 && $("tdShowScreen").options.length === state.screens.length + 1) return;
		selectsFilled = true;
		fillShowSelects();
	}
	async function openShowSeats(id) {
		openModal("Seat view", "Loading\u2026");
		try {
			const data = await C.api(`/api/cinema/shows/${id}/seats`);
			const sh = data.show;
			$("tdModalTitle").textContent = `${C.day(sh.starts_at)}, ${C.time(sh.starts_at)} \u00b7 ${data.bookings.length} bookings`;
			$("tdModalBody").innerHTML = `<div class="seatmap-legend">${SM.legendHtml(data.layout, sh.prices)}</div><div id="tdSeatView" class="seatmap-scroll"></div>
				<h4 class="td-sub">Bookings</h4>` + (data.bookings.length ? `<div class="td-table">${data.bookings.map((b) => `<div class="td-row"><div><strong>${esc(b.booking_code)}</strong><small>${esc(b.name || b.email)} \u00b7 ${esc(b.seats.map((x) => x.id).join(", "))}</small></div><div class="td-row-end"><span>${C.money(b.amount)}</span><small>${b.checked_in_at ? "Checked in" : "Not checked in"}</small></div></div>`).join("")}</div>` : '<p class="td-empty">No tickets sold yet.</p>');
			SM.render($("tdSeatView"), data.layout, { mode: "view", states: data.seats });
		} catch (err) { $("tdModalBody").textContent = err.message; }
	}
	async function cancelShow(id) {
		const s = state.shows.find((x) => x.id === id);
		if (!s || !confirm(`Cancel ${s.movie_title} at ${C.time(s.starts_at)} on ${C.day(s.starts_at)}?`)) return;
		try {
			await C.api(`/api/cinema/shows/${id}/cancel`, { method: "POST" });
			s.status = "cancelled";
			if ($("tdShowEditId").value === id) resetShowForm();
			renderShows();
			C.toast("Show cancelled.", "ok");
		} catch (err) { C.toast(err.message, "bad"); }
	}

	/* ── Bookings & check-in ──────────────────────────────── */
	let bookings = [];
	let flashCode = "";
	let ticket = null;
	let ticketCode = "";

	function seatsText(b) {
		return (b.seats || []).map((x) => x.id).join(", ");
	}
	function bookingStatus(b) {
		if (b.status === "payment_conflict") return ['<em class="td-chip is-bad">Needs refund</em>', "is-bad"];
		if (b.checked_in_at) return [`<em class="td-chip is-ok">\u2713 Checked in ${esc(C.time(b.checked_in_at))}</em>`, "is-ok"];
		return ['<em class="td-chip">Not checked in</em>', ""];
	}
	function renderBookings() {
		const today = todayIst();
		const todays = bookings.filter((b) => b.status === "confirmed" && b.starts_at && C.istDateKey(b.starts_at) === today);
		const inside = todays.filter((b) => b.checked_in_at);
		$("tdCheckinSummary").textContent = todays.length
			? `Today: ${inside.length} of ${todays.length} bookings checked in (${inside.reduce((n, b) => n + (b.seat_count || 0), 0)} of ${todays.reduce((n, b) => n + (b.seat_count || 0), 0)} seats)`
			: "No bookings for today's shows yet.";
		$("tdBookingList").innerHTML = bookings.length ? bookings.map((b) => {
			const [chip, cls] = bookingStatus(b);
			const show = [b.movie_title, b.starts_at ? `${C.day(b.starts_at)}, ${C.time(b.starts_at)}` : "", b.screen_name].filter(Boolean).join(" \u00b7 ");
			return `<button type="button" class="td-row td-booking ${cls}${b.booking_code === flashCode ? " is-flash" : ""}" data-booking="${esc(b.booking_code)}">
				<div><strong>${esc(b.booking_code)} <span class="td-booking-name">${esc(b.name || b.email)}</span></strong>
					<small>${esc(show)}</small><small>Seats ${esc(seatsText(b))}</small></div>
				<div class="td-row-end"><span>${C.money(b.amount)} <small>(payout ${C.money(b.payout)})</small></span>${chip}</div>
			</button>`;
		}).join("") : '<p class="td-empty">No bookings yet.</p>';
		$("tdBookingList").querySelectorAll("[data-booking]").forEach((row) => row.addEventListener("click", () => lookupTicket(row.getAttribute("data-booking"), false)));
		if (flashCode) {
			const row = $("tdBookingList").querySelector(".is-flash");
			if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
			setTimeout(() => { flashCode = ""; const r = $("tdBookingList").querySelector(".is-flash"); if (r) r.classList.remove("is-flash"); }, 2500);
		}
	}
	async function loadBookings() {
		if (!bookings.length) $("tdBookingList").innerHTML = "Loading\u2026";
		try {
			bookings = (await C.api("/api/cinema/bookings?limit=200")).bookings || [];
			renderBookings();
		} catch (err) { $("tdBookingList").textContent = err.message; }
	}
	$("tdRefreshBookings").addEventListener("click", loadBookings);

	function updateBookingRow(b) {
		const i = bookings.findIndex((x) => x.booking_code === b.booking_code);
		if (i >= 0) bookings[i] = { ...bookings[i], ...b };
		flashCode = b.booking_code;
		renderBookings();
	}

	function feedback(ok) {
		try { if (navigator.vibrate) navigator.vibrate(ok ? 80 : [60, 60, 60]); } catch (_) {}
		try {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			const ac = feedback.ac || (feedback.ac = new AC());
			const osc = ac.createOscillator();
			const gain = ac.createGain();
			osc.frequency.value = ok ? 880 : 220;
			gain.gain.setValueAtTime(0.12, ac.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
			osc.connect(gain).connect(ac.destination);
			osc.start();
			osc.stop(ac.currentTime + 0.2);
		} catch (_) {}
	}

	/* Ticket details card: scan or type a code -> details -> confirm check-in. */
	function renderTicket(view, note) {
		const out = $("tdCheckinResult");
		if (!view) {
			out.innerHTML = note ? `<div class="td-ticket is-bad"><div class="td-ticket-status">\u2715 Not a valid ticket</div><p class="td-ticket-note">${esc(note)}</p>
				<div class="td-ticket-actions"><button type="button" class="btn-card-action" data-ck="next">${scannerOn() ? "Scan next" : "Clear"}</button></div></div>` : "";
			return;
		}
		const b = view.booking;
		const s = view.show;
		let cls = "is-ok";
		let status = "\u2713 Valid ticket";
		if (view.already_checked_in) {
			cls = "is-bad";
			status = `\u2715 Already checked in at ${C.time(b.checked_in_at)}`;
		} else if (!view.entry_ok) {
			cls = "is-warn";
			status = "Not for this show time";
		}
		if (view.just_checked_in) {
			cls = "is-ok";
			status = "\u2713 Checked in \u2014 allow entry";
		}
		const actions = [];
		if (!view.already_checked_in && !view.just_checked_in) {
			actions.push(view.entry_ok
				? '<button type="button" class="publish-gradient-btn" data-ck="confirm">Confirm check-in</button>'
				: '<button type="button" class="btn-card-action td-force" data-ck="force">Check in anyway</button>');
		}
		actions.push(`<button type="button" class="btn-card-action" data-ck="next">${scannerOn() ? "Scan next" : "Done"}</button>`);
		out.innerHTML = `<div class="td-ticket ${cls}">
			<div class="td-ticket-status">${esc(status)}</div>
			${note || view.entry_note ? `<p class="td-ticket-note">${esc(note || view.entry_note)}</p>` : ""}
			<div class="td-ticket-body">
				<strong class="td-ticket-movie">${esc((s && s.movie_title) || "Movie")}${s && s.language ? ` <small>${esc(s.language)}</small>` : ""}</strong>
				<dl>
					<div><dt>Show</dt><dd>${s ? `${esc(C.day(s.starts_at))}, ${esc(C.time(s.starts_at))} \u00b7 ${esc(s.screen_name || "")} (${esc(s.format || "2D")})` : "\u2014"}</dd></div>
					<div><dt>Seats</dt><dd class="td-ticket-seats">${esc(seatsText(b))} <small>(${b.seat_count} ${b.seat_count === 1 ? "seat" : "seats"})</small></dd></div>
					<div><dt>Name</dt><dd>${esc(b.name || "\u2014")}${b.phone ? ` <small>${esc(b.phone)}</small>` : ""}</dd></div>
					<div><dt>Booking</dt><dd>${esc(b.booking_code)} \u00b7 ${C.money(b.amount)} paid</dd></div>
				</dl>
			</div>
			<div class="td-ticket-actions">${actions.join("")}</div>
		</div>`;
		const primary = out.querySelector('[data-ck="confirm"]') || out.querySelector('[data-ck="next"]');
		if (primary && !scannerOn()) primary.focus();
	}
	async function lookupTicket(code, fromScan) {
		ticketCode = code;
		$("tdCheckinResult").innerHTML = '<div class="td-ticket"><div class="td-ticket-status">Checking ticket\u2026</div></div>';
		try {
			ticket = await C.api("/api/cinema/bookings/lookup", { method: "POST", json: { code } });
			if (fromScan && $("tdScanAuto").checked && ticket.entry_ok && !ticket.already_checked_in) return checkIn(false);
			feedback(ticket.entry_ok && !ticket.already_checked_in);
			renderTicket(ticket);
			if (fromScan) setScanHint(ticket.already_checked_in ? "Already checked in" : ticket.entry_ok ? "Ticket found" : "Check the show time");
		} catch (err) {
			ticket = null;
			feedback(false);
			renderTicket(null, err.message);
			if (fromScan) setScanHint("Not a valid ticket");
		}
	}
	async function checkIn(force) {
		if (!ticketCode) return;
		try {
			const view = await C.api("/api/cinema/bookings/checkin", { method: "POST", json: { code: ticketCode, force } });
			ticket = { ...view, just_checked_in: !view.already_checked_in };
			feedback(true);
			renderTicket(ticket);
			updateBookingRow({ ...view.booking, movie_title: view.show && view.show.movie_title, starts_at: view.show && view.show.starts_at, screen_name: view.show && view.show.screen_name });
			setScanHint("Checked in");
			if (scannerOn() && $("tdScanAuto").checked) setTimeout(nextScan, 1800);
		} catch (err) {
			feedback(false);
			renderTicket(ticket, err.message);
		}
	}
	function nextScan() {
		ticket = null;
		ticketCode = "";
		renderTicket(null);
		$("tdCheckinCode").value = "";
		if (scannerOn()) {
			scanner.resume();
			setScanHint("Point the camera at the ticket QR");
		} else {
			$("tdCheckinCode").focus();
		}
	}
	$("tdCheckinResult").addEventListener("click", (e) => {
		const btn = e.target.closest("[data-ck]");
		if (!btn) return;
		const act = btn.getAttribute("data-ck");
		if (act === "confirm") checkIn(false);
		else if (act === "force") {
			if (confirm("This ticket is not for a show around now. Check it in anyway?")) checkIn(true);
		} else nextScan();
	});
	$("tdCheckinForm").addEventListener("submit", (e) => {
		e.preventDefault();
		const code = $("tdCheckinCode").value.trim();
		if (code) lookupTicket(code, false);
	});

	/* Camera */
	let scanner = null;
	function scannerOn() {
		return Boolean(scanner && scanner.running());
	}
	function setScanHint(text) {
		$("tdScanHint").textContent = text;
	}
	function setScanUi(on) {
		$("tdScanView").hidden = !on;
		$("tdScanStart").hidden = on;
		$("tdScanStop").hidden = !on;
		$("tdScanFlip").hidden = !on;
	}
	async function startScanner() {
		if (!window.JodQrScanner) return C.toast("The QR scanner didn't load. Refresh the page and try again.", "bad");
		if (!scanner) {
			scanner = window.JodQrScanner.create($("tdScanVideo"), (value) => {
				scanner.pause();
				lookupTicket(value, true);
			});
		}
		const btn = $("tdScanStart");
		btn.disabled = true;
		btn.textContent = "Starting camera\u2026";
		try {
			await scanner.start();
			setScanUi(true);
			setScanHint("Point the camera at the ticket QR");
		} catch (err) {
			setScanUi(false);
			C.toast(err.message, "bad");
		} finally {
			btn.disabled = false;
			btn.textContent = "Scan ticket QR";
		}
	}
	function stopScanner() {
		if (scanner) scanner.stop();
		setScanUi(false);
	}
	$("tdScanStart").addEventListener("click", startScanner);
	$("tdScanStop").addEventListener("click", stopScanner);
	$("tdScanFlip").addEventListener("click", async () => {
		try { await scanner.flip(); } catch (err) { C.toast(err.message, "bad"); stopScanner(); }
	});
	document.addEventListener("visibilitychange", () => { if (document.hidden && scannerOn()) stopScanner(); });
	try { $("tdScanAuto").checked = localStorage.getItem("jod_td_auto_checkin") === "1"; } catch (_) {}
	$("tdScanAuto").addEventListener("change", () => {
		try { localStorage.setItem("jod_td_auto_checkin", $("tdScanAuto").checked ? "1" : "0"); } catch (_) {}
	});

	/* ── Start ────────────────────────────────────────────── */
	if (!(await loadAll())) return;
	renderOverview();
	renderScreenList();
	if (state.screens[0]) pickScreen(state.screens[0].id);
	renderMovies();
	fillMovieForm(null);
	$("tdShowDate").min = todayIst();
	resetShowForm();
	const tab = C.param("tab");
	showTab(["overview", "screens", "movies", "shows", "bookings"].includes(tab) ? tab : "overview");
});
