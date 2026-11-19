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
		if (!disabled) {
			select.removeAttribute("disabled");
		}
	}

	function findSelect(container, qid) {
		if (!qid) return null;
		var el = container.querySelector("#" + CSS.escape(qid));
		if (el && el.tagName === "SELECT") return el;
		el = container.querySelector('select[name="' + qid.replace(/"/g, '\\"') + '"]');
		if (el) return el;
		el = container.querySelector('select[data-qid="' + qid.replace(/"/g, '\\"') + '"]');
		return el;
	}

	function readSelectValue(el) {
		if (!el) return "";
		var v = el.value;
		if (v != null && String(v).trim() !== "") return String(v).trim();
		// Fallback: selected option text when value is oddly empty
		var opt = el.options && el.options[el.selectedIndex];
		if (opt && opt.value) return String(opt.value).trim();
		return "";
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

				function parentIdsFor(field) {
					// Only parents that exist as mapped fields AND as selects on this form.
					var ids = [];
					if (field && field.parent_question_ids && field.parent_question_ids.length) {
						ids = field.parent_question_ids.slice();
					} else if (field && field.parent_question_id) {
						ids = [field.parent_question_id];
					}
					return ids.filter(function (pid) {
						return !!byQ[pid] && !!findSelect(container, pid);
					});
				}

				function parentAnswersFor(qid) {
					var parents = {};
					var field = byQ[qid];
					parentIdsFor(field).forEach(function (pid) {
						var pel = findSelect(container, pid);
						var val = readSelectValue(pel);
						if (val) parents[pid] = val;
					});
					return parents;
				}

				function resetDescendants(qid) {
					var stack = (childrenOf[qid] || []).slice();
					while (stack.length) {
						var cid = stack.pop();
						var el = findSelect(container, cid);
						var metaC = byQ[cid];
						fillSelect(el, [], (metaC && metaC.placeholder) || "-- Select parent first --", true);
						(childrenOf[cid] || []).forEach(function (x) {
							stack.push(x);
						});
					}
				}

				function loadOptions(qid) {
					var el = findSelect(container, qid);
					var field = byQ[qid];
					if (!el || !field) return Promise.resolve();

					var requiredParents = parentIdsFor(field);
					var parents = parentAnswersFor(qid);
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
							var opts = resp.options || [];
							var disabled = !!resp.disabled;
							var placeholder = field.placeholder || "-- Select an option --";
							if (!disabled && !opts.length) {
								placeholder = "No matching values for this selection";
							}
							// Never keep child locked when parent is selected and API is reachable
							if (!disabled) {
								fillSelect(el, opts, placeholder, false);
							} else {
								fillSelect(el, [], field.placeholder || "-- Select parent first --", true);
							}
							el.dataset.loading = "0";
						})
						.catch(function (err) {
							if (fieldSeq[qid] !== seq) return;
							var msg = "Unable to load options";
							if (err && err.status === 404) msg = "Mapping not active — re-Activate in form builder";
							fillSelect(el, [], msg, true);
							el.dataset.loading = "0";
						});
				}

				fields.forEach(function (f) {
					var el = findSelect(container, f.question_id);
					if (!el || el.tagName !== "SELECT") return;
					el.classList.add("smart-mapped-select");
					el.dataset.smartMapped = "1";
					el.dataset.qid = f.question_id;
					if (f.parent_question_id) el.dataset.parentQid = f.parent_question_id;

					var requiredParents = parentIdsFor(f);
					if (!requiredParents.length) {
						loadOptions(f.question_id);
					} else {
						fillSelect(el, [], f.placeholder || "-- Select parent first --", true);
					}
				});

				// Event delegation so change always reaches children (avoids missed listeners)
				if (!container.dataset.jodSmartChangeBound) {
					container.dataset.jodSmartChangeBound = "1";
					container.addEventListener("change", function (ev) {
						var t = ev.target;
						if (!t || t.tagName !== "SELECT") return;
						var qid = t.dataset.qid || t.id || t.getAttribute("name");
						if (!qid || !byQ[qid]) return;
						resetDescendants(qid);
						(childrenOf[qid] || []).forEach(loadOptions);
					});
				}

				// If parent already has a value (browser restore / preview), unlock children now
				fields.forEach(function (f) {
					if (!f.parent_question_id) return;
					var parents = parentAnswersFor(f.question_id);
					if (Object.keys(parents).length) loadOptions(f.question_id);
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
