/**
 * Home event-highlight reels strip + click-to-carousel.
 */
(function () {
	"use strict";

	function asset(path) {
		if (window.JodConfig && typeof window.JodConfig.assetUrl === "function") {
			return window.JodConfig.assetUrl(path);
		}
		return "https://assets.jodevents.com/images/" + String(path || "").replace(/^images\//, "");
	}

	function apiUrl(path) {
		if (window.JodConfig && typeof window.JodConfig.prefixApiPath === "function") {
			return window.JodConfig.prefixApiPath(path);
		}
		return path;
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	const REELS = [
		{
			id: "rotary",
			shortcode: "DdHE_6uSqjD",
			title: "Rotary Business Meet",
			caption: "A memorable Rotary Business Meet bringing together business leaders",
			instagram: "https://www.instagram.com/reel/DdHE_6uSqjD/",
			poster: asset("images/Conference/IMG_6945.JPG.webp")
		},
		{
			id: "marathon",
			shortcode: "Db-0NsESZR-",
			title: "Singapenn Marathon",
			caption: "A glimpse of Singapenn Marathon 2026",
			instagram: "https://www.instagram.com/reel/Db-0NsESZR-/",
			poster: asset("images/Singapenn marathon/5.webp")
		},
		{
			id: "marathon2",
			shortcode: "DbGVVoVP28i",
			title: "RunChennai Marathon",
			caption: "A glimpse of RunChennai Marathon 2026",
			instagram: "https://www.instagram.com/reel/DbGVVoVP28i/",
			poster: asset("images/video/DbGVVoVP28i.jpg")
		},
		{
			id: "rotaract",
			shortcode: "DWivgeMkl4d",
			title: "Rotaract Club",
			caption: "A glimpse of Rotaract Club event",
			instagram: "https://www.instagram.com/reel/DWivgeMkl4d/",
			poster: asset("images/video/DWivgeMkl4d.jpg")
		},
		{
			id: "sandd",
			shortcode: "B7stKa9gWlO",
			title: "Sandd",
			caption: "When tradition gets a modern glow-up.",
			poster: asset("images/Sandd/1.webp"),
			instagram: "https://www.instagram.com/tv/B7stKa9gWlO/"
		}
	];

	const STATS_KEY = "jod_reel_stats_v1";
	const LIKED_KEY = "jod_reel_liked_v1";

	function videoUrl(reel) {
		return asset("images/video/" + reel.shortcode + ".mp4");
	}

	function formatCount(value) {
		const n = Math.max(0, Number(value) || 0);
		if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
		if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K";
		return String(n);
	}

	function readJson(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			const parsed = raw ? JSON.parse(raw) : null;
			return parsed && typeof parsed === "object" ? parsed : fallback;
		} catch (err) {
			return fallback;
		}
	}

	function writeJson(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch (err) {}
	}

	function emptyStats() {
		const out = {};
		REELS.forEach(function (reel) {
			out[reel.id] = { views: 0, likes: 0 };
		});
		return out;
	}

	let stats = readJson(STATS_KEY, emptyStats());
	let liked = readJson(LIKED_KEY, {});
	const viewedThisOpen = {};

	function mergeStats(remote) {
		if (!remote || typeof remote !== "object") return;
		REELS.forEach(function (reel) {
			const row = remote[reel.id] || {};
			const local = stats[reel.id] || { views: 0, likes: 0 };
			stats[reel.id] = {
				views: Math.max(Number(local.views) || 0, Number(row.views) || 0),
				likes: Math.max(Number(local.likes) || 0, Number(row.likes) || 0)
			};
		});
		writeJson(STATS_KEY, stats);
	}

	function loadRemoteStats() {
		return fetch(apiUrl("/api/reels/stats"), { credentials: "include" })
			.then(function (res) { return res.ok ? res.json() : null; })
			.then(function (data) {
				mergeStats(data);
				paintStats();
			})
			.catch(function () {});
	}

	function paintStats() {
		const reel = REELS[activeIndex];
		const root = document.getElementById("homeReelsLightbox");
		if (!reel || !root) return;
		const row = stats[reel.id] || { views: 0, likes: 0 };
		const viewsEl = root.querySelector("[data-reel-view-count]");
		const likesEl = root.querySelector("[data-reel-like-count]");
		const likeBtn = root.querySelector("[data-reel-like]");
		if (viewsEl) viewsEl.textContent = formatCount(row.views);
		if (likesEl) likesEl.textContent = formatCount(row.likes);
		if (likeBtn) {
			likeBtn.classList.toggle("is-liked", !!liked[reel.id]);
			likeBtn.setAttribute("aria-label", liked[reel.id] ? "Unlike" : "Like");
		}
	}

	function recordView(reel) {
		if (!reel || viewedThisOpen[reel.id]) return;
		viewedThisOpen[reel.id] = true;
		if (!stats[reel.id]) stats[reel.id] = { views: 0, likes: 0 };
		stats[reel.id].views += 1;
		writeJson(STATS_KEY, stats);
		paintStats();
		fetch(apiUrl("/api/reels/" + encodeURIComponent(reel.id) + "/view"), {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: "{}"
		}).then(function (res) { return res.ok ? res.json() : null; })
			.then(function (data) {
				if (!data) return;
				stats[reel.id].views = Math.max(stats[reel.id].views, Number(data.views) || 0);
				stats[reel.id].likes = Math.max(stats[reel.id].likes, Number(data.likes) || 0);
				writeJson(STATS_KEY, stats);
				paintStats();
			})
			.catch(function () {});
	}

	function toggleLike() {
		const reel = REELS[activeIndex];
		if (!reel) return;
		if (!stats[reel.id]) stats[reel.id] = { views: 0, likes: 0 };
		const nextLiked = !liked[reel.id];
		liked[reel.id] = nextLiked;
		stats[reel.id].likes = Math.max(0, (Number(stats[reel.id].likes) || 0) + (nextLiked ? 1 : -1));
		writeJson(LIKED_KEY, liked);
		writeJson(STATS_KEY, stats);
		paintStats();
		fetch(apiUrl("/api/reels/" + encodeURIComponent(reel.id) + "/like"), {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ liked: nextLiked })
		}).then(function (res) { return res.ok ? res.json() : null; })
			.then(function (data) {
				if (!data) return;
				stats[reel.id].likes = Math.max(0, Number(data.likes) || stats[reel.id].likes);
				writeJson(STATS_KEY, stats);
				paintStats();
			})
			.catch(function () {});
	}

	const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	let activeIndex = 0;
	let lightboxOpen = false;
	let stageVideo = null;
	const stripObservers = [];

	function cardHtml(reel, index) {
		return (
			'<article class="reels-card" data-reel-index="' + index + '">' +
				'<button type="button" class="reels-card-hit" data-open-reel="' + index + '" aria-label="Play ' + escapeHtml(reel.title) + ' with sound">' +
					'<div class="reels-card-media">' +
						'<img class="reels-card-poster" src="' + escapeHtml(reel.poster) + '" alt="">' +
						'<video class="reels-card-video" muted autoplay loop playsinline webkit-playsinline preload="metadata" poster="' + escapeHtml(reel.poster) + '" src="' + escapeHtml(videoUrl(reel)) + '"></video>' +
						'<div class="reels-card-top">' +
							'<img class="reels-card-brand" data-no-cdn="1" src="/images/JOD%20Events%20Logo.png" alt="JOD Events" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\'https://assets.jodevents.com/images/JOD%20Events%20Logo.png\';}">' +
						'</div>' +
						'<p class="reels-card-caption">' + escapeHtml(reel.caption) + '</p>' +
					'</div>' +
				'</button>' +
			'</article>'
		);
	}

	function playMuted(video) {
		if (!video) return;
		video.muted = true;
		video.defaultMuted = true;
		video.setAttribute("muted", "");
		video.playsInline = true;
		const play = video.play();
		if (play && typeof play.then === "function") {
			play.then(function () {
				video.classList.add("is-on");
			}).catch(function () {});
		}
	}

	function playStripIfVisible() {
		if (lightboxOpen || reduceMotion) return;
		const row = document.getElementById("homeReelsTrack");
		if (!row) return;
		const rect = row.getBoundingClientRect();
		const visible = rect.top < window.innerHeight - 40 && rect.bottom > 40;
		if (!visible) return;
		document.querySelectorAll(".reels-card-video").forEach(playMuted);
	}

	function bindStripMedia(card) {
		const video = card.querySelector(".reels-card-video");
		if (!video) return;
		video.muted = true;
		video.defaultMuted = true;
		video.setAttribute("muted", "");
		video.playsInline = true;
		video.setAttribute("webkit-playsinline", "");
		video.addEventListener("canplay", playStripIfVisible);
		video.addEventListener("playing", function () {
			video.classList.add("is-on");
		});
		video.addEventListener("stalled", function () {
			window.setTimeout(playStripIfVisible, 400);
		});
	}

	function pauseStrip() {
		document.querySelectorAll(".reels-card-video").forEach(function (video) {
			video.pause();
		});
	}

	function resumeStrip() {
		playStripIfVisible();
	}

	function syncMuteButton() {
		const muteBtn = document.querySelector("[data-reel-mute]");
		if (!muteBtn || !stageVideo) return;
		muteBtn.classList.toggle("is-muted", !!stageVideo.muted);
		muteBtn.setAttribute("aria-label", stageVideo.muted ? "Unmute" : "Mute");
	}

	function playStage(wantSound) {
		if (!stageVideo) return;
		stageVideo.playsInline = true;
		stageVideo.setAttribute("webkit-playsinline", "");
		stageVideo.muted = !wantSound;
		stageVideo.onplaying = function () {
			stageVideo.classList.add("is-on");
			const poster = document.querySelector("[data-reel-stage-poster]");
			if (poster) poster.hidden = true;
		};
		syncMuteButton();
		const play = stageVideo.play();
		if (play && typeof play.then === "function") {
			play.then(function () {
				stageVideo.classList.add("is-on");
				const poster = document.querySelector("[data-reel-stage-poster]");
				if (poster) poster.hidden = true;
			}).catch(function () {
				if (wantSound) {
					stageVideo.muted = true;
					syncMuteButton();
					stageVideo.play().then(function () {
						stageVideo.classList.add("is-on");
						const poster = document.querySelector("[data-reel-stage-poster]");
						if (poster) poster.hidden = true;
					}).catch(function () {});
				}
			});
		}
	}

	function renderLightbox(index, wantSound, countView) {
		const reel = REELS[index];
		const prev = REELS[(index - 1 + REELS.length) % REELS.length];
		const next = REELS[(index + 1) % REELS.length];
		const root = document.getElementById("homeReelsLightbox");
		if (!root || !reel) return;
		activeIndex = index;
		root.querySelector("[data-reel-stage-title]").textContent = reel.title;
		root.querySelector("[data-reel-peek-prev]").src = prev.poster;
		root.querySelector("[data-reel-peek-next]").src = next.poster;
		const instagram = root.querySelector("[data-reel-instagram]");
		if (instagram) instagram.href = reel.instagram;
		paintStats();
		if (countView) recordView(reel);

		const video = root.querySelector("[data-reel-stage-video]");
		const poster = root.querySelector("[data-reel-stage-poster]");
		stageVideo = video;
		poster.src = reel.poster;
		poster.hidden = false;
		video.classList.remove("is-on");
		video.pause();
		video.src = videoUrl(reel);
		video.loop = true;
		playStage(wantSound !== false);
	}

	function openLightbox(index) {
		const root = document.getElementById("homeReelsLightbox");
		if (!root) return;
		lightboxOpen = true;
		Object.keys(viewedThisOpen).forEach(function (key) {
			delete viewedThisOpen[key];
		});
		pauseStrip();
		root.hidden = false;
		document.body.classList.add("reels-lightbox-open");
		renderLightbox(index, true, true);
		root.querySelector(".reels-lightbox-close")?.focus();
	}

	function closeLightbox() {
		const root = document.getElementById("homeReelsLightbox");
		if (!root) return;
		lightboxOpen = false;
		root.hidden = true;
		document.body.classList.remove("reels-lightbox-open");
		if (stageVideo) {
			stageVideo.pause();
			stageVideo.removeAttribute("src");
			stageVideo.load();
			stageVideo.classList.remove("is-on");
		}
		resumeStrip();
	}

	function step(delta) {
		renderLightbox((activeIndex + delta + REELS.length) % REELS.length, true, true);
	}

	function init() {
		const track = document.getElementById("homeReelsTrack");
		if (!track) return;
		track.innerHTML = REELS.map(cardHtml).join("");
		track.querySelectorAll(".reels-card").forEach(function (card) {
			bindStripMedia(card);
		});
		playStripIfVisible();
		loadRemoteStats();
		if (!reduceMotion && "IntersectionObserver" in window) {
			const io = new IntersectionObserver(function (entries) {
				entries.forEach(function (entry) {
					if (lightboxOpen) {
						pauseStrip();
						return;
					}
					if (entry.isIntersecting) playStripIfVisible();
					else pauseStrip();
				});
			}, { threshold: 0.12 });
			io.observe(track);
			stripObservers.push(io);
		}
		window.addEventListener("scroll", playStripIfVisible, { passive: true });

		function nearestCardIndex() {
			const cards = track.querySelectorAll(".reels-card");
			const mid = track.scrollLeft + track.clientWidth / 2;
			let best = 0;
			let bestDist = Infinity;
			cards.forEach(function (card, index) {
				const center = card.offsetLeft + card.offsetWidth / 2;
				const dist = Math.abs(center - mid);
				if (dist < bestDist) {
					bestDist = dist;
					best = index;
				}
			});
			return best;
		}

		function scrollStrip(delta) {
			const cards = track.querySelectorAll(".reels-card");
			if (!cards.length) return;
			const next = (nearestCardIndex() + delta + cards.length) % cards.length;
			const card = cards[next];
			const left = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
			track.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
		}

		document.querySelector("[data-reels-strip-prev]")?.addEventListener("click", function (event) {
			event.preventDefault();
			event.stopPropagation();
			scrollStrip(-1);
		});
		document.querySelector("[data-reels-strip-next]")?.addEventListener("click", function (event) {
			event.preventDefault();
			event.stopPropagation();
			scrollStrip(1);
		});

		track.addEventListener("click", function (event) {
			const open = event.target.closest("[data-open-reel]");
			if (!open) return;
			event.preventDefault();
			openLightbox(Number(open.getAttribute("data-open-reel")));
		});

		const root = document.getElementById("homeReelsLightbox");
		if (!root) return;
		root.querySelector("[data-reel-close]")?.addEventListener("click", closeLightbox);
		root.querySelector("[data-reel-prev]")?.addEventListener("click", function () { step(-1); });
		root.querySelector("[data-reel-next]")?.addEventListener("click", function () { step(1); });
		root.querySelector("[data-reel-peek-prev-btn]")?.addEventListener("click", function () { step(-1); });
		root.querySelector("[data-reel-peek-next-btn]")?.addEventListener("click", function () { step(1); });
		root.addEventListener("click", function (event) {
			if (event.target === root) closeLightbox();
		});
		document.addEventListener("keydown", function (event) {
			if (!lightboxOpen) return;
			if (event.key === "Escape") closeLightbox();
			if (event.key === "ArrowLeft") step(-1);
			if (event.key === "ArrowRight") step(1);
		});

		const muteBtn = root.querySelector("[data-reel-mute]");
		if (muteBtn) {
			muteBtn.addEventListener("click", function () {
				if (!stageVideo) return;
				stageVideo.muted = !stageVideo.muted;
				if (stageVideo.paused) playStage(!stageVideo.muted);
				syncMuteButton();
			});
		}
		root.querySelector("[data-reel-like]")?.addEventListener("click", function (event) {
			event.preventDefault();
			toggleLike();
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
