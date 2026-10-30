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

// Movie page keys must equal APIs/movies.py: f"{_norm(title)}-{_norm(language)}".
assert.strictEqual(C.movieKey("Jailer 2", "Tamil"), "jailer2-tamil");
assert.strictEqual(C.movieKey("K.G.F: Chapter 2", "Kannada"), "kgfchapter2-kannada");
assert.strictEqual(C.movieKey("\u0B9C\u0BC6\u0BAF\u0BBF\u0BB2\u0BB0\u0BCD 2", "Tamil"), "\u0B9C\u0BAF\u0BB2\u0BB02-tamil");
console.log("youtube_link tests passed");
