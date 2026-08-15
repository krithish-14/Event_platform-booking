/**
 * JOD Events — Shared public event utilities
 * Single source for API access, cards, hero, countdown (IST), and UI states.
 */
(function (global) {
	"use strict";

	const IST = "Asia/Kolkata";
	const PLACEHOLDER_IMAGE = "images/hero-event.jpg";

	function getApiBase() {
		if (global.JodHealth && typeof global.JodHealth.getApiBaseUrl === "function") {
			return global.JodHealth.getApiBaseUrl();
		}
		const host = (global.location.hostname && global.location.hostname !== "localhost")
			? global.location.hostname : "127.0.0.1";
		return `http://${host}:8001`;
	}

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function resolveImage(url) {
		if (!url) return PLACEHOLDER_IMAGE;
		if (url.startsWith("http://") || url.startsWith("https://")) return url;
		if (url.startsWith("/uploads/") || url.startsWith("uploads/")) {
			const base = getApiBase().replace(/\/$/, "");
			return `${base}/${url.replace(/^\//, "")}`;
		}
		if (url.startsWith("/") || url.startsWith("images/")) return url;
		return url;
	}

	function formatPrice(price) {
		const p = Number(price) || 0;
		return p <= 0 ? "Free" : `₹${p.toLocaleString("en-IN")}`;
	}

	function formatDateIST(iso) {
		if (!iso) return "Date TBA";
		try {
			return new Date(iso).toLocaleDateString("en-IN", {
				timeZone: IST,
				weekday: "short",
				day: "numeric",
				month: "short",
				year: "numeric"
			});
		} catch (_) {
			return "Date TBA";
		}
	}

	function formatDateTimeIST(iso) {
		if (!iso) return "Schedule TBA";
		try {
			return new Date(iso).toLocaleString("en-IN", {
				timeZone: IST,
				weekday: "short",
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			});
		} catch (_) {
			return "Schedule TBA";
		}
	}

	function eventDetailsUrl(event) {
		return `event-details.html?id=${encodeURIComponent(event.id)}`;
	}

	function parseEventMs(iso) {
		if (!iso) return null;
		let s = String(iso).trim();
		if (!s) return null;
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
			s = s.length === 16 ? s + ":00+05:30" : s + "+05:30";
		}
		const ms = new Date(s).getTime();
		return Number.isFinite(ms) ? ms : null;
	}

	function getCountdownParts(targetMs) {
		const diff = targetMs - Date.now();
		if (diff <= 0) {
			return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: diff };
		}
		const totalSec = Math.floor(diff / 1000);
		return {
			expired: false,
			days: Math.floor(totalSec / 86400),
			hours: Math.floor((totalSec % 86400) / 3600),
			minutes: Math.floor((totalSec % 3600) / 60),
			seconds: totalSec % 60,
			totalMs: diff
		};
	}

	function pad(n) {
		return String(n).padStart(2, "0");
	}

	function getEventPhase(event) {
		const startMs = parseEventMs(event.start_date);
		const endMs = parseEventMs(event.end_date);
		const now = Date.now();
		if (!startMs) return "unknown";
		if (now < startMs) return "upcoming";
		if (endMs && now >= endMs) return "ended";
		return "live";
	}

	function pickFeaturedEvent(events) {
		if (!events || !events.length) return null;
		const now = Date.now();
		const upcoming = events.filter((ev) => {
			const ms = parseEventMs(ev.start_date);
			return ms && ms >= now;
		});
		if (upcoming.length) return upcoming[0];
		return events[0];
	}

	async function fetchPublishedEvents(params) {
		const qs = new URLSearchParams(params || {}).toString();
		const url = `${getApiBase()}/api/events/public${qs ? "?" + qs : ""}`;
		const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
		if (!res.ok) throw new Error("Unable to load events.");
		const data = await res.json();
		const list = Array.isArray(data) ? data : [];
		if (typeof console !== "undefined" && console.debug) {
			console.debug("[PUBLIC EVENTS] fetched", list.length, "events");
		}
		return list;
	}

	async function fetchPublishedEventById(eventId) {
		const res = await fetch(`${getApiBase()}/api/events/public/${encodeURIComponent(eventId)}`, {
			cache: "no-store",
			headers: { Accept: "application/json" }
		});
		if (res.status === 404) {
			const err = new Error("This event is currently unavailable.");
			err.code = "UNAVAILABLE";
			throw err;
		}
		if (!res.ok) throw new Error("Unable to load event details.");
		return res.json();
	}

	function wishlistHeartButton(eventId) {
		const id = escapeHtml(String(eventId || ""));
		return `<button type="button" class="wishlist-heart-btn" data-wishlist-event="${id}" aria-label="Add to wishlist" title="Add to wishlist" aria-pressed="false">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
		</button>`;
	}

	function buildCarouselCard(event, delayClass) {
		const id = event.id;
		const detailsUrl = eventDetailsUrl(event);
		const img = resolveImage(event.image_url);
		const title = escapeHtml(event.title || "Untitled Event");
		const desc = escapeHtml((event.description || "").slice(0, 120));
		const venue = escapeHtml(event.venue || event.location || "Venue TBA");
		const category = escapeHtml(event.category || "Event");
		const dateStr = formatDateIST(event.start_date);
		const countdownIso = event.start_date || "";
		const delay = delayClass || "";

		return `
			<article class="event-card carousel-slide reveal ${delay}" data-event-id="${id}"
				data-lat="${event.latitude || ""}" data-lon="${event.longitude || ""}"
				style="cursor:pointer;"
				onclick="return (window.handleGuestOrNavigate ? window.handleGuestOrNavigate(event, '${detailsUrl}', 'event') : (window.location.href='${detailsUrl}', false));">
				<div class="event-card-image">
					<img src="${img}" alt="${title}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMAGE}'" />
					<span class="card-category">${category}</span>
					${wishlistHeartButton(id)}
					${countdownIso ? `<span class="card-timer" data-card-countdown="${countdownIso}">&#10024; --d : --h : --m</span>` : ""}
				</div>
				<div class="event-card-body">
					<h3>${title}</h3>
					${desc ? `<p>${desc}</p>` : ""}
					<div class="event-meta">
						<span>&#128197; ${dateStr}</span>
						<span>&#128205; ${venue}</span>
					</div>
					<a class="card-link" href="${detailsUrl}"
						onclick="event.stopPropagation(); return (window.handleGuestOrNavigate ? window.handleGuestOrNavigate(event, '${detailsUrl}', 'event') : true);">
						View Details <span>&#8594;</span>
					</a>
				</div>
			</article>
		`;
	}

	function buildCategoryCard(event) {
		const targetUrl = eventDetailsUrl(event);
		const title = escapeHtml(event.title || "Untitled Event");
		const venue = escapeHtml(event.venue || event.location || "Venue TBA");
		const category = escapeHtml(event.category || "Event");
		const dateShort = formatDateIST(event.start_date);
		const priceDisplay = formatPrice(event.price) + (Number(event.price) > 0 ? " onwards" : "");
		const imgUrl = resolveImage(event.image_url);
		const formatLabel = escapeHtml(event.event_format || "In-person");

		return `
			<article class="cat-event-card" data-event-id="${event.id}" data-target-url="${targetUrl}"
				onclick="window.location.href='${targetUrl}';">
				<div class="cat-card-image">
					<img src="${imgUrl}" alt="${title}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMAGE}'" />
					<span class="cat-card-badge">${category}</span>
					${wishlistHeartButton(event.id)}
				</div>
				<div class="cat-card-body">
					<h3 class="cat-card-title">${title}</h3>
					<p class="cat-card-meta">&#128197; ${dateShort} &bull; ${formatLabel}</p>
					<p class="cat-card-meta">&#128205; ${venue}</p>
					<div class="cat-card-footer">
						<span class="cat-card-price">${priceDisplay}</span>
						<span class="cat-card-cta">View Details &#8594;</span>
					</div>
				</div>
			</article>
		`;
	}

	function renderHero(event) {
		const heroImg = document.querySelector(".hero-image");
		const heroCategory = document.querySelector(".hero-category");
		const heroTitle = document.getElementById("hero-title");
		const heroCountdown = document.querySelector(".hero-countdown");
		const heroMeta = document.querySelector(".hero-event-meta");
		const heroCta = document.querySelector(".hero .button-gold");
		const featuredImg = document.querySelector(".hero-featured-image img");
		const featuredLink = document.querySelector(".hero-featured-image a");

		if (!event) {
			if (heroTitle) heroTitle.innerHTML = "No featured events available";
			if (heroCategory) heroCategory.textContent = "Featured";
			if (heroMeta) heroMeta.innerHTML = "<p>Check back later for upcoming events.</p>";
			if (heroCountdown) heroCountdown.style.display = "none";
			return;
		}

		const url = eventDetailsUrl(event);
		const title = escapeHtml(event.title || "Featured Event");
		const category = escapeHtml(event.category || "Event");
		const img = resolveImage(event.image_url);
		const dateStr = formatDateTimeIST(event.start_date);
		const venue = escapeHtml(event.venue || event.location || "Venue TBA");

		if (heroImg) heroImg.src = img;
		if (heroCategory) heroCategory.textContent = category;
		if (heroTitle) heroTitle.textContent = event.title || "Featured Event";
		if (heroMeta) {
			heroMeta.innerHTML = `
				<p><span aria-hidden="true">&#128197;</span> ${dateStr}</p>
				<p><span aria-hidden="true">&#128205;</span> ${venue}</p>
			`;
		}
		if (heroCountdown && event.start_date) {
			heroCountdown.style.display = "";
			heroCountdown.dataset.countdown = event.start_date;
			if (event.end_date) heroCountdown.dataset.countdownEnd = event.end_date;
			else delete heroCountdown.dataset.countdownEnd;
			ensureCountdownGrid(heroCountdown);
			updateCountdownElement(heroCountdown, event.start_date, event.end_date);
		}
		const featuredLabel = document.querySelector(".inline-featured-label");
		if (featuredLabel) {
			const phase = getEventPhase(event);
			if (phase === "live") {
				featuredLabel.innerHTML = '<span class="pulse-dot"></span> Featured - Live Now';
			} else if (phase === "ended") {
				featuredLabel.innerHTML = '<span class="pulse-dot"></span> Featured - Ended';
			} else {
				featuredLabel.innerHTML = '<span class="pulse-dot"></span> Featured - Upcoming';
			}
		}
		if (heroCta) {
			heroCta.href = url;
			heroCta.onclick = null;
		}
		if (featuredImg) {
			featuredImg.src = img;
			featuredImg.alt = event.title || "Featured event";
		}
		if (featuredLink) {
			featuredLink.href = url;
			featuredLink.onclick = null;
		}
	}

	function ensureCountdownGrid(el) {
		if (!el || el.querySelector("[data-days]")) return;
		el.innerHTML = `
			<div><strong data-days>--</strong><span>Days</span></div>
			<div><strong data-hours>--</strong><span>Hours</span></div>
			<div><strong data-minutes>--</strong><span>Mins</span></div>
			<div><strong data-seconds>--</strong><span>Secs</span></div>
		`;
	}

	function updateCountdownElement(el, startIso, endIso) {
		if (!el || !startIso) return;
		if (el.hasAttribute("data-summary-countdown")) {
			updateSummaryCountdown(el, startIso, endIso);
			return;
		}
		const phase = getEventPhase({ start_date: startIso, end_date: endIso });
		const startMs = parseEventMs(startIso);

		if (phase === "ended") {
			el.innerHTML = `<div class="countdown-status" style="grid-column:1/-1;text-align:center;font-weight:700;">Event Ended</div>`;
			return;
		}
		if (phase === "live") {
			el.innerHTML = `<div class="countdown-status" style="grid-column:1/-1;text-align:center;font-weight:700;color:#34d399;">Live Now</div>`;
			return;
		}

		ensureCountdownGrid(el);
		const parts = getCountdownParts(startMs);
		const dayEl = el.querySelector("[data-days]");
		const hourEl = el.querySelector("[data-hours]");
		const minEl = el.querySelector("[data-minutes]");
		const secEl = el.querySelector("[data-seconds]");
		if (dayEl) dayEl.textContent = pad(parts.days);
		if (hourEl) hourEl.textContent = pad(parts.hours);
		if (minEl) minEl.textContent = pad(parts.minutes);
		if (secEl) secEl.textContent = pad(parts.seconds);
	}

	function updateSummaryCountdown(el, startIso, endIso) {
		if (!el) return;
		const phase = getEventPhase({ start_date: startIso, end_date: endIso });
		if (phase === "ended") {
			el.textContent = "Ended";
			return;
		}
		if (phase === "live") {
			el.textContent = "Live Now";
			return;
		}
		const startMs = parseEventMs(startIso);
		if (!startMs) {
			el.textContent = "--d --h --m";
			return;
		}
		const parts = getCountdownParts(startMs);
		el.textContent = `${parts.days}d ${pad(parts.hours)}h ${pad(parts.minutes)}m ${pad(parts.seconds)}s`;
	}

	function updateCardCountdownElement(el, startIso) {
		if (!el || !startIso) return;
		const startMs = parseEventMs(startIso);
		const parts = getCountdownParts(startMs);
		if (parts.expired) {
			el.textContent = "✨ Started";
			return;
		}
		el.textContent = `✨ ${pad(parts.days)}d : ${pad(parts.hours)}h : ${pad(parts.minutes)}m`;
	}

	function startCountdownTicker() {
		function tick() {
			document.querySelectorAll("[data-countdown]").forEach((el) => {
				if (el.hasAttribute("data-summary-countdown")) return;
				updateCountdownElement(el, el.dataset.countdown, el.dataset.countdownEnd);
			});
			document.querySelectorAll("[data-card-countdown]").forEach((el) => {
				updateCardCountdownElement(el, el.dataset.cardCountdown);
			});
			document.querySelectorAll("[data-summary-countdown]").forEach((el) => {
				const iso = el.getAttribute("data-summary-countdown") || "";
				if (!iso || iso.indexOf("-") < 0) return;
				updateSummaryCountdown(el, iso, el.dataset.countdownEnd || "");
			});
		}
		tick();
		if (!global._jodCountdownInterval) {
			global._jodCountdownInterval = setInterval(tick, 1000);
		}
	}

	function showLoadingState(container, message) {
		if (!container) return;
		container.innerHTML = `
			<div class="events-loading-state" style="grid-column:1/-1;text-align:center;padding:2.5rem 1rem;color:#64748b;">
				<div style="margin-bottom:0.75rem;font-size:1.5rem;">⏳</div>
				<p style="margin:0;font-weight:600;">${escapeHtml(message || "Loading events…")}</p>
			</div>
		`;
	}

	function showEmptyState(container, title, message) {
		if (!container) return;
		container.innerHTML = `
			<div class="events-empty-state" style="grid-column:1/-1;text-align:center;padding:2.5rem 1rem;color:#64748b;">
				<div style="margin-bottom:0.75rem;font-size:2rem;">📭</div>
				<h3 style="margin:0 0 0.5rem;color:#0f172a;">${escapeHtml(title || "No events available")}</h3>
				<p style="margin:0;">${escapeHtml(message || "Check back later for upcoming events.")}</p>
			</div>
		`;
	}

	function showErrorState(container, message, retryFn) {
		if (!container) return;
		container.innerHTML = `
			<div class="events-error-state" style="grid-column:1/-1;text-align:center;padding:2.5rem 1rem;">
				<p style="color:#dc2626;font-weight:600;margin:0 0 1rem;">${escapeHtml(message || "Unable to load events. Please try again.")}</p>
				<button type="button" class="button button-primary events-retry-btn">Retry</button>
			</div>
		`;
		const btn = container.querySelector(".events-retry-btn");
		if (btn && typeof retryFn === "function") {
			btn.addEventListener("click", retryFn);
		}
	}

	function renderAnnouncementBar(event) {
		const bar = document.querySelector(".announcement-bar");
		if (!bar) return;
		if (!event) {
			bar.classList.remove("has-published-event");
			bar.hidden = true;
			return;
		}
		const titleEl = bar.querySelector(".announcement-title");
		if (titleEl) titleEl.textContent = event.title || "";
		const summary = bar.querySelector("[data-summary-countdown]");
		if (summary) {
			if (event.start_date) {
				summary.setAttribute("data-summary-countdown", event.start_date);
				if (event.end_date) summary.dataset.countdownEnd = event.end_date;
				else delete summary.dataset.countdownEnd;
				delete summary.dataset.countdown;
				updateSummaryCountdown(summary, event.start_date, event.end_date);
			} else {
				summary.removeAttribute("data-summary-countdown");
				summary.textContent = "--d --h --m";
			}
		}
		const link = bar.querySelector(".gold-link");
		if (link) link.href = eventDetailsUrl(event);
		bar.classList.add("has-published-event");
		bar.hidden = false;
	}

	function renderFeaturedPopup(event) {
		const modal = document.querySelector("[data-modal]");
		if (!modal) return;

		if (!event) {
			modal.hidden = true;
			document.body.classList.remove("modal-open");
			delete modal.dataset.eventId;
			return;
		}

		const url = eventDetailsUrl(event);
		const imgEl = document.getElementById("featuredModalImage");
		const titleEl = document.getElementById("modal-title");
		const descEl = document.getElementById("featuredModalDesc");
		const dateEl = document.getElementById("featuredModalDate");
		const venueEl = document.getElementById("featuredModalVenue");
		const badgeEl = document.getElementById("featuredModalBadge");
		const countdownEl = document.getElementById("featuredModalCountdown");
		const ctaEl = document.getElementById("featuredModalCta");

		const img = resolveImage(event.image_url);
		if (imgEl) {
			imgEl.src = img;
			imgEl.alt = event.title || "Featured event";
			imgEl.onerror = function () { this.src = PLACEHOLDER_IMAGE; };
		}
		if (titleEl) titleEl.textContent = event.title || "Upcoming Event";
		if (descEl) {
			const desc = (event.description || "").trim();
			descEl.textContent = desc ? desc.slice(0, 140) : (event.category ? `${event.category} event` : "");
		}
		if (dateEl) dateEl.textContent = "📅 " + formatDateTimeIST(event.start_date);
		if (venueEl) venueEl.textContent = "📍 " + (event.venue || event.location || "Venue TBA");
		if (badgeEl) badgeEl.textContent = event.category ? `✨ ${event.category}` : "✨ Upcoming Event";
		if (countdownEl) {
			if (event.start_date) {
				countdownEl.style.display = "";
				countdownEl.dataset.countdown = event.start_date;
				countdownEl.dataset.countdownEnd = event.end_date || "";
				updateCountdownElement(countdownEl, event.start_date, event.end_date);
			} else {
				countdownEl.style.display = "none";
			}
		}
		if (ctaEl) {
			ctaEl.href = url;
			ctaEl.onclick = function () {
				if (typeof global.JodCloseFeaturedModal === "function") global.JodCloseFeaturedModal();
			};
		}

		modal.dataset.eventId = event.id;
		startCountdownTicker();

		let dismissed = false;
		try {
			dismissed = sessionStorage.getItem("jod-upcoming-modal-shown-" + event.id) === "1";
		} catch (_) {}
		if (dismissed) return;
		if (modal.dataset.openedFor === String(event.id)) return;
		modal.dataset.openedFor = String(event.id);
		window.setTimeout(() => {
			if (modal.dataset.openedFor !== String(event.id)) return;
			modal.hidden = false;
			document.body.classList.add("modal-open");
		}, 1400);
	}

	global.JodEventsPublic = {
		IST,
		PLACEHOLDER_IMAGE,
		getApiBase,
		escapeHtml,
		resolveImage,
		formatPrice,
		formatDateIST,
		formatDateTimeIST,
		eventDetailsUrl,
		parseEventMs,
		getCountdownParts,
		getEventPhase,
		fetchPublishedEvents,
		fetchPublishedEventById,
		pickFeaturedEvent,
		buildCarouselCard,
		buildCategoryCard,
		renderHero,
		renderFeaturedPopup,
		renderAnnouncementBar,
		updateCountdownElement,
		updateCardCountdownElement,
		startCountdownTicker,
		showLoadingState,
		showEmptyState,
		showErrorState,
		wishlistHeartButton
	};
})(window);
