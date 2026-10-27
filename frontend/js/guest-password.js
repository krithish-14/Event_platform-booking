/* Ask a guest-checkout account to choose a password, on any page with the site header. */
(() => {
	"use strict";

	const DISMISS_KEY = "jod_guest_pwd_prompt_dismissed";

	function cachedUser() {
		try {
			const raw = localStorage.getItem("jod_user") || sessionStorage.getItem("jod_user");
			return raw ? JSON.parse(raw) : null;
		} catch (_) {
			return null;
		}
	}

	function storeUser(user) {
		if (!user) return;
		try {
			localStorage.setItem("jod_user", JSON.stringify(user));
			sessionStorage.setItem("jod_user", JSON.stringify(user));
		} catch (_) {}
	}

	function apiRoot() {
		let origin = "";
		try {
			origin = (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || "";
		} catch (_) {}
		return String(origin || "").replace(/\/$/, "") + "/api";
	}

	function dismissed() {
		try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch (_) { return false; }
	}

	function markDismissed() {
		try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch (_) {}
	}

	function injectStyles() {
		if (document.getElementById("jodGuestPwdStyles")) return;
		const style = document.createElement("style");
		style.id = "jodGuestPwdStyles";
		style.textContent = [
			"#jodGuestPwdModal{position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(15,23,42,.55)}",
			"#jodGuestPwdModal[hidden]{display:none!important}",
			"#jodGuestPwdModal .gp-card{width:min(420px,100%);background:#fff;color:#0f172a;border-radius:16px;padding:1.3rem 1.2rem 1.1rem;text-align:left;box-shadow:0 20px 50px rgba(15,23,42,.25);font-family:inherit}",
			"#jodGuestPwdModal h2{margin:0 0 .35rem;font-size:1.2rem}",
			"#jodGuestPwdModal p{margin:0 0 .85rem;font-size:.9rem;color:#64748b;line-height:1.45}",
			"#jodGuestPwdModal label{display:block;font-size:.8rem;font-weight:700;margin-bottom:.25rem}",
			"#jodGuestPwdModal input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:.7rem .8rem;margin-bottom:.7rem;font:inherit}",
			"#jodGuestPwdModal .gp-error{color:#b91c1c;font-size:.82rem;min-height:1.1rem;margin:0 0 .5rem}",
			"#jodGuestPwdModal .gp-actions{display:flex;gap:.5rem}",
			"#jodGuestPwdModal button{border:0;border-radius:10px;padding:.75rem .9rem;font:inherit;font-weight:800;cursor:pointer}",
			"#jodGuestPwdModal .gp-save{flex:1;background:#ff7a00;color:#fff}",
			"#jodGuestPwdModal .gp-save:disabled{opacity:.65;cursor:wait}",
			"#jodGuestPwdModal .gp-later{background:#fff;border:1px solid #cbd5e1;color:#334155}",
			"html[data-theme=dark] #jodGuestPwdModal .gp-card{background:#1c1814;color:#f6f0e8}",
			"html[data-theme=dark] #jodGuestPwdModal p,html[data-theme=dark] #jodGuestPwdModal .gp-later{color:#d4cbbf}",
			"html[data-theme=dark] #jodGuestPwdModal input{background:#241c16;color:#f6f0e8;border-color:rgba(255,138,31,.24)}",
		].join("");
		document.head.appendChild(style);
	}

	function buildModal(email) {
		injectStyles();
		const root = document.createElement("div");
		root.id = "jodGuestPwdModal";
		root.innerHTML =
			'<div class="gp-card" role="dialog" aria-modal="true" aria-labelledby="jodGuestPwdTitle">' +
			'<h2 id="jodGuestPwdTitle">Set a password for your account</h2>' +
			'<p>We created a JOD Events account for <strong></strong> when you filled the registration form. Choose a password so you can log in to it later.</p>' +
			'<label for="jodGuestPwdInput">Password</label>' +
			'<input id="jodGuestPwdInput" type="password" autocomplete="new-password" minlength="8" />' +
			'<label for="jodGuestPwdConfirm">Confirm password</label>' +
			'<input id="jodGuestPwdConfirm" type="password" autocomplete="new-password" minlength="8" />' +
			'<p class="gp-error" id="jodGuestPwdError"></p>' +
			'<div class="gp-actions"><button type="button" class="gp-later" id="jodGuestPwdLater">Not now</button>' +
			'<button type="button" class="gp-save" id="jodGuestPwdSave">Save password</button></div>' +
			"</div>";
		root.querySelector("p strong").textContent = email || "you";
		document.body.appendChild(root);
		return root;
	}

	function showPrompt(user) {
		if (document.getElementById("jodGuestPwdModal")) return;
		const root = buildModal(user && user.email);
		const errorEl = root.querySelector("#jodGuestPwdError");
		const saveBtn = root.querySelector("#jodGuestPwdSave");
		root.querySelector("#jodGuestPwdLater").addEventListener("click", () => {
			markDismissed();
			root.remove();
		});
		saveBtn.addEventListener("click", async () => {
			const password = root.querySelector("#jodGuestPwdInput").value || "";
			const confirmValue = root.querySelector("#jodGuestPwdConfirm").value || "";
			if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
				errorEl.textContent = "Use at least 8 characters, with a letter and a number.";
				return;
			}
			if (password !== confirmValue) {
				errorEl.textContent = "The two passwords do not match.";
				return;
			}
			errorEl.textContent = "";
			saveBtn.disabled = true;
			saveBtn.textContent = "Saving...";
			try {
				const res = await fetch(apiRoot() + "/auth/guest/set-password", {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json", Accept: "application/json" },
					body: JSON.stringify({ password: password }),
				});
				let data = {};
				try { data = await res.json(); } catch (_) {}
				if (!res.ok) {
					const detail = data && data.detail;
					errorEl.textContent = typeof detail === "string" ? detail : "Could not save the password.";
					saveBtn.disabled = false;
					saveBtn.textContent = "Save password";
					return;
				}
				storeUser(data.user || Object.assign({}, user, { must_set_password: false }));
				root.querySelector(".gp-card").innerHTML =
					'<h2>Password saved</h2><p>You can now log in with your email and this password.</p>' +
					'<div class="gp-actions"><button type="button" class="gp-save" id="jodGuestPwdDone">Done</button></div>';
				root.querySelector("#jodGuestPwdDone").addEventListener("click", () => root.remove());
			} catch (_) {
				errorEl.textContent = "Could not reach the server. Try again.";
				saveBtn.disabled = false;
				saveBtn.textContent = "Save password";
			}
		});
	}

	async function check() {
		const cached = cachedUser();
		if (!cached || !cached.must_set_password || dismissed()) return;
		try {
			const res = await fetch(apiRoot() + "/auth/me", {
				credentials: "include",
				cache: "no-store",
				headers: { Accept: "application/json" },
			});
			if (!res.ok) return;
			const user = await res.json();
			if (!user || !user.must_set_password) {
				if (user) storeUser(user);
				return;
			}
			showPrompt(user);
		} catch (_) {}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", check);
	} else {
		check();
	}
})();
