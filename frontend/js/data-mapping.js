/**
 * Smart Data Mapping — Excel upload, column order (parent→child), activate from
 * Integrated Dropdown questions in the form builder.
 */
(function (global) {
	"use strict";

	let state = {
		sourceId: null,
		sheets: [],
		columns: [], // ordered: index 0 = top parent (e.g. District)
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

	function emitColumnsChanged() {
		try {
			document.dispatchEvent(new CustomEvent("jod-sdm-columns", { detail: { columns: state.columns.slice() } }));
		} catch (_) {}
		if (typeof global.renderFormBuilderQuestions === "function") {
			global.renderFormBuilderQuestions();
		}
	}

	function render() {
		const status = el("sdmStatus");
		if (status) {
			if (!state.sourceId) {
				status.textContent = "Upload Excel first. Columns become Integrated Dropdown choices when you add questions.";
			} else if (!state.columns.length) {
				status.textContent = "Source loaded. Select a worksheet to detect columns.";
			} else {
				status.textContent =
					"Columns ready (" +
					state.columns.length +
					"). Order below = parent → child (e.g. District → Club). Add questions as Integrated Dropdown.";
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

		renderColumnOrder();
		renderIntegratedHint();
	}

	function renderColumnOrder() {
		const box = el("sdmMappingRows");
		if (!box) return;
		const cols = state.columns || [];
		if (!cols.length) {
			box.innerHTML = '<p class="sdm-hint">No columns yet. Upload a file and pick a worksheet.</p>';
			return;
		}
		box.innerHTML =
			'<p class="sdm-hint" style="margin-bottom:0.4rem;">Column hierarchy (top = parent, next = child):</p>' +
			cols
				.map(function (c, idx) {
					return (
						'<div class="sdm-col-order-row" data-col-id="' +
						escapeHtml(c.id) +
						'" style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.55rem;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">' +
						'<span style="font-weight:800;color:#2563eb;min-width:1.5rem;">' +
						(idx + 1) +
						"</span>" +
						'<span style="flex:1;font-weight:700;color:#0f172a;">' +
						escapeHtml(c.column_name) +
						'</span><span style="font-size:0.75rem;color:#64748b;">' +
						(c.unique_count || 0) +
						" unique</span>" +
						'<button type="button" class="sdm-col-up" title="Move up" ' +
						(idx === 0 ? "disabled" : "") +
						' style="padding:0.2rem 0.45rem;cursor:pointer;">↑</button>' +
						'<button type="button" class="sdm-col-down" title="Move down" ' +
						(idx === cols.length - 1 ? "disabled" : "") +
						' style="padding:0.2rem 0.45rem;cursor:pointer;">↓</button>' +
						"</div>"
					);
				})
				.join('<div class="sdm-arrow" style="text-align:center;color:#94a3b8;font-weight:700;">↓ depends on above</div>');
	}

	function renderIntegratedHint() {
		const box = el("sdmRelRows");
		if (!box) return;
		const integrated = questions().filter(function (q) {
			return q && q.type === "integrated_dropdown" && q.smart_column_id;
		});
		if (!state.columns.length) {
			box.innerHTML = "";
			return;
		}
		if (!integrated.length) {
			box.innerHTML =
				'<p class="sdm-hint">Next: click <strong>Add Question</strong>, set type to <strong>Integrated Dropdown</strong>, then pick an Excel column — the question title fills automatically.</p>';
			return;
		}
		box.innerHTML =
			'<p class="sdm-hint">Integrated fields ready:</p><ul style="margin:0.3rem 0 0;padding-left:1.2rem;font-size:0.85rem;color:#334155;">' +
			integrated
				.map(function (q) {
					return "<li><strong>" + escapeHtml(q.title || q.smart_column_name || q.id) + "</strong></li>";
				})
				.join("") +
			"</ul>";
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
		state.config = Object.assign({}, state.config || {}, {
			sheet_name: data.sheet_name,
			columns: state.columns,
			preview: data.preview,
		});
		notify("Columns detected. Reorder if needed, then add Integrated Dropdown questions.");
		render();
		emitColumnsChanged();
	}

	function moveColumn(colId, dir) {
		const idx = state.columns.findIndex(function (c) {
			return c.id === colId;
		});
		if (idx < 0) return;
		const swap = idx + dir;
		if (swap < 0 || swap >= state.columns.length) return;
		const tmp = state.columns[idx];
		state.columns[idx] = state.columns[swap];
		state.columns[swap] = tmp;
		render();
		emitColumnsChanged();
	}

	function collectIntegratedMappings() {
		const qs = questions().filter(function (q) {
			return q && q.type === "integrated_dropdown" && q.smart_column_id;
		});
		// Preserve form-builder order for relationship chain
		return qs.map(function (q) {
			return {
				question_id: q.id,
				column_id: q.smart_column_id,
				field_type: "dropdown",
				sort_order: "alpha_asc",
				is_searchable: true,
				placeholder: q.placeholder || "Select " + (q.title || "option"),
				is_active: true,
			};
		});
	}

	async function saveAndActivate() {
		if (!state.sourceId) {
			notify("Upload an Excel file first.");
			return;
		}
		if (!state.columns.length) {
			notify("Select a worksheet so columns are detected.");
			return;
		}
		const mappings = collectIntegratedMappings();
		if (mappings.length < 1) {
			notify("Add at least one question with type Integrated Dropdown and pick a column.");
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

		const qidToMid = {};
		(state.config.mappings || []).forEach(function (m) {
			qidToMid[m.question_id] = m.id;
		});

		// Chain relationships in question order: Q1 → Q2 → Q3 …
		const orderedQids = mappings.map(function (m) {
			return m.question_id;
		});
		const relationships = [];
		for (let i = 0; i < orderedQids.length - 1; i++) {
			const parentMid = qidToMid[orderedQids[i]];
			const childMid = qidToMid[orderedQids[i + 1]];
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
				(relationships.length ? " with " + relationships.length + " parent→child link(s)" : "") +
				". Save/publish the form, then open registration."
		);
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
				const up = e.target.closest(".sdm-col-up");
				const down = e.target.closest(".sdm-col-down");
				const row = e.target.closest(".sdm-col-order-row");
				if (!row) return;
				const id = row.getAttribute("data-col-id");
				if (up) moveColumn(id, -1);
				if (down) moveColumn(id, 1);
			});
		}

		const refreshBtn = el("sdmReloadBtn");
		if (refreshBtn) refreshBtn.addEventListener("click", loadExisting);

		// Hide old "Add link" if present — relationships come from question order
		const addRel = el("sdmAddRel");
		if (addRel) addRel.style.display = "none";
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
		getColumns: function () {
			return (state.columns || []).slice();
		},
		getSourceId: function () {
			return state.sourceId;
		},
		activate: saveAndActivate,
	};
})(window);
