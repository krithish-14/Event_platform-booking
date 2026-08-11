# JOD Events Platform — Comprehensive File-by-File Learning Guide

Welcome to the official developer and architecture learning guide for the **JOD Events Platform**. This document provides an exhaustive, file-by-file analysis of the entire codebase.

Every single file in this project is broken down into 6 core learning pillars:
1. **File Name & Path**
2. **Chronological Creation Order**
3. **Core Purpose**
4. **Detailed Line-by-Line / Block Explanation**
5. **Connections (Imports & Dependencies)**
6. **Self-Check Question**

---

# Table of Contents
1. [Section 1: Configuration & Infrastructure Setup](#section-1-configuration--infrastructure-setup)
2. [Section 2: Database Layer & Application Launcher](#section-2-database-layer--application-launcher)
3. [Section 3: FastAPI Backend Services & Endpoints](#section-3-fastapi-backend-services--endpoints)
4. [Section 4: Frontend HTML, CSS & Client JavaScript](#section-4-frontend-html-css--client-javascript)

---

# Section 1: Configuration & Infrastructure Setup

---

### 1. `.gitignore`
- **File Name & Path**: [`.gitignore`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/.gitignore)
- **Chronological Creation Order**: **Step 1 (Project Root Initialization)**. Created alongside repository initialization to prevent committing environment secrets, cache folders, and build artifacts from day one.
- **Core Purpose**: Configures Git to ignore bytecode, virtual environment folders (`.venv`), log files (`backend.log`), SQLite databases (`jod_events.db`), and secret credentials (`.env`). If removed, sensitive API keys, credentials, and bulky local runtime files would be accidentally tracked in version control.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 1–14`: Specifies Python bytecode compiled extensions (`__pycache__/`, `*.pyc`, `*.egg-info`) to ignore.
  - `Lines 16–21`: Specifies local Python virtual environment folders (`venv/`, `.venv/`) to exclude from commits.
  - `Lines 23–29`: Ignores IDE and editor configurations (`.vscode/`, `.idea/`, `*.swp`).
  - `Lines 31–34`: Blocks all `.env` files while explicitly allowing `!.env.example` so new developers have a configuration template.
  - `Lines 36–48`: Prevents log files (`*.log`, `backend.log`), runtime SQLite databases (`*.db`), and test/coverage reports (`htmlcov/`, `.pytest_cache/`) from dirtying the commit history.
- **Connections**:
  - **Imported By**: Git version control engine.
  - **Depends On**: Project file tree layout.
- **Self-Check Question**: *Why is `!.env.example` explicitly prefixed with an exclamation mark (`!`) when `.env*` is ignored?*

---

### 2. `package.json`
- **File Name & Path**: [`package.json`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/package.json)
- **Chronological Creation Order**: **Step 2 (Root Task Launcher)**. Added when configuring standard root npm convenience scripts to start both backend and frontend servers using a single CLI runner.
- **Core Purpose**: Provides npm metadata and CLI script definitions (`npm start`, `npm run dev`) that invoke Python's [`start_servers.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/start_servers.py). If removed, developers running standard `npm start` commands will encounter missing package errors.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 1–5`: Defines application package name (`jod-events-platform`), semantic version (`1.0.0`), and points entry file to `backend/start_servers.py`.
  - `Lines 6–9`: Defines shortcut CLI scripts: `"start": "python backend/start_servers.py"` and `"dev": "python backend/start_servers.py"`.
  - `Lines 10–13`: Metadata tags (keywords, author, MIT license).
- **Connections**:
  - **Imported By**: Node Package Manager (`npm`).
  - **Depends On**: [`backend/start_servers.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/start_servers.py).
- **Self-Check Question**: *What command does `npm run dev` internally execute under this configuration?*

---

### 3. `pyrightconfig.json` (Root)
- **File Name & Path**: [`pyrightconfig.json`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/pyrightconfig.json)
- **Chronological Creation Order**: **Step 3 (Root IDE Type Resolution)**. Created to guide Pyright / VS Code Pylance type checkers when navigating between root-level scripts and the `backend` directory.
- **Core Purpose**: Sets virtual environment path (`venvPath: "backend"`, `venv: ".venv"`) and adds `backend` to `extraPaths`. If removed, IDEs like VS Code will show red squiggly lines on imports like `from Models.user import User`.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 2–3`: Specifies where the `.venv` interpreter folder is located relative to the workspace root.
  - `Lines 4–6`: Adds `backend` directory into python's search path for type resolution.
  - `Lines 7–14`: Configures execution environment roots and extra paths for Pyright context resolution.
- **Connections**:
  - **Imported By**: Pyright, Pylance, VS Code Python Extension.
  - **Depends On**: Location of `backend/.venv`.
- **Self-Check Question**: *Why does Pyright need `extraPaths` set to `"backend"` in a multi-directory repository layout?*

---

### 4. `backend/pyrightconfig.json`
- **File Name & Path**: [`backend/pyrightconfig.json`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/pyrightconfig.json)
- **Chronological Creation Order**: **Step 4 (Backend Subdirectory Type Resolution)**. Added to ensure type checking remains consistent when VS Code opens directly into the `backend` folder.
- **Core Purpose**: Configures local Pyright settings relative to `backend/`. If removed, opening `backend` as an independent workspace folder would cause import resolution warnings.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 1–6`: Configures `extraPaths: ["."]` and `venv: ".venv"` relative to `backend/`.
- **Connections**:
  - **Imported By**: Pyright/Pylance when `backend/` is opened as workspace root.
  - **Depends On**: `backend/.venv`.
- **Self-Check Question**: *How does `backend/pyrightconfig.json` differ in scope from the root `pyrightconfig.json`?*

---

### 5. `backend/requirements.txt`
- **File Name & Path**: [`backend/requirements.txt`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/requirements.txt)
- **Chronological Creation Order**: **Step 5 (Dependency Management)**. Created during backend framework setup to pin production dependencies.
- **Core Purpose**: Specifies Python packages and exact versions needed to run the FastAPI application, database drivers, and JWT auth. If removed, `pip install` cannot automatically build the virtual environment or container images.
- **Detailed Line-by-Line / Block Explanation**:
  - `Line 1`: `fastapi==0.111.0` (Core web framework).
  - `Line 2`: `uvicorn[standard]==0.30.1` (ASGI server).
  - `Line 3`: `sqlalchemy==2.0.31` (Database ORM).
  - `Line 4`: `psycopg[binary]>=3.2.2` (PostgreSQL adapter).
  - `Line 5`: `alembic==1.13.2` (Database migration framework).
  - `Line 6`: `python-jose[cryptography]==3.3.0` (JWT token encoding/decoding).
  - `Line 7`: `passlib[bcrypt]==1.7.4` (Password hashing utilities).
  - `Line 8`: `python-multipart==0.0.9` (Form data parser for OAuth2 login).
  - `Line 9`: `pydantic[email]==2.8.2` (Data validation and email checking).
  - `Line 10`: `pydantic-settings==2.3.4` (Environment settings parsing).
  - `Line 11`: `python-dotenv==1.0.1` (Reads `.env` files).
  - `Line 12`: `httpx==0.27.0` (Async HTTP client for OpenStreetMap reverse/forward geocoding).
- **Connections**:
  - **Imported By**: `pip`, [`backend/Dockerfile`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Dockerfile), deployment scripts.
  - **Depends On**: PyPI packages.
- **Self-Check Question**: *Which package in `requirements.txt` provides the async client used to query OpenStreetMap for reverse geocoding?*

---

### 6. `backend/Dockerfile`
- **File Name & Path**: [`backend/Dockerfile`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Dockerfile)
- **Chronological Creation Order**: **Step 6 (Containerization)**. Authored when preparing the application for containerized deployment (e.g., Docker Compose, Kubernetes, Cloud Run).
- **Core Purpose**: Multi-stage build definition for containerizing the FastAPI service. If removed, automated container build pipelines cannot build isolated production images.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 1–12 (Stage 1 - Builder)`: Uses `python:3.12-slim` to create a virtual environment in `/opt/venv` and installs all dependencies from `requirements.txt`.
  - `Lines 14–24 (Stage 2 - Runtime)`: Copies only the clean `/opt/venv` and application files into a fresh python slim base, reducing final image footprint.
  - `Lines 26–30`: Exposes container port `8000` and sets entrypoint CMD: `uvicorn FastAPI.main:app --host 0.0.0.0 --port 8000`.
- **Connections**:
  - **Imported By**: Docker engine / Podman.
  - **Depends On**: [`backend/requirements.txt`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/requirements.txt), [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
- **Self-Check Question**: *Why does this Dockerfile use a two-stage build instead of installing requirements directly in a single stage?*

---

### 7. `backend/.env.example`
- **File Name & Path**: [`backend/.env.example`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/.env.example)
- **Chronological Creation Order**: **Step 7 (Environment Template)**. Created to provide a safe, sanitized template for environment configuration variables.
- **Core Purpose**: Outlines required environment keys (`DATABASE_URL`, `SECRET_KEY`, `ALLOWED_ORIGINS`). If removed, developers onboarding to the project will lack documentation on what environment variables are needed.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 8`: Template PostgreSQL connection string (`DATABASE_URL`).
  - `Lines 11–13`: Security placeholders (`SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`).
  - `Lines 16–17`: App settings (`DEBUG`, `ALLOWED_ORIGINS`).
- **Connections**:
  - **Imported By**: Developer onboarding process.
  - **Depends On**: `backend/.env`.
- **Self-Check Question**: *Why is `.env.example` safe to commit to version control while `.env` is not?*

---

### 8. `backend/.env`
- **File Name & Path**: [`backend/.env`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/.env)
- **Chronological Creation Order**: **Step 8 (Local Secrets Setup)**. Configured locally on the deployment target machine containing active secret credentials.
- **Core Purpose**: Holds actual secret values (`SECRET_KEY`, PostgreSQL passwords, allowed CORS origins) read at runtime by [`python-dotenv`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/requirements.txt). If removed, the application falls back to default fallback values (or SQLite fallback mode).
- **Detailed Line-by-Line / Block Explanation**:
  - Contains key-value pairs defining database credentials, JWT secret keys, and CORS origin domain whitelist.
- **Connections**:
  - **Imported By**: [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py), [`backend/Authentication/jwt_handler.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/jwt_handler.py), [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: Local server environment settings.
- **Self-Check Question**: *Which function in `python-dotenv` loads this file into `os.environ` on app startup?*

---

# Section 2: Database Layer & Application Launcher

---

### 9. `backend/jod_events.db`
- **File Name & Path**: [`backend/jod_events.db`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/jod_events.db)
- **Chronological Creation Order**: **Step 9 (Database Fallback Store)**. Auto-created on first server startup if a live PostgreSQL database server is unavailable.
- **Core Purpose**: SQLite single-file database storing users, events, and bookings. Ensures zero-downtime developer execution even without a running PostgreSQL instance. If removed, the system simply regenerates it on the next startup.
- **Detailed Line-by-Line / Block Explanation**:
  - Binary SQLite database containing tables: `users` (with `customer_id` column), `events` (with Haversine `latitude`/`longitude`), and `bookings`.
- **Connections**:
  - **Imported By**: SQLite engine fallback in [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py).
  - **Depends On**: SQLAlchemy SQLite engine driver.
- **Self-Check Question**: *What triggers the automatic fallback from PostgreSQL to `jod_events.db`?*

---

### 10. `backend/start_servers.py`
- **File Name & Path**: [`backend/start_servers.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/start_servers.py)
- **Chronological Creation Order**: **Step 10 (Process Orchestrator)**. Authored to solve Windows-specific console encoding crashes (cp1252) and manage dual processes simultaneously.
- **Core Purpose**: Launches FastAPI (Uvicorn on port 8001) and Frontend (Python `http.server` on port 5500) as async background subprocesses, redirecting output logs to `backend.log` and `frontend.log`. If removed, users must manually start backend and frontend in separate terminal windows.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 14–30 (launch function)`: Configures subprocess execution with UTF-8 encoding streams to prevent Windows console encoding crashes.
  - `Lines 40–44`: Launches Uvicorn process for FastAPI (`FastAPI.main:app` on port 8001).
  - `Lines 46–62`: Inline Python HTTP server launch (`http.server.SimpleHTTPRequestHandler` on port 5500).
  - `Lines 70–85 (watch thread)`: Multi-threaded process monitor watching process termination and cleaning up file streams.
  - `Lines 86–101 (main loop)`: Handles Ctrl+C signals gracefully to terminate both subprocesses simultaneously.
- **Connections**:
  - **Imported By**: `npm start`, [`package.json`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/package.json), developer CLI.
  - **Depends On**: Python `subprocess`, `threading`, [`FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
- **Self-Check Question**: *Why does `start_servers.py` launch HTTP server via a custom inline script instead of calling `python -m http.server 5500` directly?*

---

### 11. `backend/Models/base.py`
- **File Name & Path**: [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py)
- **Chronological Creation Order**: **Step 11 (ORM Foundation)**. Created alongside database architecture design to establish the SQLAlchemy Base and connection factory.
- **Core Purpose**: Manages engine creation, database connection pooling, platform-independent `GUID` type handling, auto-migrations, database fallback logic, cross-database sync, and initial demo data seeding. If removed, no models can inherit `Base`, and DB sessions cannot open.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 27–52 (GUID TypeDecorator)`: Translates UUID values to PostgreSQL `UUID` type natively or `CHAR(36)` under SQLite.
  - `Lines 59–96 (_ensure_engine)`: Thread-safe lazy engine initializer. Tries PostgreSQL; if connection fails within 3 seconds, gracefully switches to SQLite `jod_events.db`.
  - `Lines 129–198 (_sync_databases)`: Cross-database user account synchronization, ensuring users created under SQLite exist under PostgreSQL (and vice versa) with valid `customer_id` strings.
  - `Lines 199–311 (_migrate_tables)`: Self-healing auto-migration runner that detects missing table columns (`customer_id`, `latitude`, `longitude`, `performers`, `highlights`) and executes `ALTER TABLE` statements dynamically.
  - `Lines 313–630 (_seed_demo_events)`: Inserts realistic initial events into the database if the `events` table is empty.
  - `Lines 632–643 (create_tables)`: App startup hook initializing models, migrations, DB sync, and demo data.
- **Connections**:
  - **Imported By**: [`backend/Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py), [`backend/Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py), [`backend/Models/booking.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/booking.py), [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: SQLAlchemy, `python-dotenv`, `sqlite3`.
- **Self-Check Question**: *How does the `GUID` custom TypeDecorator handle UUID representation differently between PostgreSQL and SQLite?*

---

### 12. `backend/Models/user.py`
- **File Name & Path**: [`backend/Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py)
- **Chronological Creation Order**: **Step 12 (User Entity Schema)**. Authored when introducing user management, authentication, and location profile fields.
- **Core Purpose**: Defines the SQLAlchemy `User` ORM entity table structure (`users`). Maps authentication credentials, unique `customer_id` (`CUST-<number>`), profile metadata, geolocation attributes (`city`, `location_lat`, `location_lon`), and relationships to events and bookings. If removed, user authentication and profile persistence break.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 16–17`: `generate_customer_id()` helper generating formatted strings like `CUST-482910`.
  - `Lines 21–36`: Primary user columns: `id` (GUID), `customer_id` (Indexed unique string), `email`, `username`, `hashed_password`, `is_active`, `is_admin`.
  - `Lines 37–41`: Location columns: `city`, `location_pincode`, `location_lat`, `location_lon`.
  - `Lines 43–45`: Relationships: `events` (organizer relationship) and `bookings` (customer relationship) with `cascade="all, delete-orphan"`.
- **Connections**:
  - **Imported By**: [`backend/Models/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/__init__.py), [`backend/APIs/auth.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/auth.py), [`backend/APIs/users.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/users.py), [`backend/Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py).
  - **Depends On**: [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py).
- **Self-Check Question**: *Why is `customer_id` indexed and marked unique in the `User` model?*

---

### 13. `backend/Models/event.py`
- **File Name & Path**: [`backend/Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py)
- **Chronological Creation Order**: **Step 13 (Event Entity Schema)**. Created when designing the core event catalog data model.
- **Core Purpose**: Defines the `Event` ORM entity (`events`). Stores title, description, venue, WGS-84 coordinates (`latitude`, `longitude`), price, capacity, performers (JSON string), highlights (JSON string), and FK reference to organizer `User`. If removed, event creation, search, and details pages break.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 16–27`: Basic metadata: `id` (GUID), `title`, `description`, `location`, `venue`, `latitude`, `longitude`, `category`, `image_url`, `start_date`, `end_date`, `price`.
  - `Lines 28–36`: Detailed showcase fields: `capacity`, `event_format`, `duration`, `age_limit`, `language`, `performers`, `highlights`, `ticket_types`, `terms`.
  - `Lines 37–39`: Flags and Foreign Key: `is_published`, `is_cancelled`, `organizer_id` (`ForeignKey("users.id")`).
  - `Lines 43–45`: Relationships: `organizer` (User) and `bookings` (Booking list).
- **Connections**:
  - **Imported By**: [`backend/Models/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/__init__.py), [`backend/Services/event_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/event_service.py), [`backend/APIs/events.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/events.py).
  - **Depends On**: [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py), [`backend/Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py).
- **Self-Check Question**: *How are performers and highlights stored in the database model vs how they are serialized in API responses?*

---

### 14. `backend/Models/booking.py`
- **File Name & Path**: [`backend/Models/booking.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/booking.py)
- **Chronological Creation Order**: **Step 14 (Booking Entity Schema)**. Built when implementing ticket reservations and customer order tracking.
- **Core Purpose**: Maps the `Booking` entity table (`bookings`). Links customer reservations to events using `customer_id` (`ForeignKey("users.customer_id")`) and `event_id` (`ForeignKey("events.id")`). Stores ticket quantity, total price, and status (`CONFIRMED`). If removed, order history and host tracking analytics fail.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 16–23`: Primary columns: `booking_id` (GUID PK), `customer_id` (FK to `users.customer_id`), `event_id` (FK to `events.id`), `ticket_type`, `quantity`, `total_price`, `status`, `booked_at`.
  - `Lines 25–27`: Relationship bindings to `User` (as customer) and `Event`.
- **Connections**:
  - **Imported By**: [`backend/Models/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/__init__.py), [`backend/APIs/bookings.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/bookings.py).
  - **Depends On**: [`backend/Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py), [`backend/Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py), [`backend/Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py).
- **Self-Check Question**: *Why does `Booking` reference `users.customer_id` instead of `users.id` as its Foreign Key?*

---

### 15. `backend/Models/__init__.py`
- **File Name & Path**: [`backend/Models/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/__init__.py)
- **Chronological Creation Order**: **Step 15 (Package Initialization)**. Created to unify model exports across the package.
- **Core Purpose**: Exports `Base`, `User`, `Event`, `Booking` so external packages can cleanly import models via `from Models import User, Event, Booking`. If removed, Python treats `Models` as a un-exportable namespace.
- **Detailed Line-by-Line / Block Explanation**: Re-exports core ORM model symbols.
- **Connections**:
  - **Imported By**: Backend services, routers, test scripts.
  - **Depends On**: `base.py`, `user.py`, `event.py`, `booking.py`.
- **Self-Check Question**: *What is the benefit of defining explicit imports inside `__init__.py` for a Python package?*

---

# Section 3: FastAPI Backend Services & Endpoints

---

### 16. `backend/FastAPI/main.py`
- **File Name & Path**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py)
- **Chronological Creation Order**: **Step 16 (API Gateway)**. Built as the primary application entrypoint assembling routers, CORS middleware, Jinja2 template rendering, and startup events.
- **Core Purpose**: Instantiates `FastAPI()` instance, attaches CORS middleware, mounts API routers (`/api/auth`, `/api/events`, `/api/users`, `/api/location`, `/api/bookings`), and serves dynamic Jinja2 server-side rendered template routes (`/event/{id}`, `/templates/events`). If removed, the API server cannot launch.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 31–40 (lifespan)`: Async context manager invoking `create_tables()` on startup to initialize DB schemas automatically.
  - `Lines 52–65 (CORS Middleware)`: Configures origins based on `ALLOWED_ORIGINS` environment variable, enabling cross-origin requests from frontend on port 5500.
  - `Lines 67–79 (Jinja2 Templates)`: Configures `Jinja2Templates` pointing to `backend/templates` and `frontend`.
  - `Lines 81–87 (Routers)`: Includes all modular endpoint routers with `/api` prefixes.
  - `Lines 115–203 (render_event_details_page)`: Server-side rendering route that queries event data by UUID from PostgreSQL/SQLite, dynamically determines theme palette (`get_category_theme`), parses JSON performers/highlights, and renders `event_details.html`.
  - `Lines 205–250 (get_category_theme)`: Maps event category strings to dynamic UI CSS classes (e.g. `category-theme-corporate`, `category-theme-launch`, `category-theme-workshop`).
- **Connections**:
  - **Imported By**: Uvicorn server, [`backend/start_servers.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/start_servers.py).
  - **Depends On**: All API routers, ORM models, Jinja2 template engine.
- **Self-Check Question**: *What happens in `lifespan` when PostgreSQL is offline during API startup?*

---

### 17. `backend/FastAPI/__init__.py`
- **File Name & Path**: [`backend/FastAPI/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/__init__.py)
- **Chronological Creation Order**: **Step 17 (Module Marker)**. Marks `FastAPI` directory as a importable Python sub-package.
- **Core Purpose**: Enables package imports such as `import FastAPI.main`.
- **Connections**: Package structure marker.
- **Self-Check Question**: *Why is `__init__.py` necessary when referencing `FastAPI.main:app` in Uvicorn command lines?*

---

### 18. `backend/Authentication/jwt_handler.py`
- **File Name & Path**: [`backend/Authentication/jwt_handler.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/jwt_handler.py)
- **Chronological Creation Order**: **Step 18 (JWT Crypto Handler)**. Built to handle low-level JSON Web Token generation and validation.
- **Core Purpose**: Encodes payload dictionaries into signed HS256 JWT strings (`create_access_token`) and decodes token strings back into payload dictionaries (`decode_access_token`). If removed, stateless user authentication cannot function.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 14–16`: Loads `SECRET_KEY`, `ALGORITHM` (HS256), and `ACCESS_TOKEN_EXPIRE_MINUTES` (60 mins) from environment variables.
  - `Lines 19–33 (create_access_token)`: Copies payload dictionary, appends UTC expiration timestamp (`exp`), and signs token with `jose.jwt.encode`.
  - `Lines 36–46 (decode_access_token)`: Decodes and verifies token signature via `jose.jwt.decode`, returning `None` if expired or invalid.
- **Connections**:
  - **Imported By**: [`backend/APIs/auth.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/auth.py), [`backend/Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py).
  - **Depends On**: `python-jose`, `python-dotenv`.
- **Self-Check Question**: *What exception does `decode_access_token` catch to return `None` when a token has been tampered with?*

---

### 19. `backend/Authentication/dependencies.py`
- **File Name & Path**: [`backend/Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py)
- **Chronological Creation Order**: **Step 19 (Auth Middleware Dependency)**. Created to supply reusable dependency injection hooks for protected endpoints.
- **Core Purpose**: Provides `get_current_user` and `get_current_admin` dependencies for FastAPI routes. Extracts HTTP Bearer header, validates JWT claims, and fetches matching active `User` record by `customer_id`. If removed, protected routes cannot verify caller identity.
- **Detailed Line-by-Line / Block Explanation**:
  - `Line 13`: `OAuth2PasswordBearer(tokenUrl="/api/auth/login")` defining OpenAPI security scheme.
  - `Lines 16–52 (get_current_user)`: Extracts bearer token, decodes payload, retrieves `customer_id` claim, queries DB for matching user, checks `is_active`, and returns user instance.
  - `Lines 57–61 (get_current_admin)`: Validates that `current_user.is_admin` is True; throws 403 Forbidden otherwise.
- **Connections**:
  - **Imported By**: Protected API routes in `APIs/auth.py`, `APIs/events.py`, `APIs/bookings.py`, `APIs/location.py`, `APIs/users.py`.
  - **Depends On**: [`jwt_handler.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/jwt_handler.py), [`Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py), [`Models/base.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/base.py).
- **Self-Check Question**: *What HTTP status code is raised when an unauthenticated request attempts to access a protected route?*

---

### 20. `backend/Authentication/__init__.py`
- **File Name & Path**: [`backend/Authentication/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/__init__.py)
- **Chronological Creation Order**: **Step 20 (Authentication Package Marker)**. Enables clean imports from `Authentication`.
- **Core Purpose**: Module exporter for `jwt_handler` and `dependencies`.
- **Connections**: Internal authentication sub-package.
- **Self-Check Question**: *How do sub-packages simplify module imports across API routers?*

---

### 21. `backend/APIs/auth.py`
- **File Name & Path**: [`backend/APIs/auth.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/auth.py)
- **Chronological Creation Order**: **Step 21 (Auth Endpoints)**. Written to manage user registration, authentication login, profile retrieval, and password resets.
- **Core Purpose**: Exposes POST `/api/auth/register`, POST `/api/auth/login`, GET `/api/auth/me`, POST `/api/auth/logout`, and POST `/api/auth/reset-password`. Enforces strict Pydantic input validation on password strength and username formatting. Syncs new users across primary PostgreSQL and secondary SQLite databases.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 28–60 (UserRegisterRequest)`: Pydantic model with class validators enforcing minimum 8 chars password (with numbers + letters) and sanitized username formats.
  - `Lines 99–149 (register)`: Creates new user, hashes password with bcrypt, commits to DB, triggers secondary SQLite sync, generates JWT token containing `customer_id`, and returns `TokenResponse`.
  - `Lines 152–183 (login)`: Authenticates against email or username via `verify_password`. Checks `is_active` status before returning JWT token.
  - `Lines 217–241 (reset_password)`: Updates user password across primary and fallback databases.
- **Connections**:
  - **Imported By**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: [`Services/auth_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/auth_service.py), [`Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py), [`Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py).
- **Self-Check Question**: *Why does the `/login` endpoint allow users to log in with either their email OR their username?*

---

### 22. `backend/APIs/events.py`
- **File Name & Path**: [`backend/APIs/events.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/events.py)
- **Chronological Creation Order**: **Step 22 (Event CRUD Router)**. Implemented to expose event creation, search, discovery, and distance-based recommendation APIs.
- **Core Purpose**: Endpoints for event operations: GET `/api/events/` (list published events), GET `/api/events/search` (real-time query search), GET `/api/events/nearby` (Haversine radius filter), GET `/api/events/{id}` (single event lookup), POST `/api/events/` (create event), PUT `/api/events/{id}` (update event), DELETE `/api/events/{id}`.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 126–154 (_event_to_response)`: Converts SQLAlchemy `Event` models into Pydantic responses, safely parsing JSON strings for performers, highlights, and ticket types.
  - `Lines 157–168 (search_events_endpoint)`: Handles real-time search across title, venue, host, performers, and month names.
  - `Lines 171–185 (get_nearby_events)`: Accepts `lat`, `lon`, and `radius_km` queries, invoking Haversine distance calculator to return sorted nearby events.
  - `Lines 208–246 (CRUD routes)`: Enforces ownership check (`organizer_id == current_user.id` or `is_admin`) before allowing updates or deletions.
- **Connections**:
  - **Imported By**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: [`Services/event_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/event_service.py), [`Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py).
- **Self-Check Question**: *What service function is called when a client queries GET `/api/events/nearby`?*

---

### 23. `backend/APIs/bookings.py`
- **File Name & Path**: [`backend/APIs/bookings.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/bookings.py)
- **Chronological Creation Order**: **Step 23 (Ticket Booking & Analytics Router)**. Developed to handle ticket transactions and organizer tracking.
- **Core Purpose**: Provides POST `/api/bookings/` (book tickets), GET `/api/bookings/my-bookings` (user order history), and GET `/api/bookings/host/tracking` (analytics endpoint returning all bookings grouped with user profile and event details).
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 50–73 (_serialize_booking)`: Serializes booking records with eager-loaded `Booking.event` and `Booking.customer` objects.
  - `Lines 77–116 (create_ticket_booking)`: Binds reservation to `current_user.customer_id`, computes total price, creates `Booking` record, and returns populated object.
  - `Lines 118–131 (get_my_bookings)`: Fetches user bookings filtered by `customer_id` ordered by booking date descending.
  - `Lines 134–148 (get_host_tracking_analytics)`: Host/Admin tracking route returning full audit log of customer bookings.
- **Connections**:
  - **Imported By**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: [`Models/booking.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/booking.py), [`Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py).
- **Self-Check Question**: *Why does `bookings.py` use SQLAlchemy `joinedload` when querying bookings?*

---

### 24. `backend/APIs/location.py`
- **File Name & Path**: [`backend/APIs/location.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/location.py)
- **Chronological Creation Order**: **Step 24 (Geolocation API Router)**. Added to integrate browser Geolocation and OpenStreetMap reverse/forward geocoding.
- **Core Purpose**: Provides POST `/api/location/update/coords` (accepts lat/lon from browser Geolocation API, calls OpenStreetMap Nominatim reverse geocode to resolve city name, and updates user profile) and POST `/api/location/update/manual` (accepts city/pincode, forward geocodes to lat/lon coordinates via Nominatim search).
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 18–22`: Sets OpenStreetMap Nominatim request headers with custom `User-Agent`.
  - `Lines 47–79 (_reverse_geocode)`: Async HTTP request to Nominatim API resolving coordinates to city name and postal code.
  - `Lines 82–126 (_forward_geocode)`: Async HTTP request to Nominatim search API resolving manually typed city names or pincodes to GPS coordinates.
  - `Lines 129–143 (_update_user_location)`: Helper persisting updated `city`, `location_pincode`, `location_lat`, `location_lon` to DB user record.
- **Connections**:
  - **Imported By**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: `httpx`, [`Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py), [`Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py).
- **Self-Check Question**: *What is the difference between reverse geocoding and forward geocoding in `location.py`?*

---

### 25. `backend/APIs/users.py`
- **File Name & Path**: [`backend/APIs/users.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/users.py)
- **Chronological Creation Order**: **Step 25 (User Profile Router)**. Built to allow profile viewing and editing.
- **Core Purpose**: Endpoints for GET `/api/users/me` (current authenticated profile), PUT `/api/users/me` (update full name, city, bio, avatar URL), and GET `/api/users/{identifier}` (public profile lookup by username or customer ID).
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 42–45 (get_my_profile)`: Returns `current_user` profile response.
  - `Lines 48–59 (update_my_profile)`: Applies dynamic attributes update from `payload.model_dump(exclude_unset=True)`.
  - `Lines 62–70 (get_user_by_id_or_username)`: Queries public user details matching username or customer ID.
- **Connections**:
  - **Imported By**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: [`Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py), [`Authentication/dependencies.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Authentication/dependencies.py).
- **Self-Check Question**: *How does `update_my_profile` avoid overwriting fields that were not provided in the request payload?*

---

### 26. `backend/APIs/__init__.py`
- **File Name & Path**: [`backend/APIs/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/__init__.py)
- **Chronological Creation Order**: **Step 26 (APIs Package Marker)**. Package marker for router modules.
- **Core Purpose**: Module exporter for API routers.
- **Connections**: Router package initialization.
- **Self-Check Question**: *Why are API routers isolated into separate files under `APIs/` instead of placing all endpoints inside `main.py`?*

---

### 27. `backend/Services/auth_service.py`
- **File Name & Path**: [`backend/Services/auth_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/auth_service.py)
- **Chronological Creation Order**: **Step 27 (Auth Domain Logic)**. Encapsulates password hashing security operations.
- **Core Purpose**: Handles password hashing via `bcrypt.hashpw` (`get_password_hash`) and verification via `bcrypt.checkpw` (`verify_password`). Safely truncates input strings at 72 bytes to adhere to standard bcrypt limits. If removed, password hashing security breaks.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 11–19 (_to_bytes)`: Encodes UTF-8 strings into bytes and caps at 72 bytes (preventing bcrypt truncation panics).
  - `Lines 22–27 (get_password_hash)`: Generates salt and returns hashed password string.
  - `Lines 30–40 (verify_password)`: Compares candidate plain text against stored hash safely.
- **Connections**:
  - **Imported By**: [`backend/APIs/auth.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/auth.py).
  - **Depends On**: `bcrypt`.
- **Self-Check Question**: *Why does `auth_service.py` truncate password byte strings at 72 bytes before passing them to `bcrypt`?*

---

### 28. `backend/Services/event_service.py`
- **File Name & Path**: [`backend/Services/event_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/event_service.py)
- **Chronological Creation Order**: **Step 28 (Event Business Logic)**. Implemented to centralize event database queries, search matching, and nearby filtering.
- **Core Purpose**: Contains business logic functions for event creation, updates, deletion, category filtering, radius-based Haversine filtering, and intelligent search across title, venue, host name, performers, and month names (`search_events`).
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 16–26 (list_events)`: Returns published non-cancelled events with pagination.
  - `Lines 58–74 (list_nearby_events)`: Queries published events and filters using `filter_by_radius`.
  - `Lines 76–81 (MONTH_MAP)`: Maps month names and abbreviations (`january`, `jan`, `february`, etc.) to integer month numbers (1–12).
  - `Lines 84–129 (search_events)`: Executes SQL `outerjoin` with `User`, matching search queries against title, description, location, venue, category, performers, host `full_name`, or extracted start month.
- **Connections**:
  - **Imported By**: [`backend/APIs/events.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/APIs/events.py), [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: [`Services/geo_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/geo_service.py), [`Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py), [`Models/user.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/user.py).
- **Self-Check Question**: *How does `search_events` support searching for events scheduled in a specific month like "October"?*

---

### 29. `backend/Services/geo_service.py`
- **File Name & Path**: [`backend/Services/geo_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/geo_service.py)
- **Chronological Creation Order**: **Step 29 (Haversine Mathematics Helper)**. Built to calculate great-circle distances between GPS coordinates.
- **Core Purpose**: Provides trigonometric `haversine_km(lat1, lon1, lat2, lon2)` function calculating distance in kilometers between WGS-84 points. Provides `filter_by_radius` to sort objects nearest-first. If removed, distance calculations and radius filtering break.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 13–23 (haversine_km)`: Converts degrees to radians and applies Haversine formula: \(a = \sin^2(\Delta \phi/2) + \cos(\phi_1)\cos(\phi_2)\sin^2(\Delta \lambda/2)\), returning distance using Earth radius \(6371.0\) km.
  - `Lines 37–59 (filter_by_radius)`: Filters list of items with latitude/longitude attributes within `radius_km` and sorts by distance ascending.
- **Connections**:
  - **Imported By**: [`backend/Services/event_service.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/event_service.py).
  - **Depends On**: Python standard `math` module.
- **Self-Check Question**: *What is the Earth radius constant used in `haversine_km`?*

---

### 30. `backend/Services/__init__.py`
- **File Name & Path**: [`backend/Services/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Services/__init__.py)
- **Chronological Creation Order**: **Step 30 (Services Package Marker)**. Package marker for domain services.
- **Core Purpose**: Exposes service modules (`auth_service`, `event_service`, `geo_service`).
- **Connections**: Service layer initialization.
- **Self-Check Question**: *Why is business logic separated into `Services/` rather than embedded directly in API route handlers?*

---

### 31. `backend/AI/recommendations.py`
- **File Name & Path**: [`backend/AI/recommendations.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/AI/recommendations.py)
- **Chronological Creation Order**: **Step 31 (AI Module Stub)**. Added to establish the architecture pattern for future Machine Learning recommendations.
- **Core Purpose**: Stub implementations for `get_recommended_events` (returns published events sorted by recency) and `generate_event_description` (template string generator). Prepared for future OpenAI / Gemini vector embedding integrations.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 21–47`: Stub query returning recent published events.
  - `Lines 50–69`: Template generator for AI event descriptions.
- **Connections**:
  - **Imported By**: Backend recommendation system.
  - **Depends On**: [`Models/event.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/Models/event.py).
- **Self-Check Question**: *How will `get_recommended_events` be upgraded in production to deliver personalized AI recommendations?*

---

### 32. `backend/AI/__init__.py`
- **File Name & Path**: [`backend/AI/__init__.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/AI/__init__.py)
- **Chronological Creation Order**: **Step 32 (AI Package Marker)**. Package marker for AI module.
- **Core Purpose**: Exposes AI recommendations module.
- **Connections**: AI sub-package.
- **Self-Check Question**: *What role does `AI/__init__.py` play in modularizing Machine Learning components?*

---

### 33–39. Backend Automated Verification Scripts
- **File Names & Paths**:
  - [`backend/test_customer_id_booking.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_customer_id_booking.py)
  - [`backend/test_health_and_retry.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_health_and_retry.py)
  - [`backend/test_location_feature.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_location_feature.py)
  - [`backend/test_location_persistence.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_location_persistence.py)
  - [`backend/test_login_persistence.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_login_persistence.py)
  - [`backend/test_profile_location_feature.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_profile_location_feature.py)
  - [`backend/test_search_functionality.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/test_search_functionality.py)
- **Chronological Creation Order**: **Steps 33–39 (Integration Test Suite)**. Authored progressively during feature development to verify backend logic end-to-end.
- **Core Purpose**: Automated test scripts verifying DB schema auto-migrations, customer ID generation, JWT claims validation, ticket booking persistence, location reverse geocoding, user profile updates, and multi-criteria event search.
- **Detailed Line-by-Line / Block Explanation**:
  - Each script connects to the DB session, creates test fixtures, runs assertion checks (`assert u.customer_id.startswith("CUST-")`), and cleans up test data upon completion.
- **Connections**:
  - **Imported By**: Test runner / CI pipelines.
  - **Depends On**: Backend models, services, authentication handler.
- **Self-Check Question**: *What assertion check in `test_customer_id_booking.py` validates that customer IDs conform to the required prefix format?*

---

### 40–42. Backend Jinja2 Server-Side Rendered Templates
- **File Names & Paths**:
  - [`backend/templates/events_list.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/templates/events_list.html)
  - [`backend/templates/event_details.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/templates/event_details.html)
  - [`backend/templates/makeup_boutique_workshop.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/templates/makeup_boutique_workshop.html)
- **Chronological Creation Order**: **Steps 40–42 (SSR Template Infrastructure)**. Authored to support direct server-side HTML rendering alongside API endpoints.
- **Core Purpose**: Jinja2 HTML templates rendered by FastAPI (`TemplateResponse`). `event_details.html` dynamically renders event title, hero category badge, performers list, venue details, and recommended events based on database data passed in context.
- **Detailed Line-by-Line / Block Explanation**:
  - Uses Jinja syntax (`{{ event.title }}`, `{% for p in event.performers %}`, `{% if event.category_theme %}`) to inject server query data directly into final HTML delivered to browsers.
- **Connections**:
  - **Imported By**: [`backend/FastAPI/main.py`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/backend/FastAPI/main.py).
  - **Depends On**: Jinja2 engine, frontend CSS stylesheets.
- **Self-Check Question**: *How does Jinja2 template rendering differ from client-side JavaScript rendering?*

---

# Section 4: Frontend HTML, CSS & Client JavaScript

---

### 43. `frontend/components/header.html`
- **File Name & Path**: [`frontend/components/header.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/components/header.html)
- **Chronological Creation Order**: **Step 43 (Reusable UI Navigation Header)**. Built to maintain consistent top navigation bar across all pages.
- **Core Purpose**: Reusable HTML component containing brand logo, search bar input (`#globalSearchInput`), location selector button (`#locationBtn`), navigation links (Home, Services, About, Wishlist, Orders), and login/signup auth buttons. Injected dynamically into pages by `include.js`.
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 1–15`: Logo image link and location trigger modal button (`#locationBtn`).
  - `Lines 16–25`: Search input field with search button icon (`#globalSearchBtn`).
  - `Lines 26–38`: Nav menu links and user auth action items.
- **Connections**:
  - **Imported By**: [`frontend/js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js) into all HTML pages (`#header` target div).
  - **Depends On**: [`frontend/js/search.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/search.js), [`frontend/js/location.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/location.js), [`frontend/js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *What JavaScript file is responsible for fetching `header.html` and injecting it into the `#header` placeholder tag?*

---

### 44. `frontend/components/footer.html`
- **File Name & Path**: [`frontend/components/footer.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/components/footer.html)
- **Chronological Creation Order**: **Step 44 (Reusable UI Navigation Footer)**. Built for universal page footers.
- **Core Purpose**: Reusable HTML footer containing platform summary, quick links, legal policy links (Privacy Policy, Terms, Refund Policy), social icons, and copyright details.
- **Detailed Line-by-Line / Block Explanation**:
  - Defines footer grid layout, policy anchor links, and copyright text.
- **Connections**:
  - **Imported By**: [`frontend/js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js) into all HTML pages (`#footer` target div).
  - **Depends On**: [`frontend/css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css).
- **Self-Check Question**: *Why are common headers and footers isolated into `components/` files in static HTML projects?*

---

### 45. `frontend/index.html`
- **File Name & Path**: [`frontend/index.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/index.html)
- **Chronological Creation Order**: **Step 45 (Home Page Landing)**. Primary landing page designed for event discovery.
- **Core Purpose**: Main platform landing page showcasing hero banner, interactive category pills (Standup Comedy, Corporate, Launch, Workshop, Festival), 20km radius location recommendations section, upcoming featured events grid, and host CTA banner.
- **Detailed Line-by-Line / Block Explanation**:
  - Injects `#header` and `#footer` dynamic targets.
  - Houses `#locationStatusBanner` displaying current resolved city (e.g. "Showing events near Chennai within 20km").
  - Houses `#eventsGrid` where `script.js` renders event cards dynamically.
- **Connections**:
  - **Imported By**: Browser entry point, HTTP server default.
  - **Depends On**: [`css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css), [`js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js), [`js/script.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/script.js), [`js/location.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/location.js).
- **Self-Check Question**: *Which container ID in `index.html` receives dynamically rendered event cards from `script.js`?*

---

### 46. `frontend/login.html`
- **File Name & Path**: [`frontend/login.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/login.html)
- **Chronological Creation Order**: **Step 46 (Authentication Login Page)**. Created for user sign-in.
- **Core Purpose**: Form view for user authentication. Captures username/email and password, displaying inline error banners and submit spinner.
- **Detailed Line-by-Line / Block Explanation**:
  - Form containing `#loginEmail` and `#loginPassword` inputs bound to `auth.js`.
- **Connections**:
  - **Imported By**: Navigation menu links.
  - **Depends On**: [`css/auth.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/auth.css), [`js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *How does `login.html` redirect users back to their previous page after a successful sign-in?*

---

### 47. `frontend/signup.html`
- **File Name & Path**: [`frontend/signup.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/signup.html)
- **Chronological Creation Order**: **Step 47 (Account Registration Page)**. Built for new user registration.
- **Core Purpose**: Account creation form capturing Full Name, Username, Email, and Password. Displays password strength validation indicators.
- **Detailed Line-by-Line / Block Explanation**:
  - Form inputs `#signupFullName`, `#signupUsername`, `#signupEmail`, `#signupPassword`.
- **Connections**:
  - **Imported By**: Auth header actions.
  - **Depends On**: [`css/auth.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/auth.css), [`js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *What client-side password validations are enforced before submitting `signup.html` to the API?*

---

### 48. `frontend/dashboard.html`
- **File Name & Path**: [`frontend/dashboard.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/dashboard.html)
- **Chronological Creation Order**: **Step 48 (User Profile Dashboard)**. Created for profile management and customer ID lookup.
- **Core Purpose**: Logged-in user hub displaying customer ID badge (`CUST-<number>`), profile editing forms (City, Bio, Avatar), host tracking table, and active bookings.
- **Detailed Line-by-Line / Block Explanation**:
  - Displays user profile summary card and input fields bound to `profile.js`.
- **Connections**:
  - **Imported By**: User avatar menu link.
  - **Depends On**: [`js/profile.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/profile.js), [`js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *What unique identification string is displayed in the dashboard header card?*

---

### 49. `frontend/event-details.html`
- **File Name & Path**: [`frontend/event-details.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/event-details.html)
- **Chronological Creation Order**: **Step 49 (Event Showcase Detail View)**. Built for single event showcase, ticket category selection, and booking modal triggers.
- **Core Purpose**: Detailed event page rendering dynamic category hero themes (Vir Das Standup Comedy, Business Summit, Product Launch, Luxury Wedding, Workshop), performers carousel, event highlights, venue map location, ticket tier selection modal, and booking execution.
- **Detailed Line-by-Line / Block Explanation**:
  - Injects `#eventHero`, `#performersGrid`, `#highlightsGrid`, `#ticketModal`, and `#recommendedGrid`.
- **Connections**:
  - **Imported By**: Event card click handlers across `index.html`.
  - **Depends On**: [`css/event-details.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/event-details.css), [`js/event-details.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/event-details.js).
- **Self-Check Question**: *Which script handles opening the ticket tier booking modal on `event-details.html`?*

---

### 50. `frontend/makeup-boutique-workshop.html`
- **File Name & Path**: [`frontend/makeup-boutique-workshop.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/makeup-boutique-workshop.html)
- **Chronological Creation Order**: **Step 50 (Specialized Workshop Landing Page)**. Authored as a dedicated showcase page for the Makeup & Boutique Masterclass event.
- **Core Purpose**: Dedicated, rich landing experience showcasing hands-on masterclass agenda, instructor profiles, kit details, venue directions, and direct INR 499 ticket booking flow.
- **Detailed Line-by-Line / Block Explanation**: Customized hero banner, workshop schedule breakdown, and instant registration CTA.
- **Connections**:
  - **Imported By**: Category workshop link & featured events list.
  - **Depends On**: [`css/event-details.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/event-details.css), [`js/event-details.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/event-details.js).
- **Self-Check Question**: *Why is `makeup-boutique-workshop.html` given a dedicated static page in addition to generic dynamic event rendering?*

---

### 51. `frontend/orders.html`
- **File Name & Path**: [`frontend/orders.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/orders.html)
- **Chronological Creation Order**: **Step 51 (Customer Order History)**. Built for viewing confirmed ticket reservations.
- **Core Purpose**: Customer order history page fetching `/api/bookings/my-bookings` and rendering order cards with QR code placeables, venue address, ticket quantity, total price, and booking timestamp.
- **Detailed Line-by-Line / Block Explanation**: Houses `#ordersList` container rendered dynamically by `profile.js`.
- **Connections**:
  - **Imported By**: Top navigation menu link.
  - **Depends On**: [`js/profile.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/profile.js), [`js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *Which API endpoint provides the list of confirmed bookings displayed in `orders.html`?*

---

### 52. `frontend/wishlist.html`
- **File Name & Path**: [`frontend/wishlist.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/wishlist.html)
- **Chronological Creation Order**: **Step 52 (Saved Events Wishlist)**. Created for user bookmarking.
- **Core Purpose**: Wishlist page rendering events bookmarked by the user in `localStorage`.
- **Detailed Line-by-Line / Block Explanation**: Houses `#wishlistGrid` populated by `script.js`.
- **Connections**:
  - **Imported By**: Navigation header link.
  - **Depends On**: [`js/script.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/script.js).
- **Self-Check Question**: *Where are user wishlist item IDs stored on the client side?*

---

### 53–58. Static Support & Policy Pages
- **File Names & Paths**:
  - [`frontend/settings.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/settings.html)
  - [`frontend/services.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/services.html)
  - [`frontend/about.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/about.html)
  - [`frontend/help.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/help.html)
  - [`frontend/privacy-policy.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/privacy-policy.html)
  - [`frontend/return-and-refund-policy.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/return-and-refund-policy.html)
  - [`frontend/terms-and-conditions.html`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/terms-and-conditions.html)
- **Chronological Creation Order**: **Steps 53–58 (Information & Compliance Pages)**. Added to complete platform documentation, legal compliance, and customer support.
- **Core Purpose**: Static informational pages covering platform services, hosting guide, support FAQs, privacy compliance, and refund policies.
- **Detailed Line-by-Line / Block Explanation**: Structured HTML content sections styled via `style.css`.
- **Connections**:
  - **Imported By**: Footer links and menu links.
  - **Depends On**: [`css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css), [`js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js).
- **Self-Check Question**: *How does `include.js` highlight active links in the header when a user navigates to `privacy-policy.html`?*

---

### 59. `frontend/css/style.css`
- **File Name & Path**: [`frontend/css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css)
- **Chronological Creation Order**: **Step 59 (Master Global Stylesheet)**. Authored to define the main design system.
- **Core Purpose**: Primary design system defining custom CSS variables (colors, typography, spacing), dark mode glassmorphism styles, Grift custom font-face declarations, header/footer layouts, event card grids, button states, and location banner indicators.
- **Detailed Line-by-Line / Block Explanation**:
  - `@font-face` rules loading custom Grift typography family.
  - `:root` variable definitions (`--bg-primary`, `--accent-color`, `--text-main`, `--glass-bg`, `--card-border`).
  - Core card hover animations (`transform: translateY(-6px)`, `box-shadow` glows).
- **Connections**:
  - **Imported By**: All HTML pages in `<head>`.
  - **Depends On**: [`fonts/`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/fonts) directory custom font assets.
- **Self-Check Question**: *What visual effect is created using `backdrop-filter: blur(12px)` in `style.css`?*

---

### 60. `frontend/css/auth.css`
- **File Name & Path**: [`frontend/css/auth.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/auth.css)
- **Chronological Creation Order**: **Step 60 (Authentication Styling)**. Created specifically for login and signup UI.
- **Core Purpose**: Styles centered glassmorphism authentication cards, form input floating labels, validation error banners, and loading spinners.
- **Detailed Line-by-Line / Block Explanation**: Form field focus borders, input group styling, and auth action button animations.
- **Connections**:
  - **Imported By**: `login.html`, `signup.html`.
  - **Depends On**: [`css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css).
- **Self-Check Question**: *Why are authentication-specific styles isolated into `auth.css`?*

---

### 61. `frontend/css/event-details.css`
- **File Name & Path**: [`frontend/css/event-details.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/event-details.css)
- **Chronological Creation Order**: **Step 61 (Event Details Theme System)**. Authored to style dynamic category themes on event pages.
- **Core Purpose**: Contains dynamic category theme classes (`.category-theme-corporate`, `.category-theme-launch`, `.category-theme-wedding`, `.category-theme-workshop`, `.category-theme-festival`, `.category-theme-comedy`), ticket modal dialogs, performers cards, and highlights showcases.
- **Detailed Line-by-Line / Block Explanation**: Dynamic gradient borders and hero badges customized per event category.
- **Connections**:
  - **Imported By**: `event-details.html`, `makeup-boutique-workshop.html`.
  - **Depends On**: [`css/style.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/style.css).
- **Self-Check Question**: *How does `event-details.css` visually distinguish a Corporate Conference from a Live Comedy event?*

---

### 62. `frontend/css/responsive.css`
- **File Name & Path**: [`frontend/css/responsive.css`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/css/responsive.css)
- **Chronological Creation Order**: **Step 62 (Mobile & Tablet Breakpoints)**. Added to ensure fluid responsiveness across viewports.
- **Core Purpose**: Defines media queries (`@media (max-width: 1024px)`, `@media (max-width: 768px)`, `@media (max-width: 480px)`) adjusting grid columns, mobile navigation drawer toggle, and font scaling.
- **Detailed Line-by-Line / Block Explanation**: Converts multi-column event grids into single-column layouts for mobile phones.
- **Connections**:
  - **Imported By**: All HTML pages.
  - **Depends On**: Main layouts in `style.css`.
- **Self-Check Question**: *At what pixel width breakpoint does the top navigation bar collapse into a mobile menu drawer?*

---

### 63. `frontend/js/include.js`
- **File Name & Path**: [`frontend/js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js)
- **Chronological Creation Order**: **Step 63 (Component Loader)**. Built to inject header and footer components into web pages dynamically.
- **Core Purpose**: Uses `fetch()` to load `components/header.html` and `components/footer.html`, injecting them into `#header` and `#footer` target divs. Updates active link highlights (`.is-active`), saves return URLs for login redirects (`jod_redirect_after_login`), and initializes global search handlers once components are ready (`window.includesReady`).
- **Detailed Line-by-Line / Block Explanation**:
  - `Lines 17–26 (loadComponent)`: Fetches HTML component and replaces target element HTML.
  - `Lines 28–72 (updateNavigation)`: Adjusts links relative to current page and sets `is-active` class on navigation anchors matching active path.
  - `Lines 75–90`: Intercepts clicks on login/signup links, recording current page URL in `sessionStorage` for seamless post-login return.
  - `Lines 98–105`: Exposes `window.includesReady` Promise so dependent scripts know when header elements exist in DOM.
- **Connections**:
  - **Imported By**: All HTML pages.
  - **Depends On**: `components/header.html`, `components/footer.html`, `js/search.js`.
- **Self-Check Question**: *Why do other scripts wait for `window.includesReady` before attaching event listeners to header elements like `#globalSearchInput`?*

---

### 64. `frontend/js/auth.js`
- **File Name & Path**: [`frontend/js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js)
- **Chronological Creation Order**: **Step 64 (Client Auth Manager)**. Developed to manage login, registration, JWT token storage, and session state.
- **Core Purpose**: Handles login (`POST /api/auth/login`) and signup (`POST /api/auth/register`) submissions. Stores JWT access tokens in `localStorage` under `jod_token`, updates header user badge, and handles sign-out.
- **Detailed Line-by-Line / Block Explanation**:
  - Token management helpers (`getToken()`, `setToken()`, `removeToken()`, `getAuthHeaders()`).
  - Submits OAuth2 form data to `/api/auth/login`, saves JWT, and redirects user back to previous page via `sessionStorage.getItem("jod_redirect_after_login")`.
  - Updates navigation bar UI showing user full name / customer ID when authenticated.
- **Connections**:
  - **Imported By**: All HTML pages.
  - **Depends On**: Backend `/api/auth` endpoints, [`js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js).
- **Self-Check Question**: *Under what key name in `localStorage` is the user's JWT bearer token stored?*

---

### 65. `frontend/js/location.js`
- **File Name & Path**: [`frontend/js/location.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/location.js)
- **Chronological Creation Order**: **Step 65 (Client Geolocation & City Resolver)**. Built to request user GPS location and trigger 20km Haversine recommendations.
- **Core Purpose**: Prompts browser Geolocation API (`navigator.geolocation.getCurrentPosition`), sends lat/lon to backend POST `/api/location/update/coords` to resolve city via OpenStreetMap, falls back to manual city/pincode modal if location permission is denied, and updates location status banners across the platform.
- **Detailed Line-by-Line / Block Explanation**:
  - Injects fallback manual location modal HTML into document body.
  - Handles geolocation permission granting, sending coordinates to API.
  - Persists current resolved location in `localStorage` under `jod_user_location`.
  - Dispatches custom `jodLocationUpdated` DOM event to notify `script.js` to refresh nearby event lists.
- **Connections**:
  - **Imported By**: All HTML pages requiring location filtering.
  - **Depends On**: Backend `/api/location` endpoints, OpenStreetMap Nominatim.
- **Self-Check Question**: *What custom DOM event is dispatched by `location.js` when the user's location is successfully updated?*

---

### 66. `frontend/js/script.js`
- **File Name & Path**: [`frontend/js/script.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/script.js)
- **Chronological Creation Order**: **Step 66 (Home Page Event Catalog Controller)**. Developed to fetch and render event cards on `index.html`.
- **Core Purpose**: Fetches events from `/api/events/nearby` (if user location is resolved) or `/api/events/`, renders dynamic event cards with category tags, price badges, and venue addresses, manages category pill filtering, handles wishlist bookmark toggling in `localStorage`, and handles fallback image errors gracefully.
- **Detailed Line-by-Line / Block Explanation**:
  - Listens for `jodLocationUpdated` event to trigger dynamic reloading of nearby events.
  - Renders HTML cards for `#eventsGrid` with formatted dates and distance tags ("4.2 km away").
- **Connections**:
  - **Imported By**: `index.html`, `wishlist.html`.
  - **Depends On**: [`js/location.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/location.js), backend `/api/events` endpoints.
- **Self-Check Question**: *How does `script.js` display distance (e.g. "3.5 km away") on event cards?*

---

### 67. `frontend/js/event-details.js`
- **File Name & Path**: [`frontend/js/event-details.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/event-details.js)
- **Chronological Creation Order**: **Step 67 (Event Showcase & Booking UI Controller)**. Built to handle single event rendering and ticket purchase flows.
- **Core Purpose**: Extracts `id` parameter from URL query string (`?id=...`), fetches detailed event JSON from `/api/events/{id}`, populates hero banner, category badge, performers, highlights, venue address, opens ticket purchase modal, computes total price, and submits ticket bookings to `/api/bookings/`.
- **Detailed Line-by-Line / Block Explanation**:
  - Parses URL parameter `const eventId = new URLSearchParams(window.location.search).get("id")`.
  - Populates ticket tier selection modal, adjusting quantity counters.
  - Submits POST request to `/api/bookings/` with `customer_id` from JWT token.
- **Connections**:
  - **Imported By**: `event-details.html`, `makeup-boutique-workshop.html`.
  - **Depends On**: Backend `/api/events` and `/api/bookings` endpoints, [`js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *What happens when an unauthenticated user clicks "Book Now" inside the ticket modal on `event-details.html`?*

---

### 68. `frontend/js/profile.js`
- **File Name & Path**: [`frontend/js/profile.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/profile.js)
- **Chronological Creation Order**: **Step 68 (Dashboard & Orders Controller)**. Created for dashboard profile updates and customer order rendering.
- **Core Purpose**: Populates user profile fields on `dashboard.html`, handles profile updating via PUT `/api/users/me`, fetches user ticket bookings from `/api/bookings/my-bookings` to populate `orders.html`, and fetches host tracking analytics from `/api/bookings/host/tracking`.
- **Detailed Line-by-Line / Block Explanation**:
  - Renders user `customer_id` prominently in profile view.
  - Generates ticket cards on `orders.html` with status badges (`CONFIRMED`).
- **Connections**:
  - **Imported By**: `dashboard.html`, `orders.html`.
  - **Depends On**: Backend `/api/users` and `/api/bookings` endpoints, [`js/auth.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/auth.js).
- **Self-Check Question**: *Which API call does `profile.js` execute when a user saves changes in `dashboard.html`?*

---

### 69. `frontend/js/search.js`
- **File Name & Path**: [`frontend/js/search.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/search.js)
- **Chronological Creation Order**: **Step 69 (Real-time Omnibox Search Controller)**. Added to power instant live search across the header search bar.
- **Core Purpose**: Attaches debounced input listener to `#globalSearchInput`. Sends search query to GET `/api/events/search?q=...` and renders a live dropdown overlay displaying matching event titles, venues, dates, and performer names.
- **Detailed Line-by-Line / Block Explanation**:
  - Debounces keyup events (300ms delay) to prevent excessive API requests.
  - Dynamically constructs dropdown result list under header search bar.
- **Connections**:
  - **Imported By**: Loaded via [`js/include.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/include.js) across all pages.
  - **Depends On**: Header search elements in `components/header.html`, backend `/api/events/search` endpoint.
- **Self-Check Question**: *Why is debouncing used in `search.js` when listening to input events on `#globalSearchInput`?*

---

### 70. `frontend/js/health.js`
- **File Name & Path**: [`frontend/js/health.js`](file:///c:/Users/satheesh/Desktop/Event_platform-booking/frontend/js/health.js)
- **Chronological Creation Order**: **Step 70 (Backend Connection Diagnostics)**. Built to monitor backend availability and retry connection automatically.
- **Core Purpose**: Checks `/health` endpoint on page load. If the backend server is offline or unreachable, displays a subtle warning toast banner with an automated 5-second polling retry loop.
- **Detailed Line-by-Line / Block Explanation**:
  - Polls `http://127.0.0.1:8001/health` with fetch timeouts.
  - Automatically hides warning banner when backend connection is restored.
- **Connections**:
  - **Imported By**: All HTML pages.
  - **Depends On**: Backend `/health` status endpoint.
- **Self-Check Question**: *What is the interval delay used by `health.js` when retrying connection to an offline backend server?*

---

# Summary & Architecture Overview

The **JOD Events Platform** demonstrates a modern, production-grade web application architecture:
- **Modular FastAPI Backend**: Clean separation between ORM Models, API Routes, Security Middleware, and Business Logic Services.
- **Resilient Dual-Database Architecture**: Primary PostgreSQL engine with zero-config auto-fallback to SQLite (`jod_events.db`), auto-migration checks, and seamless cross-database user synchronization.
- **Geographic Haversine Intelligence**: Distance-based 20km event discovery powered by OpenStreetMap Nominatim reverse/forward geocoding and browser Geolocation APIs.
- **Robust JWT Authentication**: Secure bcrypt password hashing, stateless JWT authorization with unique `customer_id` tracking (`CUST-<number>`).
- **Dynamic Frontend UI**: Rich glassmorphism aesthetics, responsive category color themes, live search omnibox, component inclusion system, and client-side session management.
