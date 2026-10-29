// Session builder logic used by the host dashboard (frontend/js/event-sessions.js).
const assert = require("assert");
const path = require("path");
const S = require(path.join(__dirname, "..", "..", "frontend", "js", "event-sessions.js"));

const defaults = { session_date: "2026-11-15", start_time: "08:15", end_time: "10:45", venue_name: "Venue A" };

// Multiple sessions: 2 forms, then Add Session gives 3.
let list = S.resizeSessions([], 2, defaults).list;
assert.strictEqual(list.length, 2, "two session forms");
assert.deepStrictEqual(list.map((s) => s.session_name), ["Session 1", "Session 2"]);
list = S.resizeSessions(list, list.length + 1, defaults).list;
assert.strictEqual(list.length, 3, "three session forms after Add Session");

// Any count works (not limited to two), capped by MAX_SESSIONS.
assert.strictEqual(S.resizeSessions([], 5, defaults).list.length, 5);
assert.strictEqual(S.resizeSessions([], 999, defaults).list.length, S.MAX_SESSIONS);

// Lowering the count never drops a saved session.
list[2].session_id = "saved-3";
const shrunk = S.resizeSessions(list, 2, defaults);
assert.strictEqual(shrunk.list.length, 3, "saved session kept");
assert.strictEqual(shrunk.blocked, 1);
list[2].session_id = null;
assert.strictEqual(S.resizeSessions(list, 2, defaults).list.length, 2, "unsaved trailing session removed");

// Validation.
const good = Object.assign(S.blankSession(defaults), { session_name: "Morning Session" });
assert.deepStrictEqual(S.validateSession(good), {});
assert.ok(S.validateSession(Object.assign({}, good, { end_time: "08:00" })).end_time, "end before start");
assert.deepStrictEqual(S.validateSession(Object.assign({}, good, { start_time: "22:00", end_time: "01:00", ends_next_day: true })), {});
assert.ok(S.validateSession(Object.assign({}, good, { venue_name: "" })).venue_name);
assert.ok(S.validateSession(Object.assign({}, good, { capacity: "0" })).capacity);
assert.ok(S.validateSession(Object.assign({}, good, { eligibility_mode: "ticket_types", eligible_ticket_types: [] })).eligible_ticket_types);

// Payload round trip keeps ids and clears ticket types outside ticket_types mode.
const payload = S.toPayload(Object.assign({}, good, { session_id: "abc", capacity: "100", eligible_ticket_types: ["VIP"] }));
assert.strictEqual(payload.session_id, "abc");
assert.strictEqual(payload.capacity, 100);
assert.deepStrictEqual(payload.eligible_ticket_types, []);
const back = S.fromServer(Object.assign({}, payload, { capacity: 100 }));
assert.strictEqual(back.capacity, "100");

console.log("event_sessions_ui tests passed");
