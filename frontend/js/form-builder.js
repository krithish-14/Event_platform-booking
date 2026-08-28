/**
 * Dynamic Registration Form Builder & Submissions Manager (Google Forms / Typeform style)
 */
function initFormBuilder() {
	const API_BASE = (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "").replace(/\/$/, '') + '/api/forms');

	const currentUser = window.JodAuth ? window.JodAuth.getUser() : null;
	const urlParams = new URLSearchParams(window.location.search);
	let email = currentUser ? currentUser.email : (urlParams.get("email") || sessionStorage.getItem("verified_organizer_email"));

	function resolveActiveEventId() {
		if (window.JodOrganizer && typeof window.JodOrganizer.getActiveEventId === "function") {
			const id = window.JodOrganizer.getActiveEventId();
			if (id) return id;
		}
		try {
			const em = email || sessionStorage.getItem("verified_organizer_email");
			if (em) return sessionStorage.getItem(`active_event_id_${em}`);
		} catch (_) {}
		return null;
	}

	function getHostEventsApiBase() {
		return (((window.JodHealth && window.JodHealth.getApiBaseUrl && window.JodHealth.getApiBaseUrl()) || (window.JodConfig && window.JodConfig.getApiOrigin && window.JodConfig.getApiOrigin()) || (window.JodAuth && window.JodAuth.API_BASE) || (window.JOD_API_BASE_OVERRIDE) || "").replace(/\/$/, '') + '/api/host-events');
	}

	function getUploadOrigin() {
		const api = getHostEventsApiBase();
		if (api.startsWith("http")) return api.replace(/\/api\/host-events\/?$/, "");
		return window.location.origin;
	}

	function resolveUploadUrl(url) {
		if (!url) return "";
		if (url.startsWith("blob:") || url.startsWith("data:")) return url;
		if (window.JodConfig && typeof window.JodConfig.safeMediaUrl === "function") {
			return window.JodConfig.safeMediaUrl(url, "images/hero-event.jpg");
		}
		if (url.startsWith("http://") || url.startsWith("https://")) return url;
		if (url.startsWith("/api/media") || url.startsWith("/uploads/") || url.startsWith("uploads/")) {
			return `${getUploadOrigin()}/${String(url).replace(/^\//, "")}`;
		}
		return url;
	}

	function getAuthHeaders() {
		const token = window.JodAuth ? window.JodAuth.getToken() : null;
		return token ? { "Authorization": `Bearer ${token}` } : {};
	}

	function authFetch(url, options) {
		const opts = Object.assign({ credentials: "include", cache: "no-store" }, options || {});
		opts.headers = Object.assign({}, getAuthHeaders(), opts.headers || {});
		if (window.JodAuth && typeof window.JodAuth.fetchAuth === "function") {
			return window.JodAuth.fetchAuth(url, opts);
		}
		return fetch(url, opts);
	}

	async function syncRegistrationFormToHost(eventId, schema, theme, published) {
		if (!email) return false;
		const formMeta = {
			form_title: builderFormTitle ? builderFormTitle.value.trim() : "",
			form_description: builderFormDesc ? builderFormDesc.value.trim() : "",
			schema: schema,
			theme_json: theme || {}
		};
		const res = await authFetch(`${getHostEventsApiBase()}/registration-form`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				organizer_email: email,
				event_id: eventId || undefined,
				questions_json: schema,
				form_json: formMeta,
				settings_json: theme,
				published: published === true
			})
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			const detail = typeof data.detail === "string" ? data.detail : (data.message || "Failed to save registration form.");
			throw new Error(detail);
		}
		return true;
	}

	function applyThemeObject(themeObj) {
		if (!themeObj || typeof themeObj !== "object") return;
		if (themeObj.primary_color && themePrimaryColor) themePrimaryColor.value = themeObj.primary_color;
		if (themeObj.page_bg_color && themePageBgColor) themePageBgColor.value = themeObj.page_bg_color;
		if (themeObj.card_bg_color && themeCardBgColor) themeCardBgColor.value = themeObj.card_bg_color;
		if (themeObj.border_radius && themeBorderRadius) themeBorderRadius.value = themeObj.border_radius;
		if (themeObj.banner_url && themeBannerUrl) themeBannerUrl.value = themeObj.banner_url;
		if (themeObj.page_bg_url && themePageBgUrl) themePageBgUrl.value = themeObj.page_bg_url;
	}

	function loadFromHost(reg) {
		if (!reg) return;
		let questionsData = reg.questions_json;
		let formMeta = reg.form_json;
		if (typeof formMeta === "string") {
			try { formMeta = JSON.parse(formMeta); } catch (_) { formMeta = null; }
		}
		if (Array.isArray(formMeta)) {
			if (!questionsData || !questionsData.length) questionsData = formMeta;
		} else if (formMeta && typeof formMeta === "object") {
			if (formMeta.form_title && builderFormTitle) builderFormTitle.value = formMeta.form_title;
			if (formMeta.form_description && builderFormDesc) builderFormDesc.value = formMeta.form_description;
			if (Array.isArray(formMeta.schema) && formMeta.schema.length) questionsData = formMeta.schema;
			if (formMeta.theme_json) applyThemeObject(formMeta.theme_json);
		}
		if (typeof questionsData === "string") {
			try { questionsData = JSON.parse(questionsData); } catch (_) { questionsData = []; }
		}
		if (Array.isArray(questionsData) && questionsData.length) {
			questions = questionsData;
		}
		let themeObj = reg.settings_json;
		if (typeof themeObj === "string") {
			try { themeObj = JSON.parse(themeObj); } catch (_) { themeObj = null; }
		}
		applyThemeObject(themeObj);
		if (reg.form_id) formId = reg.form_id;
		if (typeof renderBuilderQuestions === "function") {
			renderBuilderQuestions();
			renderLivePreview();
		}
	}

	if (currentUser && currentUser.id) {
		const userVerifiedEmail = sessionStorage.getItem(`verified_organizer_${currentUser.id}`);
		if (userVerifiedEmail) {
			email = userVerifiedEmail;
		}
	}

	// Elements
	const subTabBuilder = document.getElementById("subTabBuilder");
	const subTabSubmissions = document.getElementById("subTabSubmissions");
	const subTabCancellations = document.getElementById("subTabCancellations");
	const subViewBuilder = document.getElementById("subViewBuilder");
	const subViewSubmissions = document.getElementById("subViewSubmissions");
	const subViewCancellations = document.getElementById("subViewCancellations");

	const builderFormTitle = document.getElementById("builderFormTitle");
	const builderFormDesc = document.getElementById("builderFormDesc");
	const themePrimaryColor = document.getElementById("themePrimaryColor");
	const themePageBgColor = document.getElementById("themePageBgColor");
	const themeCardBgColor = document.getElementById("themeCardBgColor");
	const themeBorderRadius = document.getElementById("themeBorderRadius");
	const themePresetSelect = document.getElementById("themePresetSelect");
	const themeBannerUrl = document.getElementById("themeBannerUrl");
	const themePageBgUrl = document.getElementById("themePageBgUrl");
	const btnApplyPresetBanner = document.getElementById("btnApplyPresetBanner");

	const fileBannerInput = document.getElementById("fileBannerInput");
	const btnUploadBannerFile = document.getElementById("btnUploadBannerFile");
	const filePageBgInput = document.getElementById("filePageBgInput");
	const btnUploadPageBgFile = document.getElementById("btnUploadPageBgFile");

	const ALLOWED_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
	const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
	const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
	const IMAGE_TYPE_MSG = "Your image is not in this standard file type. Please use JPG, JPEG, PNG, or WEBP.";
	const IMAGE_SIZE_MSG = "Your image is not in this standard size. Maximum file size is 5MB.";

	function hasAllowedImageMagicBytes(bytes) {
		if (!bytes || bytes.length < 12) return false;
		const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
		const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
		const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
			&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
		return jpeg || png || webp;
	}

	async function validateImageFile(file) {
		if (!file) throw new Error(IMAGE_TYPE_MSG);
		if (file.size > MAX_IMAGE_BYTES) throw new Error(IMAGE_SIZE_MSG);
		const name = String(file.name || "").toLowerCase();
		const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
		const mime = String(file.type || "").toLowerCase();
		const extOk = ALLOWED_IMAGE_EXTS.includes(ext);
		const mimeOk = !mime || mime === "application/octet-stream" || ALLOWED_IMAGE_MIMES.includes(mime);
		if (!extOk || !mimeOk) throw new Error(IMAGE_TYPE_MSG);
		const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
		if (!hasAllowedImageMagicBytes(header)) throw new Error(IMAGE_TYPE_MSG);
	}

	function setInlineUploadError(hostEl, message) {
		if (!hostEl) return;
		let el = hostEl.querySelector(":scope > .design-upload-error");
		if (!el) {
			el = document.createElement("p");
			el.className = "design-upload-error";
			el.setAttribute("role", "alert");
			hostEl.appendChild(el);
		}
		el.textContent = message || "";
		el.style.display = message ? "block" : "none";
	}

	async function handleThemeImageFile(file, urlInput, uploadBtn, errorHost) {
		setInlineUploadError(errorHost, "");
		try {
			await validateImageFile(file);
		} catch (err) {
			setInlineUploadError(errorHost, err.message);
			return;
		}
		const reader = new FileReader();
		reader.onload = (evt) => {
			if (urlInput) {
				urlInput.dataset.uploadSrc = evt.target.result;
				urlInput.value = file.name;
			}
			if (uploadBtn) {
				const shortName = file.name.length > 14 ? `${file.name.substring(0, 14)}...` : file.name;
				uploadBtn.textContent = `✓ ${shortName}`;
				uploadBtn.style.color = "#10b981";
			}
			renderLivePreview();
		};
		reader.readAsDataURL(file);
	}

	const previewCardContainer = document.getElementById("previewCardContainer");
	const questionsList = document.getElementById("questionsList");
	const questionCountLabel = document.getElementById("questionCountLabel");
	const btnAddQuestion = document.getElementById("btnAddQuestion");

	// Device File Upload Handlers
	if (btnUploadBannerFile && fileBannerInput) {
		btnUploadBannerFile.addEventListener("click", () => fileBannerInput.click());
		fileBannerInput.addEventListener("change", (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			handleThemeImageFile(
				file,
				themeBannerUrl,
				btnUploadBannerFile,
				document.getElementById("regBannerUploadHost")
			);
			fileBannerInput.value = "";
		});
	}

	if (btnUploadPageBgFile && filePageBgInput) {
		btnUploadPageBgFile.addEventListener("click", () => filePageBgInput.click());
		filePageBgInput.addEventListener("change", (e) => {
			const file = e.target.files && e.target.files[0];
			if (!file) return;
			handleThemeImageFile(
				file,
				themePageBgUrl,
				btnUploadPageBgFile,
				document.getElementById("regBgUploadHost")
			);
			filePageBgInput.value = "";
		});
	}

	if (btnApplyPresetBanner && themeBannerUrl) {
		btnApplyPresetBanner.addEventListener("click", () => {
			themeBannerUrl.value = "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=1000";
			renderLivePreview();
		});
	}

	if (themePresetSelect) {
		themePresetSelect.addEventListener("change", (e) => {
			const val = e.target.value;
			if (val === "dark_cyber") {
				themePrimaryColor.value = "#3b82f6";
				themePageBgColor.value = "#0f172a";
				themeCardBgColor.value = "#1e293b";
				if (themePageBgUrl) themePageBgUrl.value = "";
			} else if (val === "midnight_blue") {
				themePrimaryColor.value = "#6366f1";
				themePageBgColor.value = "#1e1b4b";
				themeCardBgColor.value = "#312e81";
				if (themePageBgUrl) themePageBgUrl.value = "";
			} else if (val === "sunset_gradient") {
				themePrimaryColor.value = "#f59e0b";
				themePageBgColor.value = "#fae8ff";
				themeCardBgColor.value = "#ffffff";
				if (themePageBgUrl) themePageBgUrl.value = "";
			} else if (val === "emerald_fresh") {
				themePrimaryColor.value = "#10b981";
				themePageBgColor.value = "#f0fdf4";
				themeCardBgColor.value = "#ffffff";
				if (themePageBgUrl) themePageBgUrl.value = "";
			} else {
				themePrimaryColor.value = "#2563eb";
				themePageBgColor.value = "#f8fafc";
				themeCardBgColor.value = "#ffffff";
				if (themePageBgUrl) themePageBgUrl.value = "";
			}
			renderLivePreview();
		});
	}

	if (themeBannerUrl) themeBannerUrl.addEventListener("input", () => {
		// User typed manually — clear stored upload data so typed URL is used
		delete themeBannerUrl.dataset.uploadSrc;
		renderLivePreview();
	});
	if (themePageBgUrl) themePageBgUrl.addEventListener("input", () => {
		delete themePageBgUrl.dataset.uploadSrc;
		renderLivePreview();
	});
	if (themePageBgColor) themePageBgColor.addEventListener("input", renderLivePreview);
	if (themeCardBgColor) themeCardBgColor.addEventListener("input", renderLivePreview);

	const btnSaveDraftForm = document.getElementById("btnSaveDraftForm");
	const btnPublishForm = document.getElementById("btnPublishForm");
	const formStatusBadge = document.getElementById("formStatusBadge");
	const formVersionBadge = document.getElementById("formVersionBadge");

	// Live Preview Elements
	const previewHeader = document.getElementById("previewHeader");
	const previewTitle = document.getElementById("previewTitle");
	const previewDesc = document.getElementById("previewDesc");
	const previewRenderedForm = document.getElementById("previewRenderedForm");
	const previewSubmitBtn = document.getElementById("previewSubmitBtn");
	const livePreviewWrapper = document.getElementById("livePreviewWrapper");

	// Submissions Elements
	const submissionsTableBody = document.getElementById("submissionsTableBody");
	const submissionsSearch = document.getElementById("submissionsSearch");
	const submissionsStatusFilter = document.getElementById("submissionsStatusFilter");
	const submissionsFromDate = document.getElementById("submissionsFromDate");
	const submissionsToDate = document.getElementById("submissionsToDate");
	const btnResetFilters = document.getElementById("btnResetFilters");
	const btnRefreshSubmissions = document.getElementById("btnRefreshSubmissions");
	const btnExportCSV = document.getElementById("btnExportCSV");
	const kpiTotalSubmissions = document.getElementById("kpiTotalSubmissions");
	const kpiCompletionRate = document.getElementById("kpiCompletionRate");
	const kpiAvgTime = document.getElementById("kpiAvgTime");
	const submissionsTableHead = document.getElementById("submissionsTableHead");

	// Form State
	let formId = null;
	let version = 1;
	let isPublished = false;

	let questions = [
		{
			id: "q_name",
			type: "short_answer",
			title: "What is your Full Name?",
			placeholder: "Enter your full name",
			help_text: "Please enter your name as on official ID.",
			required: true
		},
		{
			id: "q_email",
			type: "email",
			title: "Email Address",
			placeholder: "example@domain.com",
			help_text: "",
			required: true
		},
		{
			id: "q_phone",
			type: "phone",
			title: "Mobile Phone Number",
			placeholder: "9876543210",
			help_text: "",
			required: true
		},
		{
			id: "q_food",
			type: "radio",
			title: "Dietary Preference",
			help_text: "",
			required: false,
			options: ["Vegetarian", "Non-Vegetarian", "Vegan"]
		}
	];

	let theme = {
		primary_color: "#2563eb",
		bg_color: "#f8fafc",
		border_radius: "8px"
	};

	let allSubmissionsData = [];
	let submissionQuestionColumns = [];

	// ── Sub-Tab Switcher ──────────────────────────────────────────────────────
	function styleSubTab(tab, active) {
		if (!tab) return;
		if (active) {
			tab.classList.add("active");
			tab.style.background = "#ffffff";
			tab.style.color = "#2563eb";
			tab.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
			tab.style.fontWeight = "700";
		} else {
			tab.classList.remove("active");
			tab.style.background = "transparent";
			tab.style.color = "#64748b";
			tab.style.boxShadow = "none";
			tab.style.fontWeight = "600";
		}
	}

	function showRegistrationSubView(view) {
		if (subViewBuilder) subViewBuilder.style.display = view === "builder" ? "block" : "none";
		if (subViewSubmissions) subViewSubmissions.style.display = view === "submissions" ? "block" : "none";
		if (subViewCancellations) subViewCancellations.style.display = view === "cancellations" ? "block" : "none";
		styleSubTab(subTabBuilder, view === "builder");
		styleSubTab(subTabSubmissions, view === "submissions");
		styleSubTab(subTabCancellations, view === "cancellations");
		if (view === "submissions") loadSubmissionsData();
		if (view === "cancellations") loadCancellationRequests();
	}

	if (subTabBuilder) {
		subTabBuilder.addEventListener("click", () => showRegistrationSubView("builder"));
	}
	if (subTabSubmissions) {
		subTabSubmissions.addEventListener("click", () => showRegistrationSubView("submissions"));
	}
	if (subTabCancellations) {
		subTabCancellations.addEventListener("click", () => showRegistrationSubView("cancellations"));
	}

	// ── Render Left Builder Questions List ────────────────────────────────────
	function renderBuilderQuestions() {
		if (!questions || !Array.isArray(questions) || questions.length === 0) {
			questions = [
				{
					id: "q_name",
					type: "short_answer",
					title: "What is your Full Name?",
					placeholder: "Enter your full name",
					help_text: "Please enter your name as on official ID.",
					required: true
				},
				{
					id: "q_email",
					type: "email",
					title: "Email Address",
					placeholder: "example@domain.com",
					help_text: "",
					required: true
				},
				{
					id: "q_phone",
					type: "phone",
					title: "Mobile Phone Number",
					placeholder: "9876543210",
					help_text: "",
					required: true
				},
				{
					id: "q_food",
					type: "radio",
					title: "Dietary Preference",
					help_text: "",
					required: false,
					options: ["Vegetarian", "Non-Vegetarian", "Vegan"]
				}
			];
		}

		const countEl = document.getElementById("questionCountLabel");
		if (countEl) countEl.textContent = questions.length;

		const wizardPreview = document.getElementById("manageWizardQuestionsPreview");
		if (wizardPreview) {
			wizardPreview.innerHTML = questions.map((q, idx) => `
				<div style="display:flex; justify-content:space-between; align-items:center; ${idx < questions.length - 1 ? 'border-bottom:1px solid #f1f5f9; padding-bottom:0.4rem;' : ''} font-size:0.85rem; font-weight:700; color:#334155;">
					<span>${q.title || ('Question ' + (idx + 1))} ${q.required ? '<span style="color:#ef4444;">*</span>' : ''}</span>
					<span style="background:#eff6ff; color:#2563eb; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.75rem;">${q.type}</span>
				</div>
			`).join('');
		}

		const listEl = document.getElementById("questionsList");
		if (!listEl) return;
		listEl.innerHTML = "";

		questions.forEach((q, idx) => {
			try {
				if (!q) return;
				if (!q.id) q.id = "q_" + idx;
				if (!q.type) q.type = "short_answer";
				if (!q.title) q.title = `Question ${idx + 1}`;
				if (!q.placeholder) q.placeholder = "";
				if (!q.help_text) q.help_text = "";
				if (typeof q.required !== "boolean") q.required = false;

				const hasOptions = ["dropdown", "radio", "checkbox"].includes(q.type);
				if (hasOptions && (!q.options || !Array.isArray(q.options))) {
					q.options = ["Option 1", "Option 2"];
				}

				const card = document.createElement("div");
				card.className = "builder-question-card";

				const titleStr = String(q.title || '').replace(/"/g, '&quot;');
				const placeholderStr = String(q.placeholder || '').replace(/"/g, '&quot;');
				const helpStr = String(q.help_text || '').replace(/"/g, '&quot;');

				card.innerHTML = `
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.6rem;">
						<span class="builder-q-badge">Q${idx + 1}</span>
						
						<div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
							<select class="setup-select q-type-select" style="padding: 0.4rem 0.7rem; font-size: 0.88rem; font-weight: 700; height: 40px; line-height: 1.3; max-width: 240px; border-radius: 8px;">
								<option value="short_answer" ${q.type === 'short_answer' ? 'selected' : ''}>Short Answer</option>
								<option value="paragraph" ${q.type === 'paragraph' ? 'selected' : ''}>Paragraph</option>
								<option value="email" ${q.type === 'email' ? 'selected' : ''}>Email Address</option>
								<option value="phone" ${q.type === 'phone' ? 'selected' : ''}>Phone Number</option>
								<option value="dropdown" ${q.type === 'dropdown' ? 'selected' : ''}>Dropdown Select</option>
								<option value="radio" ${q.type === 'radio' ? 'selected' : ''}>Multiple Choice Radio</option>
								<option value="checkbox" ${q.type === 'checkbox' ? 'selected' : ''}>Checkboxes</option>
								<option value="date" ${q.type === 'date' ? 'selected' : ''}>Date Picker</option>
								<option value="file_upload" ${q.type === 'file_upload' ? 'selected' : ''}>File Upload</option>
								<option value="address" ${q.type === 'address' ? 'selected' : ''}>Address Block</option>
								<option value="terms" ${q.type === 'terms' ? 'selected' : ''}>Terms Checkbox</option>
							</select>
						</div>

						<div style="display: flex; align-items: center; gap: 0.4rem;">
							<button type="button" class="btn-move-up" title="Move Up" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''} style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:0.25rem 0.5rem; cursor:pointer; font-weight:700;">↑</button>
							<button type="button" class="btn-move-down" title="Move Down" ${idx === questions.length - 1 ? 'disabled style="opacity:0.3;"' : ''} style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:0.25rem 0.5rem; cursor:pointer; font-weight:700;">↓</button>
							<button type="button" class="btn-duplicate-q" title="Duplicate Question" style="background:#eff6ff; border:1px solid #bfdbfe; color:#2563eb; border-radius:6px; padding:0.25rem 0.65rem; cursor:pointer; font-weight:700; font-size:0.8rem;">Copy</button>
							<button type="button" class="btn-delete-q" title="Delete Question" style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; border-radius:6px; padding:0.25rem 0.65rem; cursor:pointer; font-weight:700; font-size:0.8rem;">Delete</button>
						</div>
					</div>

					<div class="setup-grid-2">
						<div class="setup-form-group">
							<label>Question Title</label>
							<input type="text" class="setup-input q-title-input" value="${titleStr}" placeholder="Enter question..." style="padding-left: 0.8rem;" />
						</div>
						<div class="setup-form-group">
							<label>Placeholder Text</label>
							<input type="text" class="setup-input q-placeholder-input" value="${placeholderStr}" placeholder="e.g. Enter value" style="padding-left: 0.8rem;" />
						</div>
					</div>

					<div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
						<div class="setup-form-group" style="flex: 1;">
							<label>Help Text / Description (Optional)</label>
							<input type="text" class="setup-input q-help-input" value="${helpStr}" placeholder="Helper guidance..." style="padding-left: 0.8rem;" />
						</div>
						<div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 1.2rem;">
							<label style="font-weight: 700; font-size: 0.85rem; cursor: pointer;">
								<input type="checkbox" class="q-required-check" ${q.required ? 'checked' : ''} /> Required
							</label>
						</div>
					</div>

					${hasOptions ? `
						<div class="q-options-box">
							<label style="font-size: 0.82rem; font-weight: 700; color: #475569; margin-bottom: 0.5rem; display: block;">Options List</label>
							<div class="q-options-container" style="display: flex; flex-direction: column; gap: 0.4rem;">
								${(q.options || ["Option 1"]).map((opt, oIdx) => `
									<div style="display: flex; gap: 0.4rem; align-items: center;">
										<input type="text" class="setup-input q-option-input" value="${String(opt || '').replace(/"/g, '&quot;')}" style="height: 36px; font-size: 0.85rem; padding-left: 0.8rem;" data-opt-idx="${oIdx}" />
										<button type="button" class="btn-del-option" data-opt-idx="${oIdx}" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 6px; padding: 0 0.5rem; height: 36px; cursor: pointer; font-weight: 700;">&times;</button>
									</div>
								`).join('')}
							</div>
							<button type="button" class="btn-add-option" style="background: #ffffff; border: 1px dashed #3b82f6; color: #2563eb; font-weight: 700; font-size: 0.78rem; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; margin-top: 0.5rem;">+ Add Option</button>
						</div>
					` : ''}
				`;

				// Event Listeners for Question Editing (Safely bound)
				card.querySelector(".q-type-select")?.addEventListener("change", (e) => {
					q.type = e.target.value;
					if (["dropdown", "radio", "checkbox"].includes(q.type) && !q.options) {
						q.options = ["Option 1", "Option 2"];
					}
					renderBuilderQuestions();
					renderLivePreview();
				});

				card.querySelector(".q-title-input")?.addEventListener("input", (e) => {
					q.title = e.target.value;
					renderLivePreview();
				});

				card.querySelector(".q-placeholder-input")?.addEventListener("input", (e) => {
					q.placeholder = e.target.value;
					renderLivePreview();
				});

				card.querySelector(".q-help-input")?.addEventListener("input", (e) => {
					q.help_text = e.target.value;
					renderLivePreview();
				});

				card.querySelector(".q-required-check")?.addEventListener("change", (e) => {
					q.required = e.target.checked;
					renderLivePreview();
				});

				// Up / Down / Duplicate / Delete
				card.querySelector(".btn-move-up")?.addEventListener("click", () => {
					if (idx > 0) {
						const temp = questions[idx];
						questions[idx] = questions[idx - 1];
						questions[idx - 1] = temp;
						renderBuilderQuestions();
						renderLivePreview();
					}
				});

				card.querySelector(".btn-move-down")?.addEventListener("click", () => {
					if (idx < questions.length - 1) {
						const temp = questions[idx];
						questions[idx] = questions[idx + 1];
						questions[idx + 1] = temp;
						renderBuilderQuestions();
						renderLivePreview();
					}
				});

				card.querySelector(".btn-duplicate-q")?.addEventListener("click", () => {
					const dup = JSON.parse(JSON.stringify(q));
					dup.id = "q_" + Date.now();
					dup.title += " (Copy)";
					questions.splice(idx + 1, 0, dup);
					renderBuilderQuestions();
					renderLivePreview();
				});

				card.querySelector(".btn-delete-q")?.addEventListener("click", () => {
					if (questions.length > 1) {
						questions.splice(idx, 1);
						renderBuilderQuestions();
						renderLivePreview();
					}
				});

				// Options Handlers
				if (hasOptions) {
					const optionInputs = card.querySelectorAll(".q-option-input");
					optionInputs.forEach(optInput => {
						optInput.addEventListener("input", (e) => {
							const oIdx = parseInt(e.target.getAttribute("data-opt-idx"));
							q.options[oIdx] = e.target.value;
							renderLivePreview();
						});
					});

					card.querySelectorAll(".btn-del-option").forEach(btn => {
						btn.addEventListener("click", (e) => {
							const oIdx = parseInt(e.target.getAttribute("data-opt-idx"));
							if (q.options.length > 1) {
								q.options.splice(oIdx, 1);
								renderBuilderQuestions();
								renderLivePreview();
							}
						});
					});

					const btnAddOpt = card.querySelector(".btn-add-option");
					if (btnAddOpt) {
						btnAddOpt.addEventListener("click", () => {
							q.options.push(`Option ${q.options.length + 1}`);
							renderBuilderQuestions();
							renderLivePreview();
						});
					}
				}

				listEl.appendChild(card);
			} catch (err) {
				console.error("Error rendering question card:", err);
			}
		});
	}

	// ── Render Right Column Instant Live Preview ──────────────────────────────
	function renderLivePreview() {
		if (!previewRenderedForm) return;

		// Update Header Title & Description
		if (previewTitle && builderFormTitle) previewTitle.textContent = builderFormTitle.value.trim() || "Event Registration Form";
		if (previewDesc && builderFormDesc) previewDesc.textContent = builderFormDesc.value.trim() || "";

		// Update Theme Styles, Page Background, Card Background & Banner Header Image
		const primary = themePrimaryColor ? themePrimaryColor.value : "#2563eb";
		const pageBg = themePageBgColor ? themePageBgColor.value : "#f8fafc";
		const cardBg = themeCardBgColor ? themeCardBgColor.value : "#ffffff";
		const radius = themeBorderRadius ? themeBorderRadius.value : "8px";
		// Use uploaded base64 data if available, otherwise use the typed URL value
		const bannerUrl = themeBannerUrl
			? (themeBannerUrl.dataset.uploadSrc || themeBannerUrl.value.trim())
			: "";
		const pageBgUrl = themePageBgUrl
			? (themePageBgUrl.dataset.uploadSrc || themePageBgUrl.value.trim())
			: "";

		// Outer Page Background Style
		if (livePreviewWrapper) {
			if (pageBgUrl) {
				livePreviewWrapper.style.background = `url('${resolveUploadUrl(pageBgUrl).replace(/'/g, "\\'")}') center/cover no-repeat`;
			} else {
				livePreviewWrapper.style.background = pageBg;
			}
			livePreviewWrapper.style.borderRadius = "14px";
		}

		// Inner Form Card Style
		if (previewCardContainer) {
			previewCardContainer.style.background = cardBg;
			previewCardContainer.style.borderRadius = radius;

			// Dark / Light text auto contrast
			const isDarkCard = cardBg.toLowerCase() === "#0f172a" || cardBg.toLowerCase() === "#1e293b" || cardBg.toLowerCase() === "#1e1b4b" || cardBg.toLowerCase() === "#312e81";
			const textColor = isDarkCard ? "#ffffff" : "#0f172a";
			const subTextColor = isDarkCard ? "#94a3b8" : "#64748b";

			if (previewTitle) previewTitle.style.color = textColor;
			if (previewDesc) previewDesc.style.color = subTextColor;
			previewCardContainer.style.color = textColor;
		}

		// Header Banner Image
		let previewBannerImg = document.getElementById("previewHeaderBannerImg");
		if (bannerUrl) {
			if (!previewBannerImg) {
				previewBannerImg = document.createElement("img");
				previewBannerImg.id = "previewHeaderBannerImg";
				previewBannerImg.style.width = "100%";
				previewBannerImg.style.height = "130px";
				previewBannerImg.style.objectFit = "cover";
				previewBannerImg.style.borderRadius = `${radius} ${radius} 0 0`;
				previewBannerImg.style.marginBottom = "1rem";
				if (previewHeader && previewHeader.parentNode) {
					previewHeader.parentNode.insertBefore(previewBannerImg, previewHeader);
				}
			}
			previewBannerImg.src = resolveUploadUrl(bannerUrl);
			previewBannerImg.style.display = "block";
		} else if (previewBannerImg) {
			previewBannerImg.style.display = "none";
		}

		if (previewHeader) previewHeader.style.borderBottomColor = primary;
		if (previewSubmitBtn) {
			previewSubmitBtn.style.background = primary;
			previewSubmitBtn.style.borderRadius = radius;
		}

		// Render Questions Controls
		previewRenderedForm.innerHTML = "";

		questions.forEach((q) => {
			const group = document.createElement("div");
			group.className = "setup-form-group";

			const reqSpan = q.required ? '<span style="color:#ef4444;">*</span>' : '';
			const helpHtml = q.help_text ? `<span style="font-size:0.75rem; color:#64748b; margin-top:0.1rem; display:block;">${q.help_text}</span>` : '';

			let fieldHtml = '';

			switch (q.type) {
				case 'short_answer':
				case 'email':
				case 'phone':
					fieldHtml = `<input type="${q.type === 'email' ? 'email' : 'text'}" class="setup-input" placeholder="${q.placeholder || ''}" style="border-radius:${radius}; border-color:#cbd5e1;" />`;
					break;
				case 'paragraph':
				case 'address':
					fieldHtml = `<textarea class="setup-textarea" placeholder="${q.placeholder || ''}" style="border-radius:${radius}; border-color:#cbd5e1; min-height:70px;"></textarea>`;
					break;
				case 'dropdown':
					fieldHtml = `
						<select class="setup-select" style="border-radius:${radius}; padding-left:0.8rem;">
							${(q.options || []).map(opt => `<option>${opt}</option>`).join('')}
						</select>
					`;
					break;
				case 'radio':
					fieldHtml = `
						<div style="display:flex; flex-direction:column; gap:0.4rem; margin-top:0.2rem;">
							${(q.options || []).map(opt => `
								<label style="font-weight:600; font-size:0.88rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem; color:#334155;">
									<input type="radio" name="prev_${q.id}" /> ${opt}
								</label>
							`).join('')}
						</div>
					`;
					break;
				case 'checkbox':
					fieldHtml = `
						<div style="display:flex; flex-direction:column; gap:0.4rem; margin-top:0.2rem;">
							${(q.options || []).map(opt => `
								<label style="font-weight:600; font-size:0.88rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem; color:#334155;">
									<input type="checkbox" /> ${opt}
								</label>
							`).join('')}
						</div>
					`;
					break;
				case 'date':
					fieldHtml = `<input type="date" class="setup-input" style="border-radius:${radius}; border-color:#cbd5e1;" />`;
					break;
				case 'file_upload':
					fieldHtml = `
						<div style="border:1.5px dashed #cbd5e1; background:#ffffff; border-radius:${radius}; padding:1rem; text-align:center;">
							<span style="font-weight:600; font-size:0.85rem; color:#2563eb;">Upload File ↗</span>
						</div>
					`;
					break;
				case 'terms':
					fieldHtml = `
						<label style="font-weight:600; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem; color:#334155;">
							<input type="checkbox" /> I agree to the terms and event policies.
						</label>
					`;
					break;
				default:
					fieldHtml = `<input type="text" class="setup-input" placeholder="${q.placeholder || ''}" style="border-radius:${radius};" />`;
			}

			group.innerHTML = `
				<label style="font-size:0.88rem; font-weight:700; color:#0f172a;">${q.title} ${reqSpan}</label>
				${helpHtml}
				${fieldHtml}
			`;

			previewRenderedForm.appendChild(group);
		});
	}

	// ── Form Input Change Listeners ───────────────────────────────────────────
	if (builderFormTitle) builderFormTitle.addEventListener("input", renderLivePreview);
	if (builderFormDesc) builderFormDesc.addEventListener("input", renderLivePreview);
	if (themePrimaryColor) themePrimaryColor.addEventListener("input", renderLivePreview);
	if (themePageBgColor) themePageBgColor.addEventListener("input", renderLivePreview);
	if (themeCardBgColor) themeCardBgColor.addEventListener("input", renderLivePreview);
	if (themeBorderRadius) themeBorderRadius.addEventListener("change", renderLivePreview);

	if (btnAddQuestion) {
		btnAddQuestion.addEventListener("click", (e) => {
			e.preventDefault();
			if (!Array.isArray(questions)) questions = [];
			questions.push({
				id: "q_" + Date.now(),
				type: "short_answer",
				title: `New Question ${questions.length + 1}`,
				placeholder: "Enter answer...",
				help_text: "",
				required: false
			});
			renderBuilderQuestions();
			renderLivePreview();
		});
	}

	// Document-level Click Delegation for Add Question Button
	document.addEventListener("click", (e) => {
		const btn = e.target.closest("#btnAddQuestion");
		if (btn) {
			e.preventDefault();
			e.stopPropagation();
			if (!Array.isArray(questions)) questions = [];
			questions.push({
				id: "q_" + Date.now(),
				type: "short_answer",
				title: `New Question ${questions.length + 1}`,
				placeholder: "Enter answer...",
				help_text: "",
				required: false
			});
			renderBuilderQuestions();
			renderLivePreview();
			setTimeout(() => {
				const qList = document.getElementById("questionsList");
				if (qList && qList.lastElementChild) {
					qList.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				}
			}, 60);
		}
	});

	// Save Draft API Handler
	async function saveDraftForm() {
		// Use base64 data from upload if available, otherwise fall back to typed URL
		const bannerSrc = themeBannerUrl
			? (themeBannerUrl.dataset.uploadSrc || themeBannerUrl.value.trim())
			: "";
		const pageBgSrc = themePageBgUrl
			? (themePageBgUrl.dataset.uploadSrc || themePageBgUrl.value.trim())
			: "";

		const payload = {
			organizer_email: email,
			event_id: resolveActiveEventId(),
			form_title: builderFormTitle.value.trim() || "Event Registration Form",
			form_description: builderFormDesc.value.trim() || "",
			schema_json: questions,
			theme_json: {
				primary_color: themePrimaryColor ? themePrimaryColor.value : "#2563eb",
				page_bg_color: themePageBgColor ? themePageBgColor.value : "#f8fafc",
				card_bg_color: themeCardBgColor ? themeCardBgColor.value : "#ffffff",
				border_radius: themeBorderRadius ? themeBorderRadius.value : "8px",
				banner_url: bannerSrc,
				page_bg_url: pageBgSrc
			}
		};

		const btn = document.getElementById("btnSaveDraftForm");
		const origLabel = btn ? btn.textContent : "Save Draft";
		if (btn) { btn.textContent = "Saving..."; btn.disabled = true; }

		try {
			const res = await authFetch(`${API_BASE}/save-draft`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.detail || "Failed to save draft.");

			formId = data.form_id;
			const lifecycle = window.JodOrganizer && typeof window.JodOrganizer.getLifecycle === "function"
				? window.JodOrganizer.getLifecycle()
				: "draft";
			const updated = lifecycle === "published" || lifecycle === "live" || lifecycle === "ended";
			await syncRegistrationFormToHost(
				resolveActiveEventId(),
				payload.schema_json,
				payload.theme_json,
				updated === true
			);
			if (formStatusBadge) {
				formStatusBadge.textContent = updated ? "Form Updated" : "Draft Saved";
				formStatusBadge.style.background = updated ? "#f0fdf4" : "#fef3c7";
				formStatusBadge.style.color = updated ? "#166534" : "#b45309";
			}
			const successLabel = updated ? "✓ Registration form updated successfully" : "✓ Registration form saved";
			if (btn) { btn.textContent = successLabel; btn.style.color = "#059669"; }
			if (window.showNotification) {
				window.showNotification(successLabel);
			}
			setTimeout(() => {
				if (btn) { btn.textContent = origLabel; btn.style.color = ""; btn.disabled = false; }
			}, 2500);
			return true;
		} catch (err) {
			alert(err.message || "Failed to save registration form.");
			if (btn) { btn.textContent = origLabel; btn.disabled = false; }
			return false;
		}
	}

	// Publish Form API Handler
	async function publishFormLive(e) {
		// When form-builder.js is loaded inside organizer-dashboard.html, let the
		// dashboard's own organizer-dashboard.js publish handler drive the flow.
		// This avoids double-submits and accidental navigation ("Stitch bug").
		const insideDashboard = (
			typeof window === "object" &&
			window.location &&
			/organizer-dashboard/i.test(window.location.pathname || "")
		);
		if (insideDashboard) {
			// Dashboard publish handler (organizer-dashboard.js) owns this.
			// Return early; do NOT open published-form.html here.
			return;
		}

		const btn = document.getElementById("btnPublishForm");
		const origLabel = btn ? btn.innerHTML : "Publish Form";

		// Guard: prevent double-click
		if (btn && btn.disabled) return;

		// Use base64 data from upload if available, otherwise fall back to typed URL
		const bannerSrc = themeBannerUrl
			? (themeBannerUrl.dataset.uploadSrc || themeBannerUrl.value.trim())
			: "";
		const pageBgSrc = themePageBgUrl
			? (themePageBgUrl.dataset.uploadSrc || themePageBgUrl.value.trim())
			: "";

		const payload = {
			organizer_email: email,
			event_id: resolveActiveEventId(),
			form_title: builderFormTitle.value.trim() || "Event Registration Form",
			form_description: builderFormDesc.value.trim() || "",
			schema_json: questions,
			theme_json: {
				primary_color: themePrimaryColor ? themePrimaryColor.value : "#2563eb",
				page_bg_color: themePageBgColor ? themePageBgColor.value : "#f8fafc",
				card_bg_color: themeCardBgColor ? themeCardBgColor.value : "#ffffff",
				border_radius: themeBorderRadius ? themeBorderRadius.value : "8px",
				banner_url: bannerSrc,
				page_bg_url: pageBgSrc
			}
		};

		// Show publishing state
		if (btn) {
			btn.disabled = true;
			btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.45rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Publishing...</span>`;
			btn.style.opacity = "0.8";
		}

		try {
			const res = await authFetch(`${API_BASE}/publish`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.detail || "Failed to publish form.");

			formId = data.form_id;
			version = data.version;
			isPublished = true;

			if (formStatusBadge) {
				formStatusBadge.textContent = "Live & Published ✓";
				formStatusBadge.style.background = "#f0fdf4";
				formStatusBadge.style.color = "#166534";
			}
			if (formVersionBadge) formVersionBadge.textContent = `Version: ${version}`;

			// Sync to host_events_api table (fire-and-forget)
			syncRegistrationFormToHost(resolveActiveEventId(), payload.schema_json, payload.theme_json, true).catch(() => {});

			// Success state on button
			if (btn) {
				btn.innerHTML = `✓ Published! Opening Preview...`;
				btn.style.background = "linear-gradient(135deg, #059669 0%, #047857 100%)";
				btn.style.opacity = "1";
			}

			// Open published form in a new tab
			const baseUrl = window.location.origin;
			setTimeout(() => {
				window.open(`${baseUrl}/published-form.html?formId=${formId}`, "_blank");
				// Restore button
				if (btn) {
					btn.innerHTML = origLabel;
					btn.style.background = "";
					btn.style.opacity = "1";
					btn.disabled = false;
				}
			}, 1800);

		} catch (err) {
			alert(err.message || "Failed to publish form.");
			if (btn) {
				btn.innerHTML = origLabel;
				btn.style.opacity = "1";
				btn.disabled = false;
			}
		}
	}

	if (btnSaveDraftForm) btnSaveDraftForm.addEventListener("click", saveDraftForm);
	if (btnPublishForm) btnPublishForm.addEventListener("click", publishFormLive);

	async function saveAndPublishForEvent() {
		await saveDraftForm();
		const eventId = resolveActiveEventId();
		const bannerSrc = themeBannerUrl
			? (themeBannerUrl.dataset.uploadSrc || themeBannerUrl.value.trim())
			: "";
		const pageBgSrc = themePageBgUrl
			? (themePageBgUrl.dataset.uploadSrc || themePageBgUrl.value.trim())
			: "";
		const payload = {
			organizer_email: email,
			event_id: eventId,
			form_title: builderFormTitle.value.trim() || "Event Registration Form",
			form_description: builderFormDesc.value.trim() || "",
			schema_json: questions,
			theme_json: {
				primary_color: themePrimaryColor ? themePrimaryColor.value : "#2563eb",
				page_bg_color: themePageBgColor ? themePageBgColor.value : "#f8fafc",
				card_bg_color: themeCardBgColor ? themeCardBgColor.value : "#ffffff",
				border_radius: themeBorderRadius ? themeBorderRadius.value : "8px",
				banner_url: bannerSrc,
				page_bg_url: pageBgSrc
			}
		};
		const res = await authFetch(`${API_BASE}/publish`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.detail || "Failed to publish registration form.");
		formId = data.form_id;
		isPublished = true;
		await syncRegistrationFormToHost(eventId, payload.schema_json, payload.theme_json, true);
		return data;
	}

	window.JodFormBuilder = {
		saveDraft: saveDraftForm,
		saveAndPublishForEvent,
		loadFromHost,
		loadSubmissionsData
	};

	const btnViewFormHost = document.getElementById("btnViewFormHost");
	async function viewFormHostMode() {
		if (!formId) {
			await saveDraftForm();
		}
		if (!formId) {
			alert("Please save a draft of your form first.");
			return;
		}

		const baseUrl = window.location.origin;

		window.open(`${baseUrl}/published-form.html?formId=${formId}&mode=readOnly`, "_blank");
	}

	if (btnViewFormHost) btnViewFormHost.addEventListener("click", viewFormHostMode);

	// Load Form Definition from API
	async function loadFormDefinition() {
		try {
			const hostRes = await authFetch(
				`${getHostEventsApiBase()}/current?email=${encodeURIComponent(email)}`
			);
			if (hostRes.ok) {
				const hostData = await hostRes.json();
				if (hostData.registration_form) {
					loadFromHost(hostData.registration_form);
					renderBuilderQuestions();
					renderLivePreview();
					return;
				}
			}
		} catch (e) {
			console.log("Host registration form not loaded, trying forms API.");
		}
		try {
			const activeEventId = typeof resolveActiveEventId === "function" ? resolveActiveEventId() : "";
			const eventQs = activeEventId ? `&event_id=${encodeURIComponent(activeEventId)}` : "";
			const res = await authFetch(`${API_BASE}/get-form?email=${encodeURIComponent(email)}${eventQs}`, {
				headers: { Accept: "application/json" }
			});
			if (res.ok) {
				const data = await res.json();
				if (data.form_title && builderFormTitle) builderFormTitle.value = data.form_title;
				if (data.form_description && builderFormDesc) builderFormDesc.value = data.form_description;
				
				if (data.schema_json) {
					let parsed = data.schema_json;
					if (typeof parsed === 'string') {
						try { parsed = JSON.parse(parsed); } catch(e) {}
					}
					if (Array.isArray(parsed) && parsed.length > 0) {
						questions = parsed;
					}
				}

				if (data.version && formVersionBadge) {
					version = data.version;
					formVersionBadge.textContent = `Version: ${version}`;
				}
				if (data.is_published && formStatusBadge) {
					formStatusBadge.textContent = "Live & Published ✓";
					formStatusBadge.style.background = "#f0fdf4";
					formStatusBadge.style.color = "#166534";
				}

				let themeObj = data.theme_json;
				if (typeof themeObj === 'string') {
					try { themeObj = JSON.parse(themeObj); } catch(e) { themeObj = null; }
				}
				if (themeObj && typeof themeObj === 'object') {
					if (themeObj.primary_color && themePrimaryColor) themePrimaryColor.value = themeObj.primary_color;
					if (themeObj.page_bg_color && themePageBgColor) themePageBgColor.value = themeObj.page_bg_color;
					if (themeObj.card_bg_color && themeCardBgColor) themeCardBgColor.value = themeObj.card_bg_color;
					if (themeObj.border_radius && themeBorderRadius) themeBorderRadius.value = themeObj.border_radius;
					if (themeObj.banner_url && themeBannerUrl) themeBannerUrl.value = themeObj.banner_url;
					if (themeObj.page_bg_url && themePageBgUrl) themePageBgUrl.value = themeObj.page_bg_url;
				}
			}
		} catch (e) {
			console.log("Using default form builder schema.");
		}
		renderBuilderQuestions();
		renderLivePreview();
	}

	// ── Submissions & Analytics Manager ───────────────────────────────────────
	async function loadSubmissionsData() {
		if (!submissionsTableBody) return;
		const eventId = resolveActiveEventId() || "";
		try {
			const qs = new URLSearchParams();
			if (email) qs.set("email", email);
			if (eventId) qs.set("event_id", eventId);
			const res = await authFetch(`${API_BASE}/submissions?${qs.toString()}`, {
				headers: { Accept: "application/json" }
			});
			if (!res.ok) throw new Error("Could not load submissions");
			const data = await res.json();
			submissionQuestionColumns = Array.isArray(data.columns) ? data.columns : [];
			if (data.analytics) {
				if (kpiTotalSubmissions) kpiTotalSubmissions.textContent = data.analytics.total_registrations;
				if (kpiCompletionRate) kpiCompletionRate.textContent = data.analytics.completion_rate || "0%";
				if (kpiAvgTime) kpiAvgTime.textContent = data.analytics.avg_completion_time || "—";
			}
			allSubmissionsData = Array.isArray(data.submissions) ? data.submissions : [];
			applySubmissionFilters();
			loadCancellationRequests();
		} catch (e) {
			console.log("Could not load submissions.");
			allSubmissionsData = [];
			renderSubmissionsTable([]);
			loadCancellationRequests();
		}
	}

	function parseSubmissionDate(sub) {
		const iso = sub && sub.submitted_at_iso;
		if (iso) {
			const dt = new Date(iso);
			if (Number.isFinite(dt.getTime())) return dt;
		}
		if (!sub || !sub.submitted_at) return null;
		const dt = new Date(sub.submitted_at);
		return Number.isFinite(dt.getTime()) ? dt : null;
	}

	function applySubmissionFilters() {
		if (!allSubmissionsData) return;
		const query = submissionsSearch ? submissionsSearch.value.trim().toLowerCase() : "";
		const statusValue = submissionsStatusFilter ? submissionsStatusFilter.value : "all";
		const fromDate = submissionsFromDate && submissionsFromDate.value ? new Date(submissionsFromDate.value) : null;
		const toDate = submissionsToDate && submissionsToDate.value ? new Date(submissionsToDate.value) : null;

		const filtered = allSubmissionsData.filter(s => {
			const statusNow = String(s.status || "").toLowerCase();
			if (statusNow === "cancelled" || statusNow === "canceled") return false;
			const hay = [
				s.user_email,
				s.attendee_name,
				s.ticket_type,
				s.status,
				JSON.stringify(s.answer_values || s.answers || {})
			].join(" ").toLowerCase();
			const statusMatch = statusValue === "all" || (s.status && s.status.toLowerCase() === statusValue);
			const submissionDate = parseSubmissionDate(s);
			const fromMatch = !fromDate || (submissionDate && submissionDate >= fromDate);
			const toMatch = !toDate || (submissionDate && submissionDate <= new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59));
			const queryMatch = !query || hay.includes(query);
			return queryMatch && statusMatch && fromMatch && toMatch;
		});

		renderSubmissionsTable(filtered);
	}

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function renderSubmissionsHead(columns) {
		if (!submissionsTableHead) return;
		const extra = (columns || []).map((title) => `<th style="padding:0.85rem 1rem; white-space:nowrap;">${escapeHtml(title)}</th>`).join("");
		submissionsTableHead.innerHTML = `
			<th style="padding: 0.85rem 1.2rem;">ID</th>
			<th style="padding: 0.85rem 1.2rem;">Name</th>
			<th style="padding: 0.85rem 1.2rem;">Email</th>
			<th style="padding: 0.85rem 1.2rem;">Ticket</th>
			<th style="padding: 0.85rem 1.2rem;">Submitted</th>
			<th style="padding: 0.85rem 1.2rem;">Status</th>
			${extra}
			<th style="padding: 0.85rem 1.2rem; text-align: right;">Action</th>
		`;
	}

	function readableAnswers(sub) {
		const values = sub.answer_values || {};
		const leftover = sub.answers || {};
		const rows = [
			["Name", sub.attendee_name || "—"],
			["Email", sub.user_email || "—"],
			["Phone", sub.phone || "—"],
			["Ticket", sub.ticket_type || "—"],
			["Status", sub.status || "—"],
			["Submitted", sub.submitted_at || "—"]
		];
		const seen = new Set(rows.map((row) => row[0].toLowerCase()));
		Object.keys(values).forEach((key) => {
			if (!seen.has(String(key).toLowerCase())) {
				rows.push([key, values[key] || "—"]);
				seen.add(String(key).toLowerCase());
			}
		});
		Object.keys(leftover).forEach((key) => {
			if (String(key).startsWith("_")) return;
			if (seen.has(String(key).toLowerCase())) return;
			const val = leftover[key];
			rows.push([key, Array.isArray(val) ? val.join(", ") : String(val ?? "—")]);
			seen.add(String(key).toLowerCase());
		});
		return rows;
	}

	function ensureAnswersModal() {
		let modal = document.getElementById("registrationAnswersModal");
		if (modal) return modal;
		modal = document.createElement("div");
		modal.id = "registrationAnswersModal";
		modal.setAttribute("hidden", "");
		modal.innerHTML = `
			<div class="reg-answers-backdrop" data-close-answers="1"></div>
			<div class="reg-answers-card" role="dialog" aria-modal="true" aria-labelledby="registrationAnswersTitle">
				<div class="reg-answers-head">
					<h3 id="registrationAnswersTitle">Registration details</h3>
					<button type="button" class="reg-answers-close" data-close-answers="1" aria-label="Close">&times;</button>
				</div>
				<dl id="registrationAnswersBody" class="reg-answers-body"></dl>
			</div>
		`;
		const style = document.createElement("style");
		style.textContent = `
			#registrationAnswersModal { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; padding:1.25rem; }
			#registrationAnswersModal[hidden] { display:none; }
			.reg-answers-backdrop { position:absolute; inset:0; background:rgba(15,23,42,.45); }
			.reg-answers-card { position:relative; width:min(560px,100%); max-height:min(80vh,720px); overflow:auto; background:#fff; border-radius:14px; box-shadow:0 20px 50px rgba(15,23,42,.2); padding:1.25rem 1.4rem 1.4rem; }
			.reg-answers-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
			.reg-answers-head h3 { margin:0; font-size:1.1rem; color:#0f172a; }
			.reg-answers-close { border:0; background:#f1f5f9; width:32px; height:32px; border-radius:8px; font-size:1.2rem; cursor:pointer; }
			.reg-answers-body { margin:0; display:grid; grid-template-columns:140px 1fr; gap:.55rem 1rem; }
			.reg-answers-body dt { margin:0; color:#64748b; font-size:.8rem; font-weight:700; }
			.reg-answers-body dd { margin:0; color:#0f172a; font-weight:600; word-break:break-word; }
		`;
		document.head.appendChild(style);
		document.body.appendChild(modal);
		modal.addEventListener("click", (e) => {
			if (e.target && e.target.getAttribute("data-close-answers")) {
				modal.setAttribute("hidden", "");
			}
		});
		return modal;
	}

	function openAnswersModal(sub) {
		const modal = ensureAnswersModal();
		const title = document.getElementById("registrationAnswersTitle");
		const body = document.getElementById("registrationAnswersBody");
		if (title) title.textContent = `Registration: ${sub.attendee_name || sub.user_email || "attendee"}`;
		if (body) {
			body.innerHTML = readableAnswers(sub).map(([label, value]) => (
				`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
			)).join("");
		}
		modal.removeAttribute("hidden");
	}

	function renderSubmissionsTable(items) {
		if (!submissionsTableBody) return;
		const columns = submissionQuestionColumns || [];
		renderSubmissionsHead(columns);
		const colCount = 7 + columns.length;
		submissionsTableBody.innerHTML = "";

		if (!items || items.length === 0) {
			submissionsTableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; padding:2rem; color:#64748b;">No registrations submitted yet.</td></tr>`;
			return;
		}

		items.forEach(sub => {
			const extra = columns.map((title) => {
				const val = (sub.answer_values && sub.answer_values[title]) || "";
				return `<td style="padding:0.85rem 1rem; color:#334155; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(val)}">${escapeHtml(val)}</td>`;
			}).join("");
			const tr = document.createElement("tr");
			tr.style.borderBottom = "1px solid #e2e8f0";
			tr.innerHTML = `
				<td style="padding:0.85rem 1.2rem; font-weight:700; color:#2563eb;">#${escapeHtml(sub.id)}</td>
				<td style="padding:0.85rem 1.2rem; font-weight:600; color:#0f172a;">${escapeHtml(sub.attendee_name || "—")}</td>
				<td style="padding:0.85rem 1.2rem; font-weight:600; color:#0f172a;">${escapeHtml(sub.user_email || "")}</td>
				<td style="padding:0.85rem 1.2rem; color:#334155;">${escapeHtml(sub.ticket_type || "—")}</td>
				<td style="padding:0.85rem 1.2rem; color:#64748b; white-space:nowrap;">${escapeHtml(sub.submitted_at || "")}</td>
				<td style="padding:0.85rem 1.2rem;"><span style="background:#f0fdf4; color:#166534; padding:0.15rem 0.6rem; border-radius:12px; font-weight:700; font-size:0.78rem;">${escapeHtml(sub.status || "submitted")}</span></td>
				${extra}
				<td style="padding:0.85rem 1.2rem; text-align:right;">
					<button type="button" class="btn-view-answers" style="background:#eff6ff; border:1px solid #bfdbfe; color:#2563eb; font-weight:700; font-size:0.8rem; padding:0.3rem 0.7rem; border-radius:6px; cursor:pointer;">
						View Answers
					</button>
				</td>
			`;
			tr.querySelector(".btn-view-answers").addEventListener("click", () => {
				openAnswersModal(sub);
			});
			submissionsTableBody.appendChild(tr);
		});
	}

	const cancellationRequestsBody = document.getElementById("cancellationRequestsBody");
	const cancellationRequestCount = document.getElementById("cancellationRequestCount");
	let cancellationRequests = [];

	function formatMoney(value) {
		return `₹${Number(value || 0).toLocaleString("en-IN")}`;
	}

	function openDetailModal(title, rows) {
		const modal = ensureAnswersModal();
		const titleEl = document.getElementById("registrationAnswersTitle");
		const body = document.getElementById("registrationAnswersBody");
		if (titleEl) titleEl.textContent = title;
		if (body) {
			const pairs = (rows || []).filter((row) => row && row[0]);
			body.innerHTML = pairs.length
				? pairs.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value == null || value === "" ? "—" : value)}</dd>`).join("")
				: `<dt>Details</dt><dd>No data stored for this request.</dd>`;
		}
		modal.removeAttribute("hidden");
	}

	function attendeeFormRows(req) {
		const form = req.attendee_form || {};
		const answers = form.answers || {};
		const rows = [
			["Name", displayRequestName(req)],
			["Email", req.attendee_email],
			["Phone", req.attendee_phone],
			["Form status", form.status],
			["Submitted", form.submitted_at]
		];
		Object.keys(answers).forEach((key) => {
			const val = answers[key];
			rows.push([key, Array.isArray(val) ? val.join(", ") : val]);
		});
		return rows;
	}

	function paymentFormRows(req) {
		const pay = req.payment_form || {};
		return [
			["Ticket", req.ticket_type],
			["Quantity", req.quantity],
			["Amount", formatMoney(pay.total_price != null ? pay.total_price : req.total_price)],
			["GST", pay.gst_amount != null ? formatMoney(pay.gst_amount) : "—"],
			["Payment mode", pay.payment_mode],
			["Payment ID", pay.payment_id],
			["Bank", pay.bank_name],
			["Transaction ID", pay.transaction_id],
			["Proof status", pay.proof_status],
			["Booked at", pay.booked_at]
		];
	}

	async function hostCancelTicket(bookingId, btn) {
		if (!bookingId) return;
		if (!window.confirm("Accept this cancellation request? The ticket will be cancelled, the attendee can buy again, and this QR will stop working.")) {
			return;
		}
		if (btn) btn.disabled = true;
		const eventId = resolveActiveEventId() || "";
		const qs = new URLSearchParams();
		if (email) qs.set("email", email);
		if (eventId) qs.set("event_id", eventId);
		try {
			const res = await authFetch(`${getHostEventsApiBase()}/bookings/${encodeURIComponent(bookingId)}/cancel?${qs.toString()}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.detail || "Could not cancel this ticket.");
			await loadSubmissionsData();
		} catch (err) {
			alert(err.message || "Could not cancel this ticket.");
			if (btn) btn.disabled = false;
		}
	}

	function looksLikePersonName(value) {
		const t = String(value || "").trim();
		if (t.length < 2 || t.length > 80 || t.includes("@")) return false;
		if (/[%$&#*!?=^+]{2,}/.test(t) || /\d{5,}/.test(t)) return false;
		const letters = (t.match(/[A-Za-z]/g) || []).length;
		const digits = (t.match(/\d/g) || []).length;
		return letters >= 2 && letters >= digits;
	}

	function displayRequestName(req) {
		const raw = String((req && req.attendee_name) || "").trim();
		if (looksLikePersonName(raw)) return raw;
		const email = String((req && req.attendee_email) || "").trim();
		if (email.includes("@")) return email.split("@")[0].replace(/[._+-]+/g, " ");
		return "Guest";
	}

	function renderCancellationRequests(items) {
		if (cancellationRequestCount) {
			const n = (items || []).length;
			cancellationRequestCount.textContent = n === 1 ? "1 pending" : `${n} pending`;
		}
		if (!cancellationRequestsBody) return;
		if (!items || !items.length) {
			cancellationRequestsBody.innerHTML = `<p style="margin:0; color:#9a3412; font-size:0.88rem;">No cancellation requests yet.</p>`;
			return;
		}
		cancellationRequestsBody.innerHTML = `
			<table style="width:100%; min-width:760px; border-collapse:collapse; font-size:0.86rem; background:#fff; border-radius:10px; overflow:hidden;">
				<thead>
					<tr style="text-align:left; color:#9a3412; font-weight:700; border-bottom:1px solid #fed7aa;">
						<th style="padding:0.7rem 0.85rem;">Attendee</th>
						<th style="padding:0.7rem 0.85rem;">Ticket</th>
						<th style="padding:0.7rem 0.85rem;">Amount</th>
						<th style="padding:0.7rem 0.85rem; text-align:right;">Actions</th>
					</tr>
				</thead>
				<tbody>
					${items.map((req) => `
						<tr data-cancel-booking="${escapeHtml(req.booking_id)}" style="border-bottom:1px solid #ffedd5;">
							<td style="padding:0.75rem 0.85rem;">
								<div style="font-weight:800; color:#0f172a;">${escapeHtml(displayRequestName(req))}</div>
								<div style="color:#64748b;">${escapeHtml(req.attendee_email || "")}</div>
							</td>
							<td style="padding:0.75rem 0.85rem; color:#334155;">${escapeHtml(req.ticket_type || "Ticket")} (x${Number(req.quantity || 1)})</td>
							<td style="padding:0.75rem 0.85rem; font-weight:700; color:#0f172a;">${formatMoney(req.total_price)}</td>
							<td style="padding:0.75rem 0.85rem; text-align:right; white-space:nowrap;">
								<button type="button" class="btn-cancel-attendee-form" style="background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; font-weight:700; font-size:0.76rem; padding:0.32rem 0.6rem; border-radius:6px; cursor:pointer; margin:0 0.15rem 0.25rem 0;">Attendees form</button>
								<button type="button" class="btn-cancel-payment-form" style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; font-weight:700; font-size:0.76rem; padding:0.32rem 0.6rem; border-radius:6px; cursor:pointer; margin:0 0.15rem 0.25rem 0;">Payment form</button>
								<button type="button" class="btn-cancel-ticket" style="background:#166534; border:1px solid #166534; color:#fff; font-weight:700; font-size:0.76rem; padding:0.32rem 0.6rem; border-radius:6px; cursor:pointer; margin:0 0 0.25rem 0;">Accept request</button>
							</td>
						</tr>
					`).join("")}
				</tbody>
			</table>
		`;
		cancellationRequestsBody.querySelectorAll("tr[data-cancel-booking]").forEach((tr) => {
			const bookingId = tr.getAttribute("data-cancel-booking");
			const req = items.find((row) => String(row.booking_id) === String(bookingId));
			if (!req) return;
			tr.querySelector(".btn-cancel-attendee-form")?.addEventListener("click", () => {
				openDetailModal(`Attendees form: ${displayRequestName(req) || req.attendee_email || "attendee"}`, attendeeFormRows(req));
			});
			tr.querySelector(".btn-cancel-payment-form")?.addEventListener("click", () => {
				openDetailModal(`Payment form: ${displayRequestName(req) || req.attendee_email || "attendee"}`, paymentFormRows(req));
			});
			tr.querySelector(".btn-cancel-ticket")?.addEventListener("click", (e) => {
				hostCancelTicket(bookingId, e.currentTarget);
			});
		});
	}

	async function loadCancellationRequests() {
		if (!cancellationRequestsBody) return;
		const eventId = resolveActiveEventId() || "";
		try {
			const qs = new URLSearchParams();
			if (email) qs.set("email", email);
			if (eventId) qs.set("event_id", eventId);
			const res = await authFetch(`${getHostEventsApiBase()}/cancellation-requests?${qs.toString()}`);
			if (!res.ok) throw new Error("Could not load cancellation requests");
			const data = await res.json();
			cancellationRequests = Array.isArray(data.requests) ? data.requests : [];
			renderCancellationRequests(cancellationRequests);
		} catch (_) {
			cancellationRequests = [];
			renderCancellationRequests([]);
		}
	}

	if (submissionsSearch) {
		submissionsSearch.addEventListener("input", applySubmissionFilters);
	}
	if (submissionsStatusFilter) {
		submissionsStatusFilter.addEventListener("change", applySubmissionFilters);
	}
	if (submissionsFromDate) {
		submissionsFromDate.addEventListener("change", applySubmissionFilters);
	}
	if (submissionsToDate) {
		submissionsToDate.addEventListener("change", applySubmissionFilters);
	}
	if (btnResetFilters) {
		btnResetFilters.addEventListener("click", () => {
			submissionsSearch.value = "";
			submissionsStatusFilter.value = "all";
			submissionsFromDate.value = "";
			submissionsToDate.value = "";
			applySubmissionFilters();
		});
	}
	if (btnRefreshSubmissions) {
		btnRefreshSubmissions.addEventListener("click", loadSubmissionsData);
	}

	if (btnExportCSV) {
		btnExportCSV.addEventListener("click", async () => {
			const eventId = resolveActiveEventId() || "";
			const qs = new URLSearchParams();
			if (email) qs.set("email", email);
			if (eventId) qs.set("event_id", eventId);
			try {
				const res = await authFetch(`${API_BASE}/export-csv?${qs.toString()}`, {
					headers: { Accept: "text/csv" }
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					alert(data.detail || "Could not download the CSV. Please sign in again and retry.");
					return;
				}
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				const stamp = new Date().toISOString().slice(0, 10);
				a.href = url;
				a.download = `event_registrations_${stamp}.csv`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			} catch (err) {
				alert("Could not download the CSV. Check your connection and try again.");
			}
		});
	}

	// Expose global renderers for tab switching
	window.renderFormBuilderQuestions = renderBuilderQuestions;
	window.renderFormLivePreview = renderLivePreview;
	window.loadFormSubmissionsData = loadSubmissionsData;

	// Synchronous First Render so questions are immediately visible
	renderBuilderQuestions();
	renderLivePreview();

	// Initialize Form Builder State from API
	loadFormDefinition();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initFormBuilder);
} else {
	initFormBuilder();
}
