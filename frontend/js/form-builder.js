/**
 * Dynamic Registration Form Builder & Submissions Manager (Google Forms / Typeform style)
 */
function initFormBuilder() {
	const API_BASE = window.location.origin.includes("5500") || window.location.origin.includes("127.0.0.1")
		? "http://127.0.0.1:8001/api/forms"
		: "/api/forms";

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
		return window.location.origin.includes("5500") || window.location.origin.includes("127.0.0.1")
			? "http://127.0.0.1:8001/api/host-events"
			: "/api/host-events";
	}

	function getUploadOrigin() {
		const api = getHostEventsApiBase();
		if (api.startsWith("http")) return api.replace(/\/api\/host-events\/?$/, "");
		return window.location.origin;
	}

	function resolveUploadUrl(url) {
		if (!url) return "";
		if (url.startsWith("blob:") || url.startsWith("data:")) return url;
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

	async function syncRegistrationFormToHost(eventId, schema, theme, published) {
		if (!email) return false;
		const formMeta = {
			form_title: builderFormTitle ? builderFormTitle.value.trim() : "",
			form_description: builderFormDesc ? builderFormDesc.value.trim() : "",
			schema: schema,
			theme_json: theme || {}
		};
		const res = await fetch(`${getHostEventsApiBase()}/registration-form`, {
			method: "POST",
			headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
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
	const subViewBuilder = document.getElementById("subViewBuilder");
	const subViewSubmissions = document.getElementById("subViewSubmissions");

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

	// ── Sub-Tab Switcher ──────────────────────────────────────────────────────
	if (subTabBuilder && subTabSubmissions) {
		subTabBuilder.addEventListener("click", () => {
			subTabBuilder.classList.add("active");
			subTabBuilder.style.background = "#ffffff";
			subTabBuilder.style.color = "#2563eb";
			subTabBuilder.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";

			subTabSubmissions.classList.remove("active");
			subTabSubmissions.style.background = "transparent";
			subTabSubmissions.style.color = "#64748b";
			subTabSubmissions.style.boxShadow = "none";

			subViewBuilder.style.display = "block";
			subViewSubmissions.style.display = "none";
		});

		subTabSubmissions.addEventListener("click", () => {
			subTabSubmissions.classList.add("active");
			subTabSubmissions.style.background = "#ffffff";
			subTabSubmissions.style.color = "#2563eb";
			subTabSubmissions.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";

			subTabBuilder.classList.remove("active");
			subTabBuilder.style.background = "transparent";
			subTabBuilder.style.color = "#64748b";
			subTabBuilder.style.boxShadow = "none";

			subViewBuilder.style.display = "none";
			subViewSubmissions.style.display = "block";
			loadSubmissionsData();
		});
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
				card.style.background = "#ffffff";
				card.style.border = "1.5px solid #cbd5e1";
				card.style.borderRadius = "10px";
				card.style.padding = "1.2rem";
				card.style.boxShadow = "0 2px 6px rgba(0,0,0,0.03)";
				card.style.display = "flex";
				card.style.flexDirection = "column";
				card.style.gap = "0.9rem";

				const titleStr = String(q.title || '').replace(/"/g, '&quot;');
				const placeholderStr = String(q.placeholder || '').replace(/"/g, '&quot;');
				const helpStr = String(q.help_text || '').replace(/"/g, '&quot;');

				card.innerHTML = `
					<div style="display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.6rem;">
						<span style="font-weight: 800; color: #2563eb; font-size: 0.85rem; background: #eff6ff; padding: 0.2rem 0.6rem; border-radius: 6px;">Q${idx + 1}</span>
						
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
						<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.8rem; margin-top: 0.4rem;">
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
			const res = await fetch(`${API_BASE}/save-draft`, {
				method: "POST",
				headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.detail || "Failed to save draft.");

			formId = data.form_id;
			await syncRegistrationFormToHost(resolveActiveEventId(), payload.schema_json, payload.theme_json, false);

			const lifecycle = window.JodOrganizer && typeof window.JodOrganizer.getLifecycle === "function"
				? window.JodOrganizer.getLifecycle()
				: "draft";
			const updated = lifecycle === "published" || lifecycle === "live" || lifecycle === "ended";
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
			const res = await fetch(`${API_BASE}/publish`, {
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
			const baseUrl = window.location.origin.includes("5500")
				? "http://127.0.0.1:5500"
				: window.location.origin;
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
		const res = await fetch(`${API_BASE}/publish`, {
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
		loadFromHost
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

		const baseUrl = window.location.origin.includes("5500")
			? "http://127.0.0.1:5500"
			: window.location.origin;

		window.open(`${baseUrl}/published-form.html?formId=${formId}&mode=readOnly`, "_blank");
	}

	if (btnViewFormHost) btnViewFormHost.addEventListener("click", viewFormHostMode);

	// Load Form Definition from API
	async function loadFormDefinition() {
		try {
			const hostRes = await fetch(
				`${getHostEventsApiBase()}/current?email=${encodeURIComponent(email)}`,
				{ headers: getAuthHeaders(), cache: "no-store" }
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
			const res = await fetch(`${API_BASE}/get-form?email=${encodeURIComponent(email)}`, {
				headers: getAuthHeaders()
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
		try {
			const res = await fetch(`${API_BASE}/submissions?email=${encodeURIComponent(email)}`);
			if (res.ok) {
				const data = await res.json();
				if (data.analytics && kpiTotalSubmissions) {
					kpiTotalSubmissions.textContent = data.analytics.total_registrations;
				}
				if (data.submissions) {
					allSubmissionsData = data.submissions;
					renderSubmissionsTable(allSubmissionsData);
				}
			}
		} catch (e) {
			console.log("Could not load submissions.");
		}
	}

	function parseSubmissionDate(submittedAt) {
		if (!submittedAt) return null;
		const dt = new Date(submittedAt);
		return Number.isFinite(dt.getTime()) ? dt : null;
}

	function applySubmissionFilters() {
		if (!allSubmissionsData) return;
		const query = submissionsSearch ? submissionsSearch.value.trim().toLowerCase() : "";
		const statusValue = submissionsStatusFilter ? submissionsStatusFilter.value : "all";
		const fromDate = submissionsFromDate && submissionsFromDate.value ? new Date(submissionsFromDate.value) : null;
		const toDate = submissionsToDate && submissionsToDate.value ? new Date(submissionsToDate.value) : null;

		const filtered = allSubmissionsData.filter(s => {
			const emailMatch = s.user_email && s.user_email.toLowerCase().includes(query);
			const answersMatch = query && JSON.stringify(s.answers).toLowerCase().includes(query);
			const statusMatch = statusValue === "all" || (s.status && s.status.toLowerCase() === statusValue);
			const submissionDate = parseSubmissionDate(s.submitted_at);
			const fromMatch = !fromDate || (submissionDate && submissionDate >= fromDate);
			const toMatch = !toDate || (submissionDate && submissionDate <= new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59));
			const queryMatch = !query || emailMatch || answersMatch;
			return queryMatch && statusMatch && fromMatch && toMatch;
		});

		renderSubmissionsTable(filtered);
}

	function renderSubmissionsTable(items) {
		if (!submissionsTableBody) return;
		submissionsTableBody.innerHTML = "";

		if (!items || items.length === 0) {
			submissionsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:#64748b;">No registrations submitted yet.</td></tr>`;
			return;
		}

		items.forEach(sub => {
			const tr = document.createElement("tr");
			tr.style.borderBottom = "1px solid #e2e8f0";
			tr.innerHTML = `
				<td style="padding:0.85rem 1.2rem; font-weight:700; color:#2563eb;">#${sub.id}</td>
				<td style="padding:0.85rem 1.2rem; font-weight:600; color:#0f172a;">${sub.user_email}</td>
				<td style="padding:0.85rem 1.2rem; color:#64748b;">${sub.submitted_at}</td>
				<td style="padding:0.85rem 1.2rem;"><span style="background:#f0fdf4; color:#166534; padding:0.15rem 0.6rem; border-radius:12px; font-weight:700; font-size:0.78rem;">✓ ${sub.status}</span></td>
				<td style="padding:0.85rem 1.2rem; text-align:right;">
					<button type="button" class="btn-view-answers" style="background:#eff6ff; border:1px solid #bfdbfe; color:#2563eb; font-weight:700; font-size:0.8rem; padding:0.3rem 0.7rem; border-radius:6px; cursor:pointer;">
						View Answers ↗
					</button>
				</td>
			`;

			tr.querySelector(".btn-view-answers").addEventListener("click", () => {
				alert(`Attendee Answers for ${sub.user_email}:\n\n` + JSON.stringify(sub.answers, null, 2));
			});

			submissionsTableBody.appendChild(tr);
		});
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
		btnExportCSV.addEventListener("click", () => {
			window.location.href = `${API_BASE}/export-csv?email=${encodeURIComponent(email)}`;
		});
	}

	// Expose global renderers for tab switching
	window.renderFormBuilderQuestions = renderBuilderQuestions;
	window.renderFormLivePreview = renderLivePreview;

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
