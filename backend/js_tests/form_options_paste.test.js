// Registration form builder: pasting a list into a dropdown/radio/checkbox option (frontend/js/form-builder.js).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../../frontend/js/form-builder.js"), "utf8");
const start = src.indexOf("const DEFAULT_OPTION_RE");
const end = src.indexOf("function focusOptionInput");
assert.ok(start > 0 && end > start, "paste helpers not found in form-builder.js");
const helpers = new Function(src.slice(start, end) + "\nreturn { splitOptionLines, dedupeOptions, insertOptionLines };")();
const { splitOptionLines, dedupeOptions, insertOptionLines } = helpers;

assert.deepStrictEqual(splitOptionLines("Ambattur\nAnna Nagar Madras\r\n\nCentennial Madras\n"), ["Ambattur", "Anna Nagar Madras", "Centennial Madras"]);
assert.deepStrictEqual(splitOptionLines("1. Red\n2) Green\n- Blue\n\u2022 Yellow\na. Black"), ["Red", "Green", "Blue", "Yellow", "Black"]);
assert.deepStrictEqual(splitOptionLines("A\tB\tC"), ["A", "B", "C"], "spreadsheet row cells");
assert.deepStrictEqual(splitOptionLines("2024 batch\n10 people"), ["2024 batch", "10 people"], "numbers without a dot or bracket stay");
assert.deepStrictEqual(dedupeOptions(["Red", "red ", "Blue", ""]), ["Red", "Blue"]);

// Pasting over the default placeholders replaces them all.
let q = { options: ["Option 1", "Option 2"] };
let focus = insertOptionLines(q, 0, ["Ambattur", "Chennai Amigos", "Ambattur"]);
assert.deepStrictEqual(q.options, ["Ambattur", "Chennai Amigos"]);
assert.strictEqual(focus, 1);

// Pasting into an empty option in the middle inserts there and skips options that already exist.
q = { options: ["Ambattur", "", "Chennai Bharathi"] };
focus = insertOptionLines(q, 1, ["Chennai Anchorage", "Chennai Bharathi", "Chennai Ashokpillar"]);
assert.deepStrictEqual(q.options, ["Ambattur", "Chennai Anchorage", "Chennai Ashokpillar", "Chennai Bharathi"]);
assert.strictEqual(focus, 2);

// Pasting into a filled option keeps it and adds the new lines after it.
q = { options: ["Ambattur", "Chennai Amigos"] };
focus = insertOptionLines(q, 0, ["Anna Nagar Madras", "Centennial Madras"]);
assert.deepStrictEqual(q.options, ["Ambattur", "Anna Nagar Madras", "Centennial Madras", "Chennai Amigos"]);
assert.strictEqual(focus, 2);

console.log("form_options_paste tests passed");
