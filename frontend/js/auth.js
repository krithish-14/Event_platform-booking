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
			let token = localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token");
			if (token === "null" || token === "undefined") token = null;
			return token || null;
		} catch (_) { return null; }
	}

	function getUser() {
		try {
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			if (raw && raw !== "null" && raw !== "undefined") {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object" && (parsed.email || parsed.id || parsed.customer_id)) {
					return parsed;
				}
			}
			const verifiedEmail = sessionStorage.getItem("verified_organizer_email");
			if (verifiedEmail) {
				const fallbackUser = {
					email: verifiedEmail,
					username: verifiedEmail.split("@")[0],
					full_name: verifiedEmail.split("@")[0],
					is_organizer: true
				};
				return fallbackUser;
			}
			return null;
		} catch (_) { return null; }
	}

	function isLoggedIn() {
		try {
			const user = getUser();
			const token = getToken();
			if (user && (user.id || user.customer_id || user.email)) return true;
			if (token && token !== "null" && token !== "undefined" && token.length > 5) return true;
			return false;
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
			if (window.JodLocation && typeof window.JodLocation.clearLocationSession === "function") {
				window.JodLocation.clearLocationSession();
			} else {
				try {
					sessionStorage.removeItem("jod_location_asked");
					sessionStorage.removeItem("jod_location_acquired");
					sessionStorage.removeItem("jod_user_city");
				} catch (_) {}
			}
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

	function hasHostPayoutBank(acc) {
		if (!acc) return false;
		return Boolean(
			String(acc.beneficiary_name || "").trim() &&
			String(acc.bank_name || "").trim() &&
			String(acc.account_number || "").trim() &&
			String(acc.bank_ifsc || "").trim()
		);
	}

	function isHostFlowUrl(url) {
		const u = String(url || "").toLowerCase();
		return u.includes("account-setup") || u.includes("host-your-event") || u.includes("organizer-dashboard");
	}

	async function fetchOrganizerAccount() {
		const token = getToken();
		const user = getUser();
		const email = user && user.email;
		try {
			const qs = email ? `?email=${encodeURIComponent(email)}` : "";
			const res = await fetch(`${API_BASE}/api/organizers/account-setup${qs}`, {
				headers: token ? { "Authorization": `Bearer ${token}` } : {}
			});
			if (!res.ok) return null;
			const data = await res.json();
			return data.account || null;
		} catch (_) {
			return null;
		}
	}

	async function resolvePostAuthDestination(preferredUrl) {
		const preferred = preferredUrl || "index.html";
		if (!isHostFlowUrl(preferred)) {
			return preferred;
		}
		const acc = await fetchOrganizerAccount();
		if (hasHostPayoutBank(acc)) {
			return "organizer-dashboard.html";
		}
		return "account-setup.html";
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
	function setError(input, msg) {
		if (!input) return;
		const wrap = input.closest(".form-group") || input.closest(".input-wrap")?.parentElement;
		if (!wrap) return;
		if (msg) {
			const live = wrap.querySelector(".live-status");
			if (live) live.remove();
		}
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

	function isTakenAccountMessage(msg) {
		const s = String(msg || "").toLowerCase();
		return /already (exists|registered|taken)/.test(s) || s.includes("user already exists");
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
					try {
						const remember = loginForm.querySelector("#rememberMe")?.checked;
						if (remember) {
							localStorage.setItem("jod_access_token", data.access_token);
							localStorage.setItem("jod_user", JSON.stringify(data.user));
						} else {
							sessionStorage.setItem("jod_access_token", data.access_token);
							sessionStorage.setItem("jod_user", JSON.stringify(data.user));
						}
						// Keep both storages in sync for cross-page compatibility
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
					try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) { }

					setTimeout(async () => {
						const targetUrl = getRedirectTarget();
						try {
							window.location.href = await resolvePostAuthDestination(targetUrl);
						} catch (e) {
							console.warn("[Auth Debug] Host destination check failed:", e);
							window.location.href = targetUrl || "index.html";
						}
					}, 900);
				}
			} catch (err) {
				const online = window.JodHealth
					? await window.JodHealth.checkBackendHealth(2500)
					: false;
				if (online) {
					showAlert(alertEl, "error", "Could not complete login. Please try again.");
				} else if (window.JodHealth && typeof window.JodHealth.showFriendlyError === "function") {
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							hideAlert(alertEl);
							setLoading(submitBtn, false);
							doLogin();
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
				statusEl.style.display = "none";
				inputEl.style.borderColor = "";
				return;
			}
			statusEl.style.display = "flex";
			const errEl = wrap.querySelector(".field-error");
			if (errEl) {
				errEl.textContent = "";
				errEl.classList.remove("is-visible");
			}
			inputEl.classList.remove("has-error");
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
		let emailCheckSeq = 0;
		let usernameCheckSeq = 0;
		let signupBusy = false;
		let signupAutoRetryUsed = false;

		const emailInput = signupForm.querySelector("#signupEmail");
		const usernameInput = signupForm.querySelector("#signupUsername");
		const passwordInput = signupForm.querySelector("#signupPassword");
		const confirmInput = signupForm.querySelector("#signupConfirmPassword");

		async function fetchAvailability(params) {
			const qs = new URLSearchParams(params).toString();
			const res = await fetch(`${API_BASE}/api/auth/check?${qs}`, { cache: "no-store" });
			if (!res.ok) throw new Error("check failed");
			return res.json();
		}

		const checkEmail = debounce(async (email) => {
			const seq = ++emailCheckSeq;
			if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
				clearLiveStatus(emailInput);
				emailAvailable = null;
				return;
			}
			setLiveStatus(emailInput, null, "Checking…");
			if (emailInput) emailInput.style.borderColor = "#94a3b8";
			try {
				const data = await fetchAvailability({ email });
				if (seq !== emailCheckSeq) return;
				emailAvailable = data.email_available !== false;
				setLiveStatus(
					emailInput,
					emailAvailable,
					data.email_message || (emailAvailable ? "Email is available." : "Email already registered.")
				);
			} catch (_) {
				if (seq !== emailCheckSeq) return;
				clearLiveStatus(emailInput);
				emailAvailable = null;
			}
		}, 450);

		const checkUsername = debounce(async (username) => {
			const seq = ++usernameCheckSeq;
			if (!username || username.length < 3) {
				clearLiveStatus(usernameInput);
				usernameAvailable = null;
				return;
			}
			setLiveStatus(usernameInput, null, "Checking…");
			if (usernameInput) usernameInput.style.borderColor = "#94a3b8";
			try {
				const data = await fetchAvailability({ username });
				if (seq !== usernameCheckSeq) return;
				usernameAvailable = data.username_available !== false;
				setLiveStatus(
					usernameInput,
					usernameAvailable,
					data.username_message || (usernameAvailable ? "Username is available." : "Username already taken.")
				);
			} catch (_) {
				if (seq !== usernameCheckSeq) return;
				clearLiveStatus(usernameInput);
				usernameAvailable = null;
			}
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

		function finishSignupSuccess(data) {
			try {
				if (data && data.access_token) {
					localStorage.setItem("jod_access_token", data.access_token);
					sessionStorage.setItem("jod_access_token", data.access_token);
				}
				if (data && data.user) {
					localStorage.setItem("jod_user", JSON.stringify(data.user));
					sessionStorage.setItem("jod_user", JSON.stringify(data.user));
				}
			} catch (_) { }

			showAlert(alertEl, "success", "Account created! Redirecting…");
			try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) { }
			const targetUrl = getRedirectTarget();
			setTimeout(async () => {
				try {
					window.location.href = await resolvePostAuthDestination(targetUrl);
				} catch (_) {
					window.location.href = targetUrl || "index.html";
				}
			}, 900);
		}

		async function doSignup(e) {
			if (e && e.preventDefault) e.preventDefault();
			if (signupBusy) return;
			if (getToken()) {
				finishSignupSuccess({ access_token: getToken(), user: getUser() });
				return;
			}

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

			if (!email) { setError(signupForm.querySelector("#signupEmail"), "Email is required."); valid = false; }
			else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(signupForm.querySelector("#signupEmail"), "Enter a valid email address."); valid = false; }

			if (!password) { setError(signupForm.querySelector("#signupPassword"), "Password is required."); valid = false; }
			else if (password.length < 8) { setError(signupForm.querySelector("#signupPassword"), "Password must be at least 8 characters."); valid = false; }

			if (!confirm) { setError(signupForm.querySelector("#signupConfirmPassword"), "Please confirm your password."); valid = false; }
			else if (password !== confirm) { setError(signupForm.querySelector("#signupConfirmPassword"), "Passwords do not match."); valid = false; }

			if (!valid) return;

			signupBusy = true;
			setLoading(submitBtn, true);

			try {
				try {
					const data = await fetchAvailability({ email, username });
					emailAvailable = data.email_available !== false;
					usernameAvailable = data.username_available !== false;
					if (data.email_available === false) {
						setError(signupForm.querySelector("#signupEmail"), "Email already registered. Please login instead.");
						setLiveStatus(emailInput, false, data.email_message || "Email already registered.");
						return;
					}
					if (data.username_available === false) {
						setError(signupForm.querySelector("#signupUsername"), "Username already taken. Please choose another.");
						setLiveStatus(usernameInput, false, data.username_message || "Username already taken.");
						return;
					}
					setLiveStatus(emailInput, true, data.email_message || "Email is available.");
					setLiveStatus(usernameInput, true, data.username_message || "Username is available.");
				} catch (_) {
					emailAvailable = null;
					usernameAvailable = null;
				}

				const payload = { username, email, password };
				if (fullName) payload.full_name = fullName;

				const res = await fetch(`${API_BASE}/api/auth/register`, {
					method: "POST",
					headers: { "Content-Type": "application/json", "Accept": "application/json" },
					body: JSON.stringify(payload),
				});

				let data = {};
				try { data = await res.json(); } catch (_) { }

				if (!res.ok) {
					const detail = parseApiErrorMessage(data.detail, `Registration failed (${res.status}). Please try again.`);
					const lower = detail.toLowerCase();
					if (isTakenAccountMessage(detail) && lower.includes("username")) {
						setError(signupForm.querySelector("#signupUsername"), detail);
						setLiveStatus(usernameInput, false, detail);
						usernameAvailable = false;
					} else if (isTakenAccountMessage(detail)) {
						setError(signupForm.querySelector("#signupEmail"), detail);
						setLiveStatus(emailInput, false, detail);
						emailAvailable = false;
					} else if (lower.includes("username")) {
						setError(signupForm.querySelector("#signupUsername"), detail);
					} else if (lower.includes("password")) {
						setError(signupForm.querySelector("#signupPassword"), detail);
					} else if (lower.includes("email") && /valid|invalid/.test(lower)) {
						setError(signupForm.querySelector("#signupEmail"), detail);
					}
					showAlert(alertEl, "error", detail);
					return;
				}

				finishSignupSuccess(data);
			} catch (err) {
				if (getToken()) {
					finishSignupSuccess({ access_token: getToken(), user: getUser() });
					return;
				}
				const online = window.JodHealth
					? await window.JodHealth.checkBackendHealth(2500)
					: false;
				if (online) {
					showAlert(alertEl, "error", "Could not complete signup. Please try again.");
					return;
				}
				if (window.JodHealth && typeof window.JodHealth.showFriendlyError === "function" && !signupAutoRetryUsed) {
					signupAutoRetryUsed = true;
					window.JodHealth.showFriendlyError(alertEl, "Starting server, please wait…", "info");
					window.JodHealth.retryConnection({
						onSuccess: () => {
							hideAlert(alertEl);
							signupBusy = false;
							setLoading(submitBtn, false);
							doSignup();
						},
						onError: () => {
							showAlert(alertEl, "error", "Could not connect to server. Please ensure the backend is running on port 8001.");
						}
					});
				} else {
					showAlert(alertEl, "error", "Network error: Unable to connect to backend server at " + API_BASE);
				}
			} finally {
				signupBusy = false;
				setLoading(submitBtn, false);
			}
		}

		signupForm.addEventListener("submit", doSignup);

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


	/* ── Google OAuth Integration ────────────────────────────── */
	async function handleGoogleCredentialResponse(response, alertEl, btnEl) {
		if (!response || (!response.credential && !response.code)) {
			if (alertEl) showAlert(alertEl, "error", "Google authentication was cancelled or failed.");
			return;
		}
		if (btnEl) setLoading(btnEl, true);
		if (alertEl) hideAlert(alertEl);

		try {
			let city = null;
			let pincode = null;
			if (window.JodLocation) {
				city = localStorage.getItem("jod_user_city") || sessionStorage.getItem("jod_user_city") || null;
				pincode = localStorage.getItem("jod_user_pincode") || sessionStorage.getItem("jod_user_pincode") || null;
			}

			const payload = {};
			if (response.credential) payload.credential = response.credential;
			if (response.code) {
				payload.code = response.code;
				payload.redirect_uri = window.location.origin + window.location.pathname;
			}
			if (city) payload.city = city;
			if (pincode) payload.location_pincode = pincode;

			const res = await fetch(`${API_BASE}/api/auth/google`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			let data = {};
			try { data = await res.json(); } catch (_) {}

			if (!res.ok) {
				clearAuth();
				if (alertEl) showAlert(alertEl, "error", data.detail || `Google authentication failed (${res.status}).`);
			} else {
				try {
					sessionStorage.setItem("jod_access_token", data.access_token);
					sessionStorage.setItem("jod_user", JSON.stringify(data.user));
					localStorage.setItem("jod_access_token", data.access_token);
					localStorage.setItem("jod_user", JSON.stringify(data.user));
				} catch (_) {}

				if (alertEl) showAlert(alertEl, "success", "Google Sign-In successful! Redirecting…");

				if (data.location_required || !data.user.city) {
					try { sessionStorage.setItem("jod_location_pending", "1"); } catch (_) {}
				}

				const targetUrl = getRedirectTarget();
				setTimeout(async () => {
					try {
						window.location.href = await resolvePostAuthDestination(targetUrl);
					} catch (_) {
						window.location.href = targetUrl || "index.html";
					}
				}, 900);
			}
		} catch (err) {
			if (alertEl) showAlert(alertEl, "error", "Unable to complete Google sign-in. Network error.");
		} finally {
			if (btnEl) setLoading(btnEl, false);
		}
	}

	let googleClientConfig = { client_id: "", enabled: false };

	async function initGoogleAuth() {
		// 1. Check if we returned from Google OAuth redirect
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const alertEl = document.querySelector("#signupForm .form-alert, #loginForm .form-alert");
		const btnEl = document.getElementById("googleSignupBtn") || document.getElementById("googleLoginBtn");

		if (code) {
			// Remove the code from the URL so it doesn't linger or get reused
			window.history.replaceState({}, document.title, window.location.pathname);
			if (alertEl) showAlert(alertEl, "info", "Finalizing Google authentication...");
			await handleGoogleCredentialResponse({ code }, alertEl, btnEl);
			return;
		}

		try {
			const res = await fetch(`${API_BASE}/api/auth/google/config`);
			if (res.ok) googleClientConfig = await res.json();
		} catch (_) {}

		if (googleClientConfig.client_id && !window.google?.accounts?.id) {
			const script = document.createElement("script");
			script.src = "https://accounts.google.com/gsi/client";
			script.async = true;
			script.defer = true;
			script.onload = () => {
				try {
					window.google.accounts.id.initialize({
						client_id: googleClientConfig.client_id,
						callback: (resp) => {
							handleGoogleCredentialResponse(resp, alertEl, btnEl);
						},
					});
				} catch (_) {}
			};
			document.head.appendChild(script);
		}
	}

	async function triggerGoogleFlow(btn, alertElement) {
		if (btn) btn.classList.add("is-loading");
		
		// Preserve redirect URI if present
		const params = new URLSearchParams(window.location.search);
		const redirect = params.get("redirect");
		if (redirect) {
			sessionStorage.setItem("jod_redirect", redirect);
		}
		
		try {
			const res = await fetch(`${API_BASE}/api/auth/google/url`);
			if (!res.ok) {
				throw new Error("Backend rejected Google Auth URL generation");
			}
			const data = await res.json();
			if (data.url) {
				window.location.href = data.url;
			} else {
				throw new Error("No URL returned from backend");
			}
		} catch (e) {
			if (btn) btn.classList.remove("is-loading");
			console.warn("Falling back to Google Dev Modal:", e.message);
			openGoogleDevModal(btn, alertElement);
		}
	}

	function openGoogleDevModal(btn, alertElement) {
		let modal = document.getElementById("googleDevAuthModal");
		if (!modal) {
			modal = document.createElement("div");
			modal.id = "googleDevAuthModal";
			modal.className = "google-modal-backdrop";
			modal.innerHTML = `
				<div class="google-modal-box">
					<div class="google-modal-header">
						<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
							<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
							<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
							<path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"/>
							<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
						</svg>
						<div>
							<h3 style="margin:0;font-size:1.1rem;color:#fff;font-weight:700;">Google Sign-In</h3>
							<p style="margin:0;font-size:.8rem;color:rgba(255,255,255,.7);">Sign up or log in with your Google Account</p>
						</div>
					</div>
					<div style="padding:1.25rem 0 0.5rem;">
						<div style="display:flex;flex-direction:column;gap:.75rem;">
							<div>
								<label style="display:block;margin-bottom:.35rem;font-size:.8rem;color:rgba(255,255,255,.8);font-weight:600;">Google Email Address</label>
								<input type="email" id="gModalEmail" value="user@gmail.com" style="width:100%;padding:.75rem 1rem;border-radius:.75rem;border:1px solid rgba(255,255,255,.2);background:#1a1714;color:#fff;font-size:.9rem;" />
							</div>
							<div>
								<label style="display:block;margin-bottom:.35rem;font-size:.8rem;color:rgba(255,255,255,.8);font-weight:600;">Full Name</label>
								<input type="text" id="gModalName" value="Google User" style="width:100%;padding:.75rem 1rem;border-radius:.75rem;border:1px solid rgba(255,255,255,.2);background:#1a1714;color:#fff;font-size:.9rem;" />
							</div>
							<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.25rem;">
								<button type="button" class="g-chip" data-email="satheesh.google@gmail.com" data-name="Satheesh Google">satheesh.google@gmail.com</button>
								<button type="button" class="g-chip" data-email="krithish.events@gmail.com" data-name="Krithish User">krithish.events@gmail.com</button>
							</div>
						</div>
					</div>
					<div style="display:flex;gap:.75rem;margin-top:1.25rem;">
						<button type="button" id="gModalCancel" style="flex:1;padding:.75rem;border-radius:.75rem;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;font-weight:600;">Cancel</button>
						<button type="button" id="gModalSubmit" style="flex:1;padding:.75rem;border-radius:.75rem;border:none;background:var(--primary);color:#fff;cursor:pointer;font-weight:700;">Continue &rarr;</button>
					</div>
				</div>
			`;
			document.body.appendChild(modal);

			modal.querySelectorAll(".g-chip").forEach(chip => {
				chip.addEventListener("click", () => {
					const em = chip.getAttribute("data-email");
					const nm = chip.getAttribute("data-name");
					const emailInp = document.getElementById("gModalEmail");
					const nameInp = document.getElementById("gModalName");
					if (emailInp) emailInp.value = em;
					if (nameInp) nameInp.value = nm;
				});
			});

			document.getElementById("gModalCancel")?.addEventListener("click", () => {
				modal.style.display = "none";
			});
		}

		modal.style.display = "flex";

		const submitBtn = document.getElementById("gModalSubmit");
		if (submitBtn) {
			const newSubmitBtn = submitBtn.cloneNode(true);
			submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

			newSubmitBtn.addEventListener("click", () => {
				const emailInp = document.getElementById("gModalEmail");
				const nameInp = document.getElementById("gModalName");
				const email = emailInp ? emailInp.value.trim() : "user@gmail.com";
				const name = nameInp ? nameInp.value.trim() : "Google User";
				modal.style.display = "none";

				const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
				const body = btoa(JSON.stringify({
					iss: "https://accounts.google.com",
					sub: "google-dev-" + Math.floor(Math.random() * 1000000),
					email: email || "user@gmail.com",
					email_verified: true,
					name: name || "Google User",
					picture: "https://lh3.googleusercontent.com/a/default-user=s96-c",
				}));
				const mockCredential = `${header}.${body}.mock_signature`;
				handleGoogleCredentialResponse({ credential: mockCredential }, alertElement, btn);
			});
		}
	}

	// Global Event Delegation for Google Auth Buttons
	document.addEventListener("click", (e) => {
		const targetBtn = e.target.closest("#googleSignupBtn, #googleLoginBtn, .btn-google-auth");
		console.log("Global click caught on auth button:", targetBtn);
		if (targetBtn) {
			e.preventDefault();
			e.stopPropagation();
			const alertEl = document.querySelector("#signupForm .form-alert, #loginForm .form-alert");
			triggerGoogleFlow(targetBtn, alertEl);
		}
	});

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", initGoogleAuth);
		} else {
			initGoogleAuth();
		}
	}


	// Auto-redirect if already logged in on login or signup page
	const pageFile = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
	if ((pageFile === "login.html" || pageFile === "signup.html") && isLoggedIn()) {
		(async () => {
			const targetUrl = getRedirectTarget();
			try {
				const dest = await resolvePostAuthDestination(targetUrl);
				if (dest && dest !== pageFile) {
					window.location.href = dest;
				}
			} catch (_) {
				if (targetUrl && targetUrl !== pageFile) {
					window.location.href = targetUrl;
				}
			}
		})();
	}

	/* ── Guest Auth Modal (Universal) ────────────────────────── */
	function ensureGuestModal() {
		let modal = document.getElementById("guestAuthModal");
		if (!modal) {
			modal = document.createElement("div");
			modal.id = "guestAuthModal";
			modal.className = "modal-backdrop guest-auth-modal-backdrop";
			modal.setAttribute("role", "dialog");
			modal.setAttribute("aria-modal", "true");
			modal.setAttribute("aria-labelledby", "guestAuthModalTitle");
			modal.hidden = true;
			modal.innerHTML = `
				<button class="modal-close-backdrop" type="button" aria-label="Close modal" id="guestAuthModalCloseBackdrop"></button>
				<div class="guest-auth-modal-box">
					<button class="guest-auth-modal-close" type="button" aria-label="Close" id="guestAuthModalCloseBtn">&times;</button>
					<div class="guest-auth-modal-header">
						<div class="guest-auth-modal-icon">
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
								<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
							</svg>
						</div>
						<span class="pill pill-light-orange" id="guestAuthModalBadge">ACCOUNT REQUIRED</span>
					</div>
					<div class="guest-auth-modal-body">
						<h3 id="guestAuthModalTitle">Sign Up to Book Tickets</h3>
						<p id="guestAuthModalDesc">You need to sign up or log in to reserve tickets for this event.</p>
					</div>
					<div class="guest-auth-modal-actions">
						<a class="button button-primary guest-auth-submit-btn" id="guestAuthSignupBtn" href="signup.html" data-guest-auth-nav="signup">
							Sign Up <span aria-hidden="true">&rarr;</span>
						</a>
						<button class="button button-ghost-light" type="button" id="guestAuthCancelBtn">Maybe Later</button>
					</div>
					<div class="guest-auth-modal-switch">
						Already have an account? <a href="login.html" id="guestAuthLoginLink" data-guest-auth-nav="login">Log In</a>
					</div>
				</div>
			`;
			document.body.appendChild(modal);
		}

		// Bind close handlers
		const closeBtn = modal.querySelector("#guestAuthModalCloseBtn");
		const backdrop = modal.querySelector("#guestAuthModalCloseBackdrop");
		const cancelBtn = modal.querySelector("#guestAuthCancelBtn");

		const closeHandler = () => closeGuestAuthModal();
		if (closeBtn && !closeBtn._hasCloseHandler) {
			closeBtn.addEventListener("click", closeHandler);
			closeBtn._hasCloseHandler = true;
		}
		if (backdrop && !backdrop._hasCloseHandler) {
			backdrop.addEventListener("click", closeHandler);
			backdrop._hasCloseHandler = true;
		}
		if (cancelBtn && !cancelBtn._hasCloseHandler) {
			cancelBtn.addEventListener("click", closeHandler);
			cancelBtn._hasCloseHandler = true;
		}

		bindGuestAuthNavLinks(modal);
		return modal;
	}

	function navigateGuestAuthLink(el, fallbackPage) {
		const href = String((el && el.getAttribute("href")) || fallbackPage || "").trim();
		if (!href || href === "#") return;
		window.location.assign(href);
	}

	function bindGuestAuthNavLinks(modal) {
		if (!modal) return;
		const signupBtn = modal.querySelector("#guestAuthSignupBtn");
		const loginLink = modal.querySelector("#guestAuthLoginLink");

		function bind(el, fallbackPage) {
			if (!el || el._hasAuthNavHandler) return;
			el.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
				navigateGuestAuthLink(el, fallbackPage);
			});
			el._hasAuthNavHandler = true;
		}

		bind(signupBtn, "signup.html");
		bind(loginLink, "login.html");
	}

	function closeGuestAuthModal() {
		const modal = document.getElementById("guestAuthModal");
		if (modal) {
			modal.hidden = true;
		}
		if (typeof document !== "undefined" && document.body) {
			document.body.classList.remove("guest-modal-open");
		}
	}

	function openGuestAuthModal(optionsOrUrl) {
		const modal = ensureGuestModal();
		let targetUrl = "index.html";
		let title = "Sign Up to Book Tickets";
		let desc = "Please sign up or log in to access this feature.";
		let badge = "ACCOUNT REQUIRED";

		if (typeof optionsOrUrl === "string") {
			targetUrl = optionsOrUrl;
			if (targetUrl.includes("host-your-event") || targetUrl.includes("account-setup")) {
				title = "Sign Up to Host Your Event";
				desc = "Please sign up or log in to access this feature.";
				badge = "HOST YOUR EVENT";
			} else if (targetUrl.includes("makeup-boutique") || targetUrl.includes("event-details")) {
				title = "Sign Up to Book Tickets";
				desc = "You need to sign up or log in to reserve tickets for this event.";
				badge = "ACCOUNT REQUIRED";
			} else {
				title = "Sign Up to Continue";
				desc = "Please sign up or log in to access this feature.";
			}
		} else if (optionsOrUrl && typeof optionsOrUrl === "object") {
			targetUrl = optionsOrUrl.targetUrl || targetUrl;
			title = optionsOrUrl.title || title;
			desc = optionsOrUrl.message || optionsOrUrl.desc || "Please sign up or log in to access this feature.";
			if (optionsOrUrl.badge) badge = optionsOrUrl.badge;
		}

		// Save redirect URL in sessionStorage
		if (targetUrl) {
			try {
				sessionStorage.setItem("jod_redirect_after_login", targetUrl);
			} catch (_) {}
		}

		const titleEl = modal.querySelector("#guestAuthModalTitle");
		const descEl = modal.querySelector("#guestAuthModalDesc");
		const badgeEl = modal.querySelector("#guestAuthModalBadge");
		const signupBtn = modal.querySelector("#guestAuthSignupBtn");
		const loginLink = modal.querySelector("#guestAuthLoginLink");

		if (titleEl) titleEl.textContent = title;
		if (descEl) descEl.textContent = desc;
		if (badgeEl) badgeEl.textContent = badge;

		const redirectParam = targetUrl ? `?redirect=${encodeURIComponent(targetUrl)}` : "";
		if (signupBtn) {
			signupBtn.href = `signup.html${redirectParam}`;
			signupBtn.setAttribute("data-guest-auth-nav", "signup");
			signupBtn.innerHTML = `Sign Up <span aria-hidden="true">&rarr;</span>`;
		}
		if (loginLink) {
			loginLink.href = `login.html${redirectParam}`;
			loginLink.setAttribute("data-guest-auth-nav", "login");
		}
		bindGuestAuthNavLinks(modal);

		modal.hidden = false;
		if (document.body) {
			document.body.classList.add("guest-modal-open");
		}
	}

	if (typeof document !== "undefined") {
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				const modal = document.getElementById("guestAuthModal");
				if (modal && !modal.hidden) {
					closeGuestAuthModal();
				}
			}
		});
	}

	// Global Click Interception for Guest Users
	if (typeof document !== "undefined") {
		document.addEventListener("click", (e) => {
			const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
			if (page === "login.html" || page === "signup.html") return;

			// If user is already logged in, let normal interactions proceed
			if (isLoggedIn()) return;

			const guestAuthNav = e.target.closest("#guestAuthSignupBtn, #guestAuthLoginLink, [data-guest-auth-nav]");
			if (guestAuthNav) {
				e.preventDefault();
				e.stopPropagation();
				if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
				navigateGuestAuthLink(
					guestAuthNav,
					guestAuthNav.getAttribute("data-guest-auth-nav") === "login" ? "login.html" : "signup.html"
				);
				return;
			}

			if (e.target.closest("#guestAuthModal")) return;

			// 1. "Host Your Event" links & buttons
			const hostLink = e.target.closest("a[href*='host-your-event'], a[href*='account-setup'], [data-host-flow]");
			if (hostLink) {
				const href = String(hostLink.getAttribute("href") || "").toLowerCase();
				if (href.includes("signup.html") || href.includes("login.html")) return;
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				openGuestAuthModal({
					title: "Sign Up to Host Your Event",
					message: "Create your account or log in to list events, publish registration forms, and manage your attendees with JOD Events.",
					targetUrl: "account-setup.html",
					badge: "✨ Host Your Event"
				});
				return;
			}

			// 2. Booking only — event details are public for attendees, guests, and other hosts
			const bookTarget = e.target.closest(".btn-book-now");
			if (bookTarget) {
				if (e.target.closest("#guestAuthModal, .modal-close, [data-modal-close], #navAuth")) return;
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				const currentTarget = window.location.pathname + window.location.search + window.location.hash;
				openGuestAuthModal({
					title: "Sign Up to Book Tickets",
					message: "You need to sign up or log in to reserve tickets for this event.",
					targetUrl: currentTarget,
					badge: "🎟️ Account Required"
				});
			}
		}, true);
	}

	async function navigateToHostFlow(e) {
		if (e && typeof e.preventDefault === "function") e.preventDefault();
		const u = getUser();
		if (!u || !isLoggedIn()) {
			openGuestAuthModal({
				title: "Sign Up to Host Your Event",
				message: "Create your account or log in to list events, publish registration forms, and manage your attendees with JOD Events.",
				targetUrl: "account-setup.html",
				badge: "✨ Host Your Event"
			});
			return;
		}

		try {
			window.location.href = await resolvePostAuthDestination("organizer-dashboard.html");
		} catch (_) {
			window.location.href = "account-setup.html";
		}
	}

	function handleGuestOrNavigate(e, targetUrl, type) {
		if (e) {
			if (typeof e.preventDefault === "function") e.preventDefault();
			if (typeof e.stopPropagation === "function") e.stopPropagation();
			if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
		}
		if (isLoggedIn()) {
			if (type === "host") {
				navigateToHostFlow(e);
			} else {
				window.location.href = targetUrl || "event-details.html";
			}
			return false;
		}

		if (type === "host") {
			openGuestAuthModal({
				title: "Sign Up to Host Your Event",
				message: "Please sign up or log in to access this feature.",
				targetUrl: targetUrl || "account-setup.html",
				badge: "HOST YOUR EVENT"
			});
		} else {
			window.location.href = targetUrl || "event-details.html";
		}
		return false;
	}

	if (typeof window !== "undefined") {
		window.handleGuestOrNavigate = handleGuestOrNavigate;
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
		hasHostPayoutBank,
		resolvePostAuthDestination,
		getRedirectTarget,
		validateSession,
		initGoogleAuth,
		handleGoogleCredentialResponse,
		openGuestAuthModal,
		closeGuestAuthModal,
		showGuestModal: openGuestAuthModal,
		handleGuestOrNavigate,
	};
})();


