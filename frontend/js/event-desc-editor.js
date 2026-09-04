/**
 * Host-only rich text for event Description & Highlights.
 * Saves sanitized HTML into #eventDescInput for the existing about_event API.
 */
(function (global) {
	"use strict";

	var EDITOR_ID = "eventDescEditor";
	var INPUT_ID = "eventDescInput";
	var SIZE_STEPS = [12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36];
	var ALLOWED_TAGS = {
		P: 1, DIV: 1, BR: 1, SPAN: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, FONT: 1,
		S: 1, STRIKE: 1, SUB: 1, SUP: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1
	};
	var TOGGLE_CMDS = ["bold", "italic", "underline", "strikeThrough", "subscript", "superscript", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"];
	var savedRange = null;

	function looksLikeHtml(value) {
		return /<\/?(p|div|br|span|b|strong|i|em|u|font|s|strike|sub|sup|ul|ol|li|blockquote)\b/i.test(String(value || ""));
	}

	function stripToText(value) {
		var html = String(value || "")
			.replace(/<\s*br\s*\/?\s*>/gi, " ")
			.replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote|tr|section|article|header|footer)\s*>/gi, " ")
			.replace(/<\s*(p|div|h[1-6]|li|blockquote|tr|section|article|header|footer)\b[^>]*>/gi, " ");
		var tmp = document.createElement("div");
		tmp.innerHTML = html;
		return (tmp.textContent || tmp.innerText || "")
			.replace(/\u00a0/g, " ")
			.replace(/\.([A-Za-z])/g, ". $1")
			.replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
			.replace(/\s+/g, " ")
			.trim();
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
			} else if (prop === "text-decoration" && /^(underline|none|line-through|underline line-through)$/i.test(val)) {
				allowed.push("text-decoration:" + val);
			} else if ((prop === "margin-left" || prop === "padding-left") && /^[\d.]+\s*(px|em|rem)$/i.test(val)) {
				allowed.push(prop + ":" + val);
			} else if (prop === "line-height" && /^[\d.]+$|^[\d.]+\s*(px|em|%)$/i.test(val)) {
				allowed.push("line-height:" + val);
			} else if (prop === "vertical-align" && /^(sub|super|baseline|middle)$/i.test(val)) {
				allowed.push("vertical-align:" + val);
			} else if (prop === "border" && /^[\d.]+px\s+solid\s+(#[0-9a-f]{3,8}|[a-z]+)$/i.test(val)) {
				allowed.push("border:" + val);
			} else if (prop === "padding" && /^[\d.]+\s*(px|em|rem)$/i.test(val)) {
				allowed.push("padding:" + val);
			} else if (prop === "list-style-type" && /^(disc|decimal|circle|square)$/i.test(val)) {
				allowed.push("list-style-type:" + val);
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

	function currentFontSizePx() {
		var node = savedRange ? savedRange.startContainer : null;
		if (node && node.nodeType === 3) node = node.parentElement;
		if (!node || !node.nodeType) return 16;
		try {
			return parseFloat(global.getComputedStyle(node).fontSize) || 16;
		} catch (_) {
			return 16;
		}
	}

	function bumpFontSize(dir) {
		var cur = Math.round(currentFontSizePx());
		var next = cur;
		if (Number(dir) > 0) {
			next = SIZE_STEPS.filter(function (s) { return s > cur; })[0] || SIZE_STEPS[SIZE_STEPS.length - 1];
		} else {
			var smaller = SIZE_STEPS.filter(function (s) { return s < cur; });
			next = smaller.length ? smaller[smaller.length - 1] : SIZE_STEPS[0];
		}
		applyFontSize(next + "px");
	}

	function applyCase(mode) {
		var sel = global.getSelection && global.getSelection();
		if (!sel || !sel.rangeCount) return;
		var range = sel.getRangeAt(0);
		if (range.collapsed) return;
		var text = range.toString();
		var next = text;
		if (mode === "upper") next = text.toUpperCase();
		else if (mode === "lower") next = text.toLowerCase();
		else if (mode === "title") {
			next = text.replace(/\S+/g, function (word) {
				return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			});
		} else {
			next = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
		}
		document.execCommand("insertText", false, next);
	}

	function closestBlock(node) {
		var editor = getEditor();
		while (node && node !== editor) {
			if (node.nodeType === 1 && /^(P|DIV|LI|H1|H2|H3|BLOCKQUOTE)$/.test(node.tagName) && node !== editor) {
				return node;
			}
			node = node.parentNode;
		}
		return editor;
	}

	function selectedBlocks() {
		var editor = getEditor();
		var sel = global.getSelection && global.getSelection();
		if (!editor || !sel || !sel.rangeCount) return editor ? [editor] : [];
		var range = sel.getRangeAt(0);
		var start = closestBlock(range.startContainer);
		var end = closestBlock(range.endContainer);
		if (start === editor && end === editor) return [editor];
		var blocks = [];
		var all = editor.querySelectorAll("p, div, li, blockquote");
		var seen = false;
		if (!all.length) return [start];
		all.forEach(function (el) {
			if (el === start) seen = true;
			if (seen) blocks.push(el);
			if (el === end) seen = false;
		});
		return blocks.length ? blocks : [start];
	}

	function applyBlockStyle(prop, value) {
		selectedBlocks().forEach(function (el) {
			if (!el || !el.style) return;
			if (!value || value === "transparent") el.style.removeProperty(prop);
			else el.style.setProperty(prop, value);
		});
	}

	function toggleBorder() {
		selectedBlocks().forEach(function (el) {
			if (!el || !el.style) return;
			if (el.style.border) {
				el.style.removeProperty("border");
				el.style.removeProperty("padding");
			} else {
				el.style.border = "1px solid #cbd5e1";
				el.style.padding = "8px";
			}
		});
	}

	function afterCommand() {
		var editor = getEditor();
		saveSelection();
		sync();
		if (editor) editor.dispatchEvent(new Event("input", { bubbles: true }));
	}

	function applyCommand(cmd, value) {
		var editor = getEditor();
		if (!editor) return;
		restoreSelection();
		try { document.execCommand("styleWithCSS", false, true); } catch (_) {}
		if (cmd === "fontSizePx") applyFontSize(value);
		else if (cmd === "fontSizeBump") bumpFontSize(value);
		else if (cmd === "changeCase") applyCase(value);
		else if (cmd === "lineHeight") applyBlockStyle("line-height", value);
		else if (cmd === "shade") applyBlockStyle("background-color", value);
		else if (cmd === "toggleBorder") toggleBorder();
		else if (cmd === "hilite") {
			if (!document.execCommand("hiliteColor", false, value || "transparent")) {
				document.execCommand("backColor", false, value || "transparent");
			}
		} else if (cmd === "removeFormat") {
			document.execCommand("removeFormat", false, null);
			document.execCommand("unlink", false, null);
			document.execCommand("hiliteColor", false, "transparent");
			applyBlockStyle("background-color", "transparent");
			applyBlockStyle("line-height", "");
			applyBlockStyle("border", "");
			applyBlockStyle("padding", "");
		} else {
			document.execCommand(cmd, false, value || null);
		}
		afterCommand();
	}

	function queryState(cmd) {
		try { return document.queryCommandState(cmd); } catch (_) { return false; }
	}

	function updateToolbarState(wrap) {
		if (!wrap) return;
		TOGGLE_CMDS.forEach(function (cmd) {
			var btn = wrap.querySelector('[data-desc-cmd="' + cmd + '"]');
			if (!btn) return;
			var active = queryState(cmd);
			btn.classList.toggle("is-active", !!active);
			btn.setAttribute("aria-pressed", active ? "true" : "false");
		});
	}

	function bindToolbar(wrap, editor) {
		wrap.addEventListener("mousedown", function (e) {
			if (e.target.closest("button")) {
				saveSelection();
				e.preventDefault();
			} else if (e.target.closest("select") || e.target.closest("input[type=color]")) {
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
			var color = e.target.closest("input[type=color][data-desc-cmd]");
			if (color) {
				applyCommand(color.getAttribute("data-desc-cmd"), color.value);
				return;
			}
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
			afterCommand();
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
