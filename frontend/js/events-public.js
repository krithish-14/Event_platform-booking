/**
 * JOD Events — Shared public event utilities
 * Single source for API access, cards, hero, countdown (IST), and UI states.
 */
(function (global) {
	"use strict";

	const IST = "Asia/Kolkata";
	function placeholderImage() {
		if (global.JodConfig && typeof global.JodConfig.assetUrl === "function") {
			return global.JodConfig.assetUrl("images/hero-event.jpg");
		}
		return "https://assets.jodevents.com/images/hero-event.jpg";
	}

	const PLACEHOLDER_IMAGE = placeholderImage();

	function getApiBase() {
		if (typeof window !== "undefined" && window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
			return window.JodConfig.getApiOrigin();
		}
		if (typeof window !== "undefined" && window.JodHealth && typeof window.JodHealth.getApiBaseUrl === "function") {
			return window.JodHealth.getApiBaseUrl();
		}
		if (window.JOD_API_BASE_OVERRIDE) return String(window.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
		return "";
	}

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function resolveImage(url) {
		if (global.JodConfig && typeof global.JodConfig.safeMediaUrl === "function") {
			return global.JodConfig.safeMediaUrl(url, "images/hero-event.jpg");
		}
		if (!url) return placeholderImage();
		const trimmed = String(url).trim();
		const lower = trimmed.toLowerCase();
		if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("data:")) {
			return placeholderImage();
		}
		if (trimmed.startsWith("https://")) return trimmed;
		if (trimmed.startsWith("/") || trimmed.startsWith("images/")) {
			return global.JodConfig && global.JodConfig.assetUrl
				? global.JodConfig.assetUrl(trimmed)
				: trimmed;
		}
		return placeholderImage();
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

	function ticketSaleStart(ticket) {
		if (!ticket || typeof ticket !== "object") return "";
		return ticket.sales_start || ticket.offer_start || ticket.sale_start || "";
	}

	function ticketSaleEnd(ticket) {
		if (!ticket || typeof ticket !== "object") return "";
		return ticket.sales_end || ticket.offer_end || ticket.sale_end || "";
	}

	function ticketOfferPhase(ticket) {
		const startMs = parseEventMs(ticketSaleStart(ticket));
		const endMs = parseEventMs(ticketSaleEnd(ticket));
		const now = Date.now();
		if (!startMs && !endMs) return "always";
		if (startMs && now < startMs) return "upcoming";
		if (endMs && now >= endMs) return "ended";
		return "live";
	}

	function isTicketOnSale(ticket) {
		const phase = ticketOfferPhase(ticket);
		return phase === "always" || phase === "live";
	}

	function visibleTicketTypes(event) {
		const types = event && Array.isArray(event.ticket_types) ? event.ticket_types : [];
		return types.filter(isTicketOnSale);
	}

	function isEventCurrentlyVisible(event) {
		if (!event) return false;
		if (event.is_cancelled === true || event.is_published === false) return false;
		if (getEventPhase(event) === "ended") return false;
		const types = Array.isArray(event.ticket_types) ? event.ticket_types : [];
		if (!types.length) return true;
		return types.some(isTicketOnSale);
	}

	function liveEventAttr(event) {
		const payload = {
			start_date: event && event.start_date || "",
			end_date: event && event.end_date || "",
			ticket_types: (event && Array.isArray(event.ticket_types) ? event.ticket_types : []).map((t) => ({
				sales_start: ticketSaleStart(t),
				sales_end: ticketSaleEnd(t)
			}))
		};
		return encodeURIComponent(JSON.stringify(payload));
	}

	function cardCountdownIso(event) {
		if (!event) return "";
		const phase = getEventPhase(event);
		if (phase === "upcoming") return event.start_date || "";
		if (phase === "live") return event.end_date || event.start_date || "";
		return event.end_date || event.start_date || "";
	}

	function pickFeaturedEvent(events) {
		if (!events || !events.length) return null;
		const visible = events.filter(isEventCurrentlyVisible);
		if (!visible.length) return null;
		const now = Date.now();
		const upcoming = visible.filter((ev) => {
			const ms = parseEventMs(ev.start_date);
			return ms && ms >= now;
		});
		if (upcoming.length) return upcoming[0];
		return visible[0];
	}

	async function fetchPublishedEvents(params) {
		const qs = new URLSearchParams(params || {}).toString();
		const url = `${getApiBase()}/api/events/public${qs ? "?" + qs : ""}`;
		const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
		if (!res.ok) throw new Error("Unable to load events.");
		const data = await res.json();
		const list = Array.isArray(data) ? data : [];
		return list.filter(isEventCurrentlyVisible);
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
		return `<button type="button" class="wishlist-heart-btn" data-wishlist-event="${id}" aria-label="Add to wishlist" title="Add to wishlist" aria-pressed="false" onclick="event.stopPropagation();">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
		</button>`;
	}

	function eventCardImage(event) {
		return resolveImage((event && (event.card_image || event.image_url)) || "");
	}

	function buildCarouselCard(event, delayClass) {
		const id = escapeHtml(String(event.id || ""));
		const detailsUrl = escapeHtml(eventDetailsUrl(event));
		const img = escapeHtml(eventCardImage(event));
		const title = escapeHtml(event.title || "Untitled Event");
		const desc = escapeHtml((event.description || "").slice(0, 120));
		const venue = escapeHtml(event.venue || event.location || "Venue TBA");
		const category = escapeHtml(event.category || "Event");
		const dateStr = formatDateIST(event.start_date);
		const countdownIso = cardCountdownIso(event);
		const countdownEnd = event.end_date || "";
		const delay = delayClass || "";

		return `
			<article class="event-card carousel-slide reveal ${delay}" data-event-id="${id}"
				data-live-event="${liveEventAttr(event)}"
				data-lat="${event.latitude || ""}" data-lon="${event.longitude || ""}"
				style="cursor:pointer;"
				onclick="return (window.handleGuestOrNavigate ? window.handleGuestOrNavigate(event, '${detailsUrl}', 'event') : (window.location.href='${detailsUrl}', false));">
				<div class="event-card-image">
					<img src="${img}" alt="${title}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMAGE}'" />
					<span class="card-category">${category}</span>
					${wishlistHeartButton(id)}
					${countdownIso ? `<span class="card-timer" data-card-countdown="${countdownIso}" data-card-countdown-end="${countdownEnd}">&#10024; --d : --h : --m</span>` : ""}
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
		const id = escapeHtml(String(event.id || ""));
		const detailsUrl = escapeHtml(eventDetailsUrl(event));
		const img = escapeHtml(eventCardImage(event));
		const title = escapeHtml(event.title || "Untitled Event");
		const desc = escapeHtml((event.description || "").slice(0, 90));
		const venue = escapeHtml(event.venue || event.location || "Venue TBA");
		const category = escapeHtml(event.category || "Event");
		const dateStr = formatDateIST(event.start_date);
		const countdownIso = cardCountdownIso(event);
		const countdownEnd = event.end_date || "";
		const liveTypes = visibleTicketTypes(event);
		const priceSource = liveTypes.length ? Math.min(...liveTypes.map((t) => Number(t.price) || 0)) : event.price;
		const priceDisplay = formatPrice(priceSource) + (Number(priceSource) > 0 ? " onwards" : "");

		return `
			<article class="event-card cat-home-card" data-event-id="${id}"
				data-live-event="${liveEventAttr(event)}"
				data-lat="${event.latitude || ""}" data-lon="${event.longitude || ""}"
				style="cursor:pointer;"
				onclick="return (window.handleGuestOrNavigate ? window.handleGuestOrNavigate(event, '${detailsUrl}', 'event') : (window.location.href='${detailsUrl}', false));">
				<div class="event-card-image">
					<img src="${img}" alt="${title}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMAGE}'" />
					<span class="card-category">${category}</span>
					${wishlistHeartButton(id)}
					${countdownIso ? `<span class="card-timer" data-card-countdown="${countdownIso}" data-card-countdown-end="${countdownEnd}">&#10024; --d : --h : --m</span>` : ""}
				</div>
				<div class="event-card-body">
					<h3>${title}</h3>
					${desc ? `<p>${desc}</p>` : ""}
					<div class="event-meta">
						<span>&#128197; ${dateStr}</span>
						<span>&#128205; ${venue}</span>
						<span class="cat-card-price">${priceDisplay}</span>
					</div>
					<a class="card-link" href="${detailsUrl}"
						onclick="event.stopPropagation(); return (window.handleGuestOrNavigate ? window.handleGuestOrNavigate(event, '${detailsUrl}', 'event') : true);">
						View Details <span>&#8594;</span>
					</a>
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
				<p><span aria-hidden="true">&#128197;</span> ${escapeHtml(dateStr)}</p>
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
			heroCta.onclick = function (evt) {
				return window.handleGuestOrNavigate
					? window.handleGuestOrNavigate(evt, url, "event")
					: true;
			};
		}
		if (featuredImg) {
			featuredImg.src = img;
			featuredImg.alt = event.title || "Featured event";
		}
		if (featuredLink) {
			featuredLink.href = url;
			featuredLink.onclick = function (evt) {
				return window.handleGuestOrNavigate
					? window.handleGuestOrNavigate(evt, url, "event")
					: true;
			};
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

	function updateCardCountdownElement(el, startIso, endIso) {
		if (!el || !startIso) return;
		const phase = getEventPhase({ start_date: startIso, end_date: endIso || el.dataset.cardCountdownEnd || "" });
		if (phase === "ended") {
			el.textContent = "Ended";
			return;
		}
		if (phase === "live") {
			const endMs = parseEventMs(endIso || el.dataset.cardCountdownEnd || "");
			if (endMs) {
				const parts = getCountdownParts(endMs);
				el.textContent = parts.expired
					? "Ended"
					: `Live ${pad(parts.days)}d : ${pad(parts.hours)}h : ${pad(parts.minutes)}m`;
			} else {
				el.textContent = "✨ Live Now";
			}
			return;
		}
		const startMs = parseEventMs(startIso);
		const parts = getCountdownParts(startMs);
		if (parts.expired) {
			el.textContent = "✨ Started";
			return;
		}
		el.textContent = `✨ ${pad(parts.days)}d : ${pad(parts.hours)}h : ${pad(parts.minutes)}m`;
	}

	function pruneExpiredPublicEvents() {
		let removed = 0;
		document.querySelectorAll("[data-live-event]").forEach((card) => {
			const raw = card.getAttribute("data-live-event");
			if (!raw) return;
			let payload = null;
			try {
				payload = JSON.parse(decodeURIComponent(raw));
			} catch (_) {
				return;
			}
			if (!isEventCurrentlyVisible(payload)) {
				card.remove();
				removed += 1;
			}
		});
		if (removed) {
			try {
				global.dispatchEvent(new CustomEvent("jod:public-events-pruned"));
			} catch (_) {}
		}
		return removed;
	}

	function updateTicketCountdownElement(el) {
		if (!el) return;
		const option = el.closest("[data-ticket-option]");
		const start = el.dataset.ticketStart || (option && option.dataset.salesStart) || "";
		const end = el.dataset.ticketEnd || (option && option.dataset.salesEnd) || "";
		const phase = ticketOfferPhase({ sales_start: start, sales_end: end });
		if (phase === "ended" || phase === "upcoming") {
			if (option) option.remove();
			try {
				global.dispatchEvent(new CustomEvent("jod:tickets-pruned"));
			} catch (_) {}
			return;
		}
		if (phase === "always") {
			el.hidden = true;
			return;
		}
		el.hidden = false;
		const endMs = parseEventMs(end);
		const parts = getCountdownParts(endMs);
		el.textContent = `Offer ends in ${pad(parts.days)}d : ${pad(parts.hours)}h : ${pad(parts.minutes)}m : ${pad(parts.seconds)}s`;
	}

	function startCountdownTicker() {
		function tick() {
			document.querySelectorAll("[data-countdown]").forEach((el) => {
				if (el.hasAttribute("data-summary-countdown")) return;
				updateCountdownElement(el, el.dataset.countdown, el.dataset.countdownEnd);
			});
			document.querySelectorAll("[data-card-countdown]").forEach((el) => {
				updateCardCountdownElement(el, el.dataset.cardCountdown, el.dataset.cardCountdownEnd);
			});
			document.querySelectorAll("[data-summary-countdown]").forEach((el) => {
				const iso = el.getAttribute("data-summary-countdown") || "";
				if (!iso || iso.indexOf("-") < 0) return;
				updateSummaryCountdown(el, iso, el.dataset.countdownEnd || "");
			});
			document.querySelectorAll("[data-ticket-countdown]").forEach((el) => {
				updateTicketCountdownElement(el);
			});
			pruneExpiredPublicEvents();
			if (global.__jodFeaturedEvent && !isEventCurrentlyVisible(global.__jodFeaturedEvent)) {
				const key = String(global.__jodFeaturedEvent.id || "featured");
				if (global.__jodFeaturedExpiredNotified !== key) {
					global.__jodFeaturedExpiredNotified = key;
					try {
						global.dispatchEvent(new CustomEvent("jod:featured-expired"));
					} catch (_) {}
				}
			} else {
				global.__jodFeaturedExpiredNotified = "";
			}
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

		let forceShow = false;
		try {
			const params = new URLSearchParams(window.location.search || "");
			forceShow = params.get("show_featured") === "1"
				|| sessionStorage.getItem("jod-show-featured-modal-after-login") === "1"
				|| localStorage.getItem("jod-show-featured-modal-after-login") === "1";
		} catch (_) {}

		let dismissed = false;
		if (!forceShow) {
			try {
				dismissed = sessionStorage.getItem("jod-upcoming-modal-shown-" + event.id) === "1";
			} catch (_) {}
		}
		if (dismissed) return;

		if (forceShow) {
			delete modal.dataset.openedFor;
		} else if (modal.dataset.openedFor === String(event.id) && !modal.hidden) {
			return;
		}

		modal.dataset.openedFor = String(event.id);
		window.setTimeout(() => {
			if (modal.dataset.openedFor !== String(event.id)) return;
			try {
				sessionStorage.removeItem("jod-show-featured-modal-after-login");
				localStorage.removeItem("jod-show-featured-modal-after-login");
				const url = new URL(window.location.href);
				if (url.searchParams.has("show_featured")) {
					url.searchParams.delete("show_featured");
					window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
				}
			} catch (_) {}
			modal.hidden = false;
			document.body.classList.add("modal-open");
		}, forceShow ? 600 : 1400);
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
		ticketSaleStart,
		ticketSaleEnd,
		ticketOfferPhase,
		isTicketOnSale,
		visibleTicketTypes,
		isEventCurrentlyVisible,
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
