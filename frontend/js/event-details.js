/**
 * Dynamic Event Details Page — loads published events from API only.
 */
document.addEventListener('DOMContentLoaded', () => {
    initEventDetailsPage();
});

let currentSelectedPrice = 0;
let currentSelectedTicketType = "General Admission";
let currentEventData = null;
let galleryImages = [];
let galleryIndex = 0;
let galleryLightboxBound = false;

async function initEventDetailsPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('id');
    const EP = window.JodEventsPublic;

    showLoadingState();

    if (!eventId) {
        showUnavailableState("This event is currently unavailable.", "No event was selected.");
        return;
    }

    if (!EP) {
        showUnavailableState("Unable to load event details.", "Please refresh the page and try again.");
        return;
    }

    await loadEventFromBackend(eventId);
}

function showLoadingState() {
    const main = document.getElementById('mainContent');
    const loading = document.getElementById('eventLoadingState');
    const unavailable = document.getElementById('eventUnavailableState');
    if (main) main.style.display = 'none';
    if (unavailable) unavailable.style.display = 'none';
    if (loading) loading.style.display = 'block';
}

function showUnavailableState(title, message) {
    const main = document.getElementById('mainContent');
    const loading = document.getElementById('eventLoadingState');
    const unavailable = document.getElementById('eventUnavailableState');
    const titleEl = document.getElementById('unavailableTitle');
    const msgEl = document.getElementById('unavailableMessage');
    if (loading) loading.style.display = 'none';
    if (main) main.style.display = 'none';
    if (unavailable) unavailable.style.display = 'block';
    if (titleEl) titleEl.textContent = title || 'This event is currently unavailable.';
    if (msgEl) msgEl.textContent = message || 'The event may be unpublished or no longer available.';
    document.title = 'Event Unavailable — JOD Events';
}

function showEventContent() {
    const main = document.getElementById('mainContent');
    const loading = document.getElementById('eventLoadingState');
    const unavailable = document.getElementById('eventUnavailableState');
    if (loading) loading.style.display = 'none';
    if (unavailable) unavailable.style.display = 'none';
    if (main) main.style.display = '';
}

async function loadEventFromBackend(eventId) {
    const EP = window.JodEventsPublic;
    try {
        const data = await EP.fetchPublishedEventById(eventId);
        currentEventData = data;
        renderEventDOM(data);
        showEventContent();
        await loadRecommendedEvents(eventId);
        EP.startCountdownTicker();
    } catch (err) {
        console.warn('Event details load failed:', err);
        showUnavailableState(
            err.code === 'UNAVAILABLE' ? 'This event is currently unavailable.' : 'Unable to load event details.',
            err.message || 'Please try again later.'
        );
    }
}

async function loadRecommendedEvents(currentId) {
    const EP = window.JodEventsPublic;
    const grid = document.getElementById('recommendedGrid');
    const block = document.getElementById('recommendedBlock');
    if (block) block.style.display = '';
    if (!grid) return;
    grid.innerHTML = '';
    if (!EP) return;

    try {
        const events = await EP.fetchPublishedEvents({ limit: 8 });
        const others = events.filter(e => String(e.id) !== String(currentId)).slice(0, 4);
        if (!others.length) return;
        grid.innerHTML = others.map(ev => {
            const url = EP.eventDetailsUrl(ev);
            const img = EP.resolveImage(ev.image_url);
            const title = EP.escapeHtml(ev.title || 'Event');
            const venue = EP.escapeHtml(ev.venue || ev.location || '');
            const dateStr = EP.formatDateIST ? EP.escapeHtml(EP.formatDateIST(ev.start_date) || '') : '';
            const meta = [dateStr, venue].filter(Boolean).join(' · ');
            const heart = EP.wishlistHeartButton ? EP.wishlistHeartButton(ev.id) : '';
            return `
                <a href="${url}" class="rec-card">
                    <div class="rec-card-media">
                        <img src="${img}" alt="${title}" loading="lazy" onerror="this.src='${EP.PLACEHOLDER_IMAGE}'" />
                        ${heart}
                    </div>
                    <div class="rec-card-body">
                        <h3 class="rec-card-title">${title}</h3>
                        <p class="rec-card-meta">${meta}</p>
                    </div>
                </a>
            `;
        }).join('');
        if (window.JodWishlist && typeof window.JodWishlist.refreshButtons === 'function') {
            window.JodWishlist.refreshButtons(grid);
        }
    } catch (_) {
        grid.innerHTML = '';
    }
}

function getCategoryThemeConfig(category) {
    const cat = (category || '').trim();
    const themes = {
        Sports: {
            themeClass: 'category-theme-festival',
            heroBadge: '🏅 Sports Event',
            performersTitle: 'Athletes & Headliners',
            highlightsTitle: 'Sponsors',
            icon: '🏅'
        },
        Conferences: {
            themeClass: 'category-theme-corporate',
            heroBadge: '💼 Conference',
            performersTitle: 'Speakers',
            highlightsTitle: 'Sponsors',
            icon: '💼'
        },
        Performances: {
            themeClass: 'category-theme-comedy',
            heroBadge: '🎭 Performance',
            performersTitle: 'Artists',
            highlightsTitle: 'Sponsors',
            icon: '🎭'
        },
        Experiences: {
            themeClass: 'category-theme-workshop',
            heroBadge: '✨ Experience',
            performersTitle: 'Hosts',
            highlightsTitle: 'Sponsors',
            icon: '✨'
        },
        Expositions: {
            themeClass: 'category-theme-launch',
            heroBadge: '🏛️ Exposition',
            performersTitle: 'Exhibitors & Speakers',
            highlightsTitle: 'Sponsors',
            icon: '🏛️'
        },
        Parties: {
            themeClass: 'category-theme-wedding',
            heroBadge: '🎉 Party',
            performersTitle: 'Artists',
            highlightsTitle: 'Sponsors',
            icon: '🎉'
        }
    };
    return themes[cat] || {
        themeClass: 'category-theme-comedy',
        heroBadge: cat || 'Event',
        performersTitle: 'Artists & Speakers',
        highlightsTitle: 'Sponsors',
        icon: '🎟️'
    };
}

function renderEventDOM(event) {
    if (!event) return;
    const EP = window.JodEventsPublic;
    const themeConfig = getCategoryThemeConfig(event.category);

    document.body.classList.remove('category-theme-comedy', 'category-theme-corporate', 'category-theme-launch', 'category-theme-wedding', 'category-theme-festival', 'category-theme-workshop');
    document.body.classList.add('sub-page', 'event-details-page', themeConfig.themeClass);

    document.title = `${event.title || 'Event Details'} — JOD Events`;

    const perfTitleEl = document.getElementById('performersTitle');
    if (perfTitleEl) perfTitleEl.textContent = themeConfig.performersTitle;

    const titleEl = document.getElementById('eventTitle');
    if (titleEl) titleEl.textContent = event.title || 'Event';

    const venueEl = document.getElementById('headerVenue');
    if (venueEl) venueEl.textContent = `📍 ${event.venue || event.location || 'Event Venue'}`;

    const imgEl = document.getElementById('eventImage');
    if (imgEl) {
        imgEl.src = EP ? EP.resolveImage(event.image_url) : (event.image_url || 'images/hero-event.jpg');
        imgEl.alt = event.title || 'Event Banner';
    }

    const wishBtn = document.getElementById('btnWishlist');
    if (wishBtn && event.id) {
        wishBtn.setAttribute('data-wishlist-event', String(event.id));
        if (window.JodWishlist && typeof window.JodWishlist.refreshButtons === 'function') {
            window.JodWishlist.refreshButtons();
        }
    }

    const formatTagEl = document.getElementById('eventFormatTag');
    if (formatTagEl) formatTagEl.textContent = event.event_format || 'In-person';

    const catTagEl = document.getElementById('eventCategoryTag');
    if (catTagEl) {
        const cat = (event.category || '').trim();
        catTagEl.textContent = cat || 'Sport';
        catTagEl.style.display = cat ? '' : 'none';
    }

    const descEl = document.getElementById('eventDescription');
    if (descEl) descEl.textContent = event.description || 'Event details will be shared by the host.';

    renderEventPolicies(event, EP);

    const scheduleEl = document.getElementById('infoSchedule');
    if (scheduleEl && EP) {
        scheduleEl.textContent = EP.formatDateTimeIST(event.start_date);
    }

    const durationEl = document.getElementById('infoDuration');
    if (durationEl) durationEl.textContent = event.duration || 'See event schedule';

    const ageLangEl = document.getElementById('infoAgeLang');
    if (ageLangEl) ageLangEl.textContent = `${event.age_limit || 'All ages'} | ${event.language || 'English'}`;

    const infoVenueEl = document.getElementById('infoVenue');
    if (infoVenueEl) infoVenueEl.textContent = event.venue || event.location || '';

    const infoLocEl = document.getElementById('infoLocation');
    if (infoLocEl) infoLocEl.textContent = event.location || '';

    const countdownEl = document.getElementById('eventCountdown');
    if (countdownEl && event.start_date && EP) {
        countdownEl.dataset.countdown = event.start_date;
        countdownEl.dataset.countdownEnd = event.end_date || '';
        countdownEl.style.display = '';
        EP.updateCountdownElement(countdownEl, event.start_date, event.end_date);
    }

    const startingPrice = lowestTicketPrice(event);
    currentSelectedPrice = startingPrice;
    setStartingPriceDisplay(startingPrice);

    const escape = (EP && typeof EP.escapeHtml === 'function')
        ? EP.escapeHtml
        : (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const perfSection = document.getElementById('performersSection');
    if (event.performers && Array.isArray(event.performers) && event.performers.length > 0) {
        const pGrid = document.getElementById('performersGrid');
        if (pGrid) {
            pGrid.innerHTML = event.performers.map(p => {
                const name = escape(p.name || 'Speaker');
                const role = escape(p.role || '');
                const photo = EP ? EP.resolveImage(p.image_url || p.photo_url) : (p.image_url || p.photo_url || 'images/hero-event.jpg');
                return `
                <div class="performer-card">
                    <img class="performer-avatar" src="${photo}" alt="${name}" onerror="this.src='images/hero-event.jpg'" />
                    <h3 class="performer-name">${name}</h3>
                    ${role ? `<p class="performer-role">${role}</p>` : ''}
                </div>`;
            }).join('');
        }
        if (perfSection) perfSection.style.display = '';
    } else if (perfSection) {
        perfSection.style.display = 'none';
    }

    renderEventGallery(event, EP);
    renderEventSponsors(event, EP, escape);

    if (event.ticket_types && Array.isArray(event.ticket_types) && event.ticket_types.length > 0) {
        const tList = document.getElementById('ticketsList');
        if (tList) {
            tList.innerHTML = event.ticket_types.map((t, idx) => `
                <div class="ticket-type-option ${idx === 0 ? 'selected' : ''}" onclick="selectTicketOption(this, ${t.price}, '${(t.name || '').replace(/'/g, "\\'")}')">
                    <div>
                        <div class="ticket-name">${t.name}</div>
                        <div class="ticket-status">${t.availability || 'Available'}</div>
                    </div>
                    <div class="ticket-price">₹${t.price}</div>
                </div>
            `).join('');
            const first = event.ticket_types[0];
            if (first) {
                currentSelectedTicketType = first.name || currentSelectedTicketType;
                currentSelectedPrice = Number(first.price);
            }
            setStartingPriceDisplay(lowestTicketPrice(event));
        }
    } else {
        const tList = document.getElementById('ticketsList');
        if (tList) {
            tList.innerHTML = `
                <div class="ticket-type-option selected" onclick="selectTicketOption(this, ${startingPrice}, 'General Admission')">
                    <div>
                        <div class="ticket-name">General Admission</div>
                        <div class="ticket-status">Available</div>
                    </div>
                    <div class="ticket-price">${startingPrice <= 0 ? 'Free' : '₹' + startingPrice}</div>
                </div>
            `;
        }
    }
}

function collectGalleryUrls(event, EP) {
    let raw = event ? event.gallery_images : null;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try { raw = JSON.parse(trimmed); } catch (_) { raw = trimmed ? [trimmed] : []; }
        } else {
            raw = trimmed ? [trimmed] : [];
        }
    }
    if (!Array.isArray(raw)) raw = [];
    return raw.map((item) => {
        if (typeof item === 'string') return EP ? EP.resolveImage(item) : item;
        if (item && typeof item === 'object') {
            const url = item.url || item.image_url || item.src || '';
            return url ? (EP ? EP.resolveImage(url) : url) : '';
        }
        return '';
    }).filter(Boolean);
}

function renderEventGallery(event, EP) {
    const section = document.getElementById('gallerySection');
    const grid = document.getElementById('galleryGrid');
    const urls = collectGalleryUrls(event, EP);
    galleryImages = urls;
    if (!section || !grid) return;
    section.style.display = '';
    if (!urls.length) {
        grid.innerHTML = '';
        return;
    }

    const previewCount = 5;
    const hasMore = urls.length > previewCount;
    const visible = hasMore ? urls.slice(0, previewCount) : urls;
    grid.innerHTML = visible.map((url, i) => {
        const isOverlay = hasMore && i === visible.length - 1;
        const openIndex = isOverlay ? 0 : i;
        return `
            <button type="button" class="gallery-thumb${isOverlay ? ' gallery-thumb--more' : ''}" data-gallery-index="${openIndex}">
                <img src="${url}" alt="Gallery photo ${i + 1}" loading="lazy" />
                ${isOverlay ? '<span class="gallery-thumb-overlay">See the Entire Gallery</span>' : ''}
            </button>
        `;
    }).join('');
    section.style.display = '';
    grid.querySelectorAll('[data-gallery-index]').forEach((btn) => {
        btn.addEventListener('click', () => openGalleryLightbox(Number(btn.dataset.galleryIndex)));
    });
    bindGalleryLightbox();
}

function renderEventSponsors(event, EP, escape) {
    const section = document.getElementById('sponsorsSection');
    const grid = document.getElementById('sponsorsGrid');
    if (!section || !grid) return;

    let sponsors = Array.isArray(event.sponsors) ? event.sponsors : [];
    if (!sponsors.length && Array.isArray(event.highlights)) {
        sponsors = event.highlights;
    }
    sponsors = (sponsors || []).filter((s) => s && (s.logo_url || s.image_url || s.name || s.title));
    if (!sponsors.length) {
        section.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    const esc = escape || ((s) => String(s || ''));
    grid.innerHTML = sponsors.map((s) => {
        const name = esc(s.name || s.title || '');
        const logo = EP ? EP.resolveImage(s.logo_url || s.image_url) : (s.logo_url || s.image_url || '');
        return `
            <div class="sponsor-logo-card">
                ${logo ? `<img src="${logo}" alt="${name || 'Sponsor'}" onerror="this.style.display='none'" />` : ''}
                ${name ? `<p class="sponsor-name">${name}</p>` : ''}
            </div>
        `;
    }).join('');
    section.style.display = '';
}

function bindGalleryLightbox() {
    if (galleryLightboxBound) return;
    const lightbox = document.getElementById('galleryLightbox');
    if (!lightbox) return;
    galleryLightboxBound = true;

    const closeBtn = document.getElementById('galleryLightboxClose');
    const prevBtn = document.getElementById('galleryLightboxPrev');
    const nextBtn = document.getElementById('galleryLightboxNext');
    if (closeBtn) closeBtn.addEventListener('click', closeGalleryLightbox);
    if (prevBtn) prevBtn.addEventListener('click', () => stepGalleryLightbox(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => stepGalleryLightbox(1));
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeGalleryLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (lightbox.hidden) return;
        if (e.key === 'Escape') closeGalleryLightbox();
        if (e.key === 'ArrowLeft') stepGalleryLightbox(-1);
        if (e.key === 'ArrowRight') stepGalleryLightbox(1);
    });
}

function openGalleryLightbox(index) {
    if (!galleryImages.length) return;
    galleryIndex = Number.isFinite(index) ? index : 0;
    if (galleryIndex < 0) galleryIndex = 0;
    if (galleryIndex >= galleryImages.length) galleryIndex = 0;
    const lightbox = document.getElementById('galleryLightbox');
    const img = document.getElementById('galleryLightboxImg');
    const count = document.getElementById('galleryLightboxCount');
    if (!lightbox || !img) return;
    img.src = galleryImages[galleryIndex];
    img.alt = `Gallery photo ${galleryIndex + 1}`;
    if (count) count.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
    const prevBtn = document.getElementById('galleryLightboxPrev');
    const nextBtn = document.getElementById('galleryLightboxNext');
    const showNav = galleryImages.length > 1;
    if (prevBtn) prevBtn.style.display = showNav ? '' : 'none';
    if (nextBtn) nextBtn.style.display = showNav ? '' : 'none';
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
}

function stepGalleryLightbox(delta) {
    if (!galleryImages.length) return;
    galleryIndex = (galleryIndex + delta + galleryImages.length) % galleryImages.length;
    openGalleryLightbox(galleryIndex);
}

function closeGalleryLightbox() {
    const lightbox = document.getElementById('galleryLightbox');
    if (lightbox) lightbox.hidden = true;
    document.body.style.overflow = '';
}

function renderEventPolicies(event, EP) {
    const section = document.getElementById('policiesSection');
    const container = document.getElementById('eventPolicies');
    if (!section || !container) return;

    const labels = [
        ['event_policy', 'Event Policy'],
        ['cancellation_policy', 'Cancellation Policy'],
        ['refund_policy', 'Refund Policy'],
        ['terms_and_conditions', 'Terms & Conditions'],
        ['privacy_policy', 'Privacy Policy'],
        ['age_policy', 'Age / Entry Policy']
    ];
    const escape = (EP && typeof EP.escapeHtml === 'function')
        ? EP.escapeHtml
        : (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const blocks = [];
    const policies = event && event.policies && typeof event.policies === 'object' && !Array.isArray(event.policies)
        ? event.policies
        : null;

    if (policies) {
        labels.forEach(([key, label]) => {
            const val = String(policies[key] || '').trim();
            if (val) blocks.push({ label, val });
        });
    }

    if (!blocks.length && event && event.terms) {
        const chunks = String(event.terms).split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
        chunks.forEach((chunk) => {
            const nl = chunk.indexOf('\n');
            if (nl > 0 && chunk.slice(0, nl).trim().endsWith(':')) {
                blocks.push({
                    label: chunk.slice(0, nl).trim().replace(/:$/, ''),
                    val: chunk.slice(nl + 1).trim()
                });
            } else {
                blocks.push({ label: 'Event Policy', val: chunk });
            }
        });
    }

    if (!blocks.length) {
        section.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    section.style.display = '';
    container.innerHTML = blocks.map((b) => `
        <div class="policy-block">
            <h3 class="policy-block-title">${escape(b.label)}</h3>
            <p class="policy-block-body">${escape(b.val)}</p>
        </div>
    `).join('');
}

function selectTicketOption(element, price, ticketName) {
    const options = document.querySelectorAll('.ticket-type-option');
    options.forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');

    currentSelectedPrice = price;
    if (ticketName) {
        currentSelectedTicketType = ticketName;
    } else {
        const nameEl = element.querySelector('.ticket-name');
        if (nameEl && nameEl.textContent) {
            currentSelectedTicketType = nameEl.textContent.trim();
        }
    }
}

function lowestTicketPrice(event) {
    const types = event && Array.isArray(event.ticket_types) ? event.ticket_types : [];
    const prices = types
        .map((t) => Number(t && t.price))
        .filter((n) => Number.isFinite(n));
    if (prices.length) return Math.min(...prices);
    const fallback = Number(event && event.price);
    return Number.isFinite(fallback) ? fallback : 0;
}

function formatTicketPrice(price) {
    return Number(price) <= 0 ? 'Free' : `₹${Number(price).toLocaleString('en-IN')}`;
}

function setStartingPriceDisplay(price) {
    const displayPrice = document.getElementById('displayPrice');
    if (displayPrice) displayPrice.textContent = formatTicketPrice(price);
    const mobilePrice = document.getElementById('mobileStickyPrice');
    if (mobilePrice) mobilePrice.textContent = formatTicketPrice(price);
}

function copyEventShareLink() {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
        showToast('Event link copied to clipboard! 📋');
    }).catch(() => {
        showToast('Sharing link: ' + currentUrl);
    });
}

function showToast(message) {
    const toast = document.getElementById('toastMsg');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

async function triggerBookingModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = currentEventData ? currentEventData.id : urlParams.get("id");

    if (!eventId || !currentEventData) {
        showToast("This event is currently unavailable.");
        return;
    }

    const isAuth = (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function")
        ? window.JodAuth.isLoggedIn()
        : Boolean(localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));

    if (!isAuth) {
        const currentTarget = window.location.pathname + window.location.search + window.location.hash;
        if (window.JodAuth && typeof window.JodAuth.openGuestAuthModal === "function") {
            window.JodAuth.openGuestAuthModal({
                title: "Sign Up to Book Tickets",
                message: "You need to create an account or sign in to complete registration for this event.",
                targetUrl: currentTarget,
                badge: "🎟️ Account Required"
            });
        } else {
            showToast("Please sign up or log in to book tickets. Redirecting… 🎟️");
            try { sessionStorage.setItem("jod_redirect_after_login", currentTarget); } catch (_) {}
            setTimeout(() => { window.location.href = `signup.html?redirect=${encodeURIComponent(currentTarget)}`; }, 800);
        }
        return;
    }

    let ticketType = typeof currentSelectedTicketType !== "undefined" ? currentSelectedTicketType : "General Admission";
    const activeOptName = document.querySelector('.ticket-type-option.selected .ticket-name');
    if (activeOptName && activeOptName.textContent.trim()) {
        ticketType = activeOptName.textContent.trim();
    }
    const price = typeof currentSelectedPrice !== "undefined" ? currentSelectedPrice : 0;

    try {
        sessionStorage.setItem("jod_pending_ticket_bill", JSON.stringify({
            eventId: eventId,
            eventTitle: currentEventData.title || "",
            venue: currentEventData.venue || currentEventData.location || "",
            ticket: ticketType,
            price: String(price),
            quantity: 1
        }));
    } catch (_) {}

    const regUrl = new URL("published-form.html", window.location.href);
    regUrl.searchParams.set("eventId", eventId);
    regUrl.searchParams.set("ticket", ticketType);
    regUrl.searchParams.set("price", String(price));
    regUrl.searchParams.set("v", "16");
    window.location.href = regUrl.toString();
}
