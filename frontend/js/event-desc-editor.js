/**
 * Host-only rich text for event Description & Highlights.
 * Saves sanitized HTML into #eventDescInput for the existing about_event API.
 */
(function (global) {
	"use strict";

	var EDITOR_ID = "eventDescEditor";
	var INPUT_ID = "eventDescInput";
	var ALLOWED_TAGS = {
		P: 1, DIV: 1, BR: 1, SPAN: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, FONT: 1
	};
	var savedRange = null;

	function looksLikeHtml(value) {
		return /<\/?(p|div|br|span|b|strong|i|em|u|font)\b/i.test(String(value || ""));
	}

	function stripToText(value) {
		var tmp = document.createElement("div");
		tmp.innerHTML = String(value || "");
		var text = (tmp.textContent || tmp.innerText || "")
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return text;
	}

	function sanitizeStyle(styleText) {
		if (!styleText) return "";
		var allowed = [];
		String(styleText).split(";").forEach(function (decl) {
			var parts = decl.split(":");
			if (parts.length < 2) return;
			var prop = parts[0].trim().toLowerCase();
			var val = parts.slice(1).join(":").trim();
			if (!prop || !val) return;
			if (/expression|javascript|url\s*\(|@import|behavior/i.test(val)) return;
			if (prop === "font-size" && /^[\d.]+\s*(px|pt|em|rem)$/i.test(val)) {
				allowed.push("font-size:" + val);
			} else if (prop === "font-family" && /^[a-z0-9\s,"'\-]+$/i.test(val) && val.length < 80) {
				allowed.push("font-family:" + val);
			} else if (prop === "font-weight" && /^(bold|normal|bolder|lighter|[1-9]00)$/i.test(val)) {
				allowed.push("font-weight:" + val);
			} else if (prop === "font-style" && /^(normal|italic|oblique)$/i.test(val)) {
				allowed.push("font-style:" + val);
			} else if (prop === "text-align" && /^(left|center|right|justify)$/i.test(val)) {
				allowed.push("text-align:" + val);
			} else if ((prop === "color" || prop === "background-color") &&
				/^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)$/i.test(val)) {
				allowed.push(prop + ":" + val);
			} else if (prop === "text-decoration" && /^(underline|none|line-through)$/i.test(val)) {
				allowed.push("text-decoration:" + val);
			}
		});
		return allowed.join(";");
	}

	function sanitizeHtml(html) {
		var parser = new DOMParser();
		var doc = parser.parseFromString("<!DOCTYPE html><html><body></body></html>", "text/html");
		var root = doc.body;
		root.innerHTML = String(html || "");

		function walk(node) {
			Array.prototype.slice.call(node.childNodes).forEach(function (child) {
				if (child.nodeType === 8) {
					child.remove();
					return;
				}
				if (child.nodeType === 3) return;
				if (child.nodeType !== 1) {
					child.remove();
					return;
				}
				var tag = child.tagName;
				if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|FORM|INPUT|TEXTAREA|BUTTON|SVG|IMG)$/.test(tag)) {
					child.remove();
					return;
				}
				walk(child);
				if (!ALLOWED_TAGS[tag]) {
					var parent = child.parentNode;
					if (!parent) return;
					while (child.firstChild) parent.insertBefore(child.firstChild, child);
					parent.removeChild(child);
					return;
				}
				Array.prototype.slice.call(child.attributes).forEach(function (attr) {
					var name = attr.name.toLowerCase();
					if (name === "style") {
						var cleaned = sanitizeStyle(attr.value);
						if (cleaned) child.setAttribute("style", cleaned);
						else child.removeAttribute("style");
						return;
					}
					if (tag === "FONT" && (name === "face" || name === "color" || name === "size")) {
						if (name === "size" && !/^[1-7]$/.test(attr.value)) child.removeAttribute(attr.name);
						else if (name === "color" && !/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(attr.value)) child.removeAttribute(attr.name);
						else if (name === "face" && !/^[a-z0-9\s,"'\-]+$/i.test(attr.value)) child.removeAttribute(attr.name);
						return;
					}
					if (name === "align" && /^(left|center|right|justify)$/i.test(attr.value)) return;
					child.removeAttribute(attr.name);
				});
			});
		}

		walk(root);
		return root.innerHTML;
	}

	function getEditor() {
		return document.getElementById(EDITOR_ID);
	}

	function getInput() {
		return document.getElementById(INPUT_ID);
	}

	function editorIsEmpty(editor) {
		if (!editor) return true;
		var text = (editor.textContent || "").replace(/\u00a0/g, " ").trim();
		if (text) return false;
		var html = String(editor.innerHTML || "")
			.replace(/<br\s*\/?>/gi, "")
			.replace(/&nbsp;/gi, "")
			.replace(/<div><\/div>/gi, "")
			.replace(/<p><\/p>/gi, "")
			.replace(/\s+/g, "")
			.trim();
		return !html;
	}

	function syncEmptyClass(editor) {
		if (!editor) return;
		editor.classList.toggle("is-empty", editorIsEmpty(editor));
	}

	function sync() {
		var editor = getEditor();
		var input = getInput();
		if (!editor) return input ? String(input.value || "") : "";
		var html = editorIsEmpty(editor) ? "" : sanitizeHtml(editor.innerHTML);
		if (input) input.value = html;
		syncEmptyClass(editor);
		return html;
	}

	function setHtml(raw) {
		var editor = getEditor();
		var text = String(raw || "");
		if (editor) {
			if (!text.trim()) {
				editor.innerHTML = "";
			} else if (!looksLikeHtml(text)) {
				editor.textContent = text;
			} else {
				editor.innerHTML = sanitizeHtml(text);
			}
			syncEmptyClass(editor);
		} else {
			var input = getInput();
			if (input) input.value = text;
		}
		return sync();
	}

	function saveSelection() {
		var editor = getEditor();
		var sel = global.getSelection && global.getSelection();
		if (!editor || !sel || !sel.rangeCount) return;
		var range = sel.getRangeAt(0);
		var node = range.commonAncestorContainer;
		if (editor === node || editor.contains(node)) savedRange = range;
	}

	function restoreSelection() {
		var editor = getEditor();
		if (!editor) return;
		editor.focus();
		if (!savedRange) return;
		var sel = global.getSelection && global.getSelection();
		if (!sel) return;
		sel.removeAllRanges();
		sel.addRange(savedRange);
	}

	function applyFontSize(px) {
		document.execCommand("fontSize", false, "7");
		var editor = getEditor();
		if (!editor) return;
		editor.querySelectorAll('font[size="7"], span').forEach(function (node) {
			if (node.tagName === "FONT" && node.getAttribute("size") === "7") {
				var span = document.createElement("span");
				span.style.fontSize = px;
				while (node.firstChild) span.appendChild(node.firstChild);
				if (node.parentNode) node.parentNode.replaceChild(span, node);
				return;
			}
			var size = (node.style && node.style.fontSize) || "";
			if (size === "xxx-large" || size === "xx-large" || size === "-webkit-xxx-large") {
				node.style.fontSize = px;
			}
		});
	}

	function applyCommand(cmd, value) {
		var editor = getEditor();
		if (!editor) return;
		restoreSelection();
		try { document.execCommand("styleWithCSS", false, true); } catch (_) {}
		if (cmd === "fontSizePx") applyFontSize(value);
		else if (cmd === "hilite") {
			if (!document.execCommand("hiliteColor", false, value || "transparent")) {
				document.execCommand("backColor", false, value || "transparent");
			}
		}
		else document.execCommand(cmd, false, value || null);
		saveSelection();
		sync();
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	}

	function updateToolbarState(wrap) {
		if (!wrap) return;
		var boldBtn = wrap.querySelector('[data-desc-cmd="bold"]');
		if (!boldBtn) return;
		var active = false;
		try { active = document.queryCommandState("bold"); } catch (_) {}
		boldBtn.classList.toggle("is-active", !!active);
		boldBtn.setAttribute("aria-pressed", active ? "true" : "false");
	}

	function bindToolbar(wrap, editor) {
		wrap.addEventListener("mousedown", function (e) {
			if (e.target.closest("button")) {
				saveSelection();
				e.preventDefault();
			} else if (e.target.closest("select")) {
				saveSelection();
			}
		});
		wrap.addEventListener("click", function (e) {
			var btn = e.target.closest("button[data-desc-cmd]");
			if (!btn || !wrap.contains(btn)) return;
			applyCommand(btn.getAttribute("data-desc-cmd"), btn.getAttribute("data-desc-value"));
			updateToolbarState(wrap);
		});
		wrap.addEventListener("change", function (e) {
			var sel = e.target.closest("select[data-desc-cmd]");
			if (!sel || !sel.value) return;
			applyCommand(sel.getAttribute("data-desc-cmd"), sel.value);
			sel.selectedIndex = 0;
		});
		editor.addEventListener("keyup", saveSelection);
		editor.addEventListener("mouseup", saveSelection);
		document.addEventListener("selectionchange", function () {
			if (document.activeElement === editor || editor.contains(document.activeElement)) {
				saveSelection();
				updateToolbarState(wrap);
			}
		});
	}

	function init() {
		var editor = getEditor();
		if (!editor || editor.dataset.bound === "1") return;
		editor.dataset.bound = "1";
		var wrap = editor.closest(".desc-editor") || editor.parentNode;
		if (wrap) bindToolbar(wrap, editor);
		editor.addEventListener("input", sync);
		editor.addEventListener("blur", sync);
		editor.addEventListener("paste", function (e) {
			e.preventDefault();
			restoreSelection();
			var html = (e.clipboardData && e.clipboardData.getData("text/html")) || "";
			var text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
			try { document.execCommand("styleWithCSS", false, true); } catch (_) {}
			if (html) document.execCommand("insertHTML", false, sanitizeHtml(html));
			else document.execCommand("insertText", false, text);
			sync();
			editor.dispatchEvent(new Event("input", { bubbles: true }));
		});
		var input = getInput();
		if (input && input.value && editorIsEmpty(editor)) setHtml(input.value);
		else sync();
	}

	global.JodDescEditor = {
		sanitize: sanitizeHtml,
		stripToText: stripToText,
		looksLikeHtml: looksLikeHtml,
		sync: sync,
		setHtml: setHtml,
		isEmpty: function () {
			var editor = getEditor();
			if (editor) return editorIsEmpty(editor);
			var input = getInput();
			return !input || !String(input.value || "").trim();
		},
		init: init
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})(window);
