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

	async function getWorkingApiBase() {
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.resolveWorkingBaseUrl === "function") {
			return await window.JodHealth.resolveWorkingBaseUrl();
		}
		return getApiBase();
	}

	/* ── Public Auth Helpers ─────────────────────────────── */
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
		const base = await getWorkingApiBase();
		try {
			await fetch(`${base}/api/auth/logout`, {
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

	/* ── Form UI Helpers ──────────────────────────────────── */
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
		if (!alertEl) return;
		alertEl.className = `form-alert is-visible alert-${type}`;
		const msgEl = alertEl.querySelector(".alert-msg");
		if (msgEl) {
			msgEl.textContent = parseApiErrorMessage(msg, "An error occurred.");
		} else {
			alertEl.innerHTML = `<span class="alert-msg">${parseApiErrorMessage(msg, "An error occurred.")}</span>`;
		}
	}
	function hideAlert(alertEl) {
		if (alertEl) alertEl.classList.remove("is-visible");
	}
	function setLoading(btn, loading) {
		if (!btn) return;
		btn.disabled = loading;
		btn.classList.toggle("is-loading", loading);
	}

	/* ── Password Helpers ──────────────────────────────────── */
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

	function initTogglePw(btn, input) {
		if (!btn || !input) return;
		btn.addEventListener("click", () => {
			const isText = input.type === "text";
			input.type = isText ? "password" : "text";
			btn.textContent = isText ? "👁" : "🙈";
			btn.setAttribute("aria-label", isText ? "Show password" : "Hide password");
		});
	}

	/* ── Login Form ────────────────────────────────────────── */
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
					const base = await getWorkingApiBase();
					const res = await fetch(`${base}/api/auth/reset-password`, {
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
				const base = await getWorkingApiBase();
				const body = new URLSearchParams();
				body.append("username", identifier);
				body.append("password", password);

				const res = await fetch(`${base}/api/auth/login`, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body,
				});

				let data = {};
				try { data = await res.json(); } catch (_) {}

				if (!res.ok) {
					showAlert(alertEl, "error", data.detail || `Login failed (${res.status}). Please try again.`);
				} else {
					try {
						const remember = loginForm.querySelector("#rememberMe")?.checked;
						const storage = remember ? localStorage : sessionStorage;
						storage.setItem("jod_access_token", data.access_token);
						storage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) {}

					showAlert(alertEl, "success", "Login successful! Redirecting…");
					try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) {}
					setTimeout(() => { window.location.href = "index.html"; }, 800);
				}
			} catch (err) {
				if (window.JodHealth && typeof window.JodHealth.showFriendlyError === "function") {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							showAlert(alertEl, "success", "Backend server online! Logging in…");
							setTimeout(doLogin, 500);
						},
						onError: () => {
							showAlert(alertEl, "error", "Could not connect to backend server on port 8001.");
						}
					});
				} else {
					showAlert(alertEl, "error", "Network error: Unable to connect to backend server.");
				}
			} finally {
				setLoading(submitBtn, false);
			}
		}

		submitBtn.addEventListener("click", doLogin);

		loginForm.querySelector("#loginPassword").addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); doLogin(); }
		});
		loginForm.querySelector("#loginIdentifier").addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); doLogin(); }
		});
	}

	/* ── Sign Up Form ──────────────────────────────────────── */
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
				const base = await getWorkingApiBase();
				const payload = { username, email, password };
				if (fullName) payload.full_name = fullName;

				const res = await fetch(`${base}/api/auth/register`, {
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
					try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) {}
					setTimeout(() => { window.location.href = "index.html"; }, 800);
				}
			} catch (err) {
				if (window.JodHealth && typeof window.JodHealth.showFriendlyError === "function") {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							showAlert(alertEl, "success", "Backend server online! Registering…");
							setTimeout(doSignup, 500);
						},
						onError: () => {
							showAlert(alertEl, "error", "Could not connect to backend server on port 8001.");
						}
					});
				} else {
					showAlert(alertEl, "error", "Network error: Unable to connect to backend server.");
				}
			} finally {
				setLoading(submitBtn, false);
			}
		}

		submitBtn.addEventListener("click", doSignup);
	}

	/* ── Expose Public API ─────────────────────────────────── */
	return {
		getApiBase,
		getWorkingApiBase,
		getToken,
		getUser,
		isLoggedIn,
		logout,
		clearAuth,
		fetchAuth,
	};
})();
