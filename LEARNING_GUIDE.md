# JOD Events Platform — Comprehensive Architectural & File-by-File Learning Guide

Welcome to the ultimate learning guide for the **JOD Events Platform**. This document provides an exhaustive, file-by-file breakdown of every single configuration, backend module, database model, frontend page, stylesheet, and JavaScript controller in this repository.

---

# Part 1: Configuration & Environment Setup

### 1. `.gitignore`
- **File Name & Path**: [`.gitignore`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/.gitignore)
- **Chronological Creation Order**: **Step 1 (Repository Setup)**. Created at the project inception to prevent local system artifacts from entering version control.
- **Core Purpose**: Specifies intentionally untracked files that Git should ignore (e.g. Python virtual environments, compiled bytecode, SQLite local databases, IDE settings, and log files).
- **Detailed Line-by-Line / Block Explanation**:
  - `__pycache__/`, `*.py[cod]`: Excludes compiled Python bytecode.
  - `.venv/`, `venv/`: Excludes local Python virtual environment directories containing installed dependencies.
  - `*.db`, `*.sqlite3`: Excludes local database files like `jod_events.db`.
  - `.env`, `*.log`: Excludes local secret environment files and execution logs.
- **Connections**: Relates directly to Git version control across all backend and frontend files.
- **Self-Check Question**: *Why is `jod_events.db` included in `.gitignore`?* (Answer: To prevent developer-specific local database data or credentials from polluting shared commits).

---

### 2. `package.json`
- **File Name & Path**: [`package.json`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/package.json)
- **Chronological Creation Order**: **Step 2 (Frontend Environment Setup)**. Created to provide metadata and script hooks for web serving tools.
- **Core Purpose**: Serves as the manifest file for Node.js based static file servers (like `serve` or `live-server`) used during frontend development.
- **Detailed Line-by-Line / Block Explanation**:
  - `"name": "event_platform-booking"`: Identifies the package name.
  - `"scripts": { "start": "serve frontend -p 5500" }`: Defines dev server shortcut for running static frontend files on port 5500.
- **Connections**: Used by `start_servers.py` or terminal runners to launch static file servers.
- **Self-Check Question**: *What command is triggered by `npm start` in this repository?*

---

### 3. `pyrightconfig.json`
- **File Name & Path**: [`pyrightconfig.json`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/pyrightconfig.json)
- **Chronological Creation Order**: **Step 3 (Tooling Setup)**. Created to configure Python static type analysis tools like Pyright/Pylance in VS Code.
- **Core Purpose**: Configures virtual environment paths so IDE autocompletion and type checking function without false positive module import errors.
- **Detailed Line-by-Line / Block Explanation**:
  - `"venvPath": "backend"`: Points Pyright to search `backend/` for virtual environment setups.
  - `"venv": ".venv"`: Specifies `.venv` as the active Python environment.
- **Connections**: Referenced by VS Code and IDE language servers inspecting `backend/`.
- **Self-Check Question**: *How does `pyrightconfig.json` help IDEs resolve imports like `from fastapi import APIRouter`?*

---

### 4. `backend/Dockerfile`
- **File Name & Path**: [`backend/Dockerfile`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Dockerfile)
- **Chronological Creation Order**: **Step 4 (Containerization Setup)**. Created for containerized deployment of the FastAPI backend.
- **Core Purpose**: Instructs Docker on how to build a lightweight Linux container image for the Python FastAPI server.
- **Detailed Line-by-Line / Block Explanation**:
  - `FROM python:3.11-slim`: Uses official lightweight Python 3.11 image.
  - `WORKDIR /app`: Sets default container working directory.
  - `COPY requirements.txt .`: Copies python dependencies list into build cache.
  - `RUN pip install --no-cache-dir -r requirements.txt`: Installs python packages.
  - `EXPOSE 8001`: Documents API port 8001.
  - `CMD ["uvicorn", "FastAPI.main:app", "--host", "0.0.0.0", "--port", "8001"]`: Launches Uvicorn server on startup.
- **Connections**: References `requirements.txt` and `FastAPI/main.py`.
- **Self-Check Question**: *Which command launches the server inside the Docker container?*

---

### 5. `backend/.env.example` & `backend/.env`
- **File Name & Path**: [`backend/.env.example`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/.env.example) & [`backend/.env`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/.env)
- **Chronological Creation Order**: **Step 5 (Secrets Management)**. Created to store environment configuration variables securely.
- **Core Purpose**: Defines environment keys such as `DATABASE_URL`, `JWT_SECRET_KEY`, `GOOGLE_CLIENT_ID`, and CORS configurations.
- **Detailed Line-by-Line / Block Explanation**:
  - `DATABASE_URL=sqlite:///./jod_events.db`: Database connection string (defaults to SQLite, supports PostgreSQL).
  - `SECRET_KEY=...`: Secret key used for signing JWT authentication tokens.
  - `ALGORITHM=HS256`: JWT cryptographic algorithm.
  - `ACCESS_TOKEN_EXPIRE_MINUTES=4320`: Token expiration window.
- **Connections**: Read by `Models/base.py`, `Authentication/jwt_handler.py`, and `APIs/auth.py`.
- **Self-Check Question**: *Why is `.env.example` committed to Git while `.env` is ignored?*

---

### 6. `backend/requirements.txt`
- **File Name & Path**: [`backend/requirements.txt`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/requirements.txt)
- **Chronological Creation Order**: **Step 6 (Backend Dependencies)**. Created to pin backend python dependencies.
- **Core Purpose**: Specifies Python packages required by FastAPI (FastAPI, Uvicorn, SQLAlchemy, PyJWT, Passlib, Pydantic, HTTPX, etc.).
- **Detailed Line-by-Line / Block Explanation**:
  - `fastapi`: High-performance ASGI web framework.
  - `uvicorn`: Lightning-fast ASGI server implementation.
  - `sqlalchemy`: Python SQL toolkit and Object Relational Mapper (ORM).
  - `passlib[bcrypt]`: Password hashing algorithms.
  - `pyjwt`: JSON Web Token generation and validation.
- **Connections**: Required by `Dockerfile` and local virtual environment setup scripts.
- **Self-Check Question**: *Which package handles password hashing in `requirements.txt`?*

---

### 7. `backend/start_servers.py`
- **File Name & Path**: [`backend/start_servers.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/start_servers.py)
- **Chronological Creation Order**: **Step 7 (Local Launcher)**. Created to run both backend and frontend servers simultaneously on Windows without console encoding crashes.
- **Core Purpose**: Spawns FastAPI on port 8001 and HTTP static server on port 5500 as background subprocesses, redirecting logs to UTF-8 files (`backend.log` & `frontend.log`).
- **Detailed Line-by-Line / Block Explanation**:
  - `launch(cmd, cwd, logfile)`: Subprocess launcher function with UTF-8 stream wrapping.
  - Spawns Uvicorn (`FastAPI.main:app`) on port 8001.
  - Spawns Python `http.server 5500` serving `frontend/`.
- **Connections**: Launches `FastAPI/main.py` and serves `frontend/index.html`.
- **Self-Check Question**: *What problem does `start_servers.py` solve on Windows systems?*

---

# Part 2: Database Models & ORM

### 8. `backend/Models/base.py`
- **File Name & Path**: [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py)
- **Chronological Creation Order**: **Step 8 (Database Infrastructure)**. Created to set up SQLAlchemy engine, session maker, base model, and auto-seeding routines.
- **Core Purpose**: Establishes database connection pooling, handles cross-database UUID compatibility (SQLite vs PostgreSQL), creates tables automatically, and seeds mock initial events and accounts.
- **Detailed Line-by-Line / Block Explanation**:
  - `engine = create_engine(DATABASE_URL, ...)`: Initializes database engine.
  - `SessionLocal = sessionmaker(...)`: Generates database sessions.
  - `Base = declarative_base()`: ORM base class.
  - `GUID`: Custom TypeDecorator that stores UUIDs natively in PostgreSQL or as CHAR(36) in SQLite.
  - `init_db()`: Automatically creates missing tables and seeds initial mock data (Users, Events, Bookings).
- **Connections**: Base class for `user.py`, `event.py`, `booking.py`. Imported by `dependencies.py` and `FastAPI/main.py`.
- **Self-Check Question**: *How does `GUID` ensure database portability between SQLite and PostgreSQL?*

---

### 9. `backend/Models/user.py`
- **File Name & Path**: [`backend/Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py)
- **Chronological Creation Order**: **Step 9 (User Model)**. Defines user database schema.
- **Core Purpose**: Represents registered user accounts, organizers, and guest profiles in the system.
- **Detailed Line-by-Line / Block Explanation**:
  - `id`: Primary key UUID.
  - `customer_id`: Unique human-readable customer ID (e.g. `CUST-JOD-881923`).
  - `username`, `email`: Unique login credentials.
  - `hashed_password`: Bcrypt password hash.
  - `city`, `avatar_url`, `bio`: Profile customization attributes.
  - `bookings = relationship("Booking", ...)`: One-to-many relationship with bookings.
- **Connections**: Linked to `Booking` model and used by `Services/auth_service.py` and `APIs/auth.py`.
- **Self-Check Question**: *What is the purpose of the `customer_id` field in `User`?*

---

### 10. `backend/Models/event.py`
- **File Name & Path**: [`backend/Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py)
- **Chronological Creation Order**: **Step 10 (Event Model)**. Defines event schema.
- **Core Purpose**: Represents single and recurring events, conferences, workshops, comedy shows, and festivals.
- **Detailed Line-by-Line / Block Explanation**:
  - `id`: Primary key UUID.
  - `title`, `description`, `category`: Core metadata.
  - `venue`, `location`, `latitude`, `longitude`: Geospatial location data.
  - `start_date`, `end_date`: Event scheduling.
  - `price`, `event_format` ("In-person", "Online", "Hybrid"): Pricing and access model.
  - `performers`, `highlights`, `ticket_types`, `terms`: JSON storage for complex structures.
- **Connections**: Referenced by `Booking` model, `Services/event_service.py`, `APIs/events.py`, and `category.js`.
- **Self-Check Question**: *Which column stores event format like 'In-person' or 'Online'?*

---

### 11. `backend/Models/booking.py`
- **File Name & Path**: [`backend/Models/booking.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/booking.py)
- **Chronological Creation Order**: **Step 11 (Booking Model)**. Defines ticket bookings and orders.
- **Core Purpose**: Stores ticket registration records, payment metadata, receiver info, seat assignments, and cancellation status.
- **Detailed Line-by-Line / Block Explanation**:
  - `booking_id`: Primary key UUID.
  - `customer_id`: Foreign key referencing `users.customer_id`.
  - `event_id`: Foreign key referencing `events.id`.
  - `ticket_type`, `quantity`, `total_price`: Purchase details.
  - `status`: `"CONFIRMED"` or `"CANCELLED"`.
  - `payment_id`, `payment_mode`, `gst_amount`: Financial & tax auditing metadata.
  - `seat_number`: Assigned seating string.
  - `receiver_name`, `receiver_email`, `receiver_phone`: Ticket attendee contact info.
- **Connections**: Foreign key relationships to `User` and `Event`. Managed by `APIs/bookings.py` and `ticket-details.js`.
- **Self-Check Question**: *Which field indicates whether a booking is active or cancelled?*

---

# Part 3: FastAPI Backend Services & Endpoints

### 12. `backend/Services/auth_service.py`
- **File Name & Path**: [`backend/Services/auth_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/auth_service.py)
- **Chronological Creation Order**: **Step 12 (Auth Service)**. Created for password hashing and user validation business logic.
- **Core Purpose**: Encapsulates password hashing routines (`bcrypt`) and credential validation logic.
- **Detailed Line-by-Line / Block Explanation**:
  - `verify_password(plain, hashed)`: Compares raw password with Bcrypt hash.
  - `get_password_hash(password)`: Hashes new passwords before database insertion.
- **Connections**: Depended on by `APIs/auth.py`.
- **Self-Check Question**: *Why are raw passwords never stored in the database?*

---

### 13. `backend/Services/geo_service.py`
- **File Name & Path**: [`backend/Services/geo_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/geo_service.py)
- **Chronological Creation Order**: **Step 13 (Geospatial Service)**. Created to calculate real-world distance between users and event venues.
- **Core Purpose**: Computes distance in kilometers using the Haversine formula and filters nearby events.
- **Detailed Line-by-Line / Block Explanation**:
  - `haversine_distance(lat1, lon1, lat2, lon2)`: Calculates spherical distance between two lat/lon points on Earth.
  - `filter_by_radius(events, user_lat, user_lon, radius_km)`: Filters and sorts events within radius_km.
- **Connections**: Used by `APIs/events.py` and `APIs/location.py`.
- **Self-Check Question**: *What mathematical formula is used in `geo_service.py` to compute distance on Earth?*

---

### 14. `backend/Services/event_service.py`
- **File Name & Path**: [`backend/Services/event_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/event_service.py)
- **Chronological Creation Order**: **Step 14 (Event Service)**. Manages database queries for event listing, filtering, search, and CRUD.
- **Core Purpose**: Provides database querying algorithms for filtering events by category, format, min/max price, date range, and keyword search.
- **Detailed Line-by-Line / Block Explanation**:
  - `list_events(db, skip, limit, category, event_format, min_price, max_price, date_filter, location)`: Multi-column filter query builder.
  - `search_events(db, query_str, limit)`: Performs fuzzy search across title, venue, category, host, and month.
- **Connections**: Depended on by `APIs/events.py` and `APIs/location.py`.
- **Self-Check Question**: *Which function performs multi-column filtering in `event_service.py`?*

---

### 15. `backend/Authentication/jwt_handler.py`
- **File Name & Path**: [`backend/Authentication/jwt_handler.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/jwt_handler.py)
- **Chronological Creation Order**: **Step 15 (JWT Utilities)**. Handles creation and decoding of JSON Web Tokens.
- **Core Purpose**: Encodes payload claims into signed JWT tokens and validates incoming JWT tokens.
- **Detailed Line-by-Line / Block Explanation**:
  - `create_access_token(data, expires_delta)`: Creates signed JWT string.
  - `decode_access_token(token)`: Decodes and verifies token signature and expiration.
- **Connections**: Used by `APIs/auth.py` and `Authentication/dependencies.py`.
- **Self-Check Question**: *What happens if an expired JWT token is passed to `decode_access_token`?*

---

### 16. `backend/Authentication/dependencies.py`
- **File Name & Path**: [`backend/Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py)
- **Chronological Creation Order**: **Step 16 (FastAPI Auth Dependency)**. Protects routes requiring authentication.
- **Core Purpose**: Extracts Bearer token from incoming request HTTP headers, decodes JWT, and returns authenticated `User` database model instance.
- **Detailed Line-by-Line / Block Explanation**:
  - `get_current_user(db, token)`: Decodes Authorization header, verifies user existence in database, and raises HTTP 401 if unauthorized.
- **Connections**: Imported by protected routes in `APIs/auth.py`, `APIs/events.py`, `APIs/bookings.py`, `APIs/users.py`.
- **Self-Check Question**: *What HTTP status code is returned if an unauthenticated user calls a protected route?*

---

### 17. `backend/AI/recommendations.py`
- **File Name & Path**: [`backend/AI/recommendations.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/AI/recommendations.py)
- **Chronological Creation Order**: **Step 17 (Recommendation Service)**. Generates personalized event suggestions.
- **Core Purpose**: Computes similarity scores based on user city, location coordinates, and past booking categories to recommend events.
- **Detailed Line-by-Line / Block Explanation**:
  - `get_recommendations_for_user(db, user, limit)`: Ranks published events according to user preference matching scores.
- **Connections**: Depended on by `APIs/events.py` and `APIs/users.py`.
- **Self-Check Question**: *What factors are used to compute event recommendation scores?*

---

### 18. `backend/APIs/auth.py`
- **File Name & Path**: [`backend/APIs/auth.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/auth.py)
- **Chronological Creation Order**: **Step 18 (Auth API Routes)**. Implements registration, login, logout, and token refresh routes.
- **Core Purpose**: Exposes user authentication endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/google`, `GET /api/auth/me`.
- **Detailed Line-by-Line / Block Explanation**:
  - `register_user`: Validates input, hashes password, assigns unique `customer_id`, creates user, and returns JWT.
  - `login_user`: Authenticates credentials against database and issues JWT access token.
  - `google_auth`: Authenticates Google OAuth ID tokens and auto-provisions user accounts.
  - `get_me`: Returns profile details for currently authenticated user.
- **Connections**: Consumed by `frontend/js/auth.js`.
- **Self-Check Question**: *Which endpoint returns profile details for the currently logged-in user?*

---

### 19. `backend/APIs/events.py`
- **File Name & Path**: [`backend/APIs/events.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/events.py)
- **Chronological Creation Order**: **Step 19 (Events API Routes)**. Exposes event endpoints.
- **Core Purpose**: Handles GET `/api/events/`, GET `/api/events/search`, GET `/api/events/nearby`, GET `/api/events/{event_id}`, and CRUD routes.
- **Detailed Line-by-Line / Block Explanation**:
  - `get_events`: Exposes filtering query parameters (`category`, `event_format`, `min_price`, `max_price`, `date_filter`, `location`).
  - `search_events_endpoint`: Real-time debounced query search.
  - `get_nearby_events`: Haversine location radius filtering.
- **Connections**: Consumed by `script.js`, `search.js`, `category.js`, `location.js`.
- **Self-Check Question**: *What route handles geospatial nearby event searches?*

---

### 20. `backend/APIs/bookings.py`
- **File Name & Path**: [`backend/APIs/bookings.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/bookings.py)
- **Chronological Creation Order**: **Step 20 (Bookings API Routes)**. Handles ticket booking creation, retrieval, and cancellation.
- **Core Purpose**: Exposes `POST /api/bookings/`, `GET /api/bookings/my-bookings`, `GET /api/bookings/{booking_id}`, `POST /api/bookings/{booking_id}/cancel`, `GET /api/bookings/host/tracking`.
- **Detailed Line-by-Line / Block Explanation**:
  - `create_ticket_booking`: Creates booking record with customer ID, payment ID, GST calculation, seat number, and receiver details.
  - `get_my_bookings`: Returns list of bookings for current user.
  - `get_single_booking`: Returns itemized ticket details for specific booking ID.
  - `cancel_booking`: Updates ticket status to `"CANCELLED"` in database.
- **Connections**: Consumed by `event-details.js`, `orders.html`, `ticket-details.js`.
- **Self-Check Question**: *Which route cancels a ticket booking by ID?*

---

### 21. `backend/APIs/location.py`
- **File Name & Path**: [`backend/APIs/location.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/location.py)
- **Chronological Creation Order**: **Step 21 (Location API Routes)**. City lookup & location recommendations endpoint.
- **Core Purpose**: Accepts city name or lat/lon coordinates and returns matching local events and city recommendations.
- **Detailed Line-by-Line / Block Explanation**:
  - `GET /api/location/city`: Geocodes city names and fetches nearby event recommendations.
- **Connections**: Consumed by `frontend/js/location.js`.
- **Self-Check Question**: *Which API route handles city-based location recommendations?*

---

### 22. `backend/APIs/users.py`
- **File Name & Path**: [`backend/APIs/users.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/users.py)
- **Chronological Creation Order**: **Step 22 (User Profile API Routes)**. Profile updating and avatar upload endpoint.
- **Core Purpose**: Exposes `PUT /api/users/me` for updating profile information, city, bio, and cropping avatar images.
- **Detailed Line-by-Line / Block Explanation**:
  - `update_profile`: Updates profile fields on the authenticated user model.
- **Connections**: Consumed by `frontend/js/profile.js`.
- **Self-Check Question**: *Which HTTP method is used to update user profile information?*

---

### 23. `backend/FastAPI/main.py`
- **File Name & Path**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py)
- **Chronological Creation Order**: **Step 23 (FastAPI Application Entry Point)**. Main backend assembly file.
- **Core Purpose**: Initializes FastAPI application instance, registers CORS middleware, includes API routers, sets up Jinja2 templates, and runs database auto-initialization on startup.
- **Detailed Line-by-Line / Block Explanation**:
  - `app = FastAPI(...)`: Initializes FastAPI framework instance.
  - `app.add_middleware(CORSMiddleware, ...)`: Enables Cross-Origin Resource Sharing for frontend requests.
  - `app.include_router(...)`: Mounts routers from `APIs/auth.py`, `events.py`, `bookings.py`, `location.py`, `users.py`.
  - `@app.on_event("startup")`: Triggers database auto-creation and seeding (`init_db()`).
- **Connections**: Core backend entry point launched by Uvicorn.
- **Self-Check Question**: *Why is CORS middleware necessary in `FastAPI/main.py`?*

---

### 24–26. Backend Templates (`event_details.html`, `events_list.html`, `makeup_boutique_workshop.html`)
- **File Name & Path**: [`backend/templates/event_details.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/templates/event_details.html), [`events_list.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/templates/events_list.html), [`makeup_boutique_workshop.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/templates/makeup_boutique_workshop.html)
- **Chronological Creation Order**: **Step 24 (SSR Templates)**. Server-side rendering fallback templates.
- **Core Purpose**: Provides server-side rendered HTML templates using Jinja2 engine for fallback or SEO rendering.
- **Connections**: Rendered by FastAPI template response routes.

---

### 27–37. Backend Test Suite Scripts
- **File Names & Paths**:
  - [`test_customer_id_booking.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_customer_id_booking.py)
  - [`test_google_auth.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_google_auth.py)
  - [`test_health_and_retry.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_health_and_retry.py)
  - [`test_location_feature.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_location_feature.py)
  - [`test_location_persistence.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_location_persistence.py)
  - [`test_login_persistence.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_login_persistence.py)
  - [`test_profile_location_feature.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_profile_location_feature.py)
  - [`test_search_functionality.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_search_functionality.py)
  - [`test_live_trending_guest_modal.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_live_trending_guest_modal.py)
  - [`test_category_flow.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_category_flow.py)
  - [`test_ticket_view_and_persistence.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_ticket_view_and_persistence.py)
- **Chronological Creation Order**: Created incrementally alongside each major feature build.
- **Core Purpose**: Automated verification scripts that test backend APIs, database models, and frontend integration integrity.

---

# Part 4: Frontend HTML Components & Pages

### 38. `frontend/components/header.html`
- **File Name & Path**: [`frontend/components/header.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/components/header.html)
- **Chronological Creation Order**: **Step 38 (Header Component)**. Reusable navigation header component.
- **Core Purpose**: Contains brand logo, global search input (`#globalSearchInput`), location selector button (`#locationBtn`), navigation links, and login/signup auth buttons.
- **Connections**: Dynamically loaded into pages via `include.js`.
- **Self-Check Question**: *How is `header.html` included across multiple HTML pages?*

---

### 39. `frontend/components/footer.html`
- **File Name & Path**: [`frontend/components/footer.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/components/footer.html)
- **Chronological Creation Order**: **Step 39 (Footer Component)**. Reusable footer component.
- **Core Purpose**: Contains brand information, quick links, category links, social media links, and copyright footer notices.
- **Connections**: Dynamically loaded into pages via `include.js`.

---

### 40. `frontend/index.html`
- **File Name & Path**: [`frontend/index.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/index.html)
- **Chronological Creation Order**: **Step 40 (Home Page)**. Main platform landing page.
- **Core Purpose**: Displays hero section, interactive animated background canvas, "Live Trending Events" carousel (with guest auth pop-up modal interceptor), Category Carousel, location recommendation banner, and customer testimonials.
- **Connections**: Loads all CSS files and JS controller scripts (`script.js`, `auth.js`, `location.js`, `search.js`).
- **Self-Check Question**: *What happens when a guest user clicks an event card in the Live Trending Events section?*

---

### 41. `frontend/category.html`
- **File Name & Path**: [`frontend/category.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/category.html)
- **Chronological Creation Order**: **Step 41 (Category Listing Page)**. BookMyShow style category event listing page.
- **Core Purpose**: Displays sub-topic horizontal pill chips bar, dynamic top category title ("Workshops In Chennai"), left sidebar filters (Categories, Date, Format, Price), active tags summary, and responsive event cards grid.
- **Connections**: Controlled by `frontend/js/category.js` and styled by `frontend/css/category.css`.
- **Self-Check Question**: *Which file controls the filtering logic on `category.html`?*

---

### 42. `frontend/event-details.html`
- **File Name & Path**: [`frontend/event-details.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/event-details.html)
- **Chronological Creation Order**: **Step 42 (Event Details Page)**. Individual event landing and ticket selection page.
- **Core Purpose**: Displays event hero banner, category-specific theme badges, ticket selection options, performer roster, event highlights, terms, and primary "Book Now" CTA.
- **Connections**: Controlled by `frontend/js/event-details.js` and styled by `frontend/css/event-details.css`.
- **Self-Check Question**: *Which script handles ticket booking dialog trigger on `event-details.html`?*

---

### 43. `frontend/makeup-boutique-workshop.html`
- **File Name & Path**: [`frontend/makeup-boutique-workshop.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/makeup-boutique-workshop.html)
- **Chronological Creation Order**: **Step 43 (Workshop Custom Landing Page)**. Dedicated custom landing page for Workshop events.
- **Core Purpose**: Specialized event page with masterclass instructor bios, beauty glam highlights, ticket breakdown options, and mobile sticky booking bar.
- **Connections**: Uses `event-details.js` for ticket purchasing logic.

---

### 44. `frontend/ticket-details.html`
- **File Name & Path**: [`frontend/ticket-details.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/ticket-details.html)
- **Chronological Creation Order**: **Step 44 (Ticket Viewing & Invoice Page)**. Dedicated ticket view page.
- **Core Purpose**: Displays confirmed/cancelled status badge, Order ID `#JOD-XXXXXX`, event header info, ticket details (ID, seat, category, count, booked timestamp), bill summary (price, qty, payment ID, payment mode, 18% GST, total), receiver details, entry validation QR code, and bottom action buttons ("Download Ticket", "Download Invoice", "Cancel Ticket").
- **Connections**: Controlled by `frontend/js/ticket-details.js` and styled by `frontend/css/ticket-details.css`.
- **Self-Check Question**: *What extra options are provided at the bottom of `ticket-details.html`?*

---

### 45. `frontend/orders.html`
- **File Name & Path**: [`frontend/orders.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/orders.html)
- **Chronological Creation Order**: **Step 45 (Orders & Bookings Dashboard)**. Customer order list page.
- **Core Purpose**: Displays list of user's past and upcoming event ticket orders with dual-cache persistence (`localStorage` + FastAPI `/api/bookings/my-bookings`). Clicking any card opens `ticket-details.html?id=...`.
- **Connections**: Interacts with `auth.js` and opens `ticket-details.html`.

---

### 46. `frontend/dashboard.html`
- **File Name & Path**: [`frontend/dashboard.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/dashboard.html)
- **Chronological Creation Order**: **Step 46 (User Dashboard)**. User account hub.
- **Core Purpose**: Displays user profile avatar, account statistics, quick navigation shortcuts, upcoming ticket preview cards, and host event tracking analytics.
- **Connections**: Controlled by `frontend/js/profile.js`.

---

### 47. `frontend/settings.html`
- **File Name & Path**: [`frontend/settings.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/settings.html)
- **Chronological Creation Order**: **Step 47 (Account Settings Page)**. Profile editing and preference configuration.
- **Core Purpose**: Allows users to edit full name, email, city, bio, upload & crop profile picture (canvas modal), update security passwords, and toggle notification preferences.
- **Connections**: Uses `frontend/js/profile.js`.

---

### 48–49. `login.html` & `signup.html`
- **File Names & Paths**: [`frontend/login.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/login.html) & [`frontend/signup.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/signup.html)
- **Chronological Creation Order**: **Step 48 (Authentication Pages)**. User sign-in and registration pages.
- **Core Purpose**: Split-screen auth layout providing username/email login, registration forms with password strength meters, and Google OAuth buttons. Supports return URL redirects (`?redirect=...`).
- **Connections**: Controlled by `frontend/js/auth.js` and styled by `frontend/css/auth.css`.

---

### 50–56. Platform Pages (`about.html`, `services.html`, `help.html`, `wishlist.html`, `privacy-policy.html`, `terms-and-conditions.html`, `return-and-refund-policy.html`)
- **File Names & Paths**: Additional content pages providing company overview, services showcase, FAQ help center, saved wishlist items, and legal policy documentation.

---

# Part 5: Frontend Stylesheets (CSS)

### 57. `frontend/css/style.css`
- **File Name & Path**: [`frontend/css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css)
- **Chronological Creation Order**: **Step 57 (Core Design System)**. Primary master stylesheet.
- **Core Purpose**: Defines CSS custom properties (`:root` color tokens, typography, shadows, gradients), reset rules, container grid layouts, button variants, header/footer styles, splash screen, location toast, and guest auth modal pop-up rules.
- **Connections**: Loaded on every HTML page.

---

### 58. `frontend/css/responsive.css`
- **File Name & Path**: [`frontend/css/responsive.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/responsive.css)
- **Chronological Creation Order**: **Step 58 (Responsive Layout Rules)**. Media queries stylesheet.
- **Core Purpose**: Enforces fluid responsive layouts across mobile, tablet, and desktop viewports (`@media (max-width: 900px)`, `@media (max-width: 520px)`).

---

### 59. `frontend/css/auth.css`
- **File Name & Path**: [`frontend/css/auth.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/auth.css)
- **Chronological Creation Order**: **Step 59 (Auth Page Styles)**. Split-screen auth layout styling.
- **Core Purpose**: Styles left brand panel glowing orbs, right form panel input floating labels, strength meters, and social login buttons on `login.html` and `signup.html`.

---

### 60. `frontend/css/event-details.css`
- **File Name & Path**: [`frontend/css/event-details.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/event-details.css)
- **Chronological Creation Order**: **Step 60 (Event Details Theme Styles)**. Category-specific visual theme rules.
- **Core Purpose**: Dynamic theme classes (`category-theme-corporate`, `category-theme-launch`, `category-theme-wedding`, `category-theme-workshop`, `category-theme-festival`, `category-theme-comedy`) that re-skin event details pages based on category.

---

### 61. `frontend/css/category.css`
- **File Name & Path**: [`frontend/css/category.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/category.css)
- **Chronological Creation Order**: **Step 61 (Category Listing Styles)**. BookMyShow layout styling.
- **Core Purpose**: Styles sub-topic horizontal pill chips bar, left sidebar filter cards, active filter tags, date overlay badges, format tags, and poster event card hover float animations on `category.html`.

---

### 62. `frontend/css/ticket-details.css`
- **File Name & Path**: [`frontend/css/ticket-details.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/ticket-details.css)
- **Chronological Creation Order**: **Step 62 (Ticket View & Print Styles)**. Ticket details layout and print styling.
- **Core Purpose**: Styles ticket header, status badges (`CONFIRMED` / `CANCELLED`), bill summary table, receiver info grid, QR code frame, and includes `@media print` rules for clean PDF/paper ticket printing.

---

# Part 6: Frontend JavaScript Controllers & Modules

### 63. `frontend/js/include.js`
- **File Name & Path**: [`frontend/js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js)
- **Chronological Creation Order**: **Step 63 (Component Loader)**. Asynchronous component loader.
- **Core Purpose**: Dynamically fetches and inserts `components/header.html` and `components/footer.html`, marks active nav links, and tracks return URLs for login redirects.
- **Connections**: Loaded first on every HTML page.

---

### 64. `frontend/js/health.js`
- **File Name & Path**: [`frontend/js/health.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/health.js)
- **Chronological Creation Order**: **Step 64 (Backend Health & Retry Helper)**. Backend connectivity supervisor.
- **Core Purpose**: Monitors FastAPI backend availability, provides exponential backoff reconnection retries, and displays user-friendly connection banners if backend is offline.
- **Connections**: Used by `auth.js` and `event-details.js`.

---

### 65. `frontend/js/auth.js`
- **File Name & Path**: [`frontend/js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js)
- **Chronological Creation Order**: **Step 65 (Client Auth Module)**. Global authentication controller.
- **Core Purpose**: Manages access tokens (`jod_access_token`), user profile storage (`jod_user`), token validation (`/api/auth/me`), login/registration form submission, Google OAuth flow, and session logout.
- **Connections**: Exposes `window.JodAuth`.

---

### 66. `frontend/js/profile.js`
- **File Name & Path**: [`frontend/js/profile.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/profile.js)
- **Chronological Creation Order**: **Step 66 (User Profile & Avatar Controller)**. User profile and avatar editor.
- **Core Purpose**: Renders header avatar profile dropdown widget, handles profile settings form submission, and manages HTML canvas image cropper modal for avatar picture uploads.
- **Connections**: Exposes `window.JodProfile`.

---

### 67. `frontend/js/location.js`
- **File Name & Path**: [`frontend/js/location.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/location.js)
- **Chronological Creation Order**: **Step 67 (Geospatial Location Controller)**. GPS geolocator & city selector.
- **Core Purpose**: Obtains browser HTML5 geolocation coordinates (or manual city selection), queries `/api/location/city`, caches city selection (`jod_user_city`), and filters event cards by distance.
- **Connections**: Exposes `window.JodLocation`.

---

### 68. `frontend/js/search.js`
- **File Name & Path**: [`frontend/js/search.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/search.js)
- **Chronological Creation Order**: **Step 68 (Search Controller)**. Header search bar logic.
- **Core Purpose**: Performs debounced real-time query search against `/api/events/search`, groups results into Events, Venues, and Categories, handles keyboard arrow navigation, and directs category clicks to `category.html?name=...`.
- **Connections**: Exposes `window.JodSearch`.

---

### 69. `frontend/js/script.js`
- **File Name & Path**: [`frontend/js/script.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/script.js)
- **Chronological Creation Order**: **Step 69 (Main Page Controller)**. Master frontend UI controller.
- **Core Purpose**: Manages splash screen replay, interactive background canvas particles physics, responsive carousel arrows/touch swiping, countdown timers, FAQ accordions, and Guest Auth Modal click interception for Live Trending Events.
- **Connections**: Loaded on main pages.

---

### 70. `frontend/js/category.js`
- **File Name & Path**: [`frontend/js/category.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/category.js)
- **Chronological Creation Order**: **Step 70 (Category Page Controller)**. Category listing and filter manager.
- **Core Purpose**: Reads URL parameters (`category.html?name=...`), queries `/api/events/?category=...&event_format=...&date_filter=...&min_price=...&max_price=...`, manages filter state (Categories, Dates, Formats, Prices), renders event grid, and handles clicks directing to event detail pages.
- **Connections**: Controls `frontend/category.html`.

---

### 71. `frontend/js/event-details.js`
- **File Name & Path**: [`frontend/js/event-details.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/event-details.js)
- **Chronological Creation Order**: **Step 71 (Event Details Controller)**. Event page theme builder & ticket booking trigger.
- **Core Purpose**: Fetches single event data from `/api/events/{id}`, applies category dynamic visual theme (`category-theme-*`), updates ticket price option selection, and executes `triggerBookingModal()` to POST ticket booking with payment and receiver details to `/api/bookings/`.
- **Connections**: Controls `event-details.html` and `makeup-boutique-workshop.html`.

---

### 72. `frontend/js/ticket-details.js`
- **File Name & Path**: [`frontend/js/ticket-details.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/ticket-details.js)
- **Chronological Creation Order**: **Step 72 (Ticket Viewing Controller)**. Individual ticket & invoice manager.
- **Core Purpose**: Reads booking ID from URL (`ticket-details.html?id=...`), fetches booking details from `/api/bookings/{id}` (or fallback local backup), populates ticket info, bill breakdown, and receiver details, renders QR code validation image, handles ticket/invoice downloads (`window.print()`), and executes ticket cancellation (`POST /api/bookings/{id}/cancel`).
- **Connections**: Controls `frontend/ticket-details.html`.
- **Self-Check Question**: *How does `ticket-details.js` handle ticket cancellation when the user clicks 'Cancel Ticket'?* (Answer: Prompts user confirmation, sends API request to `POST /api/bookings/{id}/cancel`, updates status in database and `localStorage`, and updates the status badge to `CANCELLED`).

---

## Summary Table of Key Routes & File Relationships

| Feature Area | Key Backend File | Key Frontend File | Key API Endpoint | Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | `APIs/auth.py` | `js/auth.js` | `POST /api/auth/login` | Registration, Bcrypt login, JWT issuance, profile check |
| **Event Listing** | `APIs/events.py` | `js/category.js` | `GET /api/events/` | Category, Format, Price, and Date range filtering |
| **Geospatial Location** | `APIs/location.py` | `js/location.js` | `GET /api/location/city` | GPS location lookup and city event recommendations |
| **Search Engine** | `Services/event_service.py` | `js/search.js` | `GET /api/events/search` | Debounced multi-field fuzzy query search |
| **Ticket Bookings** | `APIs/bookings.py` | `js/event-details.js` | `POST /api/bookings/` | Ticket booking creation with customer ID and payment info |
| **Ticket Details** | `APIs/bookings.py` | `js/ticket-details.js` | `GET /api/bookings/{id}` | Itemized ticket breakdown, bill summary, QR validation |
| **Ticket Cancellation**| `APIs/bookings.py` | `js/ticket-details.js` | `POST /api/bookings/{id}/cancel` | Ticket cancellation & status update to CANCELLED |
