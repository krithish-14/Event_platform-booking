
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

(window.includesReady || Promise.resolve()).then(() => {
	"use strict";

	/* ── Auth state in header ──────────────────────────────── */
	const Auth = window.JodAuth || {
		isLoggedIn: () => false,
		getUser: () => null,
		logout: async () => {},
	};

	function updateNavAuth() {
		const desktopGroup = document.querySelector(".nav-auth");
		const mobileGroup = document.querySelector(".mobile-auth-group");
		if (!desktopGroup && !mobileGroup) return;

		if (Auth.isLoggedIn()) {
			if (window.JodProfile) {
				if (desktopGroup) window.JodProfile.renderProfileWidget(desktopGroup);
				if (mobileGroup) window.JodProfile.renderMobileAuthGroup(mobileGroup);
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

	async function onLogoutClick(e) {
		e.preventDefault();
		try { await Auth.logout(); } catch (_) {}
		applyAuthVisibility(false);
		window.location.href = "index.html";
	}

	function applyAuthVisibility(authenticatedOverride) {
		const isAuth = typeof authenticatedOverride === "boolean"
			? authenticatedOverride
			: (Auth.isLoggedIn && Auth.isLoggedIn());
		const body = document.body;
		if (!body) return;
		body.setAttribute("data-user", isAuth ? "authenticated" : "guest");
		body.classList.add("is-auth-ready");
	}

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
});
