window.JodAuth = (() => {
	"use strict";

	/* ── Config ────────────────────────────────────────────── */
	const API_PORT = "8001";
	const host = (typeof window !== "undefined" && window.location && window.location.hostname && window.location.hostname !== "localhost") ? window.location.hostname : "127.0.0.1";
	const API_BASE = (window.JOD_API_BASE_OVERRIDE) || `http://${host}:${API_PORT}`;

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
		} catch (_) {}
	}

	async function logout() {
		const token = getToken();
		try {
			await fetch(`${API_BASE}/api/auth/logout`, {
				method: "POST",
				headers: token ? { "Authorization": `Bearer ${token}` } : {},
			}).catch(() => {});
		} finally {
			clearAuth();
		}
	}

	async function fetchAuth(url, options = {}) {
		const token = getToken();
		const headers = Object.assign({}, options.headers || {});
		if (token) headers["Authorization"] = `Bearer ${token}`;
		return fetch(url, Object.assign({}, options, { headers }));
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
	function showAlert(alertEl, type, msg) {
		alertEl.className = `form-alert is-visible alert-${type}`;
		alertEl.querySelector(".alert-msg").textContent = msg;
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

		loginForm.addEventListener("submit", async (e) => {
			e.preventDefault();
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
				try { data = await res.json(); } catch (_) {}

				if (!res.ok) {
					showAlert(alertEl, "error", data.detail || `Login failed (${res.status}). Please try again.`);
				} else {
					// Store token
					try {
						const remember = loginForm.querySelector("#rememberMe")?.checked;
						const storage = remember ? localStorage : sessionStorage;
						storage.setItem("jod_access_token", data.access_token);
						storage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) {}

					showAlert(alertEl, "success", "Login successful! Redirecting…");
					setTimeout(() => { window.location.href = "index.html"; }, 900);
				}
			} catch (err) {
				showAlert(alertEl, "error", "Network error: Unable to connect to backend server at " + API_BASE);
			} finally {
				setLoading(submitBtn, false);
			}
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

		signupForm.addEventListener("submit", async (e) => {
			e.preventDefault();
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
				try { data = await res.json(); } catch (_) {}

				if (!res.ok) {
					showAlert(alertEl, "error", data.detail || `Registration failed (${res.status}). Please try again.`);
				} else {
					try {
						sessionStorage.setItem("jod_access_token", data.access_token);
						sessionStorage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) {}

					showAlert(alertEl, "success", "Account created! Redirecting…");
					setTimeout(() => { window.location.href = "index.html"; }, 900);
				}
			} catch (err) {
				showAlert(alertEl, "error", "Network error: Unable to connect to backend server at " + API_BASE);
			} finally {
				setLoading(submitBtn, false);
			}
		});
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
	};
})();
