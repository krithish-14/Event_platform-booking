(() => {
	"use strict";

	if (window.JodTheme && typeof window.JodTheme.sync === "function") {
 window.JodTheme.sync();
	} else if (window.JodTheme && typeof window.JodTheme.apply === "function") {
 window.JodTheme.apply();
	}

	function currentPageFile() {
 if (document.body && document.body.classList.contains("error-404-page")) {
 return "404.html";
 }
 if (window.JodUrls && typeof window.JodUrls.currentPageFile === "function") {
 return window.JodUrls.currentPageFile();
 }
 const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
 if (path === "/" || path === "/index" || path === "/index.html") return "index.html";
 const leaf = path.split("/").pop() || "index.html";
 return leaf.toLowerCase().endsWith(".html") ? leaf.toLowerCase() : `${leaf.toLowerCase()}.html`;
	}

	const pageName = currentPageFile();
	const isHome = pageName === "index.html";
	const isAboutPage = pageName === "about.html";
	const isCategoryPage = pageName === "category.html";
	const isGalleryPage = pageName === "gallery.html";
	const isLoginPage = pageName === "login.html";
	const isSignupPage = pageName === "signup.html";
	const isPolicyPage = ["privacy-policy.html", "terms-and-conditions.html", "return-and-refund-policy.html"].includes(pageName);
	const isErrorPage = document.body.classList.contains("error-404-page") || pageName === "404.html";

	if (isHome && !isErrorPage) {
 document.body.classList.add("home-page");
	} else {
 document.body.classList.add("sub-page");
	}

	function announcementBarHeight() {
 const bar = document.querySelector(".announcement-bar");
 if (!bar || bar.hidden || !bar.classList.contains("has-published-event")) return 0;
 if (window.getComputedStyle(bar).display === "none") return 0;
 return Math.ceil(bar.getBoundingClientRect().height) || bar.offsetHeight || 40;
	}

	function syncHeaderOffset() {
 const header = document.querySelector(".site-header");
 if (!header) return;
 const headerHeight = Math.ceil(header.getBoundingClientRect().height) || header.offsetHeight || 0;
 if (headerHeight > 0) {
 document.documentElement.style.setProperty("--site-header-height", `${headerHeight}px`);
 }
 if (!document.body.classList.contains("home-page")) return;
 // Use layout heights only. Measuring header.bottom - hero.top while
 // scrolling makes padding grow as the hero leaves the viewport (glitchy jump).
 const ann = announcementBarHeight();
 document.documentElement.style.setProperty("--hero-announcement-height", `${ann}px`);
 const offset = Math.max(0, ann + headerHeight);
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

	function resolveSitePath(path) {
 const raw = String(path || "").trim();
 if (!raw) return raw;
 if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("/") || raw.startsWith("data:")) return raw;
 return `/${raw.replace(/^\.\//, "")}`;
	}

	function loadComponent(id, path) {
 const target = document.getElementById(id);
 if (!target) return Promise.reject(new Error(`Missing component target: #${id}`));
 const url = resolveSitePath(path);
 return fetch(url).then((response) => {
 if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
 return response.text();
 }).then((html) => {
 if (id === "privacyPolicyBody" || id === "refundPolicyBody") {
 target.innerHTML = html;
 } else if (id === "header") {
 target.innerHTML = html;
 syncHeaderOffset();
 if (typeof window.updateNavAuth === "function") {
 try { window.updateNavAuth(); } catch (_) {}
 }
 } else {
 target.outerHTML = html;
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
	if (headerEl) promises.push(loadComponent("header", "components/header.html?v=36"));
	const footerEl = document.getElementById("footer");
	if (footerEl) promises.push(loadComponent("footer", "components/footer.html?v=14"));
	const privacyBodyEl = document.getElementById("privacyPolicyBody");
	if (privacyBodyEl) promises.push(loadComponent("privacyPolicyBody", "components/privacy-policy-body.html?v=3"));
	const refundBodyEl = document.getElementById("refundPolicyBody");
	if (refundBodyEl) promises.push(loadComponent("refundPolicyBody", "components/refund-policy-body.html?v=2"));

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
