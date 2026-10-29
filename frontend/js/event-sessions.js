/* Event Schedule & Session Management — host builder, session overview, scanner session picker. */
(function (global) {
	"use strict";

	var MAX_SESSIONS = 50;
	var STATUSES = [["active", "Active"], ["inactive", "Inactive (paused)"], ["cancelled", "Cancelled"]];
	var MODES = [
		["all_attendees", "All ticket holders of this event"],
		["registered", "Only attendees registered for this session"],
		["ticket_types", "Attendees with selected ticket types / packages"]
	];

	// ── Pure helpers (also used by tests under Node) ──────────────────────────
	var keySeq = 0;
	function newKey() { keySeq += 1; return "s" + Date.now().toString(36) + keySeq; }

	function blankSession(defaults) {
		var d = defaults || {};
		return {
			_key: newKey(),
			session_id: null,
			session_name: d.session_name || "",
			session_description: "",
			session_date: d.session_date || "",
			start_time: d.start_time || "",
			end_time: d.end_time || "",
			ends_next_day: false,
			venue_name: d.venue_name || "",
			venue_address: d.venue_address || "",
			capacity: "",
			eligibility_mode: d.eligibility_mode || "registered",
			eligible_ticket_types: [],
			status: "active"
		};
	}

	/** Grow with blank sessions, or shrink by dropping trailing unsaved ones only. */
	function resizeSessions(list, count, defaults) {
		var target = Math.max(1, Math.min(MAX_SESSIONS, parseInt(count, 10) || 1));
		var out = list.slice();
		while (out.length < target) {
			out.push(blankSession(Object.assign({}, defaults, { session_name: "Session " + (out.length + 1) })));
		}
		var blocked = 0;
		while (out.length > target) {
			var last = out[out.length - 1];
			if (last.session_id) { blocked = out.length - target; break; }
			out.pop();
		}
		return { list: out, blocked: blocked };
	}

	function validateSession(s) {
		var errors = {};
		if (!String(s.session_name || "").trim()) errors.session_name = "Enter a session name.";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.session_date || ""))) errors.session_date = "Pick the session date.";
		var start = String(s.start_time || ""), end = String(s.end_time || "");
		if (!/^\d{2}:\d{2}$/.test(start)) errors.start_time = "Enter the start time.";
		if (!/^\d{2}:\d{2}$/.test(end)) errors.end_time = "Enter the end time.";
		if (!errors.start_time && !errors.end_time) {
			if (start === end) errors.end_time = "End time must be later than start time.";
			else if (end < start && !s.ends_next_day) errors.end_time = "End time must be later than start time (tick 'Ends after midnight' for overnight sessions).";
		}
		if (!String(s.venue_name || "").trim()) errors.venue_name = "Enter the venue name.";
		if (s.capacity !== "" && s.capacity != null) {
			var cap = Number(s.capacity);
			if (!Number.isInteger(cap) || cap < 1) errors.capacity = "Capacity must be a whole number of 1 or more.";
		}
		if (s.eligibility_mode === "ticket_types" && !(s.eligible_ticket_types || []).length) {
			errors.eligible_ticket_types = "Pick at least one ticket type.";
		}
		return errors;
	}

	function toPayload(s) {
		var body = {
			session_name: String(s.session_name || "").trim(),
			session_description: String(s.session_description || "").trim(),
			session_date: s.session_date,
			start_time: s.start_time,
			end_time: s.end_time,
			ends_next_day: !!s.ends_next_day,
			venue_name: String(s.venue_name || "").trim(),
			venue_address: String(s.venue_address || "").trim(),
			capacity: s.capacity === "" || s.capacity == null ? null : Number(s.capacity),
			eligibility_mode: s.eligibility_mode,
			eligible_ticket_types: s.eligibility_mode === "ticket_types" ? (s.eligible_ticket_types || []).slice() : [],
			status: s.status || "active"
		};
		if (s.session_id) body.session_id = s.session_id;
		return body;
	}

	function fromServer(row) {
		return {
			_key: newKey(),
			session_id: row.session_id,
			session_name: row.session_name || "",
			session_description: row.session_description || "",
			session_date: row.session_date || "",
			start_time: row.start_time || "",
			end_time: row.end_time || "",
			ends_next_day: !!row.ends_next_day,
			venue_name: row.venue_name || "",
			venue_address: row.venue_address || "",
			capacity: row.capacity == null ? "" : String(row.capacity),
			eligibility_mode: row.eligibility_mode || "registered",
			eligible_ticket_types: (row.eligible_ticket_types || []).slice(),
			status: row.status || "active"
		};
	}

	var helpers = { MAX_SESSIONS: MAX_SESSIONS, blankSession: blankSession, resizeSessions: resizeSessions, validateSession: validateSession, toPayload: toPayload, fromServer: fromServer };
	if (typeof module !== "undefined" && module.exports) module.exports = helpers;
	if (!global.document) return;

	// ── DOM layer ─────────────────────────────────────────────────────────────
	var cfg = {
		apiOrigin: function () { return ""; },
		authHeaders: function () { return {}; },
		eventId: function () { return null; },
		notify: function (msg) { if (global.console) console.log(msg); },
		ticketTypes: function () { return []; },
		eventDefaults: function () { return {}; }
	};
	var state = { structure: null, sessions: [], dirty: false, loadedFor: null, saving: null, overview: null, errors: {} };

	function esc(v) {
		return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}
	function api(path) { return String(cfg.apiOrigin() || "").replace(/\/$/, "") + "/api/events/" + path; }
	function request(path, opts) {
		var o = Object.assign({ credentials: "include", headers: {} }, opts || {});
		o.headers = Object.assign({ Accept: "application/json" }, cfg.authHeaders() || {}, o.headers || {});
		if (o.body && typeof o.body !== "string") {
			o.headers["Content-Type"] = "application/json";
			o.body = JSON.stringify(o.body);
		}
		return fetch(api(path), o).then(function (res) {
			return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
		});
	}
	function detailMessage(data, fallback) {
		var d = data && data.detail;
		if (typeof d === "string") return d;
		if (d && typeof d.message === "string") return d.message;
		return fallback;
	}
	function byId(id) { return document.getElementById(id); }

	// Builder ──────────────────────────────────────────────────────────────────
	function builderRoot() { return byId("evsessBuilder"); }

	function setStatus(text, tone) {
		var el = byId("evsessStatus");
		if (!el) return;
		el.textContent = text || "";
		el.className = "evsess-status" + (tone ? " is-" + tone : "");
	}

	function eligibilityHtml(s, index) {
		var types = cfg.ticketTypes() || [];
		var name = "evsessMode_" + s._key;
		var radios = MODES.map(function (m) {
			return '<label class="evsess-radio"><input type="radio" name="' + name + '" data-field="eligibility_mode" value="' + m[0] + '"' + (s.eligibility_mode === m[0] ? " checked" : "") + " /> " + esc(m[1]) + "</label>";
		}).join("");
		var picks = "";
		if (s.eligibility_mode === "ticket_types") {
			picks = types.length
				? '<div class="evsess-types">' + types.map(function (t) {
					var on = (s.eligible_ticket_types || []).indexOf(t) >= 0;
					return '<label class="evsess-chip"><input type="checkbox" data-field="eligible_ticket_types" value="' + esc(t) + '"' + (on ? " checked" : "") + " /> " + esc(t) + "</label>";
				}).join("") + "</div>"
				: '<p class="evsess-note">Add ticket types in section 3 first, then pick them here.</p>';
		} else if (s.eligibility_mode === "registered") {
			picks = '<p class="evsess-note">After saving, assign attendees from the Attendance tab → session card → Manage attendees.</p>';
		} else {
			picks = '<p class="evsess-note">Every valid ticket holder of this event can enter this session.</p>';
		}
		return '<div class="evsess-field evsess-span"><span class="evsess-label">Who can attend this session?</span>' + radios + picks + errHtml(index, "eligible_ticket_types") + "</div>";
	}

	function errHtml(index, field) {
		var e = state.errors[index] && state.errors[index][field];
		return e ? '<small class="evsess-err">' + esc(e) + "</small>" : "";
	}

	function field(index, s, key, label, type, extra) {
		var value = s[key] == null ? "" : s[key];
		var attrs = extra || "";
		var input = type === "textarea"
			? '<textarea class="setup-textarea" rows="2" data-field="' + key + '"' + attrs + ">" + esc(value) + "</textarea>"
			: '<input class="setup-input" type="' + type + '" data-field="' + key + '" value="' + esc(value) + '"' + attrs + " />";
		return '<label class="evsess-field' + (type === "textarea" ? " evsess-span" : "") + '"><span class="evsess-label">' + label + "</span>" + input + errHtml(index, key) + "</label>";
	}

	function cardHtml(s, index) {
		var single = state.structure === "single";
		var badge = s.session_id ? '<span class="evsess-badge is-saved">Saved</span>' : '<span class="evsess-badge">Not saved</span>';
		var canRemove = !single;
		var statusOpts = STATUSES.map(function (o) { return '<option value="' + o[0] + '"' + (s.status === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
		return '<div class="evsess-card" data-key="' + s._key + '">' +
			'<div class="evsess-card-head"><strong>Session ' + (index + 1) + "</strong>" + badge +
			(canRemove ? '<button type="button" class="evsess-remove" data-action="remove">Remove Session</button>' : "") + "</div>" +
			'<div class="evsess-grid">' +
			field(index, s, "session_name", "Session Name *", "text", ' maxlength="200" placeholder="e.g. Morning Session"') +
			field(index, s, "session_date", "Session Date *", "date") +
			field(index, s, "start_time", "Start Time *", "time") +
			field(index, s, "end_time", "End Time *", "time") +
			'<label class="evsess-field evsess-check"><input type="checkbox" data-field="ends_next_day"' + (s.ends_next_day ? " checked" : "") + " /> Ends after midnight</label>" +
			field(index, s, "venue_name", "Venue Name *", "text", ' maxlength="300" placeholder="e.g. Hall A"') +
			field(index, s, "venue_address", "Venue Address", "text", ' placeholder="Street, area, city"') +
			field(index, s, "capacity", "Session Capacity (optional)", "number", ' min="1" step="1" placeholder="No limit"') +
			'<label class="evsess-field"><span class="evsess-label">Session Status</span><select class="setup-select" data-field="status">' + statusOpts + "</select>" + errHtml(index, "status") + "</label>" +
			field(index, s, "session_description", "Session Description (optional)", "textarea", ' maxlength="4000"') +
			eligibilityHtml(s, index) +
			"</div></div>";
	}

	function renderBuilder() {
		var root = builderRoot();
		if (!root) return;
		var st = state.structure;
		var count = state.sessions.length;
		root.innerHTML =
			'<div class="evsess-structure"><p class="evsess-q">Does this event contain multiple sessions?</p>' +
			'<label class="evsess-radio"><input type="radio" name="evsessStructure" value="single"' + (st === "single" ? " checked" : "") + " /> Single Session</label>" +
			'<label class="evsess-radio"><input type="radio" name="evsessStructure" value="multiple"' + (st === "multiple" ? " checked" : "") + " /> Multiple Sessions</label></div>" +
			(st === "multiple"
				? '<label class="evsess-count"><span class="evsess-label">Number of Sessions</span><input type="number" id="evsessCount" class="setup-input" min="2" max="' + MAX_SESSIONS + '" value="' + count + '" /></label>'
				: "") +
			(st
				? '<div id="evsessList">' + state.sessions.map(cardHtml).join("") + "</div>"
				: '<p class="evsess-note">No session schedule yet. Every ticket is checked in once for the whole event. Choose an option above to set up sessions.</p>') +
			'<div class="evsess-actions">' +
			(st === "multiple" ? '<button type="button" class="evsess-btn" data-action="add">+ Add Session</button>' : "") +
			(st ? '<button type="button" class="evsess-btn is-primary" data-action="save">Save sessions</button>' : "") +
			'<span id="evsessStatus" class="evsess-status"></span></div>';
	}

	function cardIndex(el) {
		var card = el.closest(".evsess-card");
		if (!card) return -1;
		var key = card.getAttribute("data-key");
		for (var i = 0; i < state.sessions.length; i++) if (state.sessions[i]._key === key) return i;
		return -1;
	}

	function defaults() {
		var d = cfg.eventDefaults() || {};
		return { session_date: d.session_date || "", start_time: d.start_time || "", end_time: d.end_time || "", venue_name: d.venue_name || "", venue_address: d.venue_address || "" };
	}

	function markDirty() { state.dirty = true; setStatus("Unsaved session changes", "warn"); }

	function onBuilderInput(ev) {
		var t = ev.target;
		var root = builderRoot();
		if (!t || !t.closest || !root || !root.contains(t)) return;
		if (t.name === "evsessStructure") {
			if (ev.type === "change") setStructure(t.value);
			return;
		}
		if (t.id === "evsessCount") {
			if (ev.type === "change") applyCount(t.value);
			return;
		}
		var idx = cardIndex(t);
		var key = t.getAttribute("data-field");
		if (idx < 0 || !key) return;
		var s = state.sessions[idx];
		if (key === "ends_next_day") s.ends_next_day = t.checked;
		else if (key === "eligible_ticket_types") {
			var list = (s.eligible_ticket_types || []).filter(function (x) { return x !== t.value; });
			if (t.checked) list.push(t.value);
			s.eligible_ticket_types = list;
		} else s[key] = t.value;
		if (state.errors[idx]) delete state.errors[idx][key];
		var holder = t.closest(".evsess-field");
		var shown = holder && holder.querySelector(".evsess-err");
		if (shown) shown.remove();
		markDirty();
		if (key === "eligibility_mode" && ev.type === "change") renderBuilder();
	}

	function setStructure(value) {
		if (value === "single" && state.sessions.length > 1) {
			var saved = state.sessions.filter(function (s, i) { return i > 0 && s.session_id; });
			if (saved.length) {
				alert("Remove the other saved sessions first (use Remove Session), then switch to a single session.");
				renderBuilder();
				return;
			}
			state.sessions = state.sessions.slice(0, 1);
		}
		state.structure = value;
		if (!state.sessions.length) {
			var first = blankSession(Object.assign(defaults(), { session_name: value === "single" ? "Main Session" : "Session 1", eligibility_mode: value === "single" ? "all_attendees" : "registered" }));
			state.sessions.push(first);
		}
		if (value === "multiple" && state.sessions.length < 2) {
			state.sessions = resizeSessions(state.sessions, 2, defaults()).list;
		}
		markDirty();
		renderBuilder();
	}

	function applyCount(raw) {
		var res = resizeSessions(state.sessions, Math.max(2, parseInt(raw, 10) || 2), defaults());
		state.sessions = res.list;
		markDirty();
		renderBuilder();
		if (res.blocked) setStatus("Saved sessions are not removed by changing the number. Use Remove Session on the one you want to delete.", "warn");
	}

	function removeSession(idx) {
		var s = state.sessions[idx];
		if (!s) return;
		if (!s.session_id) {
			state.sessions.splice(idx, 1);
			state.errors = {};
			markDirty();
			renderBuilder();
			return;
		}
		var eventId = cfg.eventId();
		if (!eventId) return;
		if (!confirm("Remove “" + (s.session_name || "this session") + "”? Its attendance history is kept.")) return;
		var path = encodeURIComponent(eventId) + "/sessions/" + encodeURIComponent(s.session_id);
		request(path, { method: "DELETE" }).then(function (r) {
			if (r.status === 409 && r.data && r.data.detail && r.data.detail.requires_confirmation) {
				if (!confirm(r.data.detail.message + "\n\nRemove it anyway?")) return null;
				return request(path + "?confirm=true", { method: "DELETE" });
			}
			return r;
		}).then(function (r) {
			if (!r) return;
			if (!r.ok) return cfg.notify(detailMessage(r.data, "Could not remove this session."));
			state.sessions.splice(idx, 1);
			state.errors = {};
			renderBuilder();
			setStatus("Session removed.", "ok");
			refreshOverview();
		});
	}

	function onBuilderClick(ev) {
		var btn = ev.target && ev.target.closest && ev.target.closest("[data-action]");
		var root = builderRoot();
		if (!btn || !root || !root.contains(btn)) return;
		ev.preventDefault();
		var action = btn.getAttribute("data-action");
		if (action === "add") {
			if (state.sessions.length >= MAX_SESSIONS) return setStatus("An event can have up to " + MAX_SESSIONS + " sessions.", "warn");
			state.sessions = resizeSessions(state.sessions, state.sessions.length + 1, defaults()).list;
			markDirty();
			renderBuilder();
		} else if (action === "remove") {
			removeSession(cardIndex(btn));
		} else if (action === "save") {
			save(true);
		}
	}

	function validateAll() {
		state.errors = {};
		var ok = true;
		state.sessions.forEach(function (s, i) {
			var e = validateSession(s);
			if (Object.keys(e).length) { state.errors[i] = e; ok = false; }
		});
		return ok;
	}

	/** Save when there are unsaved changes. `loud` shows field errors; silent saves skip incomplete forms. */
	function save(loud) {
		var eventId = cfg.eventId();
		if (!state.structure || !state.dirty) return Promise.resolve(true);
		if (!eventId) {
			if (loud) setStatus("Save the event details first, then save sessions.", "warn");
			return Promise.resolve(false);
		}
		if (!validateAll()) {
			if (loud) { renderBuilder(); setStatus("Fix the highlighted session fields.", "error"); }
			else setStatus("Complete the required session fields to save sessions.", "warn");
			return Promise.resolve(false);
		}
		if (state.saving) return state.saving;
		setStatus("Saving sessions…");
		var body = { structure: state.structure, sessions: state.sessions.map(toPayload) };
		state.saving = request(encodeURIComponent(eventId) + "/sessions", { method: "PUT", body: body }).then(function (r) {
			state.saving = null;
			if (!r.ok) {
				var d = r.data && r.data.detail;
				if (d && d.errors && typeof d.index === "number") {
					state.errors[d.index] = d.errors;
					renderBuilder();
				}
				setStatus(detailMessage(r.data, "Could not save sessions."), "error");
				return false;
			}
			var rows = (r.data.sessions || []).filter(function (row) { return !row.deleted; });
			state.sessions = rows.map(fromServer);
			state.dirty = false;
			state.errors = {};
			state.overview = r.data;
			renderBuilder();
			renderOverview();
			setStatus("Sessions saved.", "ok");
			syncPickers();
			return true;
		}).catch(function () {
			state.saving = null;
			setStatus("Could not reach the server to save sessions.", "error");
			return false;
		});
		return state.saving;
	}

	function load(eventId) {
		var id = eventId || cfg.eventId();
		if (!id) { reset(); return Promise.resolve(null); }
		state.loadedFor = String(id);
		return request(encodeURIComponent(id) + "/sessions").then(function (r) {
			if (!r.ok || String(id) !== state.loadedFor) return null;
			if (state.dirty) return r.data;
			var rows = (r.data.sessions || []).filter(function (row) { return !row.deleted; });
			state.sessions = rows.map(fromServer);
			state.structure = rows.length > 1 ? "multiple" : (rows.length === 1 ? "single" : null);
			state.overview = r.data;
			state.errors = {};
			renderBuilder();
			renderOverview();
			syncPickers();
			return r.data;
		}).catch(function () { return null; });
	}

	function reset() {
		state.structure = null;
		state.sessions = [];
		state.dirty = false;
		state.errors = {};
		state.overview = null;
		state.loadedFor = null;
		renderBuilder();
		renderOverview();
		syncPickers();
	}

	// Overview (Attendance tab) ───────────────────────────────────────────────
	var panel = { sessionId: null, rows: [], search: "", filter: "all", manage: false, changes: {} };

	function overviewRoot() { return byId("evsessOverview"); }

	function renderOverview() {
		var root = overviewRoot();
		if (!root) return;
		var ov = state.overview;
		var cards = ov && ov.sessions ? ov.sessions.filter(function (s) { return !s.deleted; }) : [];
		if (!cards.length) { root.innerHTML = ""; root.hidden = true; return; }
		root.hidden = false;
		var head = '<div class="evsess-ov-head"><h3 class="dash-card-title">Sessions</h3><div class="evsess-ov-totals">' +
			"<span><strong>" + (ov.unique_attendees || 0) + "</strong> unique attendees</span>" +
			"<span><strong>" + (ov.total_session_registrations || 0) + "</strong> session registrations</span>" +
			"<span><strong>" + (ov.unique_checked_in || 0) + "</strong> attendees checked in</span>" +
			"<span><strong>" + (ov.total_session_checkins || 0) + "</strong> session check-ins</span></div></div>";
		var grid = '<div class="evsess-ov-grid">' + cards.map(function (s, i) {
			return '<div class="evsess-ov-card' + (panel.sessionId === s.session_id ? " is-open" : "") + '">' +
				'<div class="evsess-ov-title"><span>Session ' + (i + 1) + " — " + esc(s.session_name) + '</span><span class="evsess-pill is-' + esc(s.status) + '">' + esc(s.status) + "</span></div>" +
				'<div class="evsess-ov-meta">' + esc(s.session_date || "") + " · " + esc(s.time_label || "") + "<br/>" + esc(s.venue_name || "") + "</div>" +
				'<div class="evsess-ov-stats">' +
				"<div><b>" + s.eligible_count + "</b><span>Eligible</span></div>" +
				"<div><b>" + s.checked_in_count + "</b><span>Checked in</span></div>" +
				"<div><b>" + s.pending_count + "</b><span>Pending</span></div>" +
				"<div><b>" + s.attendance_percent + "%</b><span>Attendance</span></div></div>" +
				'<div class="evsess-ov-actions"><button type="button" class="evsess-btn" data-ov="list" data-sid="' + esc(s.session_id) + '">Attendees</button>' +
				'<button type="button" class="evsess-btn" data-ov="manage" data-sid="' + esc(s.session_id) + '">Manage attendees</button>' +
				'<button type="button" class="evsess-btn" data-ov="csv" data-sid="' + esc(s.session_id) + '">Export CSV</button></div></div>';
		}).join("") + "</div>";
		root.innerHTML = '<div class="dash-card evsess-ov">' + head + grid + '<div id="evsessPanel"></div></div>';
		renderPanel();
	}

	function renderPanel() {
		var host = byId("evsessPanel");
		if (!host) return;
		if (!panel.sessionId) { host.innerHTML = ""; return; }
		host.innerHTML = '<div class="evsess-panel">' +
			'<div class="evsess-panel-bar"><input type="search" class="setup-input" id="evsessSearch" placeholder="Search name, email, ticket ref, ticket type" value="' + esc(panel.search) + '" />' +
			'<select class="setup-select" id="evsessFilter"><option value="all"' + (panel.filter === "all" ? " selected" : "") + '>All</option><option value="checked_in"' + (panel.filter === "checked_in" ? " selected" : "") + '>Checked in</option><option value="pending"' + (panel.filter === "pending" ? " selected" : "") + ">Pending</option></select>" +
			(panel.manage ? '<button type="button" class="evsess-btn is-primary" id="evsessSaveElig" data-ov="save-elig" disabled>Save eligibility (0)</button>' : "") +
			'<button type="button" class="evsess-btn" data-ov="close">Close</button></div>' +
			'<div class="evsess-table-wrap"><table class="dash-stack-table evsess-table"><thead><tr>' + (panel.manage ? "<th>Eligible</th>" : "") +
			'<th>Attendee</th><th>Ticket</th><th>Status</th><th>Checked in</th></tr></thead><tbody id="evsessPanelBody"></tbody></table></div></div>';
		renderPanelRows();
	}

	function renderPanelRows() {
		var body = byId("evsessPanelBody");
		if (!body) return;
		var needle = panel.search.toLowerCase();
		var rows = panel.rows.filter(function (r) {
			if (!panel.manage && !r.eligible) return false;
			if (panel.filter === "checked_in" && !r.checked_in) return false;
			if (panel.filter === "pending" && (r.checked_in || !r.eligible)) return false;
			if (!needle) return true;
			return (r.attendee_name + " " + r.attendee_email + " " + r.attendee_ref + " " + r.ticket_type).toLowerCase().indexOf(needle) >= 0;
		});
		var changed = Object.keys(panel.changes).length;
		var saveBtn = byId("evsessSaveElig");
		if (saveBtn) {
			saveBtn.disabled = !changed;
			saveBtn.textContent = "Save eligibility (" + changed + ")";
		}
		body.innerHTML =
			(rows.length ? rows.map(function (r) {
				var eligible = Object.prototype.hasOwnProperty.call(panel.changes, r.ticket_id) ? panel.changes[r.ticket_id] : r.eligible;
				return "<tr>" + (panel.manage ? '<td data-label="Eligible"><input type="checkbox" data-tid="' + esc(r.ticket_id) + '"' + (eligible ? " checked" : "") + " /></td>" : "") +
					'<td data-label="Attendee"><strong>' + esc(r.attendee_name) + "</strong><br/><small>" + esc(r.attendee_email) + "</small></td>" +
					'<td data-label="Ticket">' + esc(r.attendee_ref) + "<br/><small>" + esc(r.ticket_type) + "</small></td>" +
					'<td data-label="Status">' + (r.checked_in ? '<span class="evsess-pill is-active">Checked in</span>' : (r.eligible ? '<span class="evsess-pill">Pending</span>' : '<span class="evsess-pill is-cancelled">Not eligible</span>')) + "</td>" +
					'<td data-label="Checked in">' + (r.checked_in_at ? esc(new Date(r.checked_in_at + (/[zZ]|[+-]\d\d:\d\d$/.test(r.checked_in_at) ? "" : "Z")).toLocaleString()) + "<br/><small>" + esc(r.checked_in_by || "") + "</small>" : "—") + "</td></tr>";
			}).join("") : '<tr><td colspan="5" class="evsess-empty">No attendees match.</td></tr>');
	}

	function openPanel(sessionId, manage) {
		var eventId = cfg.eventId();
		if (!eventId) return;
		panel.sessionId = sessionId;
		panel.manage = !!manage;
		panel.changes = {};
		var path = encodeURIComponent(eventId) + "/sessions/" + encodeURIComponent(sessionId) + (manage ? "/registrations?include_ineligible=true" : "/attendance");
		request(path).then(function (r) {
			if (!r.ok) return cfg.notify(detailMessage(r.data, "Could not load attendees."));
			panel.rows = r.data.attendees || [];
			renderOverview();
		});
	}

	function exportCsv(sessionId) {
		var eventId = cfg.eventId();
		if (!eventId) return;
		var url = api(encodeURIComponent(eventId) + "/sessions/" + encodeURIComponent(sessionId) + "/attendance?format=csv");
		fetch(url, { credentials: "include", headers: cfg.authHeaders() || {} }).then(function (res) {
			if (!res.ok) throw new Error("export failed");
			var name = ((res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "session-attendance.csv";
			return res.blob().then(function (blob) {
				var a = document.createElement("a");
				a.href = URL.createObjectURL(blob);
				a.download = name;
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
			});
		}).catch(function () { cfg.notify("Could not export attendance."); });
	}

	function saveEligibility() {
		var eventId = cfg.eventId();
		var add = [], remove = [];
		Object.keys(panel.changes).forEach(function (tid) { (panel.changes[tid] ? add : remove).push(tid); });
		var path = encodeURIComponent(eventId) + "/sessions/" + encodeURIComponent(panel.sessionId) + "/registrations";
		var steps = [];
		if (add.length) steps.push(function () { return request(path, { method: "POST", body: { ticket_ids: add, action: "register" } }); });
		if (remove.length) steps.push(function () { return request(path, { method: "POST", body: { ticket_ids: remove, action: "revoke" } }); });
		steps.reduce(function (p, step) {
			return p.then(function (prev) {
				if (prev && !prev.ok) return prev;
				return step();
			});
		}, Promise.resolve(null)).then(function (r) {
			if (r && !r.ok) return cfg.notify(detailMessage(r.data, "Could not save eligibility."));
			cfg.notify("Session eligibility saved.");
			refreshOverview().then(function () { openPanel(panel.sessionId, true); });
		});
	}

	function onOverviewEvent(ev) {
		var root = overviewRoot();
		if (!root || !root.contains(ev.target)) return;
		var t = ev.target;
		if (ev.type === "input" && t.id === "evsessSearch") { panel.search = t.value; renderPanelRows(); return; }
		if (ev.type === "change" && t.id === "evsessFilter") { panel.filter = t.value; renderPanelRows(); return; }
		if (ev.type === "change" && t.getAttribute("data-tid")) {
			var tid = t.getAttribute("data-tid");
			var row = panel.rows.filter(function (r) { return r.ticket_id === tid; })[0];
			if (row && row.eligible === t.checked) delete panel.changes[tid];
			else panel.changes[tid] = t.checked;
			renderPanelRows();
			return;
		}
		if (ev.type !== "click") return;
		var btn = t.closest && t.closest("[data-ov]");
		if (!btn) return;
		var act = btn.getAttribute("data-ov");
		var sid = btn.getAttribute("data-sid");
		if (act === "list") openPanel(sid, false);
		else if (act === "manage") openPanel(sid, true);
		else if (act === "csv") exportCsv(sid);
		else if (act === "close") { panel.sessionId = null; renderOverview(); }
		else if (act === "save-elig") saveEligibility();
	}

	function refreshOverview() {
		var eventId = cfg.eventId();
		if (!eventId) { state.overview = null; renderOverview(); syncPickers(); return Promise.resolve(null); }
		return request(encodeURIComponent(eventId) + "/sessions").then(function (r) {
			if (!r.ok) return null;
			state.overview = r.data;
			if (!panel.sessionId) renderOverview();
			syncPickers();
			return r.data;
		}).catch(function () { return null; });
	}

	// Scanner session picker + volunteer invite scope ─────────────────────────
	var SCAN_KEY = "jod_scan_session_";
	function activeCards() {
		var ov = state.overview;
		return ov && ov.sessions ? ov.sessions.filter(function (s) { return !s.deleted && s.status !== "cancelled"; }) : [];
	}
	function scanSessionId() {
		var el = byId("evsessScanSelect");
		return el && el.value ? el.value : null;
	}
	function syncPickers() {
		var cards = activeCards();
		var eventId = cfg.eventId();
		var wrap = byId("evsessScanWrap");
		var sel = byId("evsessScanSelect");
		if (wrap && sel) {
			wrap.hidden = cards.length === 0;
			var stored = "";
			try { stored = sessionStorage.getItem(SCAN_KEY + eventId) || ""; } catch (_) {}
			var current = sel.value || stored;
			sel.innerHTML = (cards.length > 1 ? '<option value="">Select a session…</option>' : "") + cards.map(function (s) {
				return '<option value="' + esc(s.session_id) + '">' + esc(s.session_name) + " · " + esc(s.time_label || "") + "</option>";
			}).join("");
			if (current && cards.some(function (s) { return s.session_id === current; })) sel.value = current;
			paintScanInfo();
		}
		var picks = byId("volunteerSessionPicks");
		if (picks) {
			var field = byId("volunteerSessionField");
			if (field) field.hidden = cards.length < 2;
			var checked = {};
			picks.querySelectorAll("input[type=checkbox]:checked").forEach(function (c) { checked[c.value] = true; });
			picks.innerHTML = cards.map(function (s) {
				return '<label class="evsess-chip"><input type="checkbox" value="' + esc(s.session_id) + '"' + (checked[s.session_id] ? " checked" : "") + " /> " + esc(s.session_name) + "</label>";
			}).join("");
		}
	}
	function paintScanInfo() {
		var info = byId("evsessScanInfo");
		if (!info) return;
		var id = scanSessionId();
		var s = activeCards().filter(function (c) { return c.session_id === id; })[0];
		info.innerHTML = s
			? "<strong>" + esc(s.session_name) + "</strong> · " + esc(s.session_date || "") + " · " + esc(s.time_label || "") + " · " + esc(s.venue_name || "") +
			  "<br/>Eligible " + s.eligible_count + " · Checked in " + s.checked_in_count + (s.checkin_window && s.checkin_window !== "open" ? ' · <span class="evsess-warn">' + esc(String(s.checkin_window).replace("_", " ")) + "</span>" : "")
			: (activeCards().length > 1 ? "Pick the session you are checking attendees in to." : "");
	}
	function volunteerSessionIds() {
		var picks = byId("volunteerSessionPicks");
		if (!picks) return [];
		var out = [];
		picks.querySelectorAll("input[type=checkbox]:checked").forEach(function (c) { out.push(c.value); });
		return out;
	}

	function configure(options) {
		Object.keys(options || {}).forEach(function (k) { if (typeof options[k] === "function") cfg[k] = options[k]; });
	}

	function init() {
		document.addEventListener("input", onBuilderInput, true);
		document.addEventListener("change", onBuilderInput, true);
		document.addEventListener("click", onBuilderClick, true);
		["input", "change", "click"].forEach(function (type) { document.addEventListener(type, onOverviewEvent); });
		document.addEventListener("change", function (ev) {
			if (ev.target && ev.target.id === "evsessScanSelect") {
				try { sessionStorage.setItem(SCAN_KEY + cfg.eventId(), ev.target.value || ""); } catch (_) {}
				paintScanInfo();
			}
		});
		renderBuilder();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();

	global.JodEventSessions = Object.assign({
		configure: configure,
		load: load,
		reset: reset,
		save: save,
		saveIfDirty: function () { return save(false); },
		refreshOverview: refreshOverview,
		scanSessionId: scanSessionId,
		volunteerSessionIds: volunteerSessionIds,
		hasSessions: function () { return activeCards().length > 0; }
	}, helpers);
})(typeof window !== "undefined" ? window : globalThis);
