/**
 * Smart Data Mapping — select Excel columns + sort (A–Z / numeric),
 * set parent→child relationships, then wire Integrated Dropdown questions.
 */
(function (global) {
	"use strict";

	let state = {
		sourceId: null,
		sheets: [],
		columns: [], // all detected from sheet
		selected: [], // { column_id, column_name, sort_order, is_searchable }
		relationships: [], // { parent_column_id, child_column_id }
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
		if (typeof global.getBuilderQuestions === "function") {
			return global.getBuilderQuestions() || [];
		}
		if (global.formBuilderState && Array.isArray(global.formBuilderState.questions)) {
			return global.formBuilderState.questions;
		}
		return [];
	}

	function notify(msg) {
		if (global.showNotification) global.showNotification(msg);
		else console.log(msg);
	}

	function el(id) {
		return document.getElementById(id);
	}

	function escapeHtml(s) {
		return String(s == null ? "" : s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function colById(id) {
		return (state.columns || []).find(function (c) {
			return c.id === id;
		});
	}

	function emitColumnsChanged() {
		try {
			document.dispatchEvent(
				new CustomEvent("jod-sdm-columns", {
					detail: { columns: getSelectedColumnsForBuilder() },
				})
			);
		} catch (_) {}
		if (typeof global.renderFormBuilderQuestions === "function") {
			global.renderFormBuilderQuestions();
		}
	}

	/** Columns shown in Integrated Dropdown picker (selected ones preferred). */
	function getSelectedColumnsForBuilder() {
		if (state.selected && state.selected.length) {
			return state.selected.map(function (s) {
				const c = colById(s.column_id) || {};
				return {
					id: s.column_id,
					column_name: s.column_name || c.column_name || "",
					column_index: c.column_index,
					unique_count: c.unique_count,
					sort_order: s.sort_order || "alpha_asc",
					is_searchable: s.is_searchable !== false,
				};
			});
		}
		return (state.columns || []).slice();
	}

	function render() {
		const status = el("sdmStatus");
		if (status) {
			if (!state.sourceId) {
				status.textContent = "Upload Excel, select columns with A–Z/number sort, set relationships, then use Integrated Dropdown.";
			} else if (!state.columns.length) {
				status.textContent = "Select a worksheet to detect columns.";
			} else {
				status.textContent =
					state.selected.length +
					" column(s) selected · " +
					state.relationships.length +
					" relationship(s). Use Integrated Dropdown on questions.";
			}
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

		renderSelectedColumns();
		renderRelationships();
		renderHint();
	}

	function sortOptionsHtml(current) {
		const cur = current || "alpha_asc";
		const opts = [
			["alpha_asc", "A → Z"],
			["alpha_desc", "Z → A"],
			["num_asc", "Number ↑ (District / ID way)"],
			["num_desc", "Number ↓"],
		];
		return opts
			.map(function (o) {
				return (
					'<option value="' +
					o[0] +
					'"' +
					(cur === o[0] ? " selected" : "") +
					">" +
					o[1] +
					"</option>"
				);
			})
			.join("");
	}

	function columnSelectHtml(selectedId, className) {
		const cols = state.columns || [];
		return (
			'<select class="setup-input ' +
			className +
			'"><option value="">— Select column —</option>' +
			cols
				.map(function (c) {
					const sel = selectedId === c.id ? " selected" : "";
					return (
						'<option value="' +
						escapeHtml(c.id) +
						'"' +
						sel +
						">" +
						escapeHtml(c.column_name) +
						" (" +
						(c.unique_count || 0) +
						")</option>"
					);
				})
				.join("") +
			"</select>"
		);
	}

	function renderSelectedColumns() {
		const box = el("sdmMappingRows");
		if (!box) return;
		if (!state.columns.length) {
			box.innerHTML = '<p class="sdm-hint">Upload Excel and select a worksheet first.</p>';
			return;
		}
		if (!state.selected.length) {
			state.selected = [{ column_id: "", column_name: "", sort_order: "alpha_asc", is_searchable: true }];
		}
		box.innerHTML =
			state.selected
				.map(function (row, idx) {
					return (
						'<div class="sdm-map-row" data-idx="' +
						idx +
						'">' +
						columnSelectHtml(row.column_id, "sdm-col-select") +
						'<select class="setup-input sdm-sort-select">' +
						sortOptionsHtml(row.sort_order) +
						"</select>" +
						'<label class="sdm-check"><input type="checkbox" class="sdm-searchable" ' +
						(row.is_searchable !== false ? "checked" : "") +
						"/> Searchable</label>" +
						'<button type="button" class="sdm-rel-remove sdm-col-remove" aria-label="Remove">×</button>' +
						"</div>"
					);
				})
				.join("") +
			'<button type="button" id="sdmAddColumn" class="setup-input" style="width:auto;padding:0.4rem 0.75rem;cursor:pointer;margin-top:0.35rem;">+ Add column</button>';
	}

	function renderRelationships() {
		const box = el("sdmRelRows");
		if (!box) return;
		const usable = state.selected.filter(function (s) {
			return s.column_id;
		});
		if (usable.length < 2) {
			box.innerHTML =
				'<p class="sdm-hint">Select at least two columns above, then link parent → child (e.g. District ID → Club Name).</p>';
			return;
		}
		const colOpts = usable
			.map(function (s) {
				const name = s.column_name || (colById(s.column_id) || {}).column_name || s.column_id;
				return '<option value="' + escapeHtml(s.column_id) + '">' + escapeHtml(name) + "</option>";
			})
			.join("");

		if (!state.relationships.length) {
			state.relationships = [{ parent_column_id: "", child_column_id: "" }];
		}

		box.innerHTML =
			state.relationships
				.map(function (r, idx) {
					return (
						'<div class="sdm-rel-row" data-idx="' +
						idx +
						'">' +
						'<select class="setup-input sdm-rel-parent"><option value="">Parent column…</option>' +
						colOpts +
						"</select>" +
						'<span class="sdm-arrow">→</span>' +
						'<select class="setup-input sdm-rel-child"><option value="">Child column…</option>' +
						colOpts +
						"</select>" +
						'<button type="button" class="sdm-rel-remove" aria-label="Remove">×</button>' +
						"</div>"
					);
				})
				.join("");

		box.querySelectorAll(".sdm-rel-row").forEach(function (row, idx) {
			const r = state.relationships[idx] || {};
			const p = row.querySelector(".sdm-rel-parent");
			const c = row.querySelector(".sdm-rel-child");
			if (p && r.parent_column_id) p.value = r.parent_column_id;
			if (c && r.child_column_id) c.value = r.child_column_id;
		});
	}

	function renderHint() {
		const box = el("sdmPreview");
		if (!box) return;
		const integrated = questions().filter(function (q) {
			return q && q.type === "integrated_dropdown" && q.smart_column_id;
		});
		box.innerHTML =
			'<p class="sdm-hint">Then add form questions with type <strong>Integrated Dropdown (Excel)</strong> and pick a selected column — title fills automatically. Click Activate when ready.</p>' +
			(integrated.length
				? '<p class="sdm-hint">Integrated questions: ' +
					integrated
						.map(function (q) {
							return "<strong>" + escapeHtml(q.title || q.smart_column_name) + "</strong>";
						})
						.join(", ") +
					"</p>"
				: "");
	}

	function syncSelectedFromDom() {
		const box = el("sdmMappingRows");
		if (!box) return;
		const rows = [];
		box.querySelectorAll(".sdm-map-row").forEach(function (row) {
			const col = row.querySelector(".sdm-col-select");
			const sort = row.querySelector(".sdm-sort-select");
			const search = row.querySelector(".sdm-searchable");
			const id = col ? col.value : "";
			const meta = colById(id);
			rows.push({
				column_id: id,
				column_name: meta ? meta.column_name : "",
				sort_order: sort ? sort.value : "alpha_asc",
				is_searchable: search ? search.checked : true,
			});
		});
		state.selected = rows;
	}

	function syncRelsFromDom() {
		const box = el("sdmRelRows");
		if (!box) return;
		const rows = [];
		box.querySelectorAll(".sdm-rel-row").forEach(function (row) {
			const p = row.querySelector(".sdm-rel-parent");
			const c = row.querySelector(".sdm-rel-child");
			rows.push({
				parent_column_id: p ? p.value : "",
				child_column_id: c ? c.value : "",
			});
		});
		state.relationships = rows;
	}

	async function uploadFile(file) {
		const eid = eventId();
		if (!eid) {
			notify("Select or open an event first.");
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
			notify((data && data.detail) || "Upload failed");
			return;
		}
		state.sourceId = data.source_id;
		state.sheets = data.sheets || [];
		state.columns = [];
		state.selected = [];
		state.relationships = [];
		state.config = { file_name: data.file_name, sheet_name: null };
		notify("Excel uploaded. Select a worksheet.");
		render();
		emitColumnsChanged();
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
			notify((data && data.detail) || "Could not read sheet");
			return;
		}
		state.columns = (data.columns || []).slice().sort(function (a, b) {
			return (a.column_index || 0) - (b.column_index || 0);
		});
		state.selected = [{ column_id: "", column_name: "", sort_order: "alpha_asc", is_searchable: true }];
		state.relationships = [];
		state.config = Object.assign({}, state.config || {}, {
			sheet_name: data.sheet_name,
			columns: state.columns,
			preview: data.preview,
		});
		notify("Columns detected. Select columns and set A–Z / number sort.");
		render();
		emitColumnsChanged();
	}

	async function saveAndActivate() {
		if (!state.sourceId) {
			notify("Upload an Excel file first.");
			return;
		}
		syncSelectedFromDom();
		syncRelsFromDom();

		const selected = state.selected.filter(function (s) {
			return s.column_id;
		});
		if (!selected.length) {
			notify("Select at least one Excel column in section 3.");
			return;
		}

		// Prefer Integrated Dropdown questions; auto-create mapping entries by column
		const integrated = questions().filter(function (q) {
			return q && q.type === "integrated_dropdown" && q.smart_column_id;
		});

		let mappings;
		if (integrated.length) {
			mappings = integrated.map(function (q) {
				const sel = selected.find(function (s) {
					return s.column_id === q.smart_column_id;
				});
				return {
					question_id: q.id,
					column_id: q.smart_column_id,
					field_type: "dropdown",
					sort_order: (sel && sel.sort_order) || q.smart_sort_order || "alpha_asc",
					is_searchable: !sel || sel.is_searchable !== false,
					placeholder: q.placeholder || "Select " + (q.title || "option"),
					is_active: true,
				};
			});
		} else {
			notify("Add Integrated Dropdown questions and pick the columns you selected, then Activate again.");
			emitColumnsChanged();
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
			notify((cfg && cfg.detail) || "Could not save mappings");
			return;
		}
		state.config = cfg.configuration || cfg;

		const colToMid = {};
		const qidToMid = {};
		(state.config.mappings || []).forEach(function (m) {
			qidToMid[m.question_id] = m.id;
			colToMid[m.column_id] = m.id;
		});

		let relationships = state.relationships
			.filter(function (r) {
				return r.parent_column_id && r.child_column_id && r.parent_column_id !== r.child_column_id;
			})
			.map(function (r) {
				return {
					parent_mapping_id: colToMid[r.parent_column_id],
					child_mapping_id: colToMid[r.child_column_id],
					relationship_type: "one_to_many",
					sort_order: "alpha_asc",
					is_active: true,
				};
			})
			.filter(function (r) {
				return r.parent_mapping_id && r.child_mapping_id;
			});

		// Fallback: chain integrated questions in form order (Club → Name primary-key style)
		if (!relationships.length && integrated.length >= 2) {
			for (let i = 0; i < integrated.length - 1; i++) {
				const parentMid = qidToMid[integrated[i].id];
				const childMid = qidToMid[integrated[i + 1].id];
				if (parentMid && childMid) {
					relationships.push({
						parent_mapping_id: parentMid,
						child_mapping_id: childMid,
						relationship_type: "one_to_many",
						sort_order: "alpha_asc",
						is_active: true,
					});
				}
			}
		}

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
				notify((relData && relData.detail) || "Mappings saved but relationships failed");
				return;
			}
			state.config = relData.configuration || state.config;
		}

		notify(
			"Activated " +
				mappings.length +
				" integrated dropdown(s)" +
				(relationships.length ? " with " + relationships.length + " relationship(s)" : "") +
				". Save/publish the form."
		);
		render();
		emitColumnsChanged();
	}

	async function loadExisting() {
		const eid = eventId();
		if (!eid) return;
		const res = await authFetch(apiBase() + "/api/data-mapping/event/" + encodeURIComponent(eid));
		const data = await res.json().catch(function () {
			return {};
		});
		if (!res.ok || !(data.sources || []).length) return;
		const active =
			data.sources.find(function (s) {
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
		state.columns = (cfg.columns || []).slice().sort(function (a, b) {
			return (a.column_index || 0) - (b.column_index || 0);
		});
		state.selected = (cfg.mappings || []).map(function (m) {
			const col = (cfg.columns || []).find(function (c) {
				return c.id === m.column_id;
			});
			return {
				column_id: m.column_id,
				column_name: col ? col.column_name : "",
				sort_order: m.sort_order || "alpha_asc",
				is_searchable: m.is_searchable !== false,
			};
		});
		if (!state.selected.length) {
			state.selected = [{ column_id: "", column_name: "", sort_order: "alpha_asc", is_searchable: true }];
		}
		const midToCol = {};
		(cfg.mappings || []).forEach(function (m) {
			midToCol[m.id] = m.column_id;
		});
		state.relationships = (cfg.relationships || []).map(function (r) {
			return {
				parent_column_id: midToCol[r.parent_mapping_id] || "",
				child_column_id: midToCol[r.child_mapping_id] || "",
			};
		});
		const shRes = await authFetch(apiBase() + "/api/data-mapping/" + active.id + "/sheets");
		const sh = await shRes.json().catch(function () {
			return {};
		});
		state.sheets = sh.sheets || [];
		render();
		emitColumnsChanged();
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

		const mapBox = el("sdmMappingRows");
		if (mapBox) {
			mapBox.addEventListener("click", function (e) {
				if (e.target && e.target.id === "sdmAddColumn") {
					syncSelectedFromDom();
					state.selected.push({
						column_id: "",
						column_name: "",
						sort_order: "alpha_asc",
						is_searchable: true,
					});
					render();
					return;
				}
				if (e.target && e.target.classList.contains("sdm-col-remove")) {
					const row = e.target.closest(".sdm-map-row");
					const idx = row ? Number(row.getAttribute("data-idx")) : -1;
					syncSelectedFromDom();
					if (idx >= 0) state.selected.splice(idx, 1);
					if (!state.selected.length) {
						state.selected = [{ column_id: "", column_name: "", sort_order: "alpha_asc", is_searchable: true }];
					}
					render();
					emitColumnsChanged();
				}
			});
			mapBox.addEventListener("change", function (e) {
				if (
					e.target &&
					(e.target.classList.contains("sdm-col-select") ||
						e.target.classList.contains("sdm-sort-select") ||
						e.target.classList.contains("sdm-searchable"))
				) {
					syncSelectedFromDom();
					renderRelationships();
					renderHint();
					emitColumnsChanged();
				}
			});
		}

		const addRel = el("sdmAddRel");
		if (addRel) {
			addRel.style.display = "";
			addRel.addEventListener("click", function () {
				syncRelsFromDom();
				state.relationships.push({ parent_column_id: "", child_column_id: "" });
				renderRelationships();
			});
		}

		const relBox = el("sdmRelRows");
		if (relBox) {
			relBox.addEventListener("click", function (e) {
				if (e.target && e.target.classList.contains("sdm-rel-remove")) {
					const row = e.target.closest(".sdm-rel-row");
					const idx = row ? Number(row.getAttribute("data-idx")) : -1;
					syncRelsFromDom();
					if (idx >= 0) state.relationships.splice(idx, 1);
					renderRelationships();
				}
			});
			relBox.addEventListener("change", function () {
				syncRelsFromDom();
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

	global.JodDataMapping = {
		init: init,
		reload: loadExisting,
		render: render,
		getColumns: getSelectedColumnsForBuilder,
		getAllColumns: function () {
			return (state.columns || []).slice();
		},
		getSourceId: function () {
			return state.sourceId;
		},
		getSortForColumn: function (columnId) {
			const s = (state.selected || []).find(function (x) {
				return x.column_id === columnId;
			});
			return s ? s.sort_order : "alpha_asc";
		},
		activate: saveAndActivate,
	};
})(window);
