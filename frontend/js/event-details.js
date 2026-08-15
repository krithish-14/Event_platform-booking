/**
 * Dynamic Event Details Page — loads published events from API only.
 */
document.addEventListener('DOMContentLoaded', () => {
    initEventDetailsPage();
});

let currentSelectedPrice = 0;
let currentSelectedTicketType = "General Admission";
let currentEventData = null;

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
    if (!grid || !EP) return;

    try {
        const events = await EP.fetchPublishedEvents({ limit: 6 });
        const others = events.filter(e => e.id !== currentId).slice(0, 2);
        if (!others.length) {
            if (block) block.style.display = 'none';
            return;
        }
        grid.innerHTML = others.map(ev => {
            const url = EP.eventDetailsUrl(ev);
            const img = EP.resolveImage(ev.image_url);
            const title = EP.escapeHtml(ev.title || 'Event');
            const venue = EP.escapeHtml(ev.venue || ev.location || '');
            const price = EP.formatPrice(ev.price);
            return `
                <a href="${url}" class="rec-card">
                    <img src="${img}" alt="${title}" loading="lazy" onerror="this.src='${EP.PLACEHOLDER_IMAGE}'" />
                    <div class="rec-card-body">
                        <h3 class="rec-card-title">${title}</h3>
                        <p class="rec-card-meta">📍 ${venue}</p>
                        <div class="rec-card-price">${price}${Number(ev.price) > 0 ? ' onwards' : ''}</div>
                    </div>
                </a>
            `;
        }).join('');
    } catch (_) {
        if (block) block.style.display = 'none';
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

    const heroBadgeEl = document.getElementById('eventHeroBadge');
    if (heroBadgeEl) heroBadgeEl.textContent = themeConfig.heroBadge;

    const perfTitleEl = document.getElementById('performersTitle');
    if (perfTitleEl) perfTitleEl.textContent = themeConfig.performersTitle;

    const hlTitleEl = document.getElementById('highlightsTitle');
    if (hlTitleEl) hlTitleEl.textContent = themeConfig.highlightsTitle;

    const titleEl = document.getElementById('eventTitle');
    if (titleEl) titleEl.textContent = event.title || 'Event';

    const venueEl = document.getElementById('headerVenue');
    if (venueEl) venueEl.textContent = `📍 ${event.venue || event.location || 'Event Venue'}`;

    const catEl = document.getElementById('headerCategory');
    if (catEl) catEl.textContent = `${themeConfig.icon || '🎟️'} ${event.category || 'Event'}`;

    const imgEl = document.getElementById('eventImage');
    if (imgEl) {
        imgEl.src = EP ? EP.resolveImage(event.image_url) : (event.image_url || 'images/hero-event.jpg');
        imgEl.alt = event.title || 'Event Banner';
    }

    const catTagEl = document.getElementById('eventCategoryTag');
    if (catTagEl) catTagEl.textContent = event.category || 'Event';

    const formatTagEl = document.getElementById('eventFormatTag');
    if (formatTagEl) formatTagEl.textContent = event.event_format || 'In-person';

    const infoFormatBadge = document.getElementById('infoFormatBadge');
    if (infoFormatBadge) infoFormatBadge.textContent = event.event_format || 'In-person';

    const descEl = document.getElementById('eventDescription');
    if (descEl) descEl.textContent = event.description || 'Event details will be shared by the host.';

    const interestedEl = document.getElementById('interestedText');
    if (interestedEl) interestedEl.textContent = event.category ? `${event.category} event` : 'Published event';

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

    const startingPrice = event.price || 0;
    currentSelectedPrice = startingPrice;
    updatePriceDisplays(startingPrice);

    const perfSection = document.getElementById('performersSection');
    if (event.performers && Array.isArray(event.performers) && event.performers.length > 0) {
        const pGrid = document.getElementById('performersGrid');
        if (pGrid) {
            pGrid.innerHTML = event.performers.map(p => `
                <div class="performer-card">
                    <img class="performer-avatar" src="${EP ? EP.resolveImage(p.image_url || p.photo_url) : (p.image_url || p.photo_url || 'images/hero-event.jpg')}" alt="${p.name || 'Performer'}" onerror="this.src='images/hero-event.jpg'" />
                    <h3 class="performer-name">${p.name || 'Artist'}</h3>
                    <p class="performer-role">${p.role || 'Performer'}</p>
                </div>
            `).join('');
        }
    } else if (perfSection) {
        perfSection.style.display = 'none';
    }

    if (event.highlights && Array.isArray(event.highlights) && event.highlights.length > 0) {
        const hGrid = document.getElementById('highlightsGrid');
        if (hGrid) {
            hGrid.innerHTML = event.highlights.map(h => `
                <div class="highlight-card">
                    <img src="${EP ? EP.resolveImage(h.image_url || h.logo_url) : (h.image_url || h.logo_url || 'images/hero-event.jpg')}" alt="${h.title || 'Highlight'}" onerror="this.src='images/hero-event.jpg'" />
                    <div class="highlight-content">
                        <h4 class="highlight-title">${h.title || ''}</h4>
                        <p class="highlight-desc">${h.description || h.subtitle || ''}</p>
                    </div>
                </div>
            `).join('');
        }
    } else {
        const hlSection = document.getElementById('highlightsSection');
        if (hlSection) hlSection.style.display = 'none';
    }

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
                currentSelectedPrice = first.price || currentSelectedPrice;
                updatePriceDisplays(currentSelectedPrice);
            }
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

    const termsList = document.getElementById('termsList');
    if (event.terms && termsList) {
        const lines = event.terms.split('\n').filter(l => l.trim().length > 0);
        termsList.innerHTML = lines.length
            ? lines.map(l => `<li>${l}</li>`).join('')
            : '<li>Standard event terms apply. Contact the organizer for details.</li>';
    } else if (termsList) {
        termsList.innerHTML = '<li>Standard event terms apply. Contact the organizer for details.</li>';
    }
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
    updatePriceDisplays(price);
}

function updatePriceDisplays(price) {
    const displayPrice = document.getElementById('displayPrice');
    if (displayPrice) {
        displayPrice.textContent = Number(price) <= 0 ? 'Free' : `₹${Number(price).toLocaleString('en-IN')}`;
    }

    const mobilePrice = document.getElementById('mobileStickyPrice');
    if (mobilePrice) {
        mobilePrice.textContent = Number(price) <= 0 ? 'Free' : `₹${Number(price).toLocaleString('en-IN')}`;
    }
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

    const regUrl = new URL("published-form.html", window.location.href);
    regUrl.searchParams.set("eventId", eventId);
    regUrl.searchParams.set("ticket", ticketType);
    regUrl.searchParams.set("price", String(price));
    window.location.href = regUrl.toString();
}
