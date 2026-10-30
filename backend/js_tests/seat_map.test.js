// Seat numbering in the browser must match Services/cinema_booking.py exactly.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../frontend/js/seat-map.js"), "utf8"), sandbox);
const SM = sandbox.JodSeatMap;

const layout = {
	rows: 3, cols: 5, screen: "top", numbering: "ltr",
	categories: [{ id: "classic", name: "Classic", color: "#64748b" }, { id: "prime", name: "Prime", color: "#2563eb" }],
	cells: [
		["classic", "classic", null, "classic", "classic"],
		[null, null, null, null, null],
		["prime", "prime", null, "prime", "prime"],
	],
};

const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
same([0, 25, 26, 27].map(SM.rowLabel), ["A", "Z", "AA", "AB"]);
same(SM.enumerate(layout).seats.map((s) => s.id), ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"]);

const flipped = Object.assign({}, layout, { screen: "bottom", numbering: "rtl" });
const byCell = SM.enumerate(flipped).byCell;
assert.strictEqual(byCell["2,4"].id, "A1", "row nearest a bottom screen is A, numbered from the right");
assert.strictEqual(byCell["0,0"].id, "B4");

console.log("seat_map tests passed");
