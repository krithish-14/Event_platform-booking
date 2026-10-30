/* Theatre partner registration: same three steps as event hosts (details +
 * bank, documents, agreement), saved to /api/theatres/registration. */
document.addEventListener("DOMContentLoaded", async () => {
	"use strict";

	const ORIGIN = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl())
		|| (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin())
		|| (window.JodAuth && window.JodAuth.API_BASE) || window.JOD_API_BASE_OVERRIDE || "")).replace(/\/$/, "");
	const API = ORIGIN + "/api/theatres";
	const authFetch = (window.JodAuth && typeof window.JodAuth.fetchAuth === "function") ? window.JodAuth.fetchAuth : window.fetch.bind(window);
	const AGREEMENT_VERSION = "JOD-HTA-1.0";
	const FORMATS = ["2D", "3D", "IMAX", "4DX", "ScreenX", "Dolby Cinema"];
	const STATES = [
		"Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
		"Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
		"Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
		"Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
		"Uttar Pradesh", "Uttarakhand", "West Bengal"
	];

	if (!(window.JodAuth && typeof window.JodAuth.isLoggedIn === "function" && window.JodAuth.isLoggedIn())) {
		window.location.replace("login.html?redirect=" + encodeURIComponent("theatre-setup.html"));
		return;
	}
	if (typeof window.updateNavAuth === "function") window.updateNavAuth();

	const $ = (id) => document.getElementById(id);
	const user = window.JodAuth.getUser() || {};
	const email = String(user.email || "").trim().toLowerCase();
	const DRAFT_KEY = "jod_theatre_setup_draft:" + (email || "guest");
	const docs = { pan: null, cheque: null, licence: null };
	const DOC_TYPES = { pan: "pan_card", cheque: "cancelled_cheque", licence: "cinema_licence" };
	const DOC_FIELDS = { pan: "pan_card_url", cheque: "cancelled_cheque_url", licence: "licence_url" };
	let currentStep = 1;

	/* ── Alerts ───────────────────────────────────────────── */
	const alertBox = $("setupAlert");
	const alertText = $("setupAlertContent");
	function showAlert(msg, type) {
		alertBox.style.display = "block";
		const ok = type === "success";
		alertText.style.background = ok ? "#f0fdf4" : "#fef2f2";
		alertText.style.color = ok ? "#166534" : "#991b1b";
		alertText.style.border = ok ? "1px solid #bbf7d0" : "1px solid #fecaca";
		alertText.textContent = msg;
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
	function hideAlert() { alertBox.style.display = "none"; }
	function fail(field, msg) {
		showAlert(msg);
		if (field && typeof field.focus === "function") field.focus();
		return false;
	}

	/* ── State / district ─────────────────────────────────── */
	const stateSelect = $("theatreState");
	stateSelect.insertAdjacentHTML("beforeend", STATES.map((s) => `<option value="${s}">${s}</option>`).join(""));
	function fillDistricts() {
		const list = $("theatreDistrictList");
		const input = $("theatreDistrict");
		const picker = window.JodRegionPicker;
		const state = picker && picker.stateOfName ? picker.stateOfName(stateSelect.value) : null;
		list.innerHTML = state ? state.districts.map((d) => `<option value="${d.name.replace(/"/g, "&quot;")}"></option>`).join("") : "";
		input.placeholder = stateSelect.value ? "Type or pick a district" : "Choose a state first";
	}
	stateSelect.addEventListener("change", () => {
		$("theatreDistrict").value = "";
		fillDistricts();
	});
	window.addEventListener("includesLoaded", fillDistricts);
	setTimeout(fillDistricts, 800);

	/* ── Screens ──────────────────────────────────────────── */
	const screenRows = $("screenRows");
	function screenRow(screen) {
		const s = screen || {};
		const row = document.createElement("div");
		row.className = "theatre-screen-row";
		row.innerHTML =
			`<div class="setup-form-group"><label>Screen name</label><input type="text" class="setup-input" data-screen="name" maxlength="60" placeholder="e.g. Screen 1 / Audi 2"></div>` +
			`<div class="setup-form-group"><label>Seats</label><input type="number" class="setup-input" data-screen="seats" min="1" max="2000" inputmode="numeric" placeholder="e.g. 180"></div>` +
			`<div class="setup-form-group"><label>Format</label><select class="setup-select" data-screen="format">${FORMATS.map((f) => `<option value="${f}">${f}</option>`).join("")}</select></div>` +
			`<button type="button" class="theatre-remove-screen" aria-label="Remove screen" title="Remove screen">&times;</button>`;
		row.querySelector('[data-screen="name"]').value = s.name || "";
		row.querySelector('[data-screen="seats"]').value = s.seats || "";
		row.querySelector('[data-screen="format"]').value = FORMATS.includes(s.format) ? s.format : "2D";
		row.querySelector(".theatre-remove-screen").addEventListener("click", () => {
			if (screenRows.children.length > 1) row.remove();
			else row.querySelectorAll("input").forEach((i) => { i.value = ""; });
			paintScreenTotal();
		});
		row.addEventListener("input", paintScreenTotal);
		return row;
	}
	function setScreens(list) {
		screenRows.innerHTML = "";
		(list && list.length ? list : [{ name: "Screen 1" }]).forEach((s) => screenRows.appendChild(screenRow(s)));
		paintScreenTotal();
	}
	function readScreens() {
		return Array.from(screenRows.querySelectorAll(".theatre-screen-row")).map((row) => ({
			name: row.querySelector('[data-screen="name"]').value.trim(),
			seats: Number(row.querySelector('[data-screen="seats"]').value || 0),
			format: row.querySelector('[data-screen="format"]').value
		})).filter((s) => s.name || s.seats);
	}
	function paintScreenTotal() {
		const screens = readScreens();
		const seats = screens.reduce((n, s) => n + (Number(s.seats) || 0), 0);
		$("screenTotal").textContent = `${screens.length} ${screens.length === 1 ? "screen" : "screens"} \u00b7 ${seats.toLocaleString("en-IN")} seats`;
	}
	$("btnAddScreen").addEventListener("click", () => {
		screenRows.appendChild(screenRow({ name: `Screen ${screenRows.children.length + 1}` }));
		paintScreenTotal();
	});

	/* ── GSTIN toggle ─────────────────────────────────────── */
	function syncGstin() {
		$("gstinField").hidden = document.querySelector('input[name="has_gstin"]:checked')?.value !== "yes";
	}
	document.querySelectorAll('input[name="has_gstin"]').forEach((r) => r.addEventListener("change", syncGstin));

	/* ── Documents ────────────────────────────────────────── */
	function paintDoc(key, label) {
		const has = Boolean(docs[key]);
		$(key + "DropzoneContent").style.display = has ? "none" : "flex";
		$(key + "DropzonePreview").style.display = has ? "block" : "none";
		if (has) $(key + "FileName").textContent = "\u2713 " + (label || "Uploaded");
	}
	async function uploadDoc(key, file) {
		hideAlert();
		if (file.size < 500 * 1024 || file.size > 5 * 1024 * 1024) return showAlert("Documents must be 500 KB to 5 MB. Recommended 500 KB\u20132 MB.");
		if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) return showAlert("Upload a clear image in .jpg, .png or .pdf format only.");
		const form = new FormData();
		form.append("doc_type", DOC_TYPES[key]);
		form.append("file", file);
		$(key + "DropzoneContent").querySelector("span").textContent = "Uploading\u2026";
		try {
			const res = await authFetch(`${API}/upload-document`, { method: "POST", body: form });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.detail || "Upload failed.");
			docs[key] = data.file_url;
			paintDoc(key, file.name);
			saveLocal();
			showAlert("Document uploaded.", "success");
		} catch (err) {
			showAlert(err.message || "Upload failed.");
		} finally {
			$(key + "DropzoneContent").querySelector("span").textContent = "Upload";
		}
	}
	Object.keys(docs).forEach((key) => {
		const zone = $(key + "Dropzone");
		const input = $(key + "FileInput");
		zone.addEventListener("click", (e) => { if (!e.target.closest("[data-clear-doc]")) input.click(); });
		zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
		input.addEventListener("change", () => { if (input.files[0]) uploadDoc(key, input.files[0]); input.value = ""; });
		zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
		zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
		zone.addEventListener("drop", (e) => {
			e.preventDefault();
			zone.classList.remove("dragover");
			if (e.dataTransfer.files[0]) uploadDoc(key, e.dataTransfer.files[0]);
		});
		zone.querySelector("[data-clear-doc]").addEventListener("click", (e) => {
			e.stopPropagation();
			docs[key] = null;
			paintDoc(key);
		});
	});

	/* ── Form data ────────────────────────────────────────── */
	const val = (id) => ($(id) ? String($(id).value || "").trim() : "");
	function readForm(isFinal) {
		const hasGstin = document.querySelector('input[name="has_gstin"]:checked')?.value === "yes";
		return {
			theatre_name: val("theatreName"),
			chain_name: val("chainName"),
			theatre_address: val("theatreAddress"),
			state: stateSelect.value || "",
			district: val("theatreDistrict"),
			pincode: val("theatrePincode"),
			screens: readScreens(),
			licence_number: val("licenceNumber").toUpperCase(),
			licence_valid_till: val("licenceValidTill"),
			legal_name: val("legalName"),
			pan_number: val("panNumber").toUpperCase(),
			org_address: val("orgAddress"),
			has_gstin: hasGstin,
			gstin_number: hasGstin ? val("gstinNumber").toUpperCase() : "",
			contact_full_name: val("contactFullName"),
			contact_mobile: val("contactMobile").replace(/\D/g, ""),
			beneficiary_name: val("beneficiaryName"),
			account_type: $("accountType").value || "",
			bank_name: $("bankName").value || "",
			account_number: val("accountNumber"),
			bank_ifsc: val("bankIfsc").toUpperCase(),
			pan_card_url: docs.pan,
			cancelled_cheque_url: docs.cheque,
			licence_url: docs.licence,
			accepted_undertaking: Boolean($("acceptUndertaking").checked),
			accepted_agreement: Boolean($("acceptFinalAgreement").checked),
			agreement_version: AGREEMENT_VERSION,
			is_final_submit: Boolean(isFinal)
		};
	}
	function applyForm(d) {
		if (!d) return;
		const set = (id, v) => { if ($(id) && v != null && v !== "") $(id).value = v; };
		set("theatreName", d.theatre_name);
		set("chainName", d.chain_name);
		set("theatreAddress", d.theatre_address);
		if (d.state && STATES.includes(d.state)) stateSelect.value = d.state;
		fillDistricts();
		set("theatreDistrict", d.district);
		set("theatrePincode", d.pincode);
		if (Array.isArray(d.screens) && d.screens.length) setScreens(d.screens);
		set("licenceNumber", d.licence_number);
		set("licenceValidTill", d.licence_valid_till);
		set("legalName", d.legal_name);
		set("panNumber", d.pan_number);
		set("orgAddress", d.org_address);
		if (d.has_gstin != null) {
			const radio = document.querySelector(`input[name="has_gstin"][value="${d.has_gstin ? "yes" : "no"}"]`);
			if (radio) radio.checked = true;
		}
		set("gstinNumber", d.gstin_number);
		syncGstin();
		set("contactFullName", d.contact_full_name);
		set("contactMobile", String(d.contact_mobile || "").replace(/^\+?91/, "").replace(/\D/g, "").slice(-10));
		set("beneficiaryName", d.beneficiary_name);
		set("accountType", d.account_type);
		set("bankName", d.bank_name);
		set("accountNumber", d.account_number);
		set("bankIfsc", d.bank_ifsc);
		if (d.accepted_undertaking != null) $("acceptUndertaking").checked = Boolean(d.accepted_undertaking);
		Object.keys(DOC_FIELDS).forEach((key) => {
			if (d[DOC_FIELDS[key]]) {
				docs[key] = d[DOC_FIELDS[key]];
				paintDoc(key, "Uploaded");
			}
		});
	}
	function saveLocal() {
		try { localStorage.setItem(DRAFT_KEY, JSON.stringify(readForm(false))); } catch (_) {}
	}
	function loadLocal() {
		try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (_) { return null; }
	}

	/* ── Validation ───────────────────────────────────────── */
	function validateStep1() {
		const d = readForm(false);
		if (!d.theatre_name) return fail($("theatreName"), "Enter your theatre or cinema name.");
		if (!d.theatre_address) return fail($("theatreAddress"), "Enter the theatre address.");
		if (!d.state) return fail(stateSelect, "Choose the state where the theatre is.");
		if (!d.district) return fail($("theatreDistrict"), "Enter the theatre's district.");
		if (!/^[1-9][0-9]{5}$/.test(d.pincode)) return fail($("theatrePincode"), "Enter a valid 6-digit PIN code.");
		if (!d.screens.length) return fail(screenRows.querySelector("input"), "Add at least one screen.");
		const names = new Set();
		for (const s of d.screens) {
			if (!s.name) return fail(screenRows.querySelector('[data-screen="name"]'), "Every screen needs a name.");
			if (!(s.seats >= 1 && s.seats <= 2000)) return fail(screenRows.querySelector('[data-screen="seats"]'), `${s.name}: seats must be between 1 and 2000.`);
			if (names.has(s.name.toLowerCase())) return fail(null, "Each screen needs a different name.");
			names.add(s.name.toLowerCase());
		}
		if (!d.licence_number) return fail($("licenceNumber"), "Enter your cinema licence number.");
		if (!d.licence_valid_till) return fail($("licenceValidTill"), "Enter the date your cinema licence is valid till.");
		if (d.licence_valid_till < new Date().toISOString().slice(0, 10)) return fail($("licenceValidTill"), "This cinema licence has expired. Renew it before registering.");
		if (!d.legal_name) return fail($("legalName"), "Enter the business legal name.");
		if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.pan_number)) return fail($("panNumber"), "Enter a valid 10-character PAN number (e.g. ABCDE1234F).");
		if (!d.org_address) return fail($("orgAddress"), "Enter the registered business address.");
		if (d.has_gstin && !/^[0-9A-Z]{15}$/.test(d.gstin_number)) return fail($("gstinNumber"), "Enter a valid 15-character GSTIN, or select No.");
		if (!d.accepted_undertaking) return fail($("acceptUndertaking"), "Please read and accept the undertaking to continue.");
		if (!d.contact_full_name) return fail($("contactFullName"), "Enter the contact person's full name.");
		if (d.contact_mobile.length !== 10) return fail($("contactMobile"), "Enter a valid 10-digit mobile number.");
		if (!d.beneficiary_name) return fail($("beneficiaryName"), "Please enter Beneficiary Name.");
		if (!d.account_type) return fail($("accountType"), "Please select Account Type.");
		if (!d.bank_name) return fail($("bankName"), "Please select Bank Name.");
		if (!/^\d{6,20}$/.test(d.account_number)) return fail($("accountNumber"), "Please enter a valid account number (6-20 digits).");
		if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(d.bank_ifsc)) return fail($("bankIfsc"), "Please enter a valid IFSC code (e.g. HDFC0001234).");
		return true;
	}
	function validateStep2() {
		if (!docs.pan) return fail(null, "Please upload your PAN card.");
		if (!docs.cheque) return fail(null, "Please upload a cancelled cheque.");
		if (!docs.licence) return fail(null, "Please upload your cinema licence.");
		return true;
	}
	function validateStep3() {
		const check = $("acceptFinalAgreement");
		if (check.disabled) return fail(null, "Scroll to the end of the agreement, then tick the box to accept it.");
		if (!check.checked) return fail(check, "Tick \u201CI have read and agree to the JOD Host & Ticketing Agreement\u201D, then click Accept Agreement.");
		return true;
	}

	/* ── Steps ────────────────────────────────────────────── */
	function goToStep(step) {
		currentStep = step;
		hideAlert();
		[1, 2, 3].forEach((n) => {
			$(`step${n}Section`).style.display = n === step ? "block" : "none";
			$(`tabStep${n}`).classList.toggle("active", n <= step);
		});
		$("btnBack").style.display = step === 1 ? "none" : "inline-flex";
		$("btnProceed").textContent = step === 1 ? "Continue to Upload Documents" : step === 2 ? "Continue to Sign Agreement" : "Accept Agreement & Submit";
		if (step === 3) {
			const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
			const set = (id, v) => { if ($(id) && v) $(id).textContent = v; };
			set("agreementEffectiveDate", today);
			set("agreementHostName", val("legalName") || val("theatreName"));
			set("agreementHostEmail", email);
			set("agreementHostId", user.customer_id ? String(user.customer_id).replace(/^CUST-/, "THR-") : "");
			watchAgreementScroll();
		}
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
	function watchAgreementScroll() {
		const doc = $("hostAgreementDoc");
		const check = $("acceptFinalAgreement");
		const hint = $("hostAgreementScrollHint");
		const unlock = () => { check.disabled = false; if (hint) hint.hidden = true; };
		if (check.checked || doc.scrollHeight - doc.clientHeight <= 8) return unlock();
		check.disabled = true;
		if (hint) hint.hidden = false;
		if (doc.dataset.scrollBound === "1") return;
		doc.dataset.scrollBound = "1";
		doc.addEventListener("scroll", () => { if (doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 24) unlock(); }, { passive: true });
	}
	$("tabStep1").addEventListener("click", () => goToStep(1));
	$("tabStep2").addEventListener("click", () => { if (validateStep1()) goToStep(2); });
	$("tabStep3").addEventListener("click", () => { if (validateStep1() && validateStep2()) goToStep(3); });
	$("btnBack").addEventListener("click", () => { if (currentStep > 1) goToStep(currentStep - 1); });

	/* ── Save / submit ────────────────────────────────────── */
	async function save(isFinal, silent) {
		hideAlert();
		const payload = readForm(isFinal);
		saveLocal();
		$("btnProceed").disabled = true;
		$("btnSaveDetails").disabled = true;
		try {
			const res = await authFetch(`${API}/registration`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (res.status === 404) {
					throw new Error("Theatre registration isn't switched on yet on our server. Your details are saved on this browser, so please try again in a few minutes.");
				}
				const detail = data.detail;
				throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((x) => x.msg || x).join(" ") : "Could not save your theatre details.");
			}
			if (isFinal) {
				try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
				showAlert("Theatre registration submitted. Redirecting\u2026", "success");
				setTimeout(() => { window.location.href = "theatre-status.html"; }, 800);
			} else if (!silent) {
				showAlert("Details saved. You can continue whenever you are ready.", "success");
			}
			return true;
		} catch (err) {
			showAlert(err.message === "Failed to fetch"
				? "We couldn't reach the server. Your details are saved on this browser, so you can try again shortly."
				: err.message);
			return false;
		} finally {
			$("btnProceed").disabled = false;
			$("btnSaveDetails").disabled = false;
		}
	}
	$("btnSaveDetails").addEventListener("click", () => save(false, false));
	$("btnProceed").addEventListener("click", async () => {
		if (!validateStep1()) return goToStep(1);
		if (currentStep === 1) {
			if (await save(false, true)) goToStep(2);
			return;
		}
		if (!validateStep2()) return goToStep(2);
		if (currentStep === 2) {
			if (await save(false, true)) goToStep(3);
			return;
		}
		if (validateStep3()) save(true, false);
	});

	/* ── Load ─────────────────────────────────────────────── */
	$("contactEmail").value = email;
	if (user.full_name) $("contactFullName").value = user.full_name;
	setScreens([]);
	let startStep = 1;
	try {
		const res = await authFetch(`${API}/registration`);
		if (res.ok) {
			const data = await res.json();
			if (!data.editable) {
				window.location.replace("theatre-status.html");
				return;
			}
			if (data.partner) {
				applyForm(data.partner);
				if (data.verification_status === "REJECTED") {
					showAlert("Our team sent your registration back" + (data.review_reason ? ": " + data.review_reason : ".") + " Update the details and submit again.");
				}
			} else {
				const local = loadLocal();
				applyForm(Object.assign({}, data.prefill || {}, local || {}));
				if (data.is_event_host && data.prefill && Object.keys(data.prefill).length) {
					const note = $("theatrePrefillNote");
					note.textContent = "We filled your business, contact, bank and KYC documents from your event host account. Check them before you submit.";
					note.hidden = false;
				}
			}
			if (data.partner) {
				const missing = data.missing_steps || [];
				if (missing.length && missing.every((m) => m === "signed agreement")) startStep = 3;
				else if (missing.length && missing.every((m) => /image|document|signed agreement/.test(m))) startStep = 2;
			}
		} else {
			applyForm(loadLocal());
		}
	} catch (_) {
		applyForm(loadLocal());
	}
	goToStep(startStep);

	let draftTimer = null;
	$("accountSetupForm").addEventListener("input", () => {
		clearTimeout(draftTimer);
		draftTimer = setTimeout(saveLocal, 400);
	});
	$("accountSetupForm").addEventListener("change", saveLocal);
});
