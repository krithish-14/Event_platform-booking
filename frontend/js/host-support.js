/* Host Help & Support tab: request categories, request history, and the
 * event cancellation approval gate (admin must approve before a host cancels). */
(function (global) {
	"use strict";

	var CATEGORIES = [
		{ id: "event_cancellation", label: "Event cancellation", needsEvent: true,
			hint: "An admin reviews every cancellation. Once it is approved you can cancel the event here with an email OTP." },
		{ id: "event_changes", label: "Event changes after publishing", needsEvent: true,
			hint: "Date, venue or ticket changes that you cannot make from Manage." },
		{ id: "payouts", label: "Payouts & settlements", needsEvent: false,
			hint: "Payout timing, bank details or settlement amounts." },
		{ id: "tickets", label: "Tickets & bookings", needsEvent: true,
			hint: "Problems with ticket sales, bookings or e-tickets." },
		{ id: "checkin", label: "Check-in & event day", needsEvent: true,
			hint: "Scanner, volunteer or entry issues." },
		{ id: "account", label: "Account & verification", needsEvent: false,
			hint: "Host profile, KYC or agreement questions." },
		{ id: "other", label: "Something else", needsEvent: false, hint: "" }
	];
	var DEFAULT_SUBJECT = { event_cancellation: "Request to cancel my event" };

	var cfg = {
		apiOrigin: function () { return ""; },
		authHeaders: function () { return {}; },
		eventId: function () { return null; },
		eventTitle: function () { return ""; },
		needsApproval: function () { return true; },
		notify: function (msg) { alert(msg); },
		runCancel: function () {}
	};
	var state = { category: "event_cancellation", cancel: { state: "none" }, rows: [], busy: false };

	function byId(id) { return document.getElementById(id); }
	function esc(v) {
		return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}
	function api(path) { return cfg.apiOrigin().replace(/\/$/, "") + "/api/support" + path; }
	function headers(json) {
		var h = Object.assign({}, cfg.authHeaders() || {});
		if (json) h["Content-Type"] = "application/json";
		return h;
	}
	function errorText(data, fallback) {
		var d = data && data.detail;
		if (typeof d === "string" && d.trim()) return d;
		if (Array.isArray(d) && d.length) return d.map(function (x) { return (x && x.msg) || String(x); }).join(" ");
		return fallback;
	}
	function categoryById(id) {
		for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
		return CATEGORIES[CATEGORIES.length - 1];
	}
	function when(iso) {
		if (!iso) return "";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
	}

	function renderCategories() {
		var host = byId("hostSupportCategory");
		if (!host) return;
		host.innerHTML = CATEGORIES.map(function (c) {
			var on = c.id === state.category;
			return '<button type="button" role="radio" class="host-support-cat' + (on ? " is-on" : "") + '" aria-checked="' + on + '" data-cat="' + c.id + '">' + esc(c.label) + "</button>";
		}).join("");
		var cat = categoryById(state.category);
		var hint = byId("hostSupportCategoryHint");
		if (hint) { hint.textContent = cat.hint; hint.hidden = !cat.hint; }
		var wrap = byId("hostSupportEventWrap");
		var name = byId("hostSupportEventName");
		var eventId = cfg.eventId();
		if (wrap) wrap.hidden = !cat.needsEvent;
		if (name) name.textContent = eventId ? (cfg.eventTitle() || "Your current event") : "No active event. Create or open an event first.";
		var subject = byId("hostSupportSubject");
		if (subject && !subject.value.trim() && DEFAULT_SUBJECT[state.category]) subject.value = DEFAULT_SUBJECT[state.category];
	}

	function setError(text) {
		var el = byId("hostSupportError");
		if (!el) return;
		el.textContent = text || "";
		el.hidden = !text;
	}

	function statusChip(row) {
		if (row.category === "event_cancellation") {
			var d = String(row.decision || "pending").toLowerCase();
			var map = { pending: ["Waiting for admin approval", "is-pending"], approved: ["Approved", "is-approved"], rejected: ["Not approved", "is-rejected"] };
			var m = map[d] || map.pending;
			return '<span class="host-support-chip ' + m[1] + '">' + m[0] + "</span>";
		}
		var solved = String(row.status || "").toLowerCase() === "resolved";
		return '<span class="host-support-chip ' + (solved ? "is-approved" : "is-open") + '">' + (solved ? "Solved" : "Open") + "</span>";
	}

	function renderList() {
		var list = byId("hostSupportList");
		var empty = byId("hostSupportEmpty");
		if (!list) return;
		if (!state.rows.length) {
			list.innerHTML = "";
			if (empty) empty.hidden = false;
			return;
		}
		if (empty) empty.hidden = true;
		list.innerHTML = state.rows.map(function (row) {
			return '<article class="host-support-row" role="listitem">' +
				'<div class="host-support-row-top"><strong>' + esc(row.ticket_code) + "</strong>" + statusChip(row) + "</div>" +
				'<div class="host-support-row-cat">' + esc(categoryById(row.category).label) + (row.event_title ? " &middot; " + esc(row.event_title) : "") + "</div>" +
				'<div class="host-support-row-subject">' + esc(row.subject) + "</div>" +
				(row.resolution_note ? '<div class="host-support-row-note"><span>Team note:</span> ' + esc(row.resolution_note) + "</div>" : "") +
				'<div class="host-support-row-when">' + esc(when(row.created_at)) + "</div>" +
				"</article>";
		}).join("");
	}

	function renderCancelState() {
		var box = byId("hostSupportCancelState");
		var s = state.cancel || { state: "none" };
		var dot = byId("topSupportDot");
		if (dot) dot.hidden = s.state !== "approved";
		var settingsBtn = byId("btnClearEventData");
		if (settingsBtn) {
			settingsBtn.textContent = s.state === "approved"
				? "Finish cancellation in Help & Support"
				: (s.state === "pending" ? "View cancellation request" : "Request cancellation");
		}
		if (!box) return;
		if (!cfg.eventId() || s.state === "none") {
			box.hidden = true;
			box.innerHTML = "";
			return;
		}
		var code = esc(s.ticket_code || "");
		var html = "";
		if (s.state === "pending") {
			box.className = "host-support-state is-pending";
			html = "<strong>Cancellation request " + code + " is waiting for admin approval.</strong><span>You will get an email when the team decides. The event stays live until then.</span>";
		} else if (s.state === "approved") {
			box.className = "host-support-state is-approved";
			html = "<strong>Cancellation approved (" + code + ").</strong><span>You can now cancel the event. We will send an OTP to your email to confirm.</span>" +
				'<button type="button" class="host-support-cancel-btn" id="hostSupportCancelNow">Cancel event now</button>';
		} else if (s.state === "rejected") {
			box.className = "host-support-state is-rejected";
			html = "<strong>Cancellation request " + code + " was not approved.</strong>" +
				(s.note ? "<span>Team note: " + esc(s.note) + "</span>" : "") +
				"<span>You can raise a new request if something has changed.</span>";
		}
		box.innerHTML = html;
		box.hidden = !html;
		var now = byId("hostSupportCancelNow");
		if (now) now.addEventListener("click", function () { cfg.runCancel(); });
	}

	function refreshCancelState() {
		var eventId = cfg.eventId();
		if (!eventId) {
			state.cancel = { state: "none" };
			renderCancelState();
			return Promise.resolve(state.cancel);
		}
		return fetch(api("/host/cancellation-status?event_id=" + encodeURIComponent(eventId)), { headers: headers(false) })
			.then(function (res) { return res.ok ? res.json() : { state: "none" }; })
			.catch(function () { return { state: "none" }; })
			.then(function (data) {
				state.cancel = data || { state: "none" };
				renderCancelState();
				return state.cancel;
			});
	}

	function loadRequests() {
		return fetch(api("/host/requests"), { headers: headers(false) })
			.then(function (res) { return res.ok ? res.json() : []; })
			.catch(function () { return []; })
			.then(function (rows) {
				state.rows = Array.isArray(rows) ? rows : [];
				renderList();
			});
	}

	function load() {
		renderCategories();
		return Promise.all([loadRequests(), refreshCancelState()]);
	}

	function submit(ev) {
		if (ev) ev.preventDefault();
		if (state.busy) return;
		var cat = categoryById(state.category);
		var subject = (byId("hostSupportSubject") || {}).value || "";
		var message = (byId("hostSupportMessage") || {}).value || "";
		var eventId = cfg.eventId();
		subject = subject.trim();
		message = message.trim();
		if (cat.id === "event_cancellation" && !eventId) return setError("Open the event you want to cancel first.");
		if (subject.length < 6) return setError("Add a subject of at least 6 characters.");
		if (message.length < 20) return setError("Add a few more details (at least 20 characters).");
		setError("");
		var btn = byId("hostSupportSubmit");
		state.busy = true;
		if (btn) { btn.disabled = true; btn.innerHTML = "<span>Sending\u2026</span>"; }
		var body = { category: cat.id, subject: subject, message: message };
		if (cat.needsEvent && eventId) body.event_id = String(eventId);
		fetch(api("/host/requests"), { method: "POST", headers: headers(true), body: JSON.stringify(body) })
			.then(function (res) {
				return res.json().catch(function () { return {}; }).then(function (data) {
					if (!res.ok) throw new Error(errorText(data, "Could not send your request."));
					return data;
				});
			})
			.then(function (row) {
				var msg = byId("hostSupportMessage");
				var subj = byId("hostSupportSubject");
				if (msg) msg.value = "";
				if (subj) subj.value = "";
				cfg.notify(row.category === "event_cancellation"
					? "Cancellation request " + row.ticket_code + " sent. An admin will review it."
					: "Request " + row.ticket_code + " sent. The team will reply by email.");
				renderCategories();
				return load();
			})
			.catch(function (err) { setError((err && err.message) || "Could not send your request."); })
			.then(function () {
				state.busy = false;
				if (btn) { btn.disabled = false; btn.innerHTML = "<span>Send request</span>"; }
			});
	}

	function openCategory(id) {
		state.category = categoryById(id).id;
		var subject = byId("hostSupportSubject");
		if (subject) subject.value = DEFAULT_SUBJECT[state.category] || "";
		renderCategories();
	}

	function bind() {
		var cats = byId("hostSupportCategory");
		if (cats) cats.addEventListener("click", function (e) {
			var b = e.target.closest("[data-cat]");
			if (!b) return;
			var subject = byId("hostSupportSubject");
			if (subject && subject.value === (DEFAULT_SUBJECT[state.category] || "")) subject.value = "";
			state.category = b.getAttribute("data-cat");
			renderCategories();
		});
		var form = byId("hostSupportForm");
		if (form) form.addEventListener("submit", submit);
		var refresh = byId("hostSupportRefresh");
		if (refresh) refresh.addEventListener("click", function () { load(); });
	}

	function configure(opts) {
		Object.keys(opts || {}).forEach(function (k) { if (typeof opts[k] === "function") cfg[k] = opts[k]; });
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
	else bind();

	global.JodHostSupport = {
		configure: configure,
		load: load,
		refreshCancelState: refreshCancelState,
		openCategory: openCategory,
		cancelState: function () { return state.cancel; },
		CATEGORIES: CATEGORIES
	};
})(window);
