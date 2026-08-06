window.JodAuth = (() => {
	"use strict";

	/* ── Config ────────────────────────────────────────────── */
	function getApiBase() {
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		const API_PORT = "8001";
		const host = (typeof window !== "undefined" && window.location && window.location.hostname && window.location.hostname !== "localhost") ? window.location.hostname : "127.0.0.1";
		return (window.JOD_API_BASE_OVERRIDE) || `http://${host}:${API_PORT}`;
	}
	const API_BASE = getApiBase();


	/* ── Public Auth Helpers (exposed as window.JodAuth) ──── */
	function getToken() {
		try {
			return localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token") || null;
		} catch (_) { return null; }
	}

	function getUser() {
		try {
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			return raw ? JSON.parse(raw) : null;
		} catch (_) { return null; }
	}

	function isLoggedIn() {
		return Boolean(getToken());
	}

	function clearAuth() {
		try {
			localStorage.removeItem("jod_access_token");
			sessionStorage.removeItem("jod_access_token");
			localStorage.removeItem("jod_user");
			sessionStorage.removeItem("jod_user");
		} catch (_) { }
	}

	function getRedirectTarget() {
		try {
			const params = new URLSearchParams(window.location.search);
			let target = params.get("redirect");
			if (!target) {
				target = sessionStorage.getItem("jod_redirect_after_login");
			}
			if (target) {
				sessionStorage.removeItem("jod_redirect_after_login");
				target = decodeURIComponent(target);
				const isRelative = !target.includes("://") || target.startsWith(window.location.origin);
				if (isRelative && !target.includes("login.html") && !target.includes("signup.html")) {
					return target;
				}
			}
		} catch (_) {}
		return "index.html";
	}

	async function validateSession() {
		const token = getToken();
		if (!token) return null;
		try {
			const res = await fetchAuth(`${API_BASE}/api/auth/me`);
			if (res.ok) {
				const user = await res.json();
				const isRemembered = Boolean(localStorage.getItem("jod_access_token"));
				const storage = isRemembered ? localStorage : sessionStorage;
				storage.setItem("jod_user", JSON.stringify(user));
				return user;
			} else if (res.status === 401 || res.status === 403) {
				clearAuth();
				return null;
			}
		} catch (_) {}
		return getUser();
	}

	async function logout() {
		const token = getToken();
		try {
			await fetch(`${API_BASE}/api/auth/logout`, {
				method: "POST",
				headers: token ? { "Authorization": `Bearer ${token}` } : {},
			}).catch(() => { });
		} finally {
			clearAuth();
		}
	}

	async function fetchAuth(url, options = {}) {
		const token = getToken();
		const headers = Object.assign({}, options.headers || {});
		if (token) headers["Authorization"] = `Bearer ${token}`;
		const res = await fetch(url, Object.assign({}, options, { headers }));
		if (res.status === 401) {
			clearAuth();
		}
		return res;
	}

	/* ── Helpers ───────────────────────────────────────────── */
	function $(sel, ctx = document) { return ctx.querySelector(sel); }
	function setError(input, msg) {
		const wrap = input.closest(".form-group") || input.closest(".input-wrap")?.parentElement;
		if (!wrap) return;
		const err = wrap.querySelector(".field-error");
		if (err) { err.textContent = msg; err.classList.toggle("is-visible", Boolean(msg)); }
		input.classList.toggle("has-error", Boolean(msg));
	}
	function clearErrors(form) {
		form.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; el.classList.remove("is-visible"); });
		form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
	}
	function parseApiErrorMessage(detail, fallbackMsg) {
		if (!detail) return fallbackMsg || "An error occurred.";
		if (typeof detail === "string") return detail;
		if (Array.isArray(detail)) {
			const msgs = detail.map((err) => {
				if (typeof err === "string") return err;
				if (err && typeof err === "object") {
					const msg = err.msg || err.message || JSON.stringify(err);
					return msg.replace(/^Value error,\s*/i, "");
				}
				return String(err);
			});
			return msgs.join(" | ");
		}
		if (typeof detail === "object") {
			if (detail.msg) return detail.msg.replace(/^Value error,\s*/i, "");
			if (detail.message) return detail.message;
			return JSON.stringify(detail);
		}
		return String(detail);
	}

	function showAlert(alertEl, type, msg) {
		alertEl.className = `form-alert is-visible alert-${type}`;
		alertEl.querySelector(".alert-msg").textContent = parseApiErrorMessage(msg, "An error occurred.");
	}
	function hideAlert(alertEl) {
		alertEl.classList.remove("is-visible");
	}
	function setLoading(btn, loading) {
		btn.disabled = loading;
		btn.classList.toggle("is-loading", loading);
	}

	/* ── Password strength ─────────────────────────────────── */
	function calcStrength(pw) {
		let s = 0;
		if (pw.length >= 8) s++;
		if (/[A-Z]/.test(pw)) s++;
		if (/[0-9]/.test(pw)) s++;
		if (/[^A-Za-z0-9]/.test(pw)) s++;
		return s;
	}
	const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];

	function initPasswordStrength(pwInput, barEl, labelEl) {
		if (!pwInput || !barEl || !labelEl) return;
		pwInput.addEventListener("input", () => {
			const s = pwInput.value ? calcStrength(pwInput.value) : 0;
			barEl.className = "pw-strength-bar" + (s ? ` strength-${s}` : "");
			labelEl.textContent = s ? strengthLabels[s] : "";
		});
	}

	/* ── Password visibility toggle ────────────────────────── */
	function initTogglePw(btn, input) {
		if (!btn || !input) return;
		btn.addEventListener("click", () => {
			const isText = input.type === "text";
			input.type = isText ? "password" : "text";
			btn.textContent = isText ? "👁" : "🙈";
			btn.setAttribute("aria-label", isText ? "Show password" : "Hide password");
		});
	}

	/* ── Login form ────────────────────────────────────────── */
	const loginForm = document.getElementById("loginForm");
	if (loginForm) {
		const alertEl = loginForm.querySelector(".form-alert");
		const submitBtn = loginForm.querySelector("#loginSubmit");

		initTogglePw(loginForm.querySelector("#toggleLoginPw"), loginForm.querySelector("#loginPassword"));

		const forgotLink = loginForm.querySelector(".forgot-link");
		if (forgotLink) {
			forgotLink.addEventListener("click", async (e) => {
				e.preventDefault();
				const email = prompt("Enter your account email address to reset password:");
				if (!email) return;
				const newPassword = prompt("Enter your new password (min. 8 characters, with letters & numbers):");
				if (!newPassword) return;

				try {
					const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email: email.trim(), new_password: newPassword }),
					});
					const data = await res.json();
					if (res.ok) {
						showAlert(alertEl, "success", data.message || "Password updated successfully! You can now log in.");
					} else {
						showAlert(alertEl, "error", data.detail || "Could not reset password.");
					}
				} catch (_) {
					showAlert(alertEl, "error", "Network error while resetting password.");
				}
			});
		}

		async function doLogin() {
			clearErrors(loginForm);
			hideAlert(alertEl);

			const identifier = loginForm.querySelector("#loginIdentifier").value.trim();
			const password = loginForm.querySelector("#loginPassword").value;
			let valid = true;

			if (!identifier) { setError(loginForm.querySelector("#loginIdentifier"), "Email or username is required."); valid = false; }
			if (!password) { setError(loginForm.querySelector("#loginPassword"), "Password is required."); valid = false; }
			if (!valid) return;

			setLoading(submitBtn, true);

			try {
				// FastAPI OAuth2PasswordRequestForm expects form-encoded body
				const body = new URLSearchParams();
				body.append("username", identifier);
				body.append("password", password);

				const res = await fetch(`${API_BASE}/api/auth/login`, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body,
				});

				let data = {};
				try { data = await res.json(); } catch (_) { }

				if (!res.ok) {
					showAlert(alertEl, "error", data.detail || `Login failed (${res.status}). Please try again.`);
				} else {
					// Store token
					try {
						const remember = loginForm.querySelector("#rememberMe")?.checked;
						const storage = remember ? localStorage : sessionStorage;
						storage.setItem("jod_access_token", data.access_token);
						storage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) { }

					showAlert(alertEl, "success", "Login successful! Redirecting…");
					// Defer location flow to homepage (GPS needs time + secure context)
					try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) { }
					const targetUrl = getRedirectTarget();
					setTimeout(() => { window.location.href = targetUrl; }, 900);
				}
			} catch (err) {
				if (window.JodHealth && typeof window.JodHealth.showFriendlyError === "function") {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							showAlert(alertEl, "success", "Backend server is online! Retrying login…");
							setTimeout(doLogin, 600);
						},
						onError: () => {
							showAlert(alertEl, "error", "Could not connect to server. Please ensure the backend is running on port 8001.");
						}
					});
				} else {
					showAlert(alertEl, "error", "Network error: Unable to connect to backend server at " + API_BASE);
				}
			} finally {
				setLoading(submitBtn, false);
			}
		}

		// Proactive page-load health check for login form
		if (window.JodHealth) {
			window.JodHealth.checkBackendHealth().then((isOnline) => {
				if (!isOnline) {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							hideAlert(alertEl);
						}
					});
				}
			});
		}


		// Click handler on the button (type="button") — never triggers form submit
		submitBtn.addEventListener("click", doLogin);

		// Also handle Enter key in the password field
		loginForm.querySelector("#loginPassword").addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); doLogin(); }
		});
		loginForm.querySelector("#loginIdentifier").addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); doLogin(); }
		});
	}

	/* ── Sign Up form ──────────────────────────────────────── */
	const signupForm = document.getElementById("signupForm");
	if (signupForm) {
		const alertEl = signupForm.querySelector(".form-alert");
		const submitBtn = signupForm.querySelector("#signupSubmit");

		initPasswordStrength(
			signupForm.querySelector("#signupPassword"),
			signupForm.querySelector(".pw-strength-bar"),
			signupForm.querySelector(".pw-strength-label")
		);
		initTogglePw(signupForm.querySelector("#toggleSignupPw"), signupForm.querySelector("#signupPassword"));
		initTogglePw(signupForm.querySelector("#toggleConfirmPw"), signupForm.querySelector("#signupConfirmPassword"));

		async function doSignup() {
			clearErrors(signupForm);
			hideAlert(alertEl);

			const fullName = signupForm.querySelector("#signupFullName").value.trim();
			const username = signupForm.querySelector("#signupUsername").value.trim();
			const email = signupForm.querySelector("#signupEmail").value.trim();
			const password = signupForm.querySelector("#signupPassword").value;
			const confirm = signupForm.querySelector("#signupConfirmPassword").value;
			let valid = true;

			if (!username) { setError(signupForm.querySelector("#signupUsername"), "Username is required."); valid = false; }
			else if (username.length < 3) { setError(signupForm.querySelector("#signupUsername"), "Username must be at least 3 characters."); valid = false; }

			if (!email) { setError(signupForm.querySelector("#signupEmail"), "Email is required."); valid = false; }
			else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(signupForm.querySelector("#signupEmail"), "Enter a valid email address."); valid = false; }

			if (!password) { setError(signupForm.querySelector("#signupPassword"), "Password is required."); valid = false; }
			else if (password.length < 8) { setError(signupForm.querySelector("#signupPassword"), "Password must be at least 8 characters."); valid = false; }

			if (!confirm) { setError(signupForm.querySelector("#signupConfirmPassword"), "Please confirm your password."); valid = false; }
			else if (password !== confirm) { setError(signupForm.querySelector("#signupConfirmPassword"), "Passwords do not match."); valid = false; }

			if (!valid) return;

			setLoading(submitBtn, true);

			try {
				const payload = { username, email, password };
				if (fullName) payload.full_name = fullName;

				const res = await fetch(`${API_BASE}/api/auth/register`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});

				let data = {};
				try { data = await res.json(); } catch (_) { }

				if (!res.ok) {
					showAlert(alertEl, "error", data.detail || `Registration failed (${res.status}). Please try again.`);
				} else {
					try {
						sessionStorage.setItem("jod_access_token", data.access_token);
						sessionStorage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) { }

					showAlert(alertEl, "success", "Account created! Redirecting…");
					try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) { }
					const targetUrl = getRedirectTarget();
					setTimeout(() => { window.location.href = targetUrl; }, 900);
				}
			} catch (err) {
				if (window.JodHealth && typeof window.JodHealth.showFriendlyError === "function") {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							showAlert(alertEl, "success", "Backend server is online! Retrying signup…");
							setTimeout(doSignup, 600);
						},
						onError: () => {
							showAlert(alertEl, "error", "Could not connect to server. Please ensure the backend is running on port 8001.");
						}
					});
				} else {
					showAlert(alertEl, "error", "Network error: Unable to connect to backend server at " + API_BASE);
				}
			} finally {
				setLoading(submitBtn, false);
			}
		}

		// Proactive page-load health check for signup form
		if (window.JodHealth) {
			window.JodHealth.checkBackendHealth().then((isOnline) => {
				if (!isOnline) {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							hideAlert(alertEl);
						}
					});
				}
			});
		}

		// Click handler on button (type="button") — decoupled from form submit entirely
		submitBtn.addEventListener("click", doSignup);
	}


	// Auto-redirect if already logged in on login or signup page
	const pageFile = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
	if ((pageFile === "login.html" || pageFile === "signup.html") && isLoggedIn()) {
		const targetUrl = getRedirectTarget();
		if (targetUrl && targetUrl !== pageFile) {
			window.location.href = targetUrl;
		}
	}

	/* ── Expose Public API ─────────────────────────────────── */
	return {
		API_BASE,
		getToken,
		getUser,
		isLoggedIn,
		logout,
		clearAuth,
		fetchAuth,
		getRedirectTarget,
		validateSession,
	};
})();
