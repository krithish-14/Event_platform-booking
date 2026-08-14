# JOD Events — Line-by-Line Guide: Frontend Client Controllers

This document provides a line-by-line educational walkthrough of the frontend JavaScript controllers in `frontend/js/`.

---

## 1. `frontend/js/include.js`

### Source Code & Walkthrough

```javascript
1: (() => {
2: 	"use strict";
3: 
4: 	const pageName = window.location.pathname.split("/").pop() || "index.html";
5: 	const isHome = pageName === "index.html" || pageName === "";
6: 	const isAboutPage = pageName === "about.html";
7: 	const isLoginPage = pageName === "login.html";
8: 	const isSignupPage = pageName === "signup.html";
9: 	const isPolicyPage = ["privacy-policy.html", "terms-and-conditions.html", "return-and-refund-policy.html"].includes(pageName);
```
* **Line 1: `(() => {`**: Immediately Invoked Function Expression (IIFE) creating a private scope so variables don't pollute window global scope.
* **Line 2: `"use strict";`**: Enables strict JavaScript execution mode, throwing errors on undeclared variables.
* **Lines 4-9**: Parses the active page filename from `window.location.pathname` to set boolean flags (`isHome`, `isAboutPage`, etc.).

```javascript
17: 	function loadComponent(id, path) {
18: 		return fetch(path).then((response) => {
19: 			if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
20: 			return response.text();
21: 		}).then((html) => {
22: 			const target = document.getElementById(id);
23: 			if (!target) throw new Error(`Missing component target: #${id}`);
24: 			target.outerHTML = html;
25: 			if (id === "header" && typeof window.updateNavAuth === "function") {
26: 				try { window.updateNavAuth(); } catch (_) {}
27: 			}
28: 		});
29: 	}
```
* **Lines 17-29: `loadComponent(id, path)`**: Fetches an HTML component file (e.g. `components/header.html`), parses text, and replaces `<div id="header">` using `target.outerHTML = html`. Automatically triggers `updateNavAuth()` to update navigation UI.

```javascript
78: 	document.addEventListener("click", (e) => {
79: 		const link = e.target.closest("a[href*='login.html'], a[href*='signup.html']");
80: 		if (!link) return;
81: 		const currentFile = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
82: 		if (currentFile !== "login.html" && currentFile !== "signup.html") {
83: 			const fullTarget = window.location.pathname + window.location.search + window.location.hash;
84: 			try {
85: 				sessionStorage.setItem("jod_redirect_after_login", fullTarget);
86: 			} catch (_) {}
87: 			const href = link.getAttribute("href");
88: 			if (href && !href.includes("redirect=")) {
89: 				const sep = href.includes("?") ? "&" : "?";
90: 				link.setAttribute("href", `${href}${sep}redirect=${encodeURIComponent(fullTarget)}`);
91: 			}
92: 		}
93: 	});
```
* **Lines 78-93**: Click delegation interceptor. When a user clicks a "Login" or "Signup" link, it saves the current page URL in `sessionStorage` (`jod_redirect_after_login`), so after authentication, the user is redirected back to the exact page they were viewing.

```javascript
95: 	const promises = [];
96: 	const headerEl = document.getElementById("header");
97: 	if (headerEl) promises.push(loadComponent("header", "components/header.html"));
98: 	const footerEl = document.getElementById("footer");
99: 	if (footerEl) promises.push(loadComponent("footer", "components/footer.html"));
101: 	window.includesReady = Promise.all(promises).then(() => {
102: 		updateNavigation();
103: 		if (window.JodSearch && typeof window.JodSearch.initSearch === "function") {
104: 			window.JodSearch.initSearch();
105: 		}
110: 		window.dispatchEvent(new Event("includesLoaded"));
111: 	});
```
* **Lines 95-111**: Asynchronously loads both header and footer concurrently via `Promise.all()`. Once loaded, initializes global search and dispatches a custom DOM event `"includesLoaded"`.
