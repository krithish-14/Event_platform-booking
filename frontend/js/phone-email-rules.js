(() => {
	"use strict";

	/** Dial code → exact national number length */
	const PHONE_COUNTRIES = [
		{ iso: "IN", name: "India", dial: "91", length: 10 },
		{ iso: "US", name: "United States", dial: "1", length: 10 },
		{ iso: "GB", name: "United Kingdom", dial: "44", length: 10 },
		{ iso: "AE", name: "UAE", dial: "971", length: 9 },
		{ iso: "SG", name: "Singapore", dial: "65", length: 8 },
		{ iso: "AU", name: "Australia", dial: "61", length: 9 },
		{ iso: "SA", name: "Saudi Arabia", dial: "966", length: 9 },
		{ iso: "QA", name: "Qatar", dial: "974", length: 8 },
		{ iso: "MY", name: "Malaysia", dial: "60", length: 9 },
		{ iso: "LK", name: "Sri Lanka", dial: "94", length: 9 },
		{ iso: "BD", name: "Bangladesh", dial: "880", length: 10 },
		{ iso: "NP", name: "Nepal", dial: "977", length: 10 },
		{ iso: "DE", name: "Germany", dial: "49", length: 11 },
		{ iso: "FR", name: "France", dial: "33", length: 9 },
		{ iso: "PK", name: "Pakistan", dial: "92", length: 10 },
	];

	const EMAIL_RE =
		/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+$/;

	function getCountry(dial) {
		const code = String(dial || "").replace(/\D/g, "");
		return PHONE_COUNTRIES.find((c) => c.dial === code) || PHONE_COUNTRIES[0];
	}

	function digitsOnly(value) {
		return String(value || "").replace(/\D/g, "");
	}

	function isValidEmail(email) {
		const value = String(email || "").trim();
		if (!value) return false;
		if (value.length > 254) return false;
		if (!EMAIL_RE.test(value)) return false;
		const domain = value.split("@")[1] || "";
		if (!domain.includes(".")) return false;
		const tld = domain.split(".").pop() || "";
		return tld.length >= 2;
	}

	function validateEmail(email) {
		const value = String(email || "").trim();
		if (!value) return { ok: false, message: "Email is required." };
		if (!isValidEmail(value)) return { ok: false, message: "Enter valid mail id" };
		return { ok: true, message: "", value };
	}

	function validatePhone(dial, national) {
		const country = getCountry(dial);
		const number = digitsOnly(national);
		if (!number) {
			return { ok: false, message: "Phone number is required.", country };
		}
		if (number.length !== country.length) {
			return {
				ok: false,
				message: `${country.name} (+${country.dial}) requires exactly ${country.length} digits.`,
				country,
			};
		}
		return {
			ok: true,
			message: "",
			country,
			national: number,
			e164: `+${country.dial}${number}`,
		};
	}

	function fillCountrySelect(selectEl, preferredDial) {
		if (!selectEl) return;
		const preferred = String(preferredDial || "91").replace(/\D/g, "");
		selectEl.innerHTML = PHONE_COUNTRIES.map((c) => {
			const selected = c.dial === preferred ? " selected" : "";
			return `<option value="${c.dial}" data-length="${c.length}" data-iso="${c.iso}"${selected}>+${c.dial} ${c.name}</option>`;
		}).join("");
		if (![...selectEl.options].some((o) => o.value === preferred)) {
			selectEl.value = "91";
		}
	}

	function applyPhoneLength(selectEl, inputEl) {
		if (!selectEl || !inputEl) return;
		const country = getCountry(selectEl.value);
		inputEl.maxLength = country.length;
		inputEl.setAttribute("maxlength", String(country.length));
		inputEl.placeholder = `${country.length}-digit number`;
		inputEl.value = digitsOnly(inputEl.value).slice(0, country.length);
	}

	function bindPhoneField(selectEl, inputEl) {
		if (!selectEl || !inputEl) return () => {};
		fillCountrySelect(selectEl, selectEl.value || "91");
		applyPhoneLength(selectEl, inputEl);

		const onCountry = () => applyPhoneLength(selectEl, inputEl);
		const onInput = () => {
			const country = getCountry(selectEl.value);
			const next = digitsOnly(inputEl.value).slice(0, country.length);
			if (inputEl.value !== next) inputEl.value = next;
		};

		selectEl.addEventListener("change", onCountry);
		inputEl.addEventListener("input", onInput);
		return () => {
			selectEl.removeEventListener("change", onCountry);
			inputEl.removeEventListener("input", onInput);
		};
	}

	/** Parse stored values like "9876543210" or "+919876543210" into dial + national. */
	function parseStoredPhone(stored) {
		const raw = String(stored || "").trim();
		const digits = digitsOnly(raw);
		if (!digits) return { dial: "91", national: "" };

		const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
		for (const country of sorted) {
			if (digits.startsWith(country.dial) && digits.length === country.dial.length + country.length) {
				return { dial: country.dial, national: digits.slice(country.dial.length) };
			}
		}
		if (digits.length === 10) return { dial: "91", national: digits };
		return { dial: "91", national: digits.slice(0, 10) };
	}

	function setPhoneFields(selectEl, inputEl, stored) {
		const parsed = parseStoredPhone(stored);
		fillCountrySelect(selectEl, parsed.dial);
		if (inputEl) {
			inputEl.value = parsed.national;
			applyPhoneLength(selectEl, inputEl);
		}
	}

	window.JodContactRules = {
		PHONE_COUNTRIES,
		getCountry,
		digitsOnly,
		isValidEmail,
		validateEmail,
		validatePhone,
		fillCountrySelect,
		applyPhoneLength,
		bindPhoneField,
		parseStoredPhone,
		setPhoneFields,
	};
})();
