document.addEventListener("DOMContentLoaded", async () => {
	const API_BASE = window.location.origin.includes("5500") || window.location.origin.includes("127.0.0.1")
		? "http://127.0.0.1:8001/api/organizers"
		: "/api/organizers";
        const authFetch = (window.JodAuth && typeof window.JodAuth.fetchAuth === "function")
                ? window.JodAuth.fetchAuth
                : window.fetch.bind(window);

	function getAuthHeaders() {
		const token = window.JodAuth ? window.JodAuth.getToken() : null;
		return token ? { "Authorization": `Bearer ${token}` } : {};
	}

	if (typeof window.updateNavAuth === "function") {
		window.updateNavAuth();
	}

	const currentUser = window.JodAuth ? window.JodAuth.getUser() : null;
	const urlParams = new URLSearchParams(window.location.search);

	if (!(window.JodAuth && typeof window.JodAuth.isLoggedIn === "function" && window.JodAuth.isLoggedIn())) {
		window.location.href = "login.html?redirect=" + encodeURIComponent("account-setup.html");
		return;
	}

	// Primary email is the logged-in user's email
	let email = (currentUser && currentUser.email)
		? currentUser.email
		: (urlParams.get("email") || sessionStorage.getItem("verified_organizer_email") || "");

	const setupAlert = document.getElementById("setupAlert");
	const setupAlertContent = document.getElementById("setupAlertContent");

	const contactEmailInput = document.getElementById("contactEmail");
	const btnSaveDetails = document.getElementById("btnSaveDetails");
	const btnProceed = document.getElementById("btnProceed");
	const btnBack = document.getElementById("btnBack");

	const tabStep1 = document.getElementById("tabStep1");
	const tabStep2 = document.getElementById("tabStep2");
	const tabStep3 = document.getElementById("tabStep3");

	const step1Section = document.getElementById("step1Section");
	const step2Section = document.getElementById("step2Section");
	const step3Section = document.getElementById("step3Section");

	const gstinContainer = document.getElementById("gstinContainer");
	const gstinRows = document.getElementById("gstinRows");
	const btnAddGstinRow = document.getElementById("btnAddGstinRow");
	const gstinRadios = document.querySelectorAll('input[name="has_gstin"]');

	// File Upload Dropzones
	const panFileInput = document.getElementById("panFileInput");
	const panDropzone = document.getElementById("panDropzone");
	const panDropzoneContent = document.getElementById("panDropzoneContent");
	const panDropzonePreview = document.getElementById("panDropzonePreview");
	const panFileName = document.getElementById("panFileName");
	const btnClearPanFile = document.getElementById("btnClearPanFile");

	const chequeFileInput = document.getElementById("chequeFileInput");
	const chequeDropzone = document.getElementById("chequeDropzone");
	const chequeDropzoneContent = document.getElementById("chequeDropzoneContent");
	const chequeDropzonePreview = document.getElementById("chequeDropzonePreview");
	const chequeFileName = document.getElementById("chequeFileName");
	const btnClearChequeFile = document.getElementById("btnClearChequeFile");

	// Example Modals
	const exampleModalBackdrop = document.getElementById("exampleModalBackdrop");
	const exampleModalTitle = document.getElementById("exampleModalTitle");
	const exampleModalImg = document.getElementById("exampleModalImg");
	const btnCloseExampleModal = document.getElementById("btnCloseExampleModal");
	const linkViewPanExample = document.getElementById("linkViewPanExample");
	const linkViewChequeExample = document.getElementById("linkViewChequeExample");

	let currentStep = 1;
	let panCardUrl = null;
	let cancelledChequeUrl = null;

        function getDraftStorageKey(targetEmail = email || contactEmailInput?.value || "") {
                const normalizedEmail = String(targetEmail || "guest").trim().toLowerCase();
                return `jod_account_setup_draft:${normalizedEmail}`;
        }

        function saveDraftToLocal(payload) {
                try {
                        localStorage.setItem(getDraftStorageKey(payload.email), JSON.stringify({
                                ...payload,
                                saved_at: new Date().toISOString()
                        }));
                } catch (err) {
                        console.warn("Unable to store account setup draft locally.", err);
                }
        }

        function loadDraftFromLocal(targetEmail = email || contactEmailInput?.value || "") {
                try {
                        const raw = localStorage.getItem(getDraftStorageKey(targetEmail));
                        return raw ? JSON.parse(raw) : null;
                } catch (err) {
                        console.warn("Unable to read local account setup draft.", err);
                        return null;
                }
        }

        function clearDraftFromLocal(targetEmail = email || contactEmailInput?.value || "") {
                try {
                        localStorage.removeItem(getDraftStorageKey(targetEmail));
                } catch (err) {
                        console.warn("Unable to clear local account setup draft.", err);
                }
        }

	function showAlert(msg, type = "error") {
		setupAlert.style.display = "block";
		if (type === "error") {
			setupAlertContent.style.background = "#fef2f2";
			setupAlertContent.style.color = "#991b1b";
			setupAlertContent.style.border = "1px solid #fecaca";
		} else {
			setupAlertContent.style.background = "#f0fdf4";
			setupAlertContent.style.color = "#166534";
			setupAlertContent.style.border = "1px solid #bbf7d0";
		}
		setupAlertContent.textContent = msg;
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	function hideAlert() {
		setupAlert.style.display = "none";
	}

	if (!email) {
		email = "";
	}

	if (contactEmailInput) {
		contactEmailInput.value = email;
		if (email) {
			contactEmailInput.readOnly = true;
			contactEmailInput.style.backgroundColor = "#f8fafc";
		} else {
			contactEmailInput.readOnly = false;
			contactEmailInput.style.backgroundColor = "#ffffff";
			contactEmailInput.placeholder = "Enter your contact email address";
		}
	}

	const contactNameInput = document.getElementById("contactFullName");
	const orgNameInput = document.getElementById("orgName");
	if (currentUser) {
		if (contactNameInput && !contactNameInput.value && currentUser.full_name) {
			contactNameInput.value = currentUser.full_name;
		}
		if (orgNameInput && !orgNameInput.value && currentUser.full_name) {
			orgNameInput.value = currentUser.full_name;
		}
	}

	// ── Wizard Step Navigation ────────────────────────────────────────────────
	function goToStep(step) {
		currentStep = step;
		hideAlert();

		step1Section.style.display = "none";
		step2Section.style.display = "none";
		step3Section.style.display = "none";

		tabStep1.classList.remove("active");
		tabStep2.classList.remove("active");
		tabStep3.classList.remove("active");

		if (step === 1) {
			step1Section.style.display = "block";
			tabStep1.classList.add("active");
			btnBack.style.display = "none";
			btnProceed.textContent = "Continue to Host Dashboard";
		} else if (step === 2) {
			step2Section.style.display = "block";
			tabStep1.classList.add("active");
			tabStep2.classList.add("active"); // Match screenshot: step 1 and step 2 active blue
			btnBack.style.display = "inline-block";
			btnProceed.textContent = "Proceed";
		} else if (step === 3) {
			step3Section.style.display = "block";
			tabStep1.classList.add("active");
			tabStep2.classList.add("active");
			tabStep3.classList.add("active");
			btnBack.style.display = "inline-block";
			btnProceed.textContent = "Complete & Submit";
		}
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	tabStep1.addEventListener("click", () => goToStep(1));
	tabStep2.addEventListener("click", () => {
		if (validateStep1()) goToStep(2);
	});
	tabStep3.addEventListener("click", () => {
		if (validateStep1() && validateStep2()) goToStep(3);
	});

	btnBack.addEventListener("click", () => {
		if (currentStep > 1) goToStep(currentStep - 1);
	});

	// ── GSTIN Toggle & Dynamic Rows ───────────────────────────────────────────
	function toggleGstinContainer() {
		const isYes = document.querySelector('input[name="has_gstin"]:checked')?.value === "yes";
		if (isYes) {
			gstinContainer.style.display = "block";
		} else {
			gstinContainer.style.display = "none";
		}
	}

	gstinRadios.forEach(radio => radio.addEventListener("change", toggleGstinContainer));

	function createGstinRowHtml(num = "", state = "") {
		const div = document.createElement("div");
		div.className = "setup-grid-2 gstin-row";
		div.style.marginBottom = "0.75rem";
		div.style.position = "relative";
		div.innerHTML = `
			<div class="setup-form-group">
				<label>GSTIN Number</label>
				<input type="text" class="setup-input gstin-num-input" placeholder="Enter your GSTIN Number" maxlength="15" style="text-transform: uppercase;" value="${num}" />
			</div>
			<div class="setup-form-group">
				<label>State</label>
				<div style="display: flex; gap: 0.5rem;">
					<input type="text" class="setup-input gstin-state-input" placeholder="State" value="${state}" />
					<button type="button" class="btn-remove-gstin" title="Remove" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; border-radius: 6px; padding: 0 0.8rem; cursor: pointer; font-weight: 700;">&times;</button>
				</div>
			</div>
		`;

		const removeBtn = div.querySelector(".btn-remove-gstin");
		removeBtn.addEventListener("click", () => {
			if (gstinRows.children.length > 1) {
				div.remove();
			} else {
				div.querySelector(".gstin-num-input").value = "";
				div.querySelector(".gstin-state-input").value = "";
			}
		});

		return div;
	}

	if (btnAddGstinRow) {
		btnAddGstinRow.addEventListener("click", () => {
			gstinRows.appendChild(createGstinRowHtml());
		});
	}

	function getGstinDataString() {
		const isYes = document.querySelector('input[name="has_gstin"]:checked')?.value === "yes";
		if (!isYes) return null;

		const rows = gstinRows.querySelectorAll(".gstin-row");
		const entries = [];
		rows.forEach(r => {
			const num = r.querySelector(".gstin-num-input")?.value.trim().toUpperCase();
			const st = r.querySelector(".gstin-state-input")?.value.trim();
			if (num) {
				entries.push(st ? `${num} (${st})` : num);
			}
		});
		return entries.join(", ");
	}

	function populateGstinRows(gstinStr) {
		gstinRows.innerHTML = "";
		if (!gstinStr) {
			gstinRows.appendChild(createGstinRowHtml());
			return;
		}

		const parts = gstinStr.split(", ");
		parts.forEach(p => {
			const match = p.match(/^([A-Z0-9]+)(?:\s*\((.*?)\))?$/);
			if (match) {
				gstinRows.appendChild(createGstinRowHtml(match[1], match[2] || ""));
			} else {
				gstinRows.appendChild(createGstinRowHtml(p, ""));
			}
		});
		if (gstinRows.children.length === 0) {
			gstinRows.appendChild(createGstinRowHtml());
		}
	}

	// ── File Upload Logic ─────────────────────────────────────────────────────
	async function uploadDocumentFile(file, docType) {
		hideAlert();
		if (file.size > 2 * 1024 * 1024) {
			showAlert("File size should not be greater than 2mb.");
			return false;
		}

		const allowedExts = ["jpg", "jpeg", "png", "pdf"];
		const ext = file.name.split(".").pop().toLowerCase();
		if (!allowedExts.includes(ext)) {
			showAlert("Upload a clear image in .jpg or .pdf format only.");
			return false;
		}

		const formData = new FormData();
		formData.append("email", email);
		formData.append("doc_type", docType);
		formData.append("file", file);

		try {
                        const res = await authFetch(`${API_BASE}/upload-document`, {
				method: "POST",
				body: formData
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.detail || "File upload failed.");

			if (docType === "pan_card") {
				panCardUrl = data.file_url;
				panFileName.textContent = `✓ ${file.name}`;
				panDropzoneContent.style.display = "none";
				panDropzonePreview.style.display = "block";
			} else if (docType === "cancelled_cheque") {
				cancelledChequeUrl = data.file_url;
				chequeFileName.textContent = `✓ ${file.name}`;
				chequeDropzoneContent.style.display = "none";
				chequeDropzonePreview.style.display = "block";
			}

                        saveDraftToLocal(getFormData(false));
			showAlert(`${docType.replace('_', ' ').toUpperCase()} uploaded successfully!`, "success");
			return true;
		} catch (err) {
			showAlert(err.message || "Failed to upload file.");
			return false;
		}
	}

	// PAN Card Dropzone Event Handlers
	panDropzone.addEventListener("click", (e) => {
		if (e.target.id !== "btnClearPanFile") panFileInput.click();
	});
	panFileInput.addEventListener("change", (e) => {
		if (e.target.files[0]) uploadDocumentFile(e.target.files[0], "pan_card");
	});
	panDropzone.addEventListener("dragover", (e) => {
		e.preventDefault();
		panDropzone.classList.add("dragover");
	});
	panDropzone.addEventListener("dragleave", () => panDropzone.classList.remove("dragover"));
	panDropzone.addEventListener("drop", (e) => {
		e.preventDefault();
		panDropzone.classList.remove("dragover");
		if (e.dataTransfer.files[0]) uploadDocumentFile(e.dataTransfer.files[0], "pan_card");
	});
	btnClearPanFile.addEventListener("click", (e) => {
		e.stopPropagation();
		panCardUrl = null;
		panFileInput.value = "";
		panDropzoneContent.style.display = "flex";
		panDropzonePreview.style.display = "none";
	});

	// Cancelled Cheque Dropzone Event Handlers
	chequeDropzone.addEventListener("click", (e) => {
		if (e.target.id !== "btnClearChequeFile") chequeFileInput.click();
	});
	chequeFileInput.addEventListener("change", (e) => {
		if (e.target.files[0]) uploadDocumentFile(e.target.files[0], "cancelled_cheque");
	});
	chequeDropzone.addEventListener("dragover", (e) => {
		e.preventDefault();
		chequeDropzone.classList.add("dragover");
	});
	chequeDropzone.addEventListener("dragleave", () => chequeDropzone.classList.remove("dragover"));
	chequeDropzone.addEventListener("drop", (e) => {
		e.preventDefault();
		chequeDropzone.classList.remove("dragover");
		if (e.dataTransfer.files[0]) uploadDocumentFile(e.dataTransfer.files[0], "cancelled_cheque");
	});
	btnClearChequeFile.addEventListener("click", (e) => {
		e.stopPropagation();
		cancelledChequeUrl = null;
		chequeFileInput.value = "";
		chequeDropzoneContent.style.display = "flex";
		chequeDropzonePreview.style.display = "none";
	});

	// Example Modals
	linkViewPanExample.addEventListener("click", (e) => {
		e.preventDefault();
		exampleModalTitle.textContent = "Sample PAN Card Example";
		exampleModalImg.src = "https://placehold.co/500x300/e2e8f0/1e293b?text=Sample+PAN+Card+Format";
		exampleModalBackdrop.style.display = "flex";
	});
	linkViewChequeExample.addEventListener("click", (e) => {
		e.preventDefault();
		exampleModalTitle.textContent = "Sample Cancelled Cheque Example";
		exampleModalImg.src = "https://placehold.co/500x300/e2e8f0/1e293b?text=Sample+Cancelled+Cheque+Format";
		exampleModalBackdrop.style.display = "flex";
	});
	btnCloseExampleModal.addEventListener("click", () => {
		exampleModalBackdrop.style.display = "none";
	});
	exampleModalBackdrop.addEventListener("click", (e) => {
		if (e.target === exampleModalBackdrop) exampleModalBackdrop.style.display = "none";
	});

        function applyDraftData(acc) {
                if (!acc) return;

                if (acc.org_name) document.getElementById("orgName").value = acc.org_name;
                if (acc.pan_number && document.getElementById("panNumber")) document.getElementById("panNumber").value = acc.pan_number;
                if (acc.org_address && document.getElementById("orgAddress")) document.getElementById("orgAddress").value = acc.org_address;

                const hasGstinRadioValue = acc.has_gstin ? "yes" : "no";
                const gstinRadio = document.querySelector(`input[name="has_gstin"][value="${hasGstinRadioValue}"]`);
                if (gstinRadio) gstinRadio.checked = true;
                toggleGstinContainer();
                if (acc.has_gstin && acc.gstin_number) {
                        populateGstinRows(acc.gstin_number);
                }

                if (acc.accepted_undertaking !== undefined) {
                        document.getElementById("acceptUndertaking").checked = Boolean(acc.accepted_undertaking);
                }

                const itrRadioValue = acc.itr_filed ? "yes" : "no";
                const itrRadio = document.querySelector(`input[name="itr_filed"][value="${itrRadioValue}"]`);
                if (itrRadio) itrRadio.checked = true;

                if (acc.state) document.getElementById("stateSelect").value = acc.state;

                if (acc.contact_full_name) document.getElementById("contactFullName").value = acc.contact_full_name;
                if (acc.contact_email && contactEmailInput && !contactEmailInput.value) {
                        contactEmailInput.value = acc.contact_email;
                }
                if (acc.contact_mobile) document.getElementById("contactMobile").value = acc.contact_mobile;

                if (acc.beneficiary_name) document.getElementById("beneficiaryName").value = acc.beneficiary_name;
                if (acc.account_type) document.getElementById("accountType").value = acc.account_type;
                if (acc.bank_name) document.getElementById("bankName").value = acc.bank_name;
                if (acc.account_number) document.getElementById("accountNumber").value = acc.account_number;
                if (acc.bank_ifsc) document.getElementById("bankIfsc").value = acc.bank_ifsc;

                if (acc.pan_card_url) {
                        panCardUrl = acc.pan_card_url;
                        panFileName.textContent = `✓ Uploaded: ${acc.pan_card_url.split('/').pop()}`;
                        panDropzoneContent.style.display = "none";
                        panDropzonePreview.style.display = "block";
                }

                if (acc.cancelled_cheque_url) {
                        cancelledChequeUrl = acc.cancelled_cheque_url;
                        chequeFileName.textContent = `✓ Uploaded: ${acc.cancelled_cheque_url.split('/').pop()}`;
                        chequeDropzoneContent.style.display = "none";
                        chequeDropzonePreview.style.display = "block";
                }

                if (acc.accept_final_agreement !== undefined) {
                        const finalAgreementCheckbox = document.getElementById("acceptFinalAgreement");
                        if (finalAgreementCheckbox) {
                                finalAgreementCheckbox.checked = Boolean(acc.accept_final_agreement);
                        }
                }
        }

	// Fetch existing account data if available to pre-fill
        let serverDraftLoaded = false;
	try {
                const res = await authFetch(`${API_BASE}/account-setup?email=${encodeURIComponent(email)}`);
		if (res.ok) {
			const data = await res.json();
			if (data.account) {
                                serverDraftLoaded = true;
				const acc = data.account;
				const hasBank = window.JodAuth && typeof window.JodAuth.hasHostPayoutBank === "function"
					? window.JodAuth.hasHostPayoutBank(acc)
					: Boolean(acc.beneficiary_name && acc.bank_name && acc.account_number && acc.bank_ifsc);
				if (hasBank) {
					window.location.href = `organizer-dashboard.html?email=${encodeURIComponent(email)}`;
					return;
				}
                                applyDraftData(acc);
                                saveDraftToLocal({
                                        ...acc,
                                        accept_final_agreement: document.getElementById("acceptFinalAgreement")?.checked,
                                        is_final_submit: false
                                });
			}
		}
	} catch (e) {
		console.log("No existing draft found or server offline.");
	}

        if (!serverDraftLoaded) {
                const localDraft = loadDraftFromLocal();
                if (localDraft) {
                        applyDraftData(localDraft);
                        showAlert("Loaded your saved draft. You can continue from where you left off.", "success");
                }
        }

	function validateStep1() {
		const beneficiaryName = document.getElementById("beneficiaryName").value.trim();
		const accountType = document.getElementById("accountType").value;
		const bankName = document.getElementById("bankName").value;
		const accountNumber = document.getElementById("accountNumber").value.trim();
		const bankIfsc = document.getElementById("bankIfsc").value.trim();

		if (!beneficiaryName) { showAlert("Please enter Beneficiary Name."); return false; }
		if (!accountType) { showAlert("Please select Account Type."); return false; }
		if (!bankName) { showAlert("Please select Bank Name."); return false; }
		if (!accountNumber) { showAlert("Please enter Account Number."); return false; }
		if (!bankIfsc) { showAlert("Please enter Bank IFSC."); return false; }
		if (bankIfsc.length < 4) { showAlert("Please enter a valid Bank IFSC."); return false; }
		return true;
	}

	function validateStep2() {
		if (!panCardUrl) {
			showAlert("Please upload your PAN card document.");
			return false;
		}
		if (!cancelledChequeUrl) {
			showAlert("Please upload your Cancelled Cheque document.");
			return false;
		}
		return true;
	}

	function getFormData(isFinal = false) {
		const hasGstinVal = document.querySelector('input[name="has_gstin"]:checked')?.value === "yes";
		const itrFiledVal = document.querySelector('input[name="itr_filed"]:checked')?.value === "yes";
		const undertakingChecked = Boolean(document.getElementById("acceptUndertaking")?.checked);
		const targetEmail = (email || contactEmailInput?.value || "").trim();

		return {
			email: targetEmail,
			org_name: (document.getElementById("orgName")?.value || "").trim() || (currentUser && currentUser.full_name) || "",
			pan_number: (document.getElementById("panNumber")?.value || "").trim().toUpperCase(),
			org_address: (document.getElementById("orgAddress")?.value || "").trim(),
			has_gstin: hasGstinVal,
			gstin_number: getGstinDataString(),
			accepted_undertaking: undertakingChecked,
			itr_filed: itrFiledVal,
			state: document.getElementById("stateSelect") ? document.getElementById("stateSelect").value : "",
			contact_full_name: document.getElementById("contactFullName")?.value.trim() || (currentUser && currentUser.full_name) || "",
                        contact_email: targetEmail,
			contact_mobile: document.getElementById("contactMobile")?.value.trim() || "",
			beneficiary_name: document.getElementById("beneficiaryName").value.trim(),
			account_type: document.getElementById("accountType").value,
			bank_name: document.getElementById("bankName").value,
			account_number: document.getElementById("accountNumber").value.trim(),
			bank_ifsc: document.getElementById("bankIfsc").value.trim().toUpperCase(),
			pan_card_url: panCardUrl,
			cancelled_cheque_url: cancelledChequeUrl,
                        accept_final_agreement: document.getElementById("acceptFinalAgreement")?.checked || false,
			is_final_submit: isFinal
		};
	}

	async function submitAccountSetup(isFinal = false) {
		hideAlert();
		const payload = getFormData(isFinal);
                saveDraftToLocal(payload);

		try {
			btnProceed.disabled = true;
			btnSaveDetails.disabled = true;

                        const res = await authFetch(`${API_BASE}/account-setup`, {
				method: "POST",
                                headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data.detail || "Failed to save account setup details.");

			if (isFinal) {
                                clearDraftFromLocal(payload.email);
				showAlert("Bank details saved. Redirecting to your Event Organizer Dashboard...", "success");
				setTimeout(() => {
					window.location.href = `organizer-dashboard.html?email=${encodeURIComponent(email)}`;
				}, 900);
			} else {
				showAlert("Bank details saved. You can continue to the host dashboard when you are ready.", "success");
			}
		} catch (err) {
                        const fallbackMessage = isFinal
                                ? "We couldn't submit right now. Your details are still saved locally, so you can come back and continue."
                                : "Draft saved on this browser. The server could not be reached right now, but your values will still be here when you return.";
                        showAlert(err.message === "Failed to fetch" ? fallbackMessage : (err.message || fallbackMessage));
		} finally {
			btnProceed.disabled = false;
			btnSaveDetails.disabled = false;
		}
	}

	btnSaveDetails.addEventListener("click", () => {
		if (!validateStep1()) return;
		submitAccountSetup(false);
	});

	btnProceed.addEventListener("click", () => {
		if (!validateStep1()) return;
		submitAccountSetup(true);
	});
});
