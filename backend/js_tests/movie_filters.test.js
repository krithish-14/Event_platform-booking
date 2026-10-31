// Movies page filters: genre splitting and IST show-time slots (frontend/js/cinema-common.js).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { URL };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../frontend/js/cinema-common.js"), "utf8"), sandbox);
const C = sandbox.JodCinema;
const same = (actual, expected, msg) => assert.deepStrictEqual(Array.from(actual), expected, msg);

same(C.splitGenres("Action, Drama"), ["Action", "Drama"]);
same(C.splitGenres("Action Comedy Thriller / Crime"), ["Action", "Comedy", "Thriller", "Crime"]);
same(C.splitGenres("action|DRAMA & romance"), ["Action", "Drama", "Romance"]);
same(C.splitGenres("Science Fiction, Sci-Fi"), ["Science Fiction", "Sci-Fi"]);
same(C.splitGenres("Drama, drama"), ["Drama"]);
same(C.splitGenres(""), []);
same(C.splitGenres(null), []);

// Times are UTC instants; slots use India time (UTC+5:30).
assert.strictEqual(C.timeSlot("2026-10-31T04:00:00Z"), "morning");   // 9:30 AM IST
assert.strictEqual(C.timeSlot("2026-10-31T06:29:00Z"), "morning");   // 11:59 AM IST
assert.strictEqual(C.timeSlot("2026-10-31T06:30:00Z"), "afternoon"); // 12:00 PM IST
assert.strictEqual(C.timeSlot("2026-10-31T10:30:00Z"), "evening");   // 4:00 PM IST
assert.strictEqual(C.timeSlot("2026-10-31T13:30:00Z"), "night");     // 7:00 PM IST
assert.strictEqual(C.timeSlot("2026-10-31T19:00:00Z"), "night");     // 12:30 AM IST (late show)
assert.strictEqual(C.timeSlot("not a date"), "");
same(C.TIME_SLOTS.map((t) => t.id), ["morning", "afternoon", "evening", "night"]);

console.log("movie_filters tests passed");
