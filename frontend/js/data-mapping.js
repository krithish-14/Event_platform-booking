/**
 * Smart Data Mapping — host form-builder panel (Excel upload → map → relationships).
 */
(function (global) {
	"use strict";

	let state = {
		sourceId: null,
		sheets: [],
		columns: [],
		mappings: [], // { question_id, column_id, sort_order, is_searchable }
		relationships: [], // { parent_question_id, child_question_id } temp until mapping ids known
		config: null,
	};

	function apiBase() {
		if (global.JodConfig && typeof global.JodConfig.getApiOrigin === "function") {
			return global.JodConfig.getApiOrigin().replace(/\/$/, "");
		}
		return "";
	}

	function authFetch(url, options) {
		const opts = Object.assign({ credentials: "include", cache: "no-store" }, options || {});
		if (global.JodAuth && typeof global.JodAuth.fetchAuth === "function") {
			return global.JodAuth.fetchAuth(url, opts);
		}
		return fetch(url, opts);
	}

	function eventId() {
		if (typeof global.resolveActiveEventId === "function") {
			return global.resolveActiveEventId() || "";
		}
		return (global.currentEventId || global.activeEventId || "").toString();
	}

	function questions() {
		if (global.formBuilderState && Array.isArray(global.formBuilderState.questions)) {
			return global.formBuilderState.questions;
		}
		if (typeof global.getBuilderQuestions === "function") {
			return global.getBuilderQuestions() || [];
		}
		return [];
	}

	function dropdownQuestions() {
		return questions().filter(function (q) {
			return q && (q.type === "dropdown" || q.type === "radio");
		});
	}

	function notify(msg, isErr) {
		if (global.showNotification) global.showNotification(msg);
		else if (isErr) console.error(msg);
		else console.log(msg);
	}

	function el(id) {
		return document.getElementById(id);
	}

	function render() {
		const status = el("sdmStatus");
		if (status) {
			status.textContent = state.sourceId
				? "Source: " + (state.config && state.config.file_name ? state.config.file_name : state.sourceId)
				: "No Excel source uploaded yet.";
		}
		const sheetSel = el("sdmSheetSelect");
		if (sheetSel) {
			sheetSel.innerHTML = '<option value="">Select worksheet…</option>';
			(state.sheets || []).forEach(function (s) {
				const o = document.createElement("option");
				o.value = s;
				o.textContent = s;
				if (state.config && state.config.sheet_name === s) o.selected = true;
				sheetSel.appendChild(o);
			});
		}
		renderMappingRows();
		renderRelRows();
		renderPreviewHint();
	}

	function renderMappingRows() {
		const box = el("sdmMappingRows");
		if (!box) return;
		const qs = dropdownQuestions();
		const cols = state.columns || [];
		if (!qs.length) {
			box.innerHTML = '<p class="sdm-hint">Add dropdown (or radio) questions in the form builder first, then map Excel columns to them.</p>';
			return;
		}
		if (!cols.length) {
			box.innerHTML = '<p class="sdm-hint">Upload an Excel file and select a worksheet to see columns.</p>';
			return;
		}
		box.innerHTML = qs
			.map(function (q) {
				const existing = (state.mappings || []).find(function (m) {
					return m.question_id === q.id;
				});
				const colOpts = cols
					.map(function (c) {
						const sel = existing && existing.column_id === c.id ? " selected" : "";
						return '<option value="' + c.id + '"' + sel + ">" + escapeHtml(c.column_name) + " (" + (c.unique_count || 0) + " unique)</option>";
					})
					.join("");
				return (
					'<div class="sdm-map-row" data-qid="' +
					escapeHtml(q.id) +
					'">' +
					'<label class="sdm-map-label">' +
					escapeHtml(q.title || q.id) +
					"</label>" +
					'<select class="sdm-col-select setup-input"><option value="">— Not mapped —</option>' +
					colOpts +
					"</select>" +
					'<select class="sdm-sort-select setup-input">' +
					optionSel("alpha_asc", "A→Z", existing) +
					optionSel("alpha_desc", "Z→A", existing) +
					optionSel("num_asc", "Number ↑", existing) +
					optionSel("num_desc", "Number ↓", existing) +
					"</select>" +
					'<label class="sdm-check"><input type="checkbox" class="sdm-searchable" ' +
					(!existing || existing.is_searchable !== false ? "checked" : "") +
					"/> Searchable</label>" +
					"</div>"
				);
			})
			.join("");
	}

	function optionSel(val, label, existing) {
		const cur = (existing && existing.sort_order) || "alpha_asc";
		return '<option value="' + val + '"' + (cur === val ? " selected" : "") + ">" + label + "</option>";
	}

	function renderRelRows() {
		const box = el("sdmRelRows");
		if (!box) return;
		const mappedQs = collectMappingsFromDom().filter(function (m) {
			return m.column_id;
		});
		if (mappedQs.length < 2) {
			box.innerHTML = '<p class="sdm-hint">Map at least two fields, then set parent → child links (e.g. District → Club).</p>';
			return;
		}
		const opts = mappedQs
			.map(function (m) {
				const q = questions().find(function (x) {
					return x.id === m.question_id;
				});
				return '<option value="' + escapeHtml(m.question_id) + '">' + escapeHtml((q && q.title) || m.question_id) + "</option>";
			})
			.join("");
		const rows = (state.relationships.length ? state.relationships : [{ parent_question_id: "", child_question_id: "" }])
			.map(function (r, idx) {
				return (
					'<div class="sdm-rel-row" data-idx="' +
					idx +
					'">' +
					'<select class="sdm-rel-parent setup-input"><option value="">Parent…</option>' +
					opts +
					"</select>" +
					'<span class="sdm-arrow">→</span>' +
					'<select class="sdm-rel-child setup-input"><option value="">Child…</option>' +
					opts +
					"</select>" +
					'<button type="button" class="sdm-rel-remove" aria-label="Remove">×</button>' +
					"</div>"
				);
			})
			.join("");
		box.innerHTML = rows;
		box.querySelectorAll(".sdm-rel-row").forEach(function (row, idx) {
			const r = state.relationships[idx] || {};
			const p = row.querySelector(".sdm-rel-parent");
			const c = row.querySelector(".sdm-rel-child");
			if (p && r.parent_question_id) p.value = r.parent_question_id;
			if (c && r.child_question_id) c.value = r.child_question_id;
		});
	}

	function renderPreviewHint() {
		const box = el("sdmPreview");
		if (!box) return;
		if (!(state.config && state.config.columns && state.config.columns.length)) {
			box.innerHTML = "";
			return;
		}
		box.innerHTML =
			'<p class="sdm-hint">Columns detected: <strong>' +
			state.config.columns
				.map(function (c) {
					return escapeHtml(c.column_name);
				})
				.join(", ") +
			"</strong></p>";
	}

	function collectMappingsFromDom() {
		const box = el("sdmMappingRows");
		if (!box) return state.mappings || [];
		const rows = [];
		box.querySelectorAll(".sdm-map-row").forEach(function (row) {
			const qid = row.getAttribute("data-qid");
			const col = row.querySelector(".sdm-col-select");
			const sort = row.querySelector(".sdm-sort-select");
			const search = row.querySelector(".sdm-searchable");
			rows.push({
				question_id: qid,
				column_id: col ? col.value : "",
				sort_order: sort ? sort.value : "alpha_asc",
				is_searchable: search ? search.checked : true,
				field_type: "dropdown",
				is_active: true,
			});
		});
		return rows;
	}

	function collectRelsFromDom() {
		const box = el("sdmRelRows");
		if (!box) return state.relationships || [];
		const rows = [];
		box.querySelectorAll(".sdm-rel-row").forEach(function (row) {
			const p = row.querySelector(".sdm-rel-parent");
			const c = row.querySelector(".sdm-rel-child");
			if (p && c && p.value && c.value && p.value !== c.value) {
				rows.push({ parent_question_id: p.value, child_question_id: c.value });
			}
		});
		return rows;
	}

	function escapeHtml(s) {
		return String(s == null ? "" : s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	async function uploadFile(file) {
		const eid = eventId();
		if (!eid) {
			notify("Select or open an event first.", true);
			return;
		}
		const fd = new FormData();
		fd.append("event_id", eid);
		fd.append("source_name", "Registration Excel");
		fd.append("file", file);
		const res = await authFetch(apiBase() + "/api/data-mapping/upload", { method: "POST", body: fd });
		const data = await res.json().catch(function () {
			return {};
		});
		if (!res.ok) {
			notify((data && data.detail) || "Upload failed", true);
			return;
		}
		state.sourceId = data.source_id;
		state.sheets = data.sheets || [];
		state.config = { file_name: data.file_name, sheet_name: null };
		notify("Excel uploaded. Select a worksheet.");
		render();
	}

	async function selectSheet(name) {
		if (!state.sourceId || !name) return;
		const res = await authFetch(apiBase() + "/api/data-mapping/" + state.sourceId + "/select-sheet", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sheet_name: name }),
		});
		const data = await res.json().catch(function () {
			return {};
		});
		if (!res.ok) {
			notify((data && data.detail) || "Could not read sheet", true);
			return;
		}
		state.columns = data.columns || [];
		state.config = Object.assign({}, state.config || {}, {
			sheet_name: data.sheet_name,
			columns: state.columns,
			preview: data.preview,
		});
		notify("Worksheet loaded (" + (data.row_count || 0) + " rows).");
		render();
	}

	async function saveAndActivate() {
		if (!state.sourceId) {
			notify("Upload an Excel file first.", true);
			return;
		}
		const mappings = collectMappingsFromDom().filter(function (m) {
			return m.column_id;
		});
		if (!mappings.length) {
			notify("Map at least one Excel column to a form field.", true);
			return;
		}
		const cfgRes = await authFetch(apiBase() + "/api/data-mapping/" + state.sourceId + "/configure", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mappings: mappings, activate: true }),
		});
		const cfg = await cfgRes.json().catch(function () {
			return {};
		});
		if (!cfgRes.ok) {
			notify((cfg && cfg.detail) || "Could not save mappings", true);
			return;
		}
		state.config = cfg.configuration || cfg;
		const qidToMid = {};
		((state.config.mappings || [])).forEach(function (m) {
			qidToMid[m.question_id] = m.id;
		});
		const relDom = collectRelsFromDom();
		const relationships = relDom
			.map(function (r) {
				return {
					parent_mapping_id: qidToMid[r.parent_question_id],
					child_mapping_id: qidToMid[r.child_question_id],
					relationship_type: "one_to_many",
					sort_order: "alpha_asc",
					is_active: true,
				};
			})
			.filter(function (r) {
				return r.parent_mapping_id && r.child_mapping_id;
			});
		if (relationships.length) {
			const relRes = await authFetch(apiBase() + "/api/data-mapping/" + state.sourceId + "/relationships", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ relationships: relationships }),
			});
			const relData = await relRes.json().catch(function () {
				return {};
			});
			if (!relRes.ok) {
				notify((relData && relData.detail) || "Mappings saved but relationships failed", true);
				return;
			}
			state.config = relData.configuration || state.config;
		}
		state.mappings = mappings;
		state.relationships = relDom;
		notify("Smart Data Mapping saved and active.");
		render();
	}

	async function loadExisting() {
		const eid = eventId();
		if (!eid) return;
		const res = await authFetch(apiBase() + "/api/data-mapping/event/" + encodeURIComponent(eid));
		const data = await res.json().catch(function () {
			return {};
		});
		if (!res.ok || !(data.sources || []).length) return;
		const active = data.sources.find(function (s) {
			return s.status === "active" || s.status === "configured";
		}) || data.sources[0];
		if (!active) return;
		state.sourceId = active.id;
		const cfgRes = await authFetch(apiBase() + "/api/data-mapping/" + active.id + "/configuration");
		const cfg = await cfgRes.json().catch(function () {
			return {};
		});
		if (!cfgRes.ok) return;
		state.config = cfg;
		state.columns = cfg.columns || [];
		state.mappings = (cfg.mappings || []).map(function (m) {
			return {
				question_id: m.question_id,
				column_id: m.column_id,
				sort_order: m.sort_order,
				is_searchable: m.is_searchable,
			};
		});
		const midToQ = {};
		(cfg.mappings || []).forEach(function (m) {
			midToQ[m.id] = m.question_id;
		});
		state.relationships = (cfg.relationships || []).map(function (r) {
			return {
				parent_question_id: midToQ[r.parent_mapping_id],
				child_question_id: midToQ[r.child_mapping_id],
			};
		});
		const shRes = await authFetch(apiBase() + "/api/data-mapping/" + active.id + "/sheets");
		const sh = await shRes.json().catch(function () {
			return {};
		});
		state.sheets = sh.sheets || [];
		render();
	}

	function bind() {
		const panel = el("sdmPanel");
		if (!panel || panel.dataset.bound === "1") return;
		panel.dataset.bound = "1";

		const fileInput = el("sdmFileInput");
		if (fileInput) {
			fileInput.addEventListener("change", function () {
				const f = fileInput.files && fileInput.files[0];
				if (f) uploadFile(f);
				fileInput.value = "";
			});
		}
		const sheetSel = el("sdmSheetSelect");
		if (sheetSel) {
			sheetSel.addEventListener("change", function () {
				selectSheet(sheetSel.value);
			});
		}
		const saveBtn = el("sdmSaveBtn");
		if (saveBtn) saveBtn.addEventListener("click", saveAndActivate);
		const addRel = el("sdmAddRel");
		if (addRel) {
			addRel.addEventListener("click", function () {
				state.relationships = collectRelsFromDom();
				state.relationships.push({ parent_question_id: "", child_question_id: "" });
				renderRelRows();
			});
		}
		const relBox = el("sdmRelRows");
		if (relBox) {
			relBox.addEventListener("click", function (e) {
				if (e.target && e.target.classList.contains("sdm-rel-remove")) {
					const row = e.target.closest(".sdm-rel-row");
					const idx = row ? Number(row.getAttribute("data-idx")) : -1;
					state.relationships = collectRelsFromDom();
					if (idx >= 0) state.relationships.splice(idx, 1);
					renderRelRows();
				}
			});
		}
		const refreshBtn = el("sdmReloadBtn");
		if (refreshBtn) refreshBtn.addEventListener("click", loadExisting);
	}

	function init() {
		bind();
		render();
		loadExisting().catch(function () {});
	}

	global.JodDataMapping = { init: init, reload: loadExisting, render: render };
})(window);
