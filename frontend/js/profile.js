/**
 * profile.js — Profile avatar + dropdown menu
 * Reads user from JodAuth, renders avatar (initials or uploaded photo),
 * handles dropdown open/close, and profile picture persistence via localStorage.
 */
(() => {
	"use strict";

	function avatarKey() {
		if (window.JodAuth && typeof window.JodAuth.avatarCacheKey === "function") {
			return window.JodAuth.avatarCacheKey();
		}
		const user = getUser();
		const id = user && (user.customer_id || user.id || user.email);
		return id ? `jod_profile_avatar_${String(id).toLowerCase()}` : null;
	}

	function getSavedAvatar() {
		try {
			if (window.JodAuth && typeof window.JodAuth.readScopedCache === "function") {
				const cached = window.JodAuth.readScopedCache("jod_profile_avatar");
				if (cached) return cached;
			}
			const key = avatarKey();
			if (key) {
				const local = localStorage.getItem(key);
				if (local) return local;
			}
			const user = getUser();
			const remote = user && user.avatar_url;
			if (remote) return remote;
			return null;
		} catch (_) { return null; }
	}

	function saveAvatar(dataUrl) {
		try {
			if (window.JodAuth && typeof window.JodAuth.writeScopedCache === "function") {
				window.JodAuth.writeScopedCache("jod_profile_avatar", dataUrl);
				return;
			}
			const key = avatarKey();
			if (key) localStorage.setItem(key, dataUrl);
		} catch (_) {}
	}

	function getUser() {
		try {
			if (window.JodAuth && typeof window.JodAuth.getUser === "function") {
				return window.JodAuth.getUser();
			}
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			return raw ? JSON.parse(raw) : null;
		} catch (_) { return null; }
	}

	function isLoggedIn() {
		try {
			if (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function") {
				return window.JodAuth.isLoggedIn();
			}
			return !!(localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));
		} catch (_) { return false; }
	}

	function getInitials(user) {
		if (!user) return "?";
		const name = user.full_name || user.username || "";
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
		return "?";
	}

	/* ── Inject CSS ───────────────────────────────────────────── */
	function injectDropdownCSS() {
		if (document.getElementById("profile-dropdown-style")) return;
		const style = document.createElement("style");
		style.id = "profile-dropdown-style";
		style.textContent = `
/* ── Profile Avatar & Dropdown ───────────────────────────── */
.profile-wrap {
	position: relative;
	display: flex;
	align-items: center;
	gap: .625rem;
}

.profile-avatar-btn {
	display: flex;
	align-items: center;
	gap: .55rem;
	background: none;
	border: none;
	cursor: pointer;
	padding: 0;
	border-radius: 999px;
	transition: opacity .2s;
}
.profile-avatar-btn:hover { opacity: .85; }

.profile-avatar-shell {
	position: relative;
	flex-shrink: 0;
}
.profile-notif-badge {
	position: absolute;
	top: -5px;
	right: -5px;
	min-width: 1.1rem;
	height: 1.1rem;
	padding: 0 .28rem;
	border-radius: 999px;
	background: #ef4444;
	color: #fff;
	font-size: .62rem;
	font-weight: 800;
	line-height: 1;
	display: none;
	align-items: center;
	justify-content: center;
	border: 2px solid #fff;
	box-shadow: 0 2px 6px rgba(239,68,68,.35);
	z-index: 3;
	pointer-events: none;
}
.profile-notif-badge.is-visible { display: inline-flex; }

.profile-avatar {
	width: 2.375rem;
	height: 2.375rem;
	border-radius: 50%;
	background: var(--brand-gradient);
	color: #fff;
	font-family: var(--body);
	font-size: .875rem;
	font-weight: 700;
	letter-spacing: .04em;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 2.5px solid rgba(255,117,8,.35);
	box-shadow: 0 0 0 3px rgba(255,117,8,.12);
	overflow: hidden;
	transition: box-shadow .2s, border-color .2s;
	flex-shrink: 0;
}
.profile-avatar img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}
.profile-avatar-btn:hover .profile-avatar,
.profile-avatar-btn[aria-expanded="true"] .profile-avatar {
	border-color: var(--primary);
	box-shadow: 0 0 0 4px rgba(255,117,8,.22);
}

.profile-name-text {
	font-size: .875rem;
	font-weight: 600;
	color: var(--foreground);
	white-space: nowrap;
	max-width: 120px;
	overflow: hidden;
	text-overflow: ellipsis;
}

.profile-chevron {
	width: 1rem;
	height: 1rem;
	fill: none;
	stroke: var(--muted);
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
	transition: transform .25s ease;
	flex-shrink: 0;
}
.profile-avatar-btn[aria-expanded="true"] .profile-chevron {
	transform: rotate(180deg);
}

/* ── Dropdown Panel ───────────────────────────────────────── */
.profile-dropdown {
	position: absolute;
	top: calc(100% + .75rem);
	right: 0;
	width: 230px;
	background: var(--card);
	border-radius: 16px;
	box-shadow: 0 8px 40px -8px rgba(38,35,31,.22), 0 2px 8px rgba(38,35,31,.06);
	border: 1px solid rgba(38,35,31,.08);
	z-index: 9999;
	overflow: hidden;
	opacity: 0;
	transform: translateY(-8px) scale(.97);
	pointer-events: none;
	transition: opacity .22s ease, transform .22s ease;
}
.profile-dropdown.is-open {
	opacity: 1;
	transform: translateY(0) scale(1);
	pointer-events: auto;
}

.profile-dropdown-header {
	display: flex;
	align-items: center;
	gap: .75rem;
	padding: 1rem 1rem .875rem;
	border-bottom: 1px solid rgba(38,35,31,.07);
	background: linear-gradient(135deg, #fff9f5 0%, #fff 100%);
}
.profile-dropdown-header .profile-avatar {
	width: 2.75rem;
	height: 2.75rem;
	font-size: 1rem;
}
.pd-user-info { min-width: 0; }
.pd-name {
	font-size: .875rem;
	font-weight: 700;
	color: var(--foreground);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.pd-email {
	font-size: .725rem;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.profile-dropdown-menu {
	list-style: none;
	margin: 0;
	padding: .375rem 0;
}
.profile-dropdown-menu li { margin: 0; }

.pd-item {
	display: flex;
	align-items: center;
	gap: .75rem;
	width: 100%;
	padding: .625rem 1rem;
	font-size: .875rem;
	font-weight: 500;
	color: var(--foreground);
	background: none;
	border: none;
	cursor: pointer;
	text-decoration: none;
	transition: background .15s, color .15s;
	text-align: left;
}
.pd-item:hover {
	background: rgba(255,117,8,.07);
	color: var(--primary);
}
.pd-item.is-active {
	background: rgba(255,117,8,.14);
	color: var(--primary);
	font-weight: 700;
	border-left: 3px solid var(--primary);
	padding-left: calc(1rem - 3px);
}
.pd-item.is-active .pd-icon {
	opacity: 1;
	color: var(--primary);
}
.pd-item.is-active:hover {
	background: rgba(255,117,8,.22);
}
.pd-item .pd-icon {
	width: 1.125rem;
	height: 1.125rem;
	flex-shrink: 0;
	opacity: .65;
	transition: opacity .15s;
}
.pd-item:hover .pd-icon { opacity: 1; }

.pd-divider {
	height: 1px;
	background: rgba(38,35,31,.07);
	margin: .375rem 0;
}

.pd-item.pd-logout {
	color: #e53e3e;
}
.pd-item.pd-logout:hover {
	background: rgba(229,62,62,.07);
	color: #c53030;
}
.pd-item.pd-logout .pd-icon { opacity: .75; }

@media (max-width: 800px) {
	.nav-auth:has(.profile-wrap) {
		display: flex !important;
		align-items: center;
		flex-shrink: 0;
		gap: 0;
	}
	.nav-auth .profile-wrap {
		display: flex !important;
		position: relative;
		gap: 0;
	}
	.nav-auth .profile-meta-wrap,
	.nav-auth .profile-name-text,
	.nav-auth .profile-chevron {
		display: none !important;
	}
	.nav-auth .profile-avatar {
		width: 2.1rem;
		height: 2.1rem;
		font-size: .7rem;
	}
	.nav-auth .profile-dropdown {
		right: 0;
		width: min(16.5rem, calc(100vw - 1.25rem));
		z-index: 10050;
	}
}

/* ── Crop Modal Overlay ─────────────────────────────────────── */
.crop-modal-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0,0,0,.75);
	backdrop-filter: blur(8px);
	z-index: 100000;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem;
	opacity: 0;
	pointer-events: none;
	transition: opacity .25s ease;
}
.crop-modal-overlay.is-visible {
	opacity: 1;
	pointer-events: auto;
}
.crop-modal-card {
	background: var(--card);
	border-radius: 20px;
	width: 100%;
	max-width: 360px;
	padding: 1.5rem;
	box-shadow: 0 20px 60px rgba(0,0,0,.3);
	display: flex;
	flex-direction: column;
	gap: 1.125rem;
	align-items: center;
}
.crop-modal-header {
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.crop-modal-title {
	font-size: 1.1rem;
	font-weight: 700;
	color: var(--foreground);
	margin: 0;
}
.crop-modal-close {
	background: none;
	border: none;
	font-size: 1.5rem;
	cursor: pointer;
	color: var(--muted);
	line-height: 1;
}

.crop-canvas-container {
	position: relative;
	width: 280px;
	height: 280px;
	background: #1e1b18;
	border-radius: 16px;
	overflow: hidden;
	cursor: move;
	touch-action: none;
	user-select: none;
	box-shadow: inset 0 0 10px rgba(0,0,0,.5);
}
.crop-canvas-container canvas {
	display: block;
}
.crop-circular-overlay {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	box-shadow: 0 0 0 9999px rgba(0,0,0,.55);
	border: 2px dashed rgba(255,117,8,.85);
	pointer-events: none;
}

.crop-controls {
	width: 100%;
	display: flex;
	align-items: center;
	gap: .625rem;
}
.crop-zoom-btn {
	background: #f4efea;
	border: 1px solid var(--border);
	border-radius: 8px;
	width: 2.125rem;
	height: 2.125rem;
	font-size: 1rem;
	font-weight: 700;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background .2s;
}
.crop-zoom-btn:hover { background: #eae3da; }
.crop-slider {
	flex: 1;
	accent-color: var(--primary);
}

.crop-modal-actions {
	width: 100%;
	display: flex;
	gap: .75rem;
	justify-content: flex-end;
}
`;
		document.head.appendChild(style);
	}

	/* ── Crop Modal Component ─────────────────────────────────── */
	const JodCropModal = (() => {
		let modalEl = null;
		let canvasEl = null;
		let ctx = null;
		let imageObj = null;
		let zoomInput = null;
		let onCropCallback = null;

		let state = {
			scale: 1,
			minScale: 1,
			maxScale: 3,
			rotation: 0,
			posX: 0,
			posY: 0,
			isDragging: false,
			startX: 0,
			startY: 0,
			canvasSize: 280,
		};

		function createModalDOM() {
			if (modalEl) return;
			modalEl = document.createElement("div");
			modalEl.className = "crop-modal-overlay";
			modalEl.innerHTML = `
				<div class="crop-modal-card">
					<div class="crop-modal-header">
						<h3 class="crop-modal-title">Crop Profile Picture</h3>
						<button class="crop-modal-close" id="cropCloseBtn" type="button" aria-label="Close">&times;</button>
					</div>

					<div class="crop-canvas-container" id="cropContainer">
						<canvas id="cropCanvas" width="280" height="280"></canvas>
						<div class="crop-circular-overlay"></div>
					</div>

					<div class="crop-controls">
						<button type="button" class="crop-zoom-btn" id="cropZoomOutBtn" title="Zoom Out">-</button>
						<input type="range" class="crop-slider" id="cropZoomSlider" min="1" max="3" step="0.02" value="1" />
						<button type="button" class="crop-zoom-btn" id="cropZoomInBtn" title="Zoom In">+</button>
						<button type="button" class="crop-zoom-btn" id="cropRotateBtn" title="Rotate 90°" style="font-size:.9rem;">↻</button>
					</div>

					<div class="crop-modal-actions">
						<button type="button" class="button button-sm button-ghost" id="cropCancelBtn">Cancel</button>
						<button type="button" class="button button-sm button-primary" id="cropSaveBtn">Crop & Save</button>
					</div>
				</div>
			`;
			document.body.appendChild(modalEl);

			canvasEl = modalEl.querySelector("#cropCanvas");
			ctx = canvasEl.getContext("2d");
			zoomInput = modalEl.querySelector("#cropZoomSlider");

			modalEl.querySelector("#cropCloseBtn").addEventListener("click", close);
			modalEl.querySelector("#cropCancelBtn").addEventListener("click", close);
			modalEl.querySelector("#cropSaveBtn").addEventListener("click", handleSave);

			modalEl.querySelector("#cropRotateBtn").addEventListener("click", () => {
				state.rotation = (state.rotation + 90) % 360;
				draw();
			});

			zoomInput.addEventListener("input", (e) => {
				state.scale = parseFloat(e.target.value);
				draw();
			});

			modalEl.querySelector("#cropZoomInBtn").addEventListener("click", () => {
				state.scale = Math.min(state.maxScale, state.scale + 0.2);
				zoomInput.value = state.scale;
				draw();
			});

			modalEl.querySelector("#cropZoomOutBtn").addEventListener("click", () => {
				state.scale = Math.max(state.minScale, state.scale - 0.2);
				zoomInput.value = state.scale;
				draw();
			});

			const container = modalEl.querySelector("#cropContainer");

			function startDrag(clientX, clientY) {
				state.isDragging = true;
				state.startX = clientX - state.posX;
				state.startY = clientY - state.posY;
			}
			function moveDrag(clientX, clientY) {
				if (!state.isDragging) return;
				state.posX = clientX - state.startX;
				state.posY = clientY - state.startY;
				draw();
			}
			function stopDrag() {
				state.isDragging = false;
			}

			container.addEventListener("mousedown", (e) => startDrag(e.clientX, e.clientY));
			window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
			window.addEventListener("mouseup", stopDrag);

			container.addEventListener("touchstart", (e) => {
				if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
			}, { passive: true });
			window.addEventListener("touchmove", (e) => {
				if (e.touches.length === 1) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
			}, { passive: true });
			window.addEventListener("touchend", stopDrag);
		}

		function draw() {
			if (!ctx || !imageObj) return;
			const cw = state.canvasSize;
			const ch = state.canvasSize;

			ctx.clearRect(0, 0, cw, ch);
			ctx.save();

			ctx.translate(cw / 2 + state.posX, ch / 2 + state.posY);
			ctx.rotate((state.rotation * Math.PI) / 180);
			ctx.scale(state.scale, state.scale);

			const iw = imageObj.width;
			const ih = imageObj.height;

			ctx.drawImage(imageObj, -iw / 2, -ih / 2, iw, ih);
			ctx.restore();
		}

		function open(fileOrDataUrl, callback) {
			createModalDOM();
			onCropCallback = callback || null;

			const reader = new FileReader();
			const loadImg = (src) => {
				imageObj = new Image();
				imageObj.onload = () => {
					const containerSize = state.canvasSize;
					const minDim = Math.min(imageObj.width, imageObj.height);
					state.minScale = containerSize / minDim;
					state.maxScale = state.minScale * 3.5;
					state.scale = state.minScale * 1.1;
					state.rotation = 0;
					state.posX = 0;
					state.posY = 0;

					zoomInput.min = state.minScale;
					zoomInput.max = state.maxScale;
					zoomInput.step = (state.maxScale - state.minScale) / 100;
					zoomInput.value = state.scale;

					modalEl.classList.add("is-visible");
					draw();
				};
				imageObj.src = src;
			};

			if (typeof fileOrDataUrl === "string") {
				loadImg(fileOrDataUrl);
			} else if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
				reader.onload = (e) => loadImg(e.target.result);
				reader.readAsDataURL(fileOrDataUrl);
			}
		}

		function close() {
			if (modalEl) modalEl.classList.remove("is-visible");
		}

		function handleSave() {
			if (!imageObj) return;

			const outCanvas = document.createElement("canvas");
			const outSize = 300;
			outCanvas.width = outSize;
			outCanvas.height = outSize;
			const outCtx = outCanvas.getContext("2d");

			outCtx.beginPath();
			outCtx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
			outCtx.clip();

			const factor = outSize / state.canvasSize;
			outCtx.translate(outSize / 2 + state.posX * factor, outSize / 2 + state.posY * factor);
			outCtx.rotate((state.rotation * Math.PI) / 180);
			outCtx.scale(state.scale * factor, state.scale * factor);

			outCtx.drawImage(imageObj, -imageObj.width / 2, -imageObj.height / 2, imageObj.width, imageObj.height);

			const croppedDataUrl = outCanvas.toDataURL("image/png");

			if (window.JodProfile && typeof window.JodProfile.setProfilePicture === "function") {
				window.JodProfile.setProfilePicture(croppedDataUrl);
			}
			if (onCropCallback) onCropCallback(croppedDataUrl);

			close();
		}

		return { open, close };
	})();

	/* ── Build avatar element (shared) ───────────────────────── */
	function buildAvatarEl(user) {
		const avatar = document.createElement("div");
		avatar.className = "profile-avatar";
		const savedPhoto = getSavedAvatar();
		if (savedPhoto) {
			const img = document.createElement("img");
			img.src = savedPhoto;
			img.alt = "Profile picture";
			avatar.appendChild(img);
		} else {
			avatar.textContent = getInitials(user);
		}
		return avatar;
	}

	function syncProfileBadge() {
		if (window.JodInbox && typeof window.JodInbox.refresh === "function") {
			window.JodInbox.refresh();
		}
	}

	/* ── Render Profile Widget ────────────────────────────────── */
	function renderProfileWidget(navAuth) {
		const user = getUser();
		if (!user || !isLoggedIn()) return;

		// Prevent duplicate insertion
		if (navAuth.querySelector(".profile-wrap")) return;

		// Hide login/signup buttons
		const loginBtn = navAuth.querySelector("#nav-login-btn") || navAuth.querySelector(".button-login");
		const signupBtn = navAuth.querySelector("#nav-signup-btn") || navAuth.querySelector(".button-primary");
		if (loginBtn) loginBtn.style.display = "none";
		if (signupBtn) signupBtn.style.display = "none";

		// Wrap
		const wrap = document.createElement("div");
		wrap.className = "profile-wrap";

		// Avatar trigger button
		const btn = document.createElement("button");
		btn.className = "profile-avatar-btn";
		btn.setAttribute("aria-haspopup", "true");
		btn.setAttribute("aria-expanded", "false");
		btn.setAttribute("aria-label", "Open profile menu");
		btn.id = "profileAvatarBtn";

		const avatarEl = buildAvatarEl(user);
		const shell = document.createElement("div");
		shell.className = "profile-avatar-shell";
		shell.appendChild(avatarEl);
		const badge = document.createElement("span");
		badge.className = "profile-notif-badge";
		badge.setAttribute("aria-label", "Unread notifications");
		shell.appendChild(badge);
		btn.appendChild(shell);

		const metaWrap = document.createElement("div");
		metaWrap.className = "profile-meta-wrap";
		metaWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;text-align:left;line-height:1.2;min-width:0;";

		const nameSpan = document.createElement("span");
		nameSpan.className = "profile-name-text";
		nameSpan.textContent = user.full_name || user.username || "Profile";
		metaWrap.appendChild(nameSpan);

		btn.appendChild(metaWrap);

		const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		chevron.setAttribute("viewBox", "0 0 24 24");
		chevron.setAttribute("aria-hidden", "true");
		chevron.classList.add("profile-chevron");
		chevron.innerHTML = `<polyline points="6 9 12 15 18 9"/>`;
		btn.appendChild(chevron);

		// Dropdown
		const dropdown = buildDropdown(user);

		wrap.appendChild(btn);
		wrap.appendChild(dropdown);
		navAuth.appendChild(wrap);

		// Toggle
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = dropdown.classList.toggle("is-open");
			btn.setAttribute("aria-expanded", String(open));
		});
		document.addEventListener("click", () => {
			dropdown.classList.remove("is-open");
			btn.setAttribute("aria-expanded", "false");
		});
		dropdown.addEventListener("click", (e) => e.stopPropagation());

		// Keyboard close
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				dropdown.classList.remove("is-open");
				btn.setAttribute("aria-expanded", "false");
				btn.focus();
			}
		});

		syncProfileBadge();
	}

	/* ── Render Mobile Auth Group ────────────────────────────── */
	function renderMobileAuthGroup(mobileGroup) {
		if (!mobileGroup) return;
		if (!isLoggedIn()) {
			mobileGroup.hidden = false;
			return;
		}
		mobileGroup.innerHTML = "";
		mobileGroup.hidden = true;
	}

	/* ── Build Dropdown HTML ──────────────────────────────────── */
	function buildDropdown(user) {
		const d = document.createElement("div");
		d.className = "profile-dropdown";
		d.setAttribute("role", "menu");

		// Header
		const header = document.createElement("div");
		header.className = "profile-dropdown-header";
		const headerAvatar = buildAvatarEl(user);
		header.appendChild(headerAvatar);
		const info = document.createElement("div");
		info.className = "pd-user-info";
		const initialCity = (user && user.city) || (window.JodLocation && typeof window.JodLocation.getCachedCity === "function" ? window.JodLocation.getCachedCity() : null);
		const locText = initialCity ? (initialCity.toLowerCase().includes("india") ? initialCity : `${initialCity}, India`) : null;
		const locHtml = locText ? `<div class="pd-location" style="font-size:.725rem;color:var(--primary);font-weight:600;margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📍 ${escHtml(locText)}</div>` : `<div class="pd-location" style="font-size:.725rem;color:var(--muted);margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📍 Detecting location…</div>`;

		info.innerHTML = `<div class="pd-name">${escHtml(user.full_name || user.username || "User")}</div>
		<div class="pd-email">${escHtml(user.email || "")}</div>
		${locHtml}`;
		header.appendChild(info);
		d.appendChild(header);



		// Menu items
		const menu = document.createElement("ul");
		menu.className = "profile-dropdown-menu";

		const items = [
			{ label: "Dashboard",      href: "dashboard.html",                  icon: dashboardIcon() },
			{ label: "Your Orders",    href: "orders.html",                     icon: ordersIcon() },
			{ label: "Your Wishlist",  href: "wishlist.html",                   icon: wishlistIcon() },
			{ label: "Settings",       href: "settings.html",                   icon: settingsIcon() },
			{ label: "Notifications",  href: "notifications.html",              icon: notificationsIcon() },
			{ label: "Help & Support", href: "help.html",                       icon: helpIcon() },
		];

		function getDropdownActiveState(href) {
			const path = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
			const hash = (window.location.hash || "").toLowerCase();
			const hrefLower = href.toLowerCase();
			const [hrefPath, hrefHash] = hrefLower.split("#");

			if (path !== hrefPath) return false;

			if (hrefHash) {
				return hash === `#${hrefHash}`;
			}

			if (path === "settings.html") {
				return !hash || hash === "#profilesection" || hash === "#profile" || hash === "#securitysection" || hash === "#security";
			}

			return true;
		}

		items.forEach(({ label, href, icon }) => {
			const li = document.createElement("li");
			const a = document.createElement("a");
			a.className = "pd-item";
			if (getDropdownActiveState(href)) {
				a.classList.add("is-active");
			}
			a.href = href;
			a.setAttribute("role", "menuitem");
			a.innerHTML = `<span class="pd-icon">${icon}</span>${escHtml(label)}`;

			a.addEventListener("click", () => {
				menu.querySelectorAll("a.pd-item").forEach(item => item.classList.remove("is-active"));
				a.classList.add("is-active");
			});

			li.appendChild(a);
			menu.appendChild(li);
		});

		window.addEventListener("hashchange", () => {
			menu.querySelectorAll("a.pd-item").forEach((a, idx) => {
				const item = items[idx];
				if (item && getDropdownActiveState(item.href)) {
					a.classList.add("is-active");
				} else {
					a.classList.remove("is-active");
				}
			});
		});

		// Divider
		const div = document.createElement("li");
		div.innerHTML = `<div class="pd-divider"></div>`;
		menu.appendChild(div);

		// Logout
		const logoutLi = document.createElement("li");
		const logoutBtn = document.createElement("button");
		logoutBtn.className = "pd-item pd-logout";
		logoutBtn.setAttribute("type", "button");
		logoutBtn.setAttribute("role", "menuitem");
		logoutBtn.innerHTML = `<span class="pd-icon">${logoutIcon()}</span>Log Out`;
		logoutBtn.addEventListener("click", async () => {
			if (window.JodAuth && typeof window.JodAuth.logout === "function") {
				await window.JodAuth.logout();
			} else {
				try {
					localStorage.removeItem("jod_access_token");
					sessionStorage.removeItem("jod_access_token");
					localStorage.removeItem("jod_user");
					sessionStorage.removeItem("jod_user");
				} catch (_) {}
			}
			window.location.href = "index.html";
		});
		logoutLi.appendChild(logoutBtn);
		menu.appendChild(logoutLi);

		d.appendChild(menu);
		return d;
	}

	function escHtml(str) {
		return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	/* ── SVG Icons ────────────────────────────────────────────── */
	function iconWrap(path) {
		return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
	}
	function dashboardIcon()     { return iconWrap(`<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>`); }
	function ordersIcon()        { return iconWrap(`<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>`); }
	function wishlistIcon()      { return iconWrap(`<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>`); }
	function settingsIcon()      { return iconWrap(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`); }
	function notificationsIcon() { return iconWrap(`<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`); }
	function helpIcon()          { return iconWrap(`<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>`); }
	function logoutIcon()        { return iconWrap(`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`); }

	/* ── Expose Crop Modal globally ───────────────────────────── */
	window.JodCropModal = JodCropModal;

	/* ── Public: refresh all avatars on page ──────────────────── */
	window.JodProfile = {
		init,
		renderProfileWidget,
		renderMobileAuthGroup,
		/**
		 * Upload a new profile picture (called from dashboard or settings).
		 * Accepts a data URL. Updates all avatar elements on the page.
		 */
		setProfilePicture(dataUrl) {
			saveAvatar(dataUrl);
			document.querySelectorAll(".profile-avatar").forEach(el => {
				el.innerHTML = "";
				const img = document.createElement("img");
				img.src = dataUrl;
				img.alt = "Profile picture";
				el.appendChild(img);
			});
		},
		/** Remove profile picture, revert to initials */
		removeProfilePicture() {
			try {
				if (window.JodAuth && typeof window.JodAuth.writeScopedCache === "function") {
					window.JodAuth.writeScopedCache("jod_profile_avatar", null);
				} else {
					const key = avatarKey();
					if (key) localStorage.removeItem(key);
				}
			} catch (_) {}
			const user = getUser();
			document.querySelectorAll(".profile-avatar").forEach(el => {
				el.innerHTML = "";
				el.textContent = getInitials(user);
			});
		},
		getSavedAvatar,
		getInitials: () => getInitials(getUser()),
	};

	/* ── Init: wait for header to be injected ─────────────────── */
	function init() {
		injectDropdownCSS();
		const navAuth = document.querySelector(".nav-auth");
		if (navAuth && isLoggedIn()) {
			renderProfileWidget(navAuth);
		}
		const mobileGroup = document.querySelector(".mobile-auth-group");
		if (mobileGroup && isLoggedIn()) {
			renderMobileAuthGroup(mobileGroup);
		}
		if (window.updateProfileLocation) {
			window.updateProfileLocation();
		}
		ensureInbox();
	}

	function ensureInbox() {
		const run = () => {
			if (window.JodInbox && typeof window.JodInbox.start === "function") window.JodInbox.start();
		};
		if (window.JodInbox) {
			run();
			return;
		}
		if (document.querySelector("script[data-jod-inbox]")) {
			document.querySelector("script[data-jod-inbox]").addEventListener("load", run);
			return;
		}
		const script = document.createElement("script");
		script.src = "js/notifications-inbox.js?v=5";
		script.dataset.jodInbox = "1";
		script.onload = run;
		document.head.appendChild(script);
	}

	// Header is injected via include.js — wait for it
	if (window.includesReady && typeof window.includesReady.then === "function") {
		window.includesReady.then(init);
	} else {
		// Fallback: poll briefly
		let attempts = 0;
		const poll = setInterval(() => {
			attempts++;
			if (document.querySelector(".nav-auth") || attempts > 30) {
				clearInterval(poll);
				init();
			}
		}, 100);
	}
})();
