/**
 * Smart Data Mapping — dependent Excel dropdowns on published registration forms.
 * Parent selection filters child options (primary-key style); values are unique.
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

	function normKey(opt) {
		var text = String(opt == null ? "" : opt).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
		if (!text) return "";
		var asNum = Number(text.replace(/,/g, ""));
		if (!isNaN(asNum) && String(text.replace(/,/g, "")).match(/^-?\d+(\.0+)?$/)) {
			return String(Math.trunc(asNum));
		}
		return text.toLowerCase();
	}

	function dedupeOptions(options) {
		var seen = {};
		var out = [];
		(options || []).forEach(function (opt) {
			var disp = String(opt == null ? "" : opt).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
			var key = normKey(disp);
			if (!key || seen[key]) return;
			seen[key] = true;
			// Prefer clean integer display
			var n = Number(disp.replace(/,/g, ""));
			if (!isNaN(n) && String(disp.replace(/,/g, "")).match(/^-?\d+(\.0+)?$/)) {
				disp = String(Math.trunc(n));
			}
			out.push(disp);
		});
		return out;
	}

	function fillSelect(select, options, placeholder, disabled) {
		if (!select) return;
		var prev = select.value;
		var unique = dedupeOptions(options);
		select.innerHTML = "";
		var ph = document.createElement("option");
		ph.value = "";
		ph.disabled = true;
		ph.selected = true;
		ph.textContent = placeholder || "-- Select an option --";
		select.appendChild(ph);
		unique.forEach(function (opt) {
			var o = document.createElement("option");
			o.value = opt;
			o.textContent = opt;
			select.appendChild(o);
		});
		if (prev && unique.indexOf(prev) >= 0) {
			select.value = prev;
			ph.selected = false;
		}
		select.disabled = !!disabled;
	}

	function init(config) {
		var formId = config.formId;
		var formKey = config.formKey || formId;
		var container = config.container || document;
		if (!formId) return Promise.resolve(null);

		var fieldSeq = {};

		return fetchJson(buildUrl("/api/registration/" + encodeURIComponent(formKey) + "/data-fields"))
			.then(function (data) {
				var fields = (data && data.fields) || [];
				if (!fields.length) return data;

				var byQ = {};
				fields.forEach(function (f) {
					byQ[f.question_id] = f;
				});

				var childrenOf = {};
				fields.forEach(function (f) {
					var parentId = f.parent_question_id;
					if (parentId) {
						if (!childrenOf[parentId]) childrenOf[parentId] = [];
						childrenOf[parentId].push(f.question_id);
					}
				});

				function parentAnswersFor(qid) {
					var parents = {};
					var field = byQ[qid];
					var ids = (field && field.parent_question_ids && field.parent_question_ids.length)
						? field.parent_question_ids
						: [];
					if (!ids.length) {
						var cur = field;
						while (cur && cur.parent_question_id) {
							ids.push(cur.parent_question_id);
							cur = byQ[cur.parent_question_id];
						}
						ids.reverse();
					}
					ids.forEach(function (pid) {
						var pel = container.querySelector("#" + CSS.escape(pid));
						if (pel && pel.value) parents[pid] = pel.value;
					});
					return parents;
				}

				function resetDescendants(qid) {
					var stack = (childrenOf[qid] || []).slice();
					while (stack.length) {
						var cid = stack.pop();
						var el = container.querySelector("#" + CSS.escape(cid));
						var metaC = byQ[cid];
						fillSelect(el, [], (metaC && metaC.placeholder) || "-- Select parent first --", true);
						(childrenOf[cid] || []).forEach(function (x) {
							stack.push(x);
						});
					}
				}

				function loadOptions(qid) {
					var el = container.querySelector("#" + CSS.escape(qid));
					var field = byQ[qid];
					if (!el || !field) return Promise.resolve();
					var parents = parentAnswersFor(qid);
					var requiredParents = (field.parent_question_ids && field.parent_question_ids.length)
						? field.parent_question_ids
						: (field.parent_question_id ? [field.parent_question_id] : []);
					var missing = requiredParents.filter(function (pid) {
						return !parents[pid];
					});
					if (missing.length) {
						fillSelect(el, [], field.placeholder || "-- Select parent first --", true);
						return Promise.resolve();
					}

					var seq = (fieldSeq[qid] || 0) + 1;
					fieldSeq[qid] = seq;
					el.dataset.loading = "1";
					var params = { limit: "2000" };
					Object.keys(parents).forEach(function (pid) {
						params["parent_" + pid] = parents[pid];
					});
					var url = buildUrl(
						"/api/registration/" + encodeURIComponent(formKey) + "/dropdown/" + encodeURIComponent(qid) + "/options",
						params
					);
					return fetchJson(url)
						.then(function (resp) {
							if (fieldSeq[qid] !== seq) return;
							fillSelect(
								el,
								resp.options || [],
								field.placeholder || "-- Select an option --",
								!!resp.disabled
							);
							el.dataset.loading = "0";
						})
						.catch(function () {
							if (fieldSeq[qid] !== seq) return;
							fillSelect(el, [], "Unable to load options", true);
							el.dataset.loading = "0";
						});
				}

				fields.forEach(function (f) {
					var el = container.querySelector("#" + CSS.escape(f.question_id));
					if (!el || el.tagName !== "SELECT") return;
					el.classList.add("smart-mapped-select");
					el.dataset.smartMapped = "1";
					// Always clear static/schema options — backend is source of truth
					if (f.is_root || !f.parent_question_id) {
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
					var hashInput = container.querySelector('input[name="_data_mapping_hash"]');
					if (!hashInput) {
						hashInput = document.createElement("input");
						hashInput.type = "hidden";
						hashInput.name = "_data_mapping_hash";
						hashInput.id = "_data_mapping_hash";
						var form = container.querySelector("form") || container;
						form.appendChild(hashInput);
					}
					hashInput.value = data.source_version_hash;
				}

				data.reload = function (qid) {
					return loadOptions(qid);
				};
				return data;
			})
			.catch(function () {
				return null;
			});
	}

	global.JodDynamicDropdown = { init: init };
})(window);
