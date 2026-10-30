/* "Host Your Event" asks first: event host or movie / theatre partner.
 * Event host keeps the existing account-setup flow; theatre partners go to
 * theatre-setup. Runs in the window capture phase so it decides before the
 * header's own host-link handlers.
 * Once JOD Events approves an account it skips the question: approved for one
 * kind goes straight to that dashboard; approved for both picks a dashboard. */
(function (global) {
	"use strict";

	var HOST_LINKS = "a[href*='host-your-event'], a[href*='account-setup'], [data-host-flow]";
	var root = null;
	var lastFocus = null;
	var mode = "register";
	var checking = false;
	var STATUS_TIMEOUT_MS = 5000;
	var TEXT = {
		register: {
			title: "What would you like to host?",
			sub: "Choose one to start registration. Both follow the same three steps: your details, documents, and the agreement.",
			event: "Register as event host &rarr;",
			theatre: "Register your theatre &rarr;",
			eventDesc: "Concerts, workshops, conferences, sports and celebrations.",
			theatreDesc: "Register your cinema to list movie shows on JOD Events."
		},
		dashboards: {
			title: "Open your dashboard",
			sub: "You're approved as an event host and as a theatre partner. Pick the dashboard you want to manage.",
			event: "Open event dashboard &rarr;",
			theatre: "Open theatre dashboard &rarr;",
			eventDesc: "Manage your events, tickets, attendees and payouts.",
			theatreDesc: "Manage your screens, movies, shows and seat bookings."
		}
	};

	var STYLE = "" +
		".jod-hostpick{position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:1rem}" +
		".jod-hostpick[hidden]{display:none}" +
		".jod-hostpick-backdrop{position:absolute;inset:0;background:rgba(20,14,8,.55);backdrop-filter:blur(2px)}" +
		".jod-hostpick-box{position:relative;width:min(100%,44rem);background:#fffaf4;color:#25211c;border-radius:1.25rem;padding:1.6rem;box-shadow:0 30px 70px rgba(0,0,0,.3);animation:jodHostPickIn .2s ease}" +
		"@keyframes jodHostPickIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}" +
		".jod-hostpick-close{position:absolute;top:.9rem;right:.9rem;width:2.2rem;height:2.2rem;border:0;border-radius:.7rem;background:rgba(37,33,28,.07);color:inherit;font-size:1.4rem;line-height:1;cursor:pointer}" +
		".jod-hostpick-kicker{margin:0;font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#c2560a}" +
		".jod-hostpick-title{margin:.25rem 2.5rem .35rem 0;font-size:1.45rem;font-weight:800;line-height:1.25}" +
		".jod-hostpick-sub{margin:0 0 1.2rem;font-size:.92rem;color:rgba(37,33,28,.65)}" +
		".jod-hostpick-grid{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}" +
		".jod-hostpick-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:.55rem;padding:1.2rem;border:2px solid rgba(37,33,28,.1);border-radius:1rem;background:#fff;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .15s}" +
		".jod-hostpick-card:hover,.jod-hostpick-card:focus-visible{border-color:#ff7508;transform:translateY(-2px);box-shadow:0 10px 24px rgba(255,117,8,.16);outline:none}" +
		".jod-hostpick-ico{display:inline-flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:.9rem;background:linear-gradient(135deg,#ff7508,#f5b400);color:#fff}" +
		".jod-hostpick-ico svg{width:1.6rem;height:1.6rem}" +
		".jod-hostpick-card strong{font-size:1.05rem}" +
		".jod-hostpick-card span.d{font-size:.86rem;line-height:1.45;color:rgba(37,33,28,.65)}" +
		".jod-hostpick-card ul{margin:.1rem 0 0;padding-left:1.05rem;font-size:.8rem;color:rgba(37,33,28,.7);line-height:1.5}" +
		".jod-hostpick-go{margin-top:auto;font-size:.84rem;font-weight:800;color:#c2560a}" +
		".jod-hostpick-new{position:absolute;top:.9rem;right:.9rem;padding:.15rem .55rem;border-radius:999px;background:#25211c;color:#fff;font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}" +
		"@media (max-width:600px){.jod-hostpick{align-items:flex-end;padding:0}.jod-hostpick-box{border-radius:1.25rem 1.25rem 0 0;padding:1.3rem 1rem 1.5rem;max-height:92vh;overflow-y:auto}.jod-hostpick-grid{grid-template-columns:1fr}.jod-hostpick-title{font-size:1.2rem}}" +
		"html[data-theme=dark] .jod-hostpick-box{background:#15120f;color:#f6f0e8}" +
		"html[data-theme=dark] .jod-hostpick-card{background:#1f1a15;border-color:rgba(255,255,255,.1)}" +
		"html[data-theme=dark] .jod-hostpick-sub,html[data-theme=dark] .jod-hostpick-card span.d,html[data-theme=dark] .jod-hostpick-card ul{color:rgba(246,240,232,.66)}" +
		"html[data-theme=dark] .jod-hostpick-close{background:rgba(255,255,255,.08)}" +
		"html[data-theme=dark] .jod-hostpick-new{background:#f6f0e8;color:#15120f}" +
		"html.jod-hostpick-open{overflow:hidden}" +
		"html.jod-hostpick-busy,html.jod-hostpick-busy *{cursor:progress!important}" +
		".jod-hostpick[data-mode=dashboards] .jod-hostpick-new,.jod-hostpick[data-mode=dashboards] .jod-hostpick-card ul{display:none}";

	function auth() { return global.JodAuth || null; }
	function loggedIn() {
		var a = auth();
		return Boolean(a && typeof a.isLoggedIn === "function" && a.isLoggedIn());
	}

	function build() {
		if (root) return root;
		var style = document.createElement("style");
		style.id = "jodHostPickStyle";
		style.textContent = STYLE;
		document.head.appendChild(style);
		root = document.createElement("div");
		root.className = "jod-hostpick";
		root.hidden = true;
		root.innerHTML =
			'<div class="jod-hostpick-backdrop" data-hostpick-close></div>' +
			'<div class="jod-hostpick-box" role="dialog" aria-modal="true" aria-labelledby="jodHostPickTitle">' +
			'<button type="button" class="jod-hostpick-close" data-hostpick-close aria-label="Close">&times;</button>' +
			'<p class="jod-hostpick-kicker">List with JOD Events</p>' +
			'<h2 class="jod-hostpick-title" id="jodHostPickTitle">What would you like to host?</h2>' +
			'<p class="jod-hostpick-sub" id="jodHostPickSub">Choose one to start registration. Both follow the same three steps: your details, documents, and the agreement.</p>' +
			'<div class="jod-hostpick-grid">' +
			'<button type="button" class="jod-hostpick-card" data-hostpick="event">' +
			'<span class="jod-hostpick-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg></span>' +
			"<strong>Event host</strong>" +
			'<span class="d" data-hostpick-desc="event">Concerts, workshops, conferences, sports and celebrations.</span>' +
			"<ul><li>Sell tickets and passes</li><li>Registration forms and check-in</li></ul>" +
			'<span class="jod-hostpick-go" data-hostpick-go="event">Register as event host &rarr;</span></button>' +
			'<button type="button" class="jod-hostpick-card" data-hostpick="theatre">' +
			'<span class="jod-hostpick-new">New</span>' +
			'<span class="jod-hostpick-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 9h20M7 5l2 4M12 5l2 4M17 5l2 4"/></svg></span>' +
			"<strong>Movie / theatre partner</strong>" +
			'<span class="d" data-hostpick-desc="theatre">Register your cinema to list movie shows on JOD Events.</span>' +
			"<ul><li>Add your screens and seats</li><li>Cinema licence verified by our team</li></ul>" +
			'<span class="jod-hostpick-go" data-hostpick-go="theatre">Register your theatre &rarr;</span></button>' +
			"</div></div>";
		document.body.appendChild(root);
		root.addEventListener("click", function (e) {
			if (e.target.closest("[data-hostpick-close]")) return close();
			var pick = e.target.closest("[data-hostpick]");
			if (pick) choose(pick.getAttribute("data-hostpick"));
		});
		root.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
		return root;
	}

	function open(nextMode) {
		build();
		mode = nextMode === "dashboards" ? "dashboards" : "register";
		var t = TEXT[mode];
		root.setAttribute("data-mode", mode);
		root.querySelector("#jodHostPickTitle").textContent = t.title;
		root.querySelector("#jodHostPickSub").textContent = t.sub;
		root.querySelector('[data-hostpick-go="event"]').innerHTML = t.event;
		root.querySelector('[data-hostpick-go="theatre"]').innerHTML = t.theatre;
		root.querySelector('[data-hostpick-desc="event"]').textContent = t.eventDesc;
		root.querySelector('[data-hostpick-desc="theatre"]').textContent = t.theatreDesc;
		lastFocus = document.activeElement;
		root.hidden = false;
		document.documentElement.classList.add("jod-hostpick-open");
		var first = root.querySelector("[data-hostpick]");
		if (first) first.focus();
	}

	function close() {
		if (!root) return;
		root.hidden = true;
		document.documentElement.classList.remove("jod-hostpick-open");
		if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
	}

	function choose(kind) {
		close();
		var a = auth();
		if (kind === "theatre" && mode === "dashboards") {
			global.location.href = "theatre-dashboard.html";
			return;
		}
		if (kind === "theatre") {
			if (loggedIn()) {
				global.location.href = "theatre-setup.html";
			} else if (a && typeof a.openGuestAuthModal === "function") {
				a.openGuestAuthModal({
					title: "Sign up to register your theatre",
					message: "Create your account or log in to register your cinema and list movie shows with JOD Events.",
					targetUrl: "theatre-setup.html",
					badge: "\uD83C\uDFAC Theatre partner"
				});
			} else {
				global.location.href = "login.html?redirect=" + encodeURIComponent("theatre-setup.html");
			}
			return;
		}
		if (a && typeof a.navigateToHostFlow === "function") {
			a.navigateToHostFlow();
		} else {
			global.location.href = "account-setup.html";
		}
	}

	/* ── Approval checks (a failed or slow check counts as "not approved") ── */
	function withTimeout(promise) {
		return Promise.race([
			Promise.resolve(promise).catch(function () { return false; }),
			new Promise(function (resolve) { setTimeout(function () { resolve(false); }, STATUS_TIMEOUT_MS); })
		]);
	}

	function eventHostApproved() {
		var a = auth();
		if (!a || typeof a.fetchOrganizerAccount !== "function" || typeof a.canAccessHostDashboard !== "function") return Promise.resolve(false);
		return a.fetchOrganizerAccount({ withMeta: true }).then(function (data) {
			return Boolean(data && data.account && a.canAccessHostDashboard(data));
		});
	}

	function theatreApproved() {
		var a = auth();
		if (!a || typeof a.fetchAuth !== "function") return Promise.resolve(false);
		var base = String(a.API_BASE || "").replace(/\/$/, "");
		return a.fetchAuth(base + "/api/theatres/registration", { headers: { Accept: "application/json" }, cache: "no-store", allowGuest: true })
			.then(function (res) { return res.ok ? res.json() : null; })
			.then(function (data) { return String((data && data.verification_status) || "").toUpperCase() === "VERIFIED"; });
	}

	function start() {
		if (!loggedIn()) return open("register");
		if (checking) return;
		checking = true;
		document.documentElement.classList.add("jod-hostpick-busy");
		Promise.all([withTimeout(eventHostApproved()), withTimeout(theatreApproved())]).then(function (result) {
			var event = result[0];
			var theatre = result[1];
			if (event && theatre) {
				open("dashboards");
			} else if (theatre) {
				global.location.href = "theatre-dashboard.html";
			} else if (event) {
				mode = "register";
				choose("event");
			} else {
				open("register");
			}
		}).finally(function () {
			checking = false;
			document.documentElement.classList.remove("jod-hostpick-busy");
		});
	}

	global.addEventListener("click", function (e) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		var link = e.target && e.target.closest ? e.target.closest(HOST_LINKS) : null;
		if (!link || link.closest(".jod-hostpick") || link.hasAttribute("data-host-direct")) return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		start();
	}, true);

	global.JodHostTypeChooser = { open: open, close: close, choose: choose, start: start };
})(window);
