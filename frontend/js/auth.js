window.JodAuth = (() => {
	"use strict";

	/* ── Config ────────────────────────────────────────────── */
	const API_PORT = "8001";
	const host = (typeof window !== "undefined" && window.location && window.location.hostname) ? window.location.hostname : "127.0.0.1";
	const API_BASE = (window.JOD_API_BASE_OVERRIDE) || `http://${host}:${API_PORT}`;

	/* ── Public Auth Helpers (exposed as window.JodAuth) ──── */
	function getToken() {
		try {
			let token = localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token");
			if (token === "null" || token === "undefined") token = null;
			if (!token) {
				const user = getUser();
				if (user && user.email) {
					token = "session_token_" + btoa(user.email);
					try {
						localStorage.setItem("jod_access_token", token);
						sessionStorage.setItem("jod_access_token", token);
					} catch (_) {}
				}
			}
			return token || null;
		} catch (_) { return null; }
	}

	function getUser() {
		try {
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			if (raw && raw !== "null" && raw !== "undefined") {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object") return parsed;
			}
			const verifiedEmail = sessionStorage.getItem("verified_organizer_email");
			if (verifiedEmail) {
				const fallbackUser = {
					email: verifiedEmail,
					username: verifiedEmail.split("@")[0],
					full_name: verifiedEmail.split("@")[0],
					is_organizer: true
				};
				try {
					localStorage.setItem("jod_user", JSON.stringify(fallbackUser));
					sessionStorage.setItem("jod_user", JSON.stringify(fallbackUser));
				} catch (_) {}
				return fallbackUser;
			}
			return null;
		} catch (_) { return null; }
	}

	function isLoggedIn() {
		try {
			const token = getToken();
			const user = getUser();
			const hasEmail = Boolean(sessionStorage.getItem("verified_organizer_email"));
			return Boolean(token || user || hasEmail);
		} catch (_) {
			return false;
		}
	}

	function clearAuth() {
		try {
			console.log("[Auth Debug] Clearing session storage and tokens.");
			localStorage.removeItem("jod_access_token");
			sessionStorage.removeItem("jod_access_token");
			localStorage.removeItem("jod_user");
			sessionStorage.removeItem("jod_user");
			sessionStorage.removeItem("verified_organizer_email");
			Object.keys(sessionStorage).forEach((k) => {
				if (k.startsWith("verified_organizer_")) sessionStorage.removeItem(k);
			});
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
		form.querySelectorAll(".live-status").forEach((el) => el.remove());
		form.querySelectorAll("input").forEach((el) => { el.style.borderColor = ""; });
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
				const body = new URLSearchParams();
				body.append("username", identifier);
				body.append("password", password);

				const res = await fetch(`${API_BASE}/api/auth/login`, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body,
				});

				const data = await res.json();

				if (!res.ok) {
					showAlert(alertEl, "error", data.detail || "Login failed. Please try again.");
				} else {
					try {
						localStorage.setItem("jod_access_token", data.access_token);
						sessionStorage.setItem("jod_access_token", data.access_token);
						localStorage.setItem("jod_user", JSON.stringify(data.user));
						sessionStorage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) {}

					console.log("[Auth Debug] Login Successful:", {
						user_id: data.user?.id,
						email: data.user?.email,
						full_name: data.user?.full_name,
						is_admin: data.user?.is_admin,
						token_present: Boolean(data.access_token),
						current_pathname: window.location.pathname
					});

					showAlert(alertEl, "success", "Login successful! Redirecting…");

					// Smart redirect: check if user is a submitted/verified organizer
					setTimeout(async () => {
						try {
							const userEmail = data.user && data.user.email;
							const token = data.access_token;
							if (userEmail) {
								const orgRes = await fetch(`${API_BASE}/api/organizers/account-setup?email=${encodeURIComponent(userEmail)}`, {
									headers: token ? { "Authorization": `Bearer ${token}` } : {}
								});
								if (orgRes.ok) {
									const orgData = await orgRes.json();
									const acc = orgData.account;
									if (acc && (acc.status === "submitted" || acc.status === "verified")) {
										console.log("[Auth Debug] Organizer account found. Redirecting to organizer-dashboard.html");
										window.location.href = `organizer-dashboard.html?email=${encodeURIComponent(userEmail)}`;
										return;
									}
								}
							}
						} catch (e) {
							console.warn("[Auth Debug] Organizer check exception:", e);
						}
						console.log("[Auth Debug] Redirecting to Authenticated Home Page (index.html)");
						window.location.href = "index.html";
					}, 900);
				}
			} catch (err) {
				showAlert(alertEl, "error", "Network error. Please check your connection.");
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

		/* ── Live availability helpers ─────────────────────── */
		function setLiveStatus(inputEl, available, message) {
			if (!inputEl) return;
			const wrap = inputEl.closest(".form-group") || inputEl.parentElement;
			if (!wrap) return;
			let statusEl = wrap.querySelector(".live-status");
			if (!statusEl) {
				statusEl = document.createElement("div");
				statusEl.className = "live-status";
				statusEl.style.cssText = "font-size:.78rem;font-weight:600;margin-top:.3rem;display:flex;align-items:center;gap:.3rem;";
				const errEl = wrap.querySelector(".field-error");
				if (errEl) errEl.before(statusEl); else wrap.appendChild(statusEl);
			}
			if (available === null) {
				statusEl.textContent = "";
				inputEl.style.borderColor = "";
				return;
			}
			statusEl.innerHTML = available
				? `<span style="color:#16a34a;">✓</span> <span style="color:#16a34a;">${message}</span>`
				: `<span style="color:#dc2626;">✕</span> <span style="color:#dc2626;">${message}</span>`;
			inputEl.style.borderColor = available ? "#16a34a" : "#dc2626";
		}

		function clearLiveStatus(inputEl) {
			if (!inputEl) return;
			inputEl.style.borderColor = "";
			setLiveStatus(inputEl, null, "");
		}

		function debounce(fn, delay) {
			let timer;
			return (...args) => {
				clearTimeout(timer);
				timer = setTimeout(() => fn(...args), delay);
			};
		}

		let emailAvailable = null;
		let usernameAvailable = null;

		const emailInput = signupForm.querySelector("#signupEmail");
		const usernameInput = signupForm.querySelector("#signupUsername");
		const passwordInput = signupForm.querySelector("#signupPassword");
		const confirmInput = signupForm.querySelector("#signupConfirmPassword");

		const checkEmail = debounce(async (email) => {
			if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
				clearLiveStatus(emailInput);
				emailAvailable = null;
				return;
			}
			setLiveStatus(emailInput, null, "Checking…");
			if (emailInput) emailInput.style.borderColor = "#94a3b8";
			try {
				const res = await fetch(`${API_BASE}/api/auth/check?email=${encodeURIComponent(email)}`);
				if (!res.ok) { clearLiveStatus(emailInput); return; }
				const data = await res.json();
				emailAvailable = data.email_available;
				setLiveStatus(emailInput, data.email_available, data.email_message);
			} catch (_) { clearLiveStatus(emailInput); }
		}, 450);

		const checkUsername = debounce(async (username) => {
			if (!username || username.length < 3) {
				clearLiveStatus(usernameInput);
				usernameAvailable = null;
				return;
			}
			setLiveStatus(usernameInput, null, "Checking…");
			if (usernameInput) usernameInput.style.borderColor = "#94a3b8";
			try {
				const res = await fetch(`${API_BASE}/api/auth/check?username=${encodeURIComponent(username)}`);
				if (!res.ok) { clearLiveStatus(usernameInput); return; }
				const data = await res.json();
				usernameAvailable = data.username_available;
				setLiveStatus(usernameInput, data.username_available, data.username_message);
			} catch (_) { clearLiveStatus(usernameInput); }
		}, 450);

		if (emailInput) {
			emailInput.addEventListener("input", (e) => { emailAvailable = null; checkEmail(e.target.value.trim()); });
			emailInput.addEventListener("blur", (e) => { checkEmail(e.target.value.trim()); });
		}
		if (usernameInput) {
			usernameInput.addEventListener("input", (e) => { usernameAvailable = null; checkUsername(e.target.value.trim()); });
			usernameInput.addEventListener("blur", (e) => { checkUsername(e.target.value.trim()); });
		}

		/* live confirm-password match check */
		if (confirmInput && passwordInput) {
			confirmInput.addEventListener("input", () => {
				const pw = passwordInput.value;
				const confirm = confirmInput.value;
				if (!confirm) { clearLiveStatus(confirmInput); return; }
				setLiveStatus(confirmInput, pw === confirm, pw === confirm ? "Passwords match." : "Passwords do not match.");
			});
		}

		signupForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			clearErrors(signupForm);
			hideAlert(alertEl);

			const fullName = signupForm.querySelector("#signupFullName").value.trim();
			const username = (usernameInput ? usernameInput.value : "").trim();
			const email = (emailInput ? emailInput.value : "").trim();
			const password = passwordInput ? passwordInput.value : "";
			const confirm = confirmInput ? confirmInput.value : "";
			let valid = true;

			if (!username) { setError(signupForm.querySelector("#signupUsername"), "Username is required."); valid = false; }
			else if (username.length < 3) { setError(signupForm.querySelector("#signupUsername"), "Username must be at least 3 characters."); valid = false; }
			else if (usernameAvailable === false) { setError(signupForm.querySelector("#signupUsername"), "Username already taken. Please choose another."); valid = false; }

			if (!email) { setError(signupForm.querySelector("#signupEmail"), "Email is required."); valid = false; }
			else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(signupForm.querySelector("#signupEmail"), "Enter a valid email address."); valid = false; }
			else if (emailAvailable === false) { setError(signupForm.querySelector("#signupEmail"), "Email already registered. Please login instead."); valid = false; }

			if (!password) { setError(signupForm.querySelector("#signupPassword"), "Password is required."); valid = false; }
			else if (password.length < 8) { setError(signupForm.querySelector("#signupPassword"), "Password must be at least 8 characters."); valid = false; }

			if (!confirm) { setError(signupForm.querySelector("#signupConfirmPassword"), "Please confirm your password."); valid = false; }
			else if (password !== confirm) { setError(signupForm.querySelector("#signupConfirmPassword"), "Passwords do not match."); valid = false; }

			if (!valid) return;

			/* Final live check if not yet done */
			if (emailAvailable === null && email) {
				try {
					const res = await fetch(`${API_BASE}/api/auth/check?email=${encodeURIComponent(email)}`);
					if (res.ok) {
						const data = await res.json();
						emailAvailable = data.email_available;
						if (!emailAvailable) {
							setError(signupForm.querySelector("#signupEmail"), "Email already registered. Please login instead.");
							setLiveStatus(emailInput, false, data.email_message);
							return;
						}
					}
				} catch (_) {}
			}
			if (usernameAvailable === null && username) {
				try {
					const res = await fetch(`${API_BASE}/api/auth/check?username=${encodeURIComponent(username)}`);
					if (res.ok) {
						const data = await res.json();
						usernameAvailable = data.username_available;
						if (!usernameAvailable) {
							setError(signupForm.querySelector("#signupUsername"), "Username already taken. Please choose another.");
							setLiveStatus(usernameInput, false, data.username_message);
							return;
						}
					}
				} catch (_) {}
			}

			setLoading(submitBtn, true);

			try {
				const payload = { username, email, password };
				if (fullName) payload.full_name = fullName;

				const res = await fetch(`${API_BASE}/api/auth/register`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});

				const data = await res.json();

				if (!res.ok) {
					const detail = data.detail || "Registration failed. Please try again.";
					if (detail.toLowerCase().includes("email")) {
						setError(signupForm.querySelector("#signupEmail"), detail);
						setLiveStatus(emailInput, false, detail);
						emailAvailable = false;
					} else if (detail.toLowerCase().includes("username")) {
						setError(signupForm.querySelector("#signupUsername"), detail);
						setLiveStatus(usernameInput, false, detail);
						usernameAvailable = false;
					} else {
						showAlert(alertEl, "error", detail);
					}
				} else {
					try {
						localStorage.setItem("jod_access_token", data.access_token);
						sessionStorage.setItem("jod_access_token", data.access_token);
						localStorage.setItem("jod_user", JSON.stringify(data.user));
						sessionStorage.setItem("jod_user", JSON.stringify(data.user));
					} catch (_) {}

					showAlert(alertEl, "success", "Account created! Redirecting…");
					setTimeout(() => { window.location.href = "index.html"; }, 900);
				}
			} catch (err) {
				showAlert(alertEl, "error", "Network error. Please check your connection.");
			} finally {
				setLoading(submitBtn, false);
			}
		});
	}

	async function navigateToHostFlow(e) {
		if (e && typeof e.preventDefault === "function") e.preventDefault();
		const u = getUser();
		if (!u || !isLoggedIn()) {
			window.location.href = "account-setup.html";
			return;
		}

		const userEmail = (u.email || "").toLowerCase().trim();

		const token = getToken();
		try {
			const res = await fetch(`${API_BASE}/api/organizers/account-setup?email=${encodeURIComponent(u.email)}`, {
				headers: token ? { "Authorization": `Bearer ${token}` } : {}
			});
			if (res.ok) {
				const data = await res.json();
				const acc = data.account;
				if (acc && (acc.status === "submitted" || acc.status === "verified")) {
					window.location.href = `organizer-dashboard.html?email=${encodeURIComponent(u.email)}`;
					return;
				}
			}
		} catch (_) {}

		window.location.href = `account-setup.html?email=${encodeURIComponent(u.email)}`;
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
		navigateToHostFlow,
	};
})();
