/**
 * Smart Data Mapping — dependent Excel dropdowns on published registration forms.
 * Fetches options from /api/registration/{formId}/dropdown/{fieldId}/options
 */
(function (global) {
	"use strict";

	function apiOrigin() {
		if (global.JodConfig && typeof global.JodConfig.getApiOrigin === "function") {
			return global.JodConfig.getApiOrigin();
		}
		return "";
	}

	function buildUrl(path, params) {
		const base = apiOrigin().replace(/\/$/, "");
		const url = new URL(base + path, global.location.origin);
		Object.keys(params || {}).forEach(function (k) {
			const v = params[k];
			if (v == null || v === "") return;
			url.searchParams.set(k, v);
		});
		return url.toString();
	}

	async function fetchJson(url) {
		const res = await fetch(url, { credentials: "include", cache: "no-store" });
		const data = await res.json().catch(function () {
			return {};
		});
		if (!res.ok) {
			const err = new Error((data && data.detail) || "Request failed");
			err.status = res.status;
			err.data = data;
			throw err;
		}
		return data;
	}

	function fillSelect(select, options, placeholder, disabled) {
		if (!select) return;
		const prev = select.value;
		select.innerHTML = "";
		const ph = document.createElement("option");
		ph.value = "";
		ph.disabled = true;
		ph.selected = true;
		ph.textContent = placeholder || "-- Select an option --";
		select.appendChild(ph);
		(options || []).forEach(function (opt) {
			const o = document.createElement("option");
			o.value = opt;
			o.textContent = opt;
			select.appendChild(o);
		});
		if (prev && options && options.indexOf(prev) >= 0) {
			select.value = prev;
			ph.selected = false;
		}
		select.disabled = !!disabled;
	}

	function init(config) {
		const formId = config.formId;
		const formKey = config.formKey || formId;
		const container = config.container || document;
		if (!formId) return Promise.resolve(null);

		let reqSeq = 0;
		let meta = null;

		return fetchJson(buildUrl("/api/registration/" + encodeURIComponent(formKey) + "/data-fields"))
			.then(function (data) {
				meta = data;
				const fields = (data && data.fields) || [];
				if (!fields.length) return meta;

				const byQ = {};
				fields.forEach(function (f) {
					byQ[f.question_id] = f;
				});

				const childrenOf = {};
				fields.forEach(function (f) {
					if (f.parent_question_id) {
						if (!childrenOf[f.parent_question_id]) childrenOf[f.parent_question_id] = [];
						childrenOf[f.parent_question_id].push(f.question_id);
					}
				});

				function parentAnswersFor(qid) {
					const parents = {};
					let cur = byQ[qid];
					while (cur && cur.parent_question_id) {
						const pel = container.querySelector("#" + CSS.escape(cur.parent_question_id));
						if (pel && pel.value) parents[cur.parent_question_id] = pel.value;
						cur = byQ[cur.parent_question_id];
					}
					return parents;
				}

				function resetDescendants(qid) {
					const stack = (childrenOf[qid] || []).slice();
					while (stack.length) {
						const cid = stack.pop();
						const el = container.querySelector("#" + CSS.escape(cid));
						const metaC = byQ[cid];
						fillSelect(el, [], (metaC && metaC.placeholder) || "-- Select parent first --", true);
						(childrenOf[cid] || []).forEach(function (x) {
							stack.push(x);
						});
					}
				}

				function loadOptions(qid) {
					const el = container.querySelector("#" + CSS.escape(qid));
					const field = byQ[qid];
					if (!el || !field) return Promise.resolve();
					const parents = parentAnswersFor(qid);
					const missing = [];
					let cur = field;
					while (cur && cur.parent_question_id) {
						if (!parents[cur.parent_question_id]) missing.push(cur.parent_question_id);
						cur = byQ[cur.parent_question_id];
					}
					if (missing.length) {
						fillSelect(el, [], field.placeholder || "-- Select parent first --", true);
						return Promise.resolve();
					}

					const seq = ++reqSeq;
					el.dataset.loading = "1";
					const params = { limit: "200" };
					Object.keys(parents).forEach(function (pid) {
						params["parent_" + pid] = parents[pid];
					});
					const url = buildUrl(
						"/api/registration/" + encodeURIComponent(formKey) + "/dropdown/" + encodeURIComponent(qid) + "/options",
						params
					);
					return fetchJson(url)
						.then(function (resp) {
							if (seq !== reqSeq && el.dataset.lastSeq && Number(el.dataset.lastSeq) > seq) return;
							el.dataset.lastSeq = String(seq);
							fillSelect(
								el,
								resp.options || [],
								field.placeholder || "-- Select an option --",
								!!resp.disabled
							);
							el.dataset.loading = "0";
						})
						.catch(function () {
							if (seq !== reqSeq) return;
							fillSelect(el, [], "Unable to load options", true);
							el.dataset.loading = "0";
						});
				}

				fields.forEach(function (f) {
					const el = container.querySelector("#" + CSS.escape(f.question_id));
					if (!el || el.tagName !== "SELECT") return;
					el.classList.add("smart-mapped-select");
					el.dataset.smartMapped = "1";
					// Clear static options — backend is source of truth
					if (!f.parent_question_id) {
						loadOptions(f.question_id);
					} else {
						fillSelect(el, [], f.placeholder || "-- Select parent first --", true);
					}
					el.addEventListener("change", function () {
						resetDescendants(f.question_id);
						(childrenOf[f.question_id] || []).forEach(loadOptions);
					});
				});

				if (data.source_version_hash) {
					let hashInput = container.querySelector('input[name="_data_mapping_hash"]');
					if (!hashInput) {
						hashInput = document.createElement("input");
						hashInput.type = "hidden";
						hashInput.name = "_data_mapping_hash";
						hashInput.id = "_data_mapping_hash";
						const form = container.querySelector("form") || container;
						form.appendChild(hashInput);
					}
					hashInput.value = data.source_version_hash;
				}

				meta.reload = function (qid) {
					return loadOptions(qid);
				};
				return meta;
			})
			.catch(function () {
				return null;
			});
	}

	global.JodDynamicDropdown = { init: init };
})(window);
