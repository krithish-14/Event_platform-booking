// State/district picker: data integrity and event matching.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const store = {};
const sandbox = {
	localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
	document: {
		querySelectorAll: () => [],
		documentElement: { toggleAttribute() {}, classList: { add() {}, remove() {} } },
		getElementById: () => null,
	},
	addEventListener() {},
	dispatchEvent() {},
	CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
	Promise,
	setTimeout,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../frontend/js/region-picker.js"), "utf8"), sandbox);
const P = sandbox.JodRegionPicker;

// Data: 36 states/UTs, unique codes, no duplicate districts inside a state, known counts.
assert.strictEqual(P.STATES.length, 36);
assert.strictEqual(new Set(P.STATES.map((s) => s.code)).size, 36);
P.STATES.forEach((s) => {
	const names = s.districts.map((d) => d.name.toLowerCase());
	assert.strictEqual(new Set(names).size, names.length, `duplicate district in ${s.name}`);
});
const count = (code) => P.STATES.find((s) => s.code === code).districts.length;
assert.strictEqual(count("TN"), 38);
assert.strictEqual(count("KA"), 31);
assert.strictEqual(count("KL"), 14);
assert.strictEqual(count("TS"), 33);
assert.strictEqual(count("UP"), 75);
assert.ok(P.STATES.reduce((n, s) => n + s.districts.length, 0) > 750);

const sel = (code, district) => {
	P.setRegion(code, district);
	return P.getRegion();
};

// District chosen: backend district wins over venue text.
let s = sel("TN", "Chengalpattu");
assert.strictEqual(s.label, "Chengalpattu, TN");
assert.strictEqual(P.matchesEvent({ state: "Tamil Nadu", district: "Chengalpattu", venue: "Tambaram, Chennai" }, s), true);
assert.strictEqual(P.matchesEvent({ state: "Tamil Nadu", district: "Chennai", venue: "Tambaram" }, s), false);
// Spelling differences from OpenStreetMap still match.
s = sel("TN", "Kancheepuram");
assert.strictEqual(P.matchesEvent({ state: "Tamil Nadu", district: "Kanchipuram" }, s), true);
s = sel("KA", "Bengaluru Urban");
assert.strictEqual(P.matchesEvent({ state: "Karnataka", district: "Bangalore Urban" }, s), true);
s = sel("TN", "Tiruchirappalli");
assert.strictEqual(P.matchesEvent({ state: "Tamil Nadu", district: "Tiruchchirappalli" }, s), true);
// Wrong state is rejected even with the same district name.
s = sel("HP", "Bilaspur");
assert.strictEqual(P.matchesEvent({ state: "Chhattisgarh", district: "Bilaspur" }, s), false);
// No region data: fall back to venue text with aliases.
s = sel("TN", "Tiruchirappalli");
assert.strictEqual(P.matchesEvent({ venue: "Kalaiarangam, Trichy" }, s), true);
assert.strictEqual(P.matchesEvent({ venue: "Venue TBA" }, s), false);

// Whole state chosen.
s = sel("TN", null);
assert.strictEqual(s.label, "Tamil Nadu");
assert.strictEqual(P.matchesEvent({ state: "Tamil Nadu", district: "Madurai" }, s), true);
assert.strictEqual(P.matchesEvent({ state: "Kerala", district: "Ernakulam" }, s), false);
assert.strictEqual(P.matchesEvent({ venue: "Brookefields Mall, Coimbatore" }, s), true, "district name in text");
assert.strictEqual(P.matchesEvent({ venue: "Phoenix Mall, Bangalore" }, s), false);
s = sel("OD", null);
assert.strictEqual(P.matchesEvent({ state: "Orissa" }, s), true, "state alias");

// Clearing shows everything and is remembered.
P.setCity(null);
assert.strictEqual(P.getRegion(), null);
assert.strictEqual(P.hasChosen(), true);
assert.strictEqual(P.filterEvents([{ venue: "a" }, { venue: "b" }]).length, 2);
assert.strictEqual(P.stateOfName("NCT of Delhi").code, "DL");

console.log("region_picker tests passed");
