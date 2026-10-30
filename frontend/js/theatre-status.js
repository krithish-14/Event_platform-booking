(async function () {
	"use strict";
	const $ = (id) => document.getElementById(id);
	if (!(window.JodAuth && window.JodAuth.isLoggedIn && window.JodAuth.isLoggedIn())) {
		window.location.replace("login.html?redirect=" + encodeURIComponent("theatre-status.html"));
		return;
	}
	if (window.JodUrls && typeof window.JodUrls.prettyHref === "function") {
		$("tsHome").setAttribute("href", window.JodUrls.prettyHref("index.html") || "/");
		$("tsHelp").setAttribute("href", window.JodUrls.prettyHref("help.html") || "/help");
	}
	const origin = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl())
		|| (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || "")).replace(/\/$/, "");
	const authFetch = typeof window.JodAuth.fetchAuth === "function" ? window.JodAuth.fetchAuth : window.fetch.bind(window);
	const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

	function paint(title, pill, pillClass, lead, detail) {
		$("tsTitle").textContent = title;
		$("tsPill").textContent = pill;
		$("tsPill").className = "pill" + (pillClass ? " " + pillClass : "");
		$("tsLead").textContent = lead || "";
		$("tsLead").hidden = !lead;
		$("tsDetail").textContent = detail || "";
		$("tsDetail").hidden = !detail;
	}

	function facts(p) {
		if (!p) return;
		const screens = Array.isArray(p.screens) ? p.screens : [];
		const rows = [
			["Theatre", p.theatre_name],
			["Location", [p.district, p.state].filter(Boolean).join(", ")],
			["Screens", `${screens.length} \u00b7 ${Number(p.total_seats || 0).toLocaleString("en-IN")} seats`],
			["Partner ID", p.partner_code]
		].filter((r) => r[1]);
		$("tsFacts").innerHTML = rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join("");
		$("tsFacts").hidden = !rows.length;
	}

	async function load() {
		let data = null;
		try {
			const res = await authFetch(origin + "/api/theatres/registration");
			if (res.ok) data = await res.json();
		} catch (_) {}
		if (!data) {
			paint("We couldn't load your status", "Offline", "is-bad", "", "Check your connection and refresh this page.");
			return;
		}
		const status = String(data.verification_status || "").toUpperCase();
		if (status === "NOT_SUBMITTED") {
			window.location.replace("theatre-setup.html");
			return;
		}
		if (status === "VERIFIED") {
			window.location.replace("theatre-dashboard.html");
			return;
		}
		facts(data.partner);
		$("tsReason").hidden = true;
		$("tsEdit").hidden = true;
		$("tsHelp").hidden = true;
		$("tsDashboard").hidden = true;
		if (status === "VERIFIED") {
			paint("Your theatre is approved", "Approved", "is-ok",
				"Welcome aboard! Your theatre is now a verified JOD Events partner.",
				"Open your theatre dashboard to set each screen's seat layout, add movies and schedule shows. Customers can then book seats live.");
			$("tsDashboard").hidden = false;
		} else if (status === "REJECTED") {
			paint("Changes needed", "Sent back", "is-bad", "Our team reviewed your registration and needs a few changes.", "");
			$("tsReason").textContent = "Reason: " + (data.review_reason || "No reason provided.");
			$("tsReason").hidden = false;
			$("tsEdit").hidden = false;
		} else if (status === "RESTRICTED") {
			paint("Theatre access restricted", "Restricted", "is-bad", "", "Raise a support ticket so our team can review your theatre.");
			$("tsReason").textContent = "Reason: " + (data.review_reason || "No reason provided.");
			$("tsReason").hidden = false;
			$("tsHelp").hidden = false;
		} else {
			paint("Thank you", "Under review", "",
				"Your theatre registration has been submitted.",
				"Our team verifies your cinema licence and KYC documents, usually within 3 working days. We'll email you when it's approved.");
		}
	}

	await load();
	setInterval(load, 60000);
})();
