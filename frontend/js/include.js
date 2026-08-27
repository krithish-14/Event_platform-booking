(() => {
	"use strict";

	if (window.JodTheme && typeof window.JodTheme.sync === "function") {
		window.JodTheme.sync();
	} else if (window.JodTheme && typeof window.JodTheme.apply === "function") {
		window.JodTheme.apply();
	}

	function currentPageFile() {
		if (window.JodUrls && typeof window.JodUrls.currentPageFile === "function") {
			return window.JodUrls.currentPageFile();
		}
		return (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
	}

	const pageName = currentPageFile();
	const isHome = pageName === "index.html";
	const isAboutPage = pageName === "about.html";
	const isCategoryPage = pageName === "category.html";
	const isGalleryPage = pageName === "gallery.html";
	const isLoginPage = pageName === "login.html";
	const isSignupPage = pageName === "signup.html";
	const isPolicyPage = ["privacy-policy.html", "terms-and-conditions.html", "return-and-refund-policy.html"].includes(pageName);

	if (isHome) {
		document.body.classList.add("home-page");
	} else {
		document.body.classList.add("sub-page");
	}

	function announcementBarHeight() {
		const bar = document.querySelector(".announcement-bar");
		if (!bar || !bar.classList.contains("has-published-event")) return 0;
		if (window.getComputedStyle(bar).display === "none") return 0;
		return bar.offsetHeight || 40;
	}

	function syncHeaderOffset() {
		const header = document.querySelector(".site-header");
		if (!header) return;
		const headerHeight = Math.ceil(header.getBoundingClientRect().height) || header.offsetHeight;
		if (headerHeight > 0) {
			document.documentElement.style.setProperty("--site-header-height", `${headerHeight}px`);
		}
		if (!document.body.classList.contains("home-page")) return;
		// Use layout heights only. Measuring header.bottom - hero.top while
		// scrolling makes padding grow as the hero leaves the viewport (glitchy jump).
		const offset = Math.max(0, announcementBarHeight() + headerHeight - 4);
		const value = `${offset}px`;
		if (document.body.style.getPropertyValue("--hero-header-offset") === value) return;
		document.body.style.setProperty("--hero-header-offset", value);
		document.documentElement.style.setProperty("--hero-header-offset", value);
	}
	window.syncHeaderOffset = syncHeaderOffset;

	function watchHeaderOffset() {
		syncHeaderOffset();
		window.addEventListener("resize", syncHeaderOffset);
		window.addEventListener("load", syncHeaderOffset);
		const header = document.querySelector(".site-header");
		if (header && typeof ResizeObserver !== "undefined" && !header.dataset.offsetWatched) {
			header.dataset.offsetWatched = "1";
			new ResizeObserver(() => syncHeaderOffset()).observe(header);
		}
		const announcement = document.querySelector(".announcement-bar");
		if (announcement && typeof ResizeObserver !== "undefined" && !announcement.dataset.offsetWatched) {
			announcement.dataset.offsetWatched = "1";
			new ResizeObserver(() => syncHeaderOffset()).observe(announcement);
		}
		if (announcement && typeof MutationObserver !== "undefined" && !announcement.dataset.classWatched) {
			announcement.dataset.classWatched = "1";
			new MutationObserver(() => syncHeaderOffset()).observe(announcement, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
		}
	}

	function loadComponent(id, path) {
		const target = document.getElementById(id);
		if (!target) return Promise.reject(new Error(`Missing component target: #${id}`));
		return fetch(path).then((response) => {
			if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
			return response.text();
		}).then((html) => {
			target.outerHTML = html;
			if (id === "header") {
				syncHeaderOffset();
				if (typeof window.updateNavAuth === "function") {
					try { window.updateNavAuth(); } catch (_) {}
				}
			}
		});
	}

	function prettyHref(href) {
		if (window.JodUrls && typeof window.JodUrls.prettyHref === "function") {
			return window.JodUrls.prettyHref(href);
		}
		return href;
	}

	function markActive(root, file) {
		const pretty = prettyHref(file);
		root.querySelectorAll("a[href]").forEach((link) => {
			const raw = (link.getAttribute("href") || "").split("?")[0].split("#")[0];
			if (raw === pretty || raw === file || raw === file.replace(/\.html$/i, "")) {
				link.classList.add("is-active");
				link.setAttribute("aria-current", "page");
			}
		});
	}

	function updateNavigation() {
		const header = document.querySelector("[data-header]");
		const footer = document.querySelector(".site-footer");
		const homeLink = isHome ? "#top" : prettyHref("index.html#top");

		if (header) {
			header.querySelectorAll(".brand").forEach((brand) => brand.setAttribute("href", homeLink));
			header.querySelectorAll("a[href^='#']").forEach((link) => {
				if (!isHome) link.setAttribute("href", prettyHref(`index.html${link.getAttribute("href")}`));
			});
		}
		if (footer) {
			footer.querySelectorAll(".brand").forEach((brand) => brand.setAttribute("href", homeLink));
			footer.querySelectorAll("a[href^='#']").forEach((link) => {
				if (!isHome) link.setAttribute("href", prettyHref(`index.html${link.getAttribute("href")}`));
			});
		}
		if (!header) return;

		if (isPolicyPage) markActive(header, pageName);
		if (isAboutPage) markActive(header, "about.html");
		if (isCategoryPage) markActive(header, "category.html");
		if (isGalleryPage) markActive(header, "gallery.html");
		if (isLoginPage) markActive(header, "login.html");
		if (isSignupPage) markActive(header, "signup.html");
	}

	document.addEventListener("click", (e) => {
		const link = e.target.closest("a[href]");
		if (!link) return;
		const href = link.getAttribute("href") || "";
		const isAuthLink = window.JodUrls && typeof window.JodUrls.isLoginOrSignupHref === "function"
			? window.JodUrls.isLoginOrSignupHref(href)
			: (href.includes("login.html") || href.includes("signup.html"));
		if (!isAuthLink) return;
		const currentFile = currentPageFile();
		if (currentFile !== "login.html" && currentFile !== "signup.html") {
			const fullTarget = window.location.pathname + window.location.search + window.location.hash;
			try {
				sessionStorage.setItem("jod_redirect_after_login", fullTarget);
			} catch (_) {}
			if (href && !href.includes("redirect=")) {
				const sep = href.includes("?") ? "&" : "?";
				link.setAttribute("href", `${href}${sep}redirect=${encodeURIComponent(fullTarget)}`);
			}
		}
	});

	const promises = [];
	const headerEl = document.getElementById("header");
	if (headerEl) promises.push(loadComponent("header", "components/header.html?v=22"));
	const footerEl = document.getElementById("footer");
	if (footerEl) promises.push(loadComponent("footer", "components/footer.html?v=9"));

	window.includesReady = Promise.all(promises).then(() => {
		watchHeaderOffset();
		updateNavigation();
		if (window.JodTheme && typeof window.JodTheme.sync === "function") {
			window.JodTheme.sync();
		}
		if (window.JodSearch && typeof window.JodSearch.initSearch === "function") {
			window.JodSearch.initSearch();
		}
		setTimeout(() => {
			if (typeof window.updateNavAuth === "function") {
				window.updateNavAuth();
			}
			if (window.JodTheme && typeof window.JodTheme.sync === "function") {
				window.JodTheme.sync();
			}
			if (window.JodSearch && typeof window.JodSearch.initSearch === "function") {
				window.JodSearch.initSearch();
			}
			window.dispatchEvent(new Event("includesLoaded"));
			syncHeaderOffset();
		}, 0);
	}).catch((error) => {
		console.error(error);
	});
})();
