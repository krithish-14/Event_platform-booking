// YouTube link parsing in the browser must match Services/movie_details.py youtube_id.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { URL };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../frontend/js/cinema-common.js"), "utf8"), sandbox);
const C = sandbox.JodCinema;

const vid = "dQw4w9WgXcQ";
[
	vid,
	`https://www.youtube.com/watch?v=${vid}&t=10s`,
	`https://m.youtube.com/watch?feature=share&v=${vid}`,
	`youtu.be/${vid}?si=abc`,
	`https://www.youtube.com/shorts/${vid}`,
	`https://www.youtube.com/embed/${vid}`,
	`https://www.youtube.com/live/${vid}?feature=share`,
	`https://www.youtube-nocookie.com/embed/${vid}`,
	`https://music.youtube.com/watch?v=${vid}`,
].forEach((link) => assert.strictEqual(C.youtubeId(link), vid, link));

[
	"",
	"https://vimeo.com/123",
	"https://youtube.com/watch?v=short",
	`https://notyoutube.com/watch?v=${vid}`,
	"javascript:alert(1)",
	"https://www.youtube.com/@channel",
	`ftp://youtube.com/watch?v=${vid}`,
].forEach((link) => assert.strictEqual(C.youtubeId(link), null, link));

assert.strictEqual(C.initials("  Lead   Actor Name "), "LA");
console.log("youtube_link tests passed");
