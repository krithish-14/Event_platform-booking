
(function initSplashAndBg() {
	"use strict";

	const splashScreen = document.getElementById("splashScreen");
	const canvas = document.getElementById("bgCanvas");
	const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const pageName = window.location.pathname.split("/").pop() || "index.html";
	const isHome = pageName === "index.html" || pageName === "";

	let splashShown = false;
	try {
		splashShown = sessionStorage.getItem("jod-splash-shown") === "true";
	} catch (err) {
		void err;
	}

	let splashTimer = null;
	let splashKeyHandler = null;
	function clearSplashTimers() {
		if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
		if (splashKeyHandler) {
			window.removeEventListener("keydown", splashKeyHandler);
			splashKeyHandler = null;
		}
	}

	function hideSplash() {
		if (!splashScreen) return;
		clearSplashTimers();
		splashScreen.classList.add("is-hidden");
		splashTimer = setTimeout(() => {
			splashScreen.style.display = "none";
			splashTimer = null;
			try {
				sessionStorage.setItem("jod-splash-shown", "true");
			} catch (err) {
				void err;
			}
		}, 650);
	}

	function showSplash() {
		if (!splashScreen || prefersReduced) return;
		clearSplashTimers();
		splashScreen.style.display = "";
		splashScreen.classList.remove("is-hidden");
		void splashScreen.offsetWidth;
		splashScreen.classList.add("is-replay");
		void splashScreen.offsetWidth;
		splashScreen.classList.remove("is-replay");
		const skip = () => hideSplash();
		splashScreen.addEventListener("click", skip, { once: true });
		splashKeyHandler = (e) => {
			if (e.key === "Escape" || e.key === " " || e.key === "Enter") skip();
		};
		window.addEventListener("keydown", splashKeyHandler, { once: true });
	}

	if (splashScreen) {
		if (prefersReduced || !isHome || splashShown) {
			splashScreen.style.display = "none";
			splashScreen.classList.add("is-hidden");
		} else {
			showSplash();
			// Auto-hide after 2.5s
			splashTimer = setTimeout(hideSplash, 2500);
		}
	}

	document.addEventListener("click", (e) => {
		if (!splashScreen || prefersReduced) return;
		const logo = e.target.closest("a[href='index.html'] img, a[href='./index.html'] img, img[alt='JOD Events']");
		if (!logo) return;
		if (isHome) {
			e.preventDefault();
			showSplash();
			// Auto-hide after 2.5s
			clearSplashTimers();
			splashTimer = setTimeout(hideSplash, 2500);
		}
	});

	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	let width = 0, height = 0, dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
	const particles = [];
	const mouse = { x: -9999, y: -9999, active: false, radius: 140 };

	const COLORS = [
		{ r: 255, g: 117, b: 8 },
		{ r: 255, g: 138, b: 31 },
		{ r: 255, g: 161, b: 54 },
		{ r: 255, g: 171, b: 64 },
	];

	function resize() {
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function Particle() { this.reset(); }
	Particle.prototype.reset = function () {
		this.x = Math.random() * width;
		this.y = Math.random() * height;
		const base = prefersReduced ? 0.15 : 0.3;
		const ang = Math.random() * Math.PI * 2;
		const spd = (base + Math.random() * 0.5) * (prefersReduced ? 0.2 : 1);
		this.vx = Math.cos(ang) * spd;
		this.vy = Math.sin(ang) * spd;
		this.radius = 0.8 + Math.random() * 2.2;
		this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
		this.life = 0;
		this.maxLife = 600 + Math.random() * 800;
		this.baseAlpha = 0.25 + Math.random() * 0.45;
	};
	Particle.prototype.step = function () {
		if (mouse.active) {
			const dx = this.x - mouse.x;
			const dy = this.y - mouse.y;
			const distSq = dx * dx + dy * dy;
			if (distSq < mouse.radius * mouse.radius) {
				const dist = Math.sqrt(distSq) || 0.001;
				const force = (1 - dist / mouse.radius) * 0.9;
				this.vx += (dx / dist) * force;
				this.vy += (dy / dist) * force;
			}
		}
		const maxV = prefersReduced ? 0.6 : 2.4;
		const v = Math.hypot(this.vx, this.vy);
		if (v > maxV) { this.vx = (this.vx / v) * maxV; this.vy = (this.vy / v) * maxV; }
		const friction = prefersReduced ? 0.995 : 0.985;
		this.vx *= friction;
		this.vy *= friction;
		this.x += this.vx;
		this.y += this.vy;
		this.life++;
		if (this.x < -20 || this.x > width + 20 || this.y < -20 || this.y > height + 20 || this.life > this.maxLife) {
			this.reset();
		}
	};
	Particle.prototype.draw = function () {
		const lifeT = Math.min(1, this.life / 80) * Math.min(1, (this.maxLife - this.life) / 120);
		const alpha = this.baseAlpha * lifeT;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha})`;
		ctx.shadowColor = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha * 0.8})`;
		ctx.shadowBlur = 8;
		ctx.fill();
		ctx.shadowBlur = 0;
	};

	function initParticles() {
		const area = width * height;
		const density = prefersReduced ? 0.000025 : 0.000055;
		const count = Math.max(20, Math.min(90, Math.floor(area * density)));
		particles.length = 0;
		for (let i = 0; i < count; i++) particles.push(new Particle());
	}

	function drawConnections() {
		const maxDist = 130;
		const maxDistSq = maxDist * maxDist;
		for (let i = 0; i < particles.length; i++) {
			const a = particles[i];
			for (let j = i + 1; j < particles.length; j++) {
				const b = particles[j];
				const dx = a.x - b.x;
				const dy = a.y - b.y;
				const distSq = dx * dx + dy * dy;
				if (distSq < maxDistSq) {
					const t = 1 - distSq / maxDistSq;
					const alpha = t * 0.18;
					const cr = Math.floor((a.color.r + b.color.r) / 2);
					const cg = Math.floor((a.color.g + b.color.g) / 2);
					const cb = Math.floor((a.color.b + b.color.b) / 2);
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
					ctx.lineWidth = 0.6 * t + 0.2;
					ctx.stroke();
				}
			}
			if (mouse.active) {
				const dx = a.x - mouse.x;
				const dy = a.y - mouse.y;
				const distSq = dx * dx + dy * dy;
				const mDist = mouse.radius;
				if (distSq < mDist * mDist) {
					const t = 1 - Math.sqrt(distSq) / mDist;
					const alpha = t * 0.45;
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(mouse.x, mouse.y);
					const grad = ctx.createLinearGradient(a.x, a.y, mouse.x, mouse.y);
					grad.addColorStop(0, `rgba(${a.color.r}, ${a.color.g}, ${a.color.b}, ${alpha})`);
					grad.addColorStop(1, `rgba(255, 161, 54, ${alpha * 0.3})`);
					ctx.strokeStyle = grad;
					ctx.lineWidth = 0.8 * t + 0.3;
					ctx.stroke();
				}
			}
		}
	}

	let lastFrame = 0;
	const frameInterval = prefersReduced ? 1000 / 30 : 1000 / 60;
	function loop(ts) {
		if (ts - lastFrame < frameInterval) { requestAnimationFrame(loop); return; }
		lastFrame = ts;
		ctx.clearRect(0, 0, width, height);
		for (let i = 0; i < particles.length; i++) { particles[i].step(); }
		drawConnections();
		for (let i = 0; i < particles.length; i++) { particles[i].draw(); }
		requestAnimationFrame(loop);
	}

	let resizeTimer = null;
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => { resize(); initParticles(); }, 150);
	});

	window.addEventListener("pointermove", (e) => {
		mouse.active = true;
		mouse.x = e.clientX;
		mouse.y = e.clientY;
	}, { passive: true });
	window.addEventListener("pointerleave", () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; });
	window.addEventListener("pointerdown", (e) => {
		mouse.active = true;
		mouse.x = e.clientX;
		mouse.y = e.clientY;
		for (let i = 0; i < particles.length; i++) {
			const dx = particles[i].x - e.clientX;
			const dy = particles[i].y - e.clientY;
			const distSq = dx * dx + dy * dy;
			if (distSq < (mouse.radius * 1.5) * (mouse.radius * 1.5)) {
				const dist = Math.sqrt(distSq) || 0.001;
				const burst = (1 - dist / (mouse.radius * 1.5)) * 6;
				particles[i].vx += (dx / dist) * burst;
				particles[i].vy += (dy / dist) * burst;
			}
		}
	}, { passive: true });

	resize();
	initParticles();
	requestAnimationFrame(loop);
})();

// ── Global Navigation Auth State Manager ──────────────────────
(function initGlobalNavAuth() {
	"use strict";

	const DefaultAuth = {
		getToken: () => {
			if (window.JodAuth && typeof window.JodAuth.getToken === "function") {
				return window.JodAuth.getToken();
			}
			try {
				let tok = localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token");
				if (tok === "null" || tok === "undefined") tok = null;
				return tok || null;
			} catch (_) { return null; }
		},
		getUser: () => {
			if (window.JodAuth && typeof window.JodAuth.getUser === "function") {
				return window.JodAuth.getUser();
			}
			try {
				const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
				if (raw && raw !== "null" && raw !== "undefined") {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object") return parsed;
				}
				const email = sessionStorage.getItem("verified_organizer_email");
				if (email) return { email, username: email.split("@")[0], full_name: email.split("@")[0] };
				return null;
			} catch (_) { return null; }
		},
		isLoggedIn: () => {
			if (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function") {
				return window.JodAuth.isLoggedIn();
			}
			try {
				const user = DefaultAuth.getUser();
				const token = DefaultAuth.getToken();
				return Boolean(user || token || sessionStorage.getItem("verified_organizer_email"));
			} catch (_) { return false; }
		},
		logout: async () => {
			if (window.JodAuth && typeof window.JodAuth.logout === "function") {
				return window.JodAuth.logout();
			}
			try {
				localStorage.clear();
				sessionStorage.clear();
			} catch (_) {}
		}
	};

	async function onLogoutClick(e) {
		if (e && e.preventDefault) e.preventDefault();
		const auth = window.JodAuth || DefaultAuth;
		console.log("[Auth Debug] User initiated logout from page:", window.location.pathname);
		try {
			if (auth.logout) await auth.logout();
			else DefaultAuth.logout();
		} catch (_) {
			DefaultAuth.logout();
		}
		applyAuthVisibility(false);
		window.location.href = "index.html";
	}

	function applyAuthVisibility(authenticatedOverride) {
		const auth = window.JodAuth || DefaultAuth;
		const isAuth = typeof authenticatedOverride === "boolean"
			? authenticatedOverride
			: (auth.isLoggedIn && auth.isLoggedIn());
		const body = document.body;
		if (!body) return;
		
		const currentUser = auth.getUser ? auth.getUser() : null;
		console.log("[Auth Debug] Initialization & Visibility Evaluation:", {
			pathname: window.location.pathname,
			is_authenticated: isAuth,
			user_id: currentUser?.id || "N/A",
			email: currentUser?.email || "N/A",
			token_present: Boolean(auth.getToken ? auth.getToken() : localStorage.getItem("jod_access_token")),
			body_data_user: isAuth ? "authenticated" : "guest"
		});

		body.setAttribute("data-user", isAuth ? "authenticated" : "guest");
		body.classList.add("is-auth-ready");

		if (body.classList.contains("sub-page")) {
			const bar = document.querySelector(".announcement-bar");
			if (bar) bar.style.setProperty("display", "none", "important");
		}
	}

	function updateNavAuth() {
		const desktopGroup = document.querySelector(".nav-auth");
		const mobileGroup = document.querySelector(".mobile-auth-group");
		if (!desktopGroup && !mobileGroup) return;

		const auth = window.JodAuth || DefaultAuth;
		const loggedIn = auth.isLoggedIn ? auth.isLoggedIn() : false;

		if (loggedIn) {
			if (window.JodProfile) {
				if (desktopGroup) window.JodProfile.renderProfileWidget(desktopGroup);
				if (mobileGroup) window.JodProfile.renderMobileAuthGroup(mobileGroup);
			} else {
				const user = auth.getUser() || {};
				const displayName = user.full_name || user.username || (user.email ? user.email.split("@")[0] : "Account");
				const initials = (displayName || "?").slice(0, 2).toUpperCase();

				if (desktopGroup) {
					desktopGroup.innerHTML = `
						<div class="auth-user-block" style="display:flex;align-items:center;gap:.75rem;">
							<div class="user-avatar" title="${displayName}" style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#ff7508,#ffab36);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;letter-spacing:.02em;box-shadow:0 2px 8px rgba(255,117,8,0.3);">${initials}</div>
							<div style="line-height:1.2;">
								<div style="font-size:.85rem;font-weight:700;color:#ffffff;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayName}</div>
								<button id="nav-logout-btn" type="button" style="background:none;border:0;padding:0;color:#ff7508;font-weight:600;font-size:.78rem;cursor:pointer;">Logout</button>
							</div>
						</div>`;
					const btn = desktopGroup.querySelector("#nav-logout-btn");
					if (btn) btn.addEventListener("click", onLogoutClick);
				}

				if (mobileGroup) {
					mobileGroup.innerHTML = `
						<div style="padding:1rem .5rem .5rem;">
							<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.9rem;">
								<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#ff7508,#ffab36);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">${initials}</div>
								<div style="line-height:1.15;">
									<div style="font-weight:600;color:#ffffff;">${displayName}</div>
									<div style="font-size:.75rem;color:#94a3b8;">${user.email || ""}</div>
								</div>
							</div>
							<button class="button button-login" id="mobile-logout-btn" type="button" style="width:100%;background:#fef2e6;color:#ff7508;border:1px solid #ffcd9a;">Logout</button>
						</div>`;
					const btn = mobileGroup.querySelector("#mobile-logout-btn");
					if (btn) btn.addEventListener("click", onLogoutClick);
				}
			}
			}
		} else {
			if (desktopGroup && !desktopGroup.querySelector("#nav-login-btn")) {
				desktopGroup.innerHTML = `
					<a class="button button-sm button-login" href="login.html" id="nav-login-btn">Login</a>
					<a class="button button-sm button-primary" href="signup.html" id="nav-signup-btn">Sign Up &#8599;</a>`;
			}
			if (mobileGroup && !mobileGroup.querySelector('a[href="login.html"]')) {
				mobileGroup.innerHTML = `
					<a class="button button-login" href="login.html">Login</a>
					<a class="button button-primary" href="signup.html">Sign Up</a>`;
			}
		}
	}

	window.updateNavAuth = updateNavAuth;
	window.applyAuthVisibility = applyAuthVisibility;

	// Execute immediately
	applyAuthVisibility();
	updateNavAuth();

	/* ── Location flow (homepage) ─────────────── */
	if (window.JodLocation) {
		const pending = (() => {
			try { return sessionStorage.getItem("jod_location_pending") === "1"; } catch (_) { return false; }
		})();
		if (pending) {
			window.JodLocation.initLocationFlow({ force: true }).catch(() => {});
		} else {
			window.JodLocation.applyCachedRecommendations();
		}
	}

	// Listen to DOM events
	window.addEventListener("DOMContentLoaded", () => { applyAuthVisibility(); updateNavAuth(); });
	window.addEventListener("load", () => { applyAuthVisibility(); updateNavAuth(); });
	window.addEventListener("includesLoaded", () => { applyAuthVisibility(); updateNavAuth(); });

	// MutationObserver: whenever header component is injected, instantly transform auth navigation
	try {
		const observer = new MutationObserver(() => {
			const desktopGroup = document.querySelector(".nav-auth");
			const mobileGroup = document.querySelector(".mobile-auth-group");
			if (desktopGroup || mobileGroup) {
				const auth = window.JodAuth || DefaultAuth;
				if (auth.isLoggedIn() && !document.querySelector(".auth-user-block")) {
					updateNavAuth();
					applyAuthVisibility(true);
				}
			}
		});
		observer.observe(document.documentElement, { childList: true, subtree: true });
	} catch (_) {}
})();

(window.includesReady || Promise.resolve()).then(() => {
	"use strict";

	const pad = (value) => String(value).padStart(2, "0");

	function getCountdown(target) {
		const difference = Math.max(0, new Date(target).getTime() - Date.now());
		return {
			days: Math.floor(difference / 86400000),
			hours: Math.floor((difference / 3600000) % 24),
			minutes: Math.floor((difference / 60000) % 60),
			seconds: Math.floor((difference / 1000) % 60),
		};
	}

	function updateCountdown(element) {
		const value = getCountdown(element.dataset.countdown);
		["days", "hours", "minutes", "seconds"].forEach((part) => {
			const target = element.querySelector(`[data-${part}]`);
			if (target) target.textContent = pad(value[part]);
		});
	}

	function updateCardCountdown(element) {
		const value = getCountdown(element.dataset.cardCountdown);
		element.textContent = `✨ ${pad(value.days)}d : ${pad(value.hours)}h : ${pad(value.minutes)}m`;
	}

	function updateTimers() {
		document.querySelectorAll("[data-countdown]").forEach(updateCountdown);
		document.querySelectorAll("[data-card-countdown]").forEach(updateCardCountdown);
		const summary = document.querySelector("[data-summary-countdown]");
		if (summary) {
			const value = getCountdown("2026-08-15T04:30:00Z");
			summary.textContent = `${value.days}d ${value.hours}h ${value.minutes}m`;
		}
	}

	const header = document.querySelector("[data-header]");
	const announcement = document.querySelector(".announcement-bar");
	const onScroll = () => {
		const scrolled = window.scrollY > 12;
		header?.classList.toggle("is-scrolled", scrolled);
		announcement?.classList.toggle("is-scrolled", scrolled);
	};
	onScroll();
	window.addEventListener("scroll", onScroll, { passive: true });

	/* ── Header Search Bar wiring ─────────────────────────────── */
	function wireHeaderSearch(root) {
		if (!root) return;
		const input = root.querySelector("input[type='text']");
		const clear = root.querySelector(".search-clear");
		if (!input) return;
		if (clear) {
			clear.addEventListener("click", () => {
				input.value = "";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				try { input.focus(); } catch (_) {}
			});
		}
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				input.value = "";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				try { input.blur(); } catch (_) {}
			} else if (e.key === "Enter") {
				const q = (input.value || "").trim();
				if (q) {
					e.preventDefault();
					const queryParam = encodeURIComponent(q);
					try { window.location.href = `index.html?q=${queryParam}`; } catch (_) {}
				}
			}
		});
	}
	document.querySelectorAll(".header-search, .mobile-header-search").forEach(wireHeaderSearch);

	const menuToggle = document.querySelector("[data-menu-toggle]");
	const mobileNav = document.querySelector("[data-mobile-nav]");
	menuToggle?.addEventListener("click", () => {
		const open = menuToggle.classList.toggle("is-open");
		mobileNav?.classList.toggle("is-open", open);
		menuToggle.setAttribute("aria-expanded", String(open));
	});
	mobileNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
		menuToggle?.classList.remove("is-open");
		mobileNav.classList.remove("is-open");
		menuToggle?.setAttribute("aria-expanded", "false");
	}));

	document.querySelectorAll(".faq-item").forEach((item) => item.addEventListener("click", () => {
		const wasOpen = item.classList.contains("is-open");
		document.querySelectorAll(".faq-item").forEach((faq) => faq.classList.remove("is-open"));
		if (!wasOpen) item.classList.add("is-open");
	}));

	const modal = document.querySelector("[data-modal]");
	const closeModal = () => {
		if (!modal) return;
		modal.hidden = true;
		document.body.classList.remove("modal-open");
		try { sessionStorage.setItem("jod-upcoming-modal-shown", "1"); } catch (error) { void error; }
	};
	modal?.querySelectorAll("[data-modal-close]").forEach((button) => button.addEventListener("click", closeModal));
	document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal && !modal.hidden) closeModal(); });

	let modalWasShown = false;
	try { modalWasShown = sessionStorage.getItem("jod-upcoming-modal-shown") === "1"; } catch (error) { void error; }
	if (modal && !modalWasShown) {
		window.setTimeout(() => { modal.hidden = false; document.body.classList.add("modal-open"); }, 1800);
	}

	/* ── Guest Auth Modal for Live Trending Events ───────────── */
	const guestAuthModal = document.getElementById("guestAuthModal");
	const guestAuthModalCloseBtn = document.getElementById("guestAuthModalCloseBtn");
	const guestAuthModalCloseBackdrop = document.getElementById("guestAuthModalCloseBackdrop");
	const guestAuthCancelBtn = document.getElementById("guestAuthCancelBtn");
	const guestAuthSignupBtn = document.getElementById("guestAuthSignupBtn");

	function closeGuestAuthModal() {
		if (!guestAuthModal) return;
		guestAuthModal.hidden = true;
		document.body.classList.remove("guest-modal-open");
	}

	function openGuestAuthModal(targetUrl) {
		if (!guestAuthModal) return;
		if (targetUrl) {
			try { sessionStorage.setItem("jod_redirect_after_login", targetUrl); } catch (_) {}
			if (guestAuthSignupBtn) {
				guestAuthSignupBtn.href = `signup.html?redirect=${encodeURIComponent(targetUrl)}`;
			}
		} else if (guestAuthSignupBtn) {
			guestAuthSignupBtn.href = "signup.html";
		}
		guestAuthModal.hidden = false;
		document.body.classList.add("guest-modal-open");
	}

	if (guestAuthModal) {
		guestAuthModalCloseBtn?.addEventListener("click", closeGuestAuthModal);
		guestAuthModalCloseBackdrop?.addEventListener("click", closeGuestAuthModal);
		guestAuthCancelBtn?.addEventListener("click", closeGuestAuthModal);
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && guestAuthModal && !guestAuthModal.hidden) {
				closeGuestAuthModal();
			}
		});
	}

	const upcomingSection = document.getElementById("upcoming");
	if (upcomingSection) {
		upcomingSection.addEventListener("click", (e) => {
			const card = e.target.closest(".event-card");
			if (!card) return;

			const isLoggedIn = Auth.isLoggedIn && Auth.isLoggedIn();
			if (!isLoggedIn) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();

				const linkEl = card.querySelector("a.card-link");
				let targetUrl = linkEl ? linkEl.getAttribute("href") : null;
				if (!targetUrl) {
					const onclickAttr = card.getAttribute("onclick") || "";
					const match = onclickAttr.match(/href=['"]([^'"]+)['"]/);
					if (match) targetUrl = match[1];
				}
				if (!targetUrl) targetUrl = "event-details.html";

				openGuestAuthModal(targetUrl);
			}
		}, true);
	}

	const year = document.querySelector("[data-year]");
	if (year) year.textContent = String(new Date().getFullYear());
	updateTimers();
	window.setInterval(updateTimers, 1000);

	function initCarousel(carousel) {
		const viewport = carousel.querySelector("[data-carousel-viewport]");
		const track = carousel.querySelector("[data-carousel-track]");
		const prevBtn = carousel.querySelector("[data-carousel-prev]");
		const nextBtn = carousel.querySelector("[data-carousel-next]");
		if (!viewport || !track || !prevBtn || !nextBtn) return;

		let index = 0;

		function slidesPerView() {
			const w = window.innerWidth;
			if (w <= 800) return 1;
			if (w <= 1100) return 2;
			return 4;
		}

		function maxIndex() {
			const slides = track.children.length;
			const perView = slidesPerView();
			return Math.max(0, slides - perView);
		}

		function stepSize() {
			const first = track.children[0];
			if (!first) return 0;
			const style = getComputedStyle(track);
			const gap = parseFloat(style.columnGap || style.gap || "1.5rem".replace("rem", "")) * 16 || 24;
			return first.getBoundingClientRect().width + gap;
		}

		function update() {
			index = Math.min(index, maxIndex());
			const offset = index * stepSize();
			track.style.transform = `translateX(${-offset}px)`;
			const max = maxIndex();
			prevBtn.disabled = index <= 0;
			nextBtn.disabled = index >= max;
		}

		function step(delta) {
			index = Math.min(Math.max(0, index + delta), maxIndex());
			update();
		}

		prevBtn.addEventListener("click", () => step(-1));
		nextBtn.addEventListener("click", () => step(1));
		let resizeTimer = null;
		window.addEventListener("resize", () => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(update, 120);
		});
		update();
	}

	document.querySelectorAll("[data-carousel]").forEach(initCarousel);

	function initCategoryCarousel(carousel) {
		const viewport = carousel.querySelector("[data-category-viewport]");
		const track = carousel.querySelector("[data-category-track]");
		const prevBtn = carousel.querySelector("[data-category-prev]");
		const nextBtn = carousel.querySelector("[data-category-next]");
		if (!viewport || !track || !prevBtn || !nextBtn) return;

		let index = 0;

		function slidesPerView() {
			const w = window.innerWidth;
			if (w <= 520) return 1;
			if (w <= 800) return 2;
			if (w <= 1100) return 3;
			return 4;
		}

		function maxIndex() {
			const slides = track.children.length;
			const perView = slidesPerView();
			return Math.max(0, slides - perView);
		}

		function stepSize() {
			const first = track.children[0];
			if (!first) return 0;
			const style = getComputedStyle(track);
			const gap = parseFloat(style.columnGap || style.gap || "1.25rem".replace("rem", "")) * 16 || 20;
			return first.getBoundingClientRect().width + gap;
		}

		function update() {
			index = Math.min(index, maxIndex());
			const offset = index * stepSize();
			track.style.transform = `translateX(${-offset}px)`;
			const max = maxIndex();
			prevBtn.disabled = index <= 0;
			nextBtn.disabled = index >= max;
		}

		function step(delta) {
			index = Math.min(Math.max(0, index + delta), maxIndex());
			update();
		}

		prevBtn.addEventListener("click", () => step(-1));
		nextBtn.addEventListener("click", () => step(1));
		let resizeTimer = null;
		window.addEventListener("resize", () => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(update, 120);
		});
		update();
	}

	document.querySelectorAll("[data-category-carousel]").forEach(initCategoryCarousel);

	/* ── Host Your Event - Card Modal ──────────────────────── */
	const HOST_ICON_SVGS = {
		performances: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="40" r="10"></circle><path d="M42 14 L42 44"></path><path d="M42 44 C42 44 44 20 54 18"></path><path d="M49 18 C50 22 47 24 42 24"></path><path d="M30 22 L30 36"></path><path d="M32 24 L32 34"></path><circle cx="24" cy="40" r="3"></circle></svg>`,
		experiences: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 52 L16 34 L24 26 L24 52 Z"></path><path d="M28 52 L28 38 L36 30 L36 52 Z"></path><path d="M40 52 L40 42 L48 34 L48 52 Z"></path><path d="M10 52 L54 52"></path><path d="M20 20 C20 17 22 15 24 15 C26 15 27 16 28 18 C29 16 30 15 32 15 C34 15 36 17 36 20"></path><path d="M22 10 C23 8 25 7 27 8 C29 9 29 11 28 12"></path><path d="M36 10 C37 8 39 7 41 8 C43 9 43 11 42 12"></path></svg>`,
		expositions: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12 L20 52 L48 52 L48 12 Z"></path><path d="M20 12 L34 12 L34 52"></path><path d="M48 12 L34 12"></path><path d="M44 18 L26 18"></path><path d="M44 24 L26 24"></path><path d="M44 30 L26 30"></path><path d="M44 36 L26 36"></path><path d="M44 42 L26 42"></path><path d="M16 56 L52 56"></path><path d="M18 52 L18 56"></path><path d="M50 52 L50 56"></path></svg>`,
		parties: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="36" r="18"></circle><path d="M32 18 L32 8"></path><path d="M30 10 C30 10 32 14 34 10"></path><path d="M46 22 L52 16"></path><path d="M50 18 C51 20 49 21 48 20"></path><path d="M18 22 L12 16"></path><path d="M14 18 C15 20 13 21 12 20"></path><path d="M52 40 L60 36"></path><path d="M56 38 C57 40 55 41 54 40"></path><circle cx="26" cy="32" r="2"></circle><circle cx="38" cy="32" r="2"></circle><path d="M24 40 C24 44 30 48 32 44 C34 48 40 44 40 40"></path><path d="M32 54 L32 58"></path></svg>`,
		sports: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="14" width="36" height="36" rx="4"></rect><path d="M14 32 L50 32"></path><circle cx="32" cy="32" r="8"></circle><path d="M32 14 L32 24"></path><path d="M32 40 L32 50"></path><circle cx="28" cy="30" r="2" fill="currentColor"></circle><circle cx="36" cy="34" r="2" fill="currentColor"></circle></svg>`,
		conferences: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 10 C32 10 22 16 22 26 C22 32 26 36 32 36 C38 36 42 32 42 26 C42 16 32 10 32 10 Z"></path><circle cx="32" cy="50" r="6"></circle><path d="M32 36 L32 44"></path><path d="M22 48 C22 48 18 42 18 38"></path><path d="M42 48 C42 48 46 42 46 38"></path><path d="M14 54 L22 48"></path><path d="M50 54 L42 48"></path></svg>`,
		"sales-marketing": `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 54 L32 22"></path><path d="M22 32 C22 32 28 42 32 42 C36 42 42 32 42 32"></path><path d="M16 22 C16 22 22 38 32 38 C42 38 48 22 48 22"></path><path d="M32 6 L32 14"></path><path d="M26 10 C28 12 28 14 32 14 C36 14 36 12 38 10"></path><path d="M24 52 L40 52 L38 58 L26 58 Z"></path></svg>`,
		pricing: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="10" width="32" height="40" rx="4"></rect><path d="M46 22 L54 18 L54 42 L46 38"></path><path d="M22 20 L22 24"></path><path d="M30 20 L30 24"></path><path d="M38 20 L38 24"></path><path d="M20 30 L40 30"></path><path d="M20 30 C20 24 26 20 30 24 C34 28 28 34 28 34"></path><path d="M28 40 L38 40"></path></svg>`,
		"food-beverages": `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 42 C10 34 16 32 22 32 L42 32 C48 32 54 34 54 42 L54 56 L10 56 Z"></path><path d="M16 32 L16 26 C16 20 20 16 26 16 C28 16 30 17 32 18"></path><path d="M42 12 L42 28"></path><path d="M42 12 C42 12 36 12 36 18 C36 22 40 24 42 24"></path><path d="M42 24 C44 24 48 22 48 18 C48 12 42 12 42 12"></path><path d="M42 32 L42 28"></path><path d="M22 46 L42 46"></path><path d="M10 60 L54 60"></path></svg>`,
		"on-ground": `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 18 C22 14 26 10 32 10 C38 10 42 14 42 18 C42 22 38 26 32 26 C26 26 22 22 22 18 Z"></path><path d="M20 54 L20 42 C20 36 24 34 32 34 C40 34 44 36 44 42 L44 54"></path><path d="M14 58 L50 58"></path><path d="M10 38 L14 40 L20 32"></path><path d="M8 46 L14 44 L20 50"></path><path d="M54 38 L50 40 L44 32"></path><path d="M56 46 L50 44 L44 50"></path></svg>`,
		reports: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="10" width="40" height="44" rx="3"></rect><path d="M20 44 L20 30"></path><path d="M28 44 L28 22"></path><path d="M36 44 L36 34"></path><path d="M44 44 L44 18"></path><path d="M18 50 L46 50"></path></svg>`,
		"pos-rfid": `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="14" width="20" height="34" rx="4"></rect><path d="M24 22 L24 26"></path><path d="M32 22 L32 26"></path><path d="M22 34 L34 34"></path><path d="M22 40 L34 40"></path><path d="M38 32 C44 32 52 30 52 24 C52 18 44 18 44 22"></path><path d="M48 28 C50 30 50 32 48 34"></path></svg>`
	};

	const EXAMPLE_ICON_SVGS = [
		`<svg viewBox="0 0 32 32"><path d="M6 26 L6 14 L14 8 L14 26 Z"/><path d="M16 26 L16 18 L22 14 L22 26 Z"/><path d="M24 26 L24 20 L28 17 L28 26 Z"/><path d="M4 28 L30 28"/></svg>`,
		`<svg viewBox="0 0 32 32"><rect x="8" y="8" width="16" height="20" rx="2"/><path d="M8 8 L16 8 L16 28"/><path d="M11 13 L21 13"/><path d="M11 17 L21 17"/><path d="M11 21 L21 21"/></svg>`,
		`<svg viewBox="0 0 32 32"><circle cx="16" cy="18" r="8"/><path d="M16 10 L16 6"/><path d="M8 10 L5 7"/><path d="M24 10 L27 7"/></svg>`
	];

	function buildExampleItems(examplesStr) {
		const examples = examplesStr ? examplesStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
		if (examples.length === 0) return "";
		return examples.slice(0, 3).map((label, idx) => {
			const svg = EXAMPLE_ICON_SVGS[idx % EXAMPLE_ICON_SVGS.length];
			return `<div class="host-example-item">${svg}<span>${label}</span></div>`;
		}).join("");
	}

	const hostModal = document.querySelector("[data-host-modal]");
	const hostModalTitle = document.querySelector("[data-host-modal-title]");
	const hostModalDescription = document.querySelector("[data-host-modal-description]");
	const hostModalIcon = document.querySelector("[data-host-modal-icon]");
	const hostModalExamples = document.querySelector("[data-host-modal-examples]");

	function openHostModal(card) {
		if (!hostModal) return;
		const title = card.dataset.title || "";
		const description = card.dataset.description || "";
		const iconKey = card.dataset.icon || "";
		const examples = card.dataset.examples || "";

		if (hostModalTitle) hostModalTitle.textContent = title;
		if (hostModalDescription) hostModalDescription.textContent = description;
		if (hostModalIcon) {
			const svg = HOST_ICON_SVGS[iconKey] || "";
			hostModalIcon.innerHTML = svg;
		}
		if (hostModalExamples) {
			hostModalExamples.innerHTML = buildExampleItems(examples);
		}

		hostModal.hidden = false;
		document.body.classList.add("modal-open");
	}

	function closeHostModal() {
		if (!hostModal) return;
		hostModal.hidden = true;
		document.body.classList.remove("modal-open");
	}

	document.querySelectorAll("[data-host-card]").forEach((card) => {
		card.addEventListener("click", () => openHostModal(card));
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openHostModal(card);
			}
		});
	});

	hostModal?.querySelectorAll("[data-host-modal-close]").forEach((btn) => {
		btn.addEventListener("click", closeHostModal);
	});

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && hostModal && !hostModal.hidden) closeHostModal();
	});
});
