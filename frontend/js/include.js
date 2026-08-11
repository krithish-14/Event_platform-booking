(() => {
	"use strict";

	const pageName = window.location.pathname.split("/").pop() || "index.html";
	const isHome = pageName === "index.html" || pageName === "";
	const isAboutPage = pageName === "about.html";
	const isLoginPage = pageName === "login.html";
	const isSignupPage = pageName === "signup.html";
	const isPolicyPage = ["privacy-policy.html", "terms-and-conditions.html", "return-and-refund-policy.html"].includes(pageName);

	if (isHome) {
		document.body.classList.add("home-page");
	} else {
		document.body.classList.add("sub-page");
	}

	function loadComponent(id, path) {
		return fetch(path).then((response) => {
			if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
			return response.text();
		}).then((html) => {
			const target = document.getElementById(id);
			if (!target) throw new Error(`Missing component target: #${id}`);
			target.outerHTML = html;
			if (id === "header" && typeof window.updateNavAuth === "function") {
				try { window.updateNavAuth(); } catch (_) {}
			}
		});
	}

	function updateNavigation() {
		const header = document.querySelector("[data-header]");
		const footer = document.querySelector(".site-footer");
		const homeLink = isHome ? "#top" : "index.html#top";

		if (header) {
			header.querySelectorAll(".brand").forEach((brand) => brand.setAttribute("href", homeLink));
			header.querySelectorAll("a[href^='#']").forEach((link) => {
				if (!isHome) link.setAttribute("href", `index.html${link.getAttribute("href")}`);
			});
		}
		if (footer) {
			footer.querySelectorAll(".brand").forEach((brand) => brand.setAttribute("href", homeLink));
			footer.querySelectorAll("a[href^='#']").forEach((link) => {
				if (!isHome) link.setAttribute("href", `index.html${link.getAttribute("href")}`);
			});
		}
		if (!header) return;

		// Mark active nav links
		if (isPolicyPage) {
			header.querySelectorAll("a[href='privacy-policy.html']").forEach((link) => {
				link.classList.add("is-active");
				link.setAttribute("aria-current", "page");
			});
		}
		if (isAboutPage) {
			header.querySelectorAll("a[href='about.html']").forEach((link) => {
				link.classList.add("is-active");
				link.setAttribute("aria-current", "page");
			});
		}
		if (isLoginPage) {
			header.querySelectorAll("a[href='login.html']").forEach((link) => {
				link.classList.add("is-active");
				link.setAttribute("aria-current", "page");
			});
		}
		if (isSignupPage) {
			header.querySelectorAll("a[href='signup.html']").forEach((link) => {
				link.classList.add("is-active");
				link.setAttribute("aria-current", "page");
			});
		}
	}

	const promises = [];
	const headerEl = document.getElementById("header");
	if (headerEl) promises.push(loadComponent("header", "components/header.html"));
	const footerEl = document.getElementById("footer");
	if (footerEl) promises.push(loadComponent("footer", "components/footer.html"));

	window.includesReady = Promise.all(promises).then(() => {
		updateNavigation();
		setTimeout(() => {
			if (typeof window.updateNavAuth === "function") {
				window.updateNavAuth();
			}
			window.dispatchEvent(new Event("includesLoaded"));
		}, 0);
	}).catch((error) => {
		console.error(error);
	});
})();
