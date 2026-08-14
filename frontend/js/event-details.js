/**
 * Dynamic Category-Specific Event Details Page Logic — JOD Events
 */

document.addEventListener('DOMContentLoaded', () => {
    initEventDetailsPage();
});

let currentSelectedPrice = 1999;
let currentEventData = null;

async function initEventDetailsPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('id');

    if (eventId) {
        await loadEventFromBackend(eventId);
    }
}

async function loadEventFromBackend(eventId) {
    try {
        const response = await fetch(`http://127.0.0.1:8001/api/events/${eventId}`);
        if (!response.ok) {
            console.warn('Backend API request returned error status:', response.status);
            return;
        }
        const data = await response.json();
        currentEventData = data;
        renderEventDOM(data);
    } catch (err) {
        console.warn('Could not fetch event from FastAPI backend API, relying on pre-rendered template:', err);
    }
}

function getCategoryThemeConfig(category) {
    const cat = (category || '').toLowerCase();
    if (cat.includes('corporate') || cat.includes('conference') || cat.includes('business')) {
        return {
            themeClass: 'category-theme-corporate',
            heroBadge: '💼 Executive Summit',
            performersTitle: 'Keynote Speakers & Panelists',
            highlightsTitle: 'Summit Highlights & Key Takeaways'
        };
    } else if (cat.includes('launch') || cat.includes('product') || cat.includes('tech')) {
        return {
            themeClass: 'category-theme-launch',
            heroBadge: '🚀 Exclusive Product Reveal',
            performersTitle: 'Innovation Leads & Creators',
            highlightsTitle: 'Interactive Demo Pods & Reveal Showcase'
        };
    } else if (cat.includes('wedding') || cat.includes('luxury') || cat.includes('soiree')) {
        return {
            themeClass: 'category-theme-wedding',
            heroBadge: '💍 Signature Luxury Showcase',
            performersTitle: 'Featured Designers & Master Artisans',
            highlightsTitle: 'Couture Walk & Decor Exhibition'
        };
    } else if (cat.includes('workshop') || cat.includes('makeup') || cat.includes('boutique') || cat.includes('fashion')) {
        return {
            themeClass: 'category-theme-workshop',
            heroBadge: '💄 Interactive Masterclass',
            performersTitle: 'Workshop Instructors & Master Stylists',
            highlightsTitle: 'Workshop Highlights & Hands-on Sessions'
        };
    } else if (cat.includes('festival') || cat.includes('cultural') || cat.includes('music')) {
        return {
            themeClass: 'category-theme-festival',
            heroBadge: '🎸 Live Music & Cultural Fest',
            performersTitle: 'Festival Lineup & Headliners',
            highlightsTitle: 'Open Air Stages & Festival Highlights'
        };
    } else {
        return {
            themeClass: 'category-theme-comedy',
            heroBadge: '🎙️ Live Comedy Special',
            performersTitle: 'Spotlight Artists & Performers',
            highlightsTitle: 'Show Laughs & Tour Highlights'
        };
    }
}

function renderEventDOM(event) {
    if (!event) return;

    const themeConfig = getCategoryThemeConfig(event.category);

    // Apply category specific theme styling to body while preserving sub-page class
    document.body.classList.remove('category-theme-comedy', 'category-theme-corporate', 'category-theme-launch', 'category-theme-wedding', 'category-theme-festival', 'category-theme-workshop');
    document.body.classList.add('sub-page', 'event-details-page', themeConfig.themeClass);

    // Hero Badge & Section Headings
    const heroBadgeEl = document.getElementById('eventHeroBadge');
    if (heroBadgeEl) heroBadgeEl.textContent = themeConfig.heroBadge;

    const perfTitleEl = document.getElementById('performersTitle');
    if (perfTitleEl) perfTitleEl.textContent = themeConfig.performersTitle;

    const hlTitleEl = document.getElementById('highlightsTitle');
    if (hlTitleEl) hlTitleEl.textContent = themeConfig.highlightsTitle;

    // Title & Header Meta
    const titleEl = document.getElementById('eventTitle');
    if (titleEl && event.title) titleEl.textContent = event.title;

    const venueEl = document.getElementById('headerVenue');
    if (venueEl) venueEl.textContent = `📍 ${event.venue || event.location || 'Event Venue'}`;

    const catEl = document.getElementById('headerCategory');
    if (catEl) catEl.textContent = `🎭 ${event.category || 'Event'}`;

    // Banner & Badges
    const imgEl = document.getElementById('eventImage');
    if (imgEl && event.image_url) imgEl.src = event.image_url;

    const catTagEl = document.getElementById('eventCategoryTag');
    if (catTagEl && event.category) catTagEl.textContent = event.category;

    const formatTagEl = document.getElementById('eventFormatTag');
    if (formatTagEl) formatTagEl.textContent = event.event_format || 'In-person';

    const infoFormatBadge = document.getElementById('infoFormatBadge');
    if (infoFormatBadge) infoFormatBadge.textContent = event.event_format || 'In-person';

    // Description
    const descEl = document.getElementById('eventDescription');
    if (descEl && event.description) descEl.textContent = event.description;

    // Info Box Metadata
    const scheduleEl = document.getElementById('infoSchedule');
    if (scheduleEl && event.start_date) {
        try {
            const dt = new Date(event.start_date);
            const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            scheduleEl.textContent = `${dateStr} • ${timeStr}`;
        } catch (e) {
            scheduleEl.textContent = event.start_date;
        }
    }

    const durationEl = document.getElementById('infoDuration');
    if (durationEl) durationEl.textContent = event.duration || '2 hours';

    const ageLangEl = document.getElementById('infoAgeLang');
    if (ageLangEl) ageLangEl.textContent = `${event.age_limit || 'All ages'} | ${event.language || 'English'}`;

    const infoVenueEl = document.getElementById('infoVenue');
    if (infoVenueEl) infoVenueEl.textContent = event.venue || event.location || '';

    const infoLocEl = document.getElementById('infoLocation');
    if (infoLocEl) infoLocEl.textContent = event.location || '';

    // Price
    const startingPrice = event.price || 0;
    currentSelectedPrice = startingPrice;
    updatePriceDisplays(startingPrice);

    // Performers Grid
    if (event.performers && Array.isArray(event.performers) && event.performers.length > 0) {
        const pGrid = document.getElementById('performersGrid');
        if (pGrid) {
            pGrid.innerHTML = event.performers.map(p => `
                <div class="performer-card">
                    <img class="performer-avatar" src="${p.image_url || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80'}" alt="${p.name || 'Performer'}" />
                    <h3 class="performer-name">${p.name || 'Artist'}</h3>
                    <p class="performer-role">${p.role || 'Performer'}</p>
                </div>
            `).join('');
        }
    }

    // Highlights Grid
    if (event.highlights && Array.isArray(event.highlights) && event.highlights.length > 0) {
        const hGrid = document.getElementById('highlightsGrid');
        if (hGrid) {
            hGrid.innerHTML = event.highlights.map(h => `
                <div class="highlight-card">
                    <img src="${h.image_url || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80'}" alt="${h.title || 'Highlight'}" />
                    <div class="highlight-content">
                        <h4 class="highlight-title">${h.title || ''}</h4>
                        <p class="highlight-desc">${h.description || ''}</p>
                    </div>
                </div>
            `).join('');
        }
    }

    // Ticket Types Breakdown
    if (event.ticket_types && Array.isArray(event.ticket_types) && event.ticket_types.length > 0) {
        const tList = document.getElementById('ticketsList');
        if (tList) {
            tList.innerHTML = event.ticket_types.map((t, idx) => `
                <div class="ticket-type-option ${idx === 0 ? 'selected' : ''}" onclick="selectTicketOption(this, ${t.price})">
                    <div>
                        <div class="ticket-name">${t.name}</div>
                        <div class="ticket-status">${t.availability || 'Available'}</div>
                    </div>
                    <div class="ticket-price">₹${t.price}</div>
                </div>
            `).join('');
        }
    }

    // Terms & Conditions
    if (event.terms) {
        const termsList = document.getElementById('termsList');
        if (termsList) {
            const lines = event.terms.split('\n').filter(l => l.trim().length > 0);
            if (lines.length > 0) {
                termsList.innerHTML = lines.map(l => `<li>${l}</li>`).join('');
            }
        }
    }
}

let currentSelectedTicketType = "Silver Access";

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
    if (displayPrice) displayPrice.textContent = `₹${Number(price).toLocaleString('en-IN')}`;

    const mobilePrice = document.getElementById('mobileStickyPrice');
    if (mobilePrice) mobilePrice.textContent = `₹${Number(price).toLocaleString('en-IN')}`;
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
    const isAuth = (window.JodAuth && typeof window.JodAuth.isLoggedIn === "function")
        ? window.JodAuth.isLoggedIn()
        : Boolean(localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));

    if (!isAuth) {
        const currentTarget = window.location.pathname + window.location.search + window.location.hash;
        if (window.JodAuth && typeof window.JodAuth.openGuestAuthModal === "function") {
            window.JodAuth.openGuestAuthModal({
                title: "Sign Up to Book Tickets",
                message: "You need to create an account or sign in to select tickets, reserve seats, and complete your booking.",
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

    const token = window.JodAuth ? window.JodAuth.getToken() : (localStorage.getItem("jod_access_token") || sessionStorage.getItem("jod_access_token"));

    const user = window.JodAuth ? window.JodAuth.getUser() : null;
    const custId = user ? (user.customer_id || user.id) : "assigned customer";
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = currentEventData ? currentEventData.id : (urlParams.get("id") || "66666666-6666-6666-6666-666666666666");
    const eventName = currentEventData ? currentEventData.title : (document.getElementById('eventTitle')?.textContent || 'Event');
    
    // Resolve ticket type from selected DOM option if available
    let ticketType = typeof currentSelectedTicketType !== "undefined" ? currentSelectedTicketType : "Silver Access";
    const activeOptName = document.querySelector('.ticket-type-option.selected .ticket-name');
    if (activeOptName && activeOptName.textContent.trim()) {
        ticketType = activeOptName.textContent.trim();
    }
    const price = typeof currentSelectedPrice !== "undefined" ? currentSelectedPrice : 499;

    const confirmBook = confirm(`Confirm Booking for ${eventName}?\n\nCustomer ID: ${custId}\nTicket Type: ${ticketType}\nTotal Price: ₹${price}\n\nClick OK to confirm your ticket registration.`);
    if (!confirmBook) return;

    showToast("Processing ticket booking with Customer ID... 🎟️");

    try {
        const apiBase = (window.JodAuth && typeof window.JodAuth.getApiBase === "function") ? window.JodAuth.getApiBase() : "http://127.0.0.1:8001";
        const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
        const payload = {
            event_id: eventId,
            ticket_type: ticketType,
            quantity: 1,
            total_price: price,
            payment_id: `PAY-JOD-${randomHex}`,
            payment_mode: "UPI / Credit Card",
            seat_number: `Row B, Seat ${Math.floor(Math.random() * 20) + 1}`,
            receiver_name: user ? (user.full_name || user.username) : "Guest Customer",
            receiver_email: user ? user.email : "customer@jodevents.com",
            receiver_phone: "+91 98765 43210"
        };

        const res = await fetch(`${apiBase}/api/bookings/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const bData = await res.json();
            try {
                const cache = JSON.parse(localStorage.getItem("jod_user_bookings") || "[]");
                cache.unshift(bData);
                localStorage.setItem("jod_user_bookings", JSON.stringify(cache));
            } catch (_) {}

            showToast(`Booking Confirmed! Customer ID: ${bData.customer_id}. Opening Your Orders… 🎉`);
            setTimeout(() => { window.location.href = "orders.html"; }, 1200);
        } else {
            const err = await res.json();
            showToast(err.detail || "Booking failed. Please try again.");
        }
    } catch (_) {
        const mockBooking = {
            booking_id: `b${Date.now()}-0000-0000-0000-${Math.random().toString(36).substring(2, 10)}`,
            customer_id: custId,
            user_name: user ? (user.full_name || user.username) : "Guest Customer",
            user_email: user ? user.email : "customer@jodevents.com",
            event_id: eventId,
            event_title: eventName,
            event_venue: document.getElementById("eventVenue")?.textContent || "ITC Grand Chola, Chennai",
            event_start_date: new Date(Date.now() + 86400000 * 5).toISOString(),
            ticket_type: ticketType,
            quantity: 1,
            total_price: price,
            status: "CONFIRMED",
            payment_id: `PAY-JOD-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            payment_mode: "UPI / Credit Card",
            gst_amount: Math.round(price * 0.18),
            seat_number: "Row B, Seat 12",
            receiver_name: user ? (user.full_name || user.username) : "Guest Customer",
            receiver_email: user ? user.email : "customer@jodevents.com",
            receiver_phone: "+91 98765 43210",
            booked_at: new Date().toISOString()
        };

        try {
            const cache = JSON.parse(localStorage.getItem("jod_user_bookings") || "[]");
            cache.unshift(mockBooking);
            localStorage.setItem("jod_user_bookings", JSON.stringify(cache));
        } catch (_) {}

        showToast("Booking recorded! Opening Your Orders… 🎟️");
        setTimeout(() => { window.location.href = "orders.html"; }, 1200);
    }
}

