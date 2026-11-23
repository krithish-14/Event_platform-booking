/**
 * Show/hide registration questions based on a controlling dropdown/radio answer.
 *
 * Question schema:
 *   show_if: { enabled, question_id, operator: "is"|"is_not", values: string[] }
 *
 * Example: Position = Rotarian → show Club Name dropdown
 *          Position is not Rotarian → show manual name field
 */
(function (global) {
	"use strict";

	function asArray(v) {
		if (v == null) return [];
		return Array.isArray(v) ? v : [v];
	}

	function normalize(v) {
		return String(v == null ? "" : v).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function readAnswer(container, questionId) {
		if (!container || !questionId) return "";
		var sel = container.querySelector("#" + CSS.escape(questionId));
		if (sel && sel.tagName === "SELECT") return normalize(sel.value);
		var radios = container.querySelectorAll('input[type="radio"][name="' + questionId.replace(/"/g, '\\"') + '"]');
		if (radios && radios.length) {
			for (var i = 0; i < radios.length; i++) {
				if (radios[i].checked) return normalize(radios[i].value);
			}
			return "";
		}
		var checks = container.querySelectorAll('input[type="checkbox"][name="' + questionId.replace(/"/g, '\\"') + '"]');
		if (checks && checks.length) {
			var out = [];
			checks.forEach(function (cb) {
				if (cb.checked) out.push(normalize(cb.value));
			});
			return out;
		}
		var named = container.querySelector('[name="' + questionId.replace(/"/g, '\\"') + '"]');
		if (named) return normalize(named.value);
		return "";
	}

	function answerHitsWanted(answer, wanted) {
		if (Array.isArray(answer)) {
			var set = {};
			answer.forEach(function (a) {
				set[normalize(a).toLowerCase()] = true;
			});
			return wanted.some(function (w) {
				return !!set[w.toLowerCase()];
			});
		}
		var ans = normalize(answer).toLowerCase();
		if (!ans) return false;
		return wanted.some(function (w) {
			return w.toLowerCase() === ans;
		});
	}

	function ruleMatches(q, answer) {
		var rule = q && q.show_if;
		if (!rule || !rule.enabled || !rule.question_id) return true;
		var wanted = asArray(rule.values != null ? rule.values : rule.equals)
			.map(normalize)
			.filter(Boolean);
		if (!wanted.length) return true;
		var isNot = String(rule.operator || "is").toLowerCase() === "is_not";
		// No controlling answer yet → keep dependents hidden for both operators
		if (Array.isArray(answer) ? !answer.length : !normalize(answer)) return false;
		var hits = answerHitsWanted(answer, wanted);
		return isNot ? !hits : hits;
	}

	function setGroupVisible(group, visible) {
		if (!group) return;
		group.hidden = !visible;
		group.style.display = visible ? "" : "none";
		group.setAttribute("data-cond-hidden", visible ? "0" : "1");
		// Strip required when hidden so HTML5 validation does not block submit.
		// Do not toggle disabled — that fights Integrated Dropdown parent locks.
		var fields = group.querySelectorAll("input, select, textarea");
		fields.forEach(function (el) {
			if (visible) {
				if (el.dataset.condWasRequired === "1") {
					el.required = true;
					el.setAttribute("required", "");
				}
				delete el.dataset.condWasRequired;
			} else {
				if (el.required) {
					el.dataset.condWasRequired = "1";
					el.required = false;
					el.removeAttribute("required");
				}
				if (el.type === "checkbox" || el.type === "radio") {
					el.checked = false;
				} else if (el.tagName === "SELECT") {
					el.selectedIndex = 0;
				} else if (el.type !== "file") {
					el.value = "";
				}
			}
		});
	}

	function findGroup(container, qid) {
		if (!container || !qid) return null;
		var byData = container.querySelector('[data-qid="' + qid.replace(/"/g, '\\"') + '"]');
		if (byData && (byData.classList.contains("question-group") || byData.classList.contains("setup-form-group") || byData.getAttribute("data-question-group") === "1")) {
			return byData;
		}
		// Prefer closest question wrapper around the field
		var field = container.querySelector("#" + CSS.escape(qid));
		if (field) {
			return field.closest(".question-group, .setup-form-group, [data-question-group='1']") || field.parentElement;
		}
		return byData;
	}

	function apply(container, schema) {
		if (!container || !Array.isArray(schema)) return;
		schema.forEach(function (q) {
			if (!q || !q.id) return;
			var group = findGroup(container, q.id);
			if (!group) return;
			var visible = true;
			if (q.show_if && q.show_if.enabled && q.show_if.question_id) {
				var answer = readAnswer(container, q.show_if.question_id);
				visible = ruleMatches(q, answer);
			}
			setGroupVisible(group, visible);
		});
	}

	function isQuestionVisible(container, q) {
		if (!q) return true;
		if (!q.show_if || !q.show_if.enabled || !q.show_if.question_id) return true;
		return ruleMatches(q, readAnswer(container, q.show_if.question_id));
	}

	function init(config) {
		var container = (config && config.container) || document;
		var schema = (config && config.schema) || [];
		apply(container, schema);

		container._jodCondState = { schema: schema, apply: function () { apply(container, schema); } };
		if (!container._jodCondBound) {
			container._jodCondBound = true;
			container.addEventListener("change", function () {
				if (container._jodCondState) container._jodCondState.apply();
			});
			container.addEventListener("input", function () {
				if (container._jodCondState) container._jodCondState.apply();
			});
		} else if (container._jodCondState) {
			container._jodCondState.schema = schema;
			container._jodCondState.apply = function () {
				apply(container, schema);
			};
		}
		return {
			apply: function () {
				apply(container, schema);
			},
			isQuestionVisible: function (q) {
				return isQuestionVisible(container, q);
			},
		};
	}

	global.JodConditionalQuestions = {
		init: init,
		apply: apply,
		isQuestionVisible: isQuestionVisible,
		readAnswer: readAnswer,
	};
})(window);
