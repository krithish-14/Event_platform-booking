# Incident notes: `character = uuid` + go-live checklist (EC2)

**Date:** 2026-09-03  
**Branch:** `krithish-feature`  
**API host:** EC2 → `api.jodevents.com` (`/var/www/Event_platform-booking`)  
**Frontend:** Cloudflare Pages → `jodevents.com`  
**Service:** `event-platform.service` (gunicorn + UvicornWorker)

Use this when bookings/tickets/host attendee pages fail with SQL type errors after a deploy, or when host save / forgot-password break after splitting apex and API domains.

---

## 1. What error happened

### A) Postgres join crash (main SQL error)

```text
sqlalchemy.exc.ProgrammingError: (psycopg.errors.UndefinedFunction)
operator does not exist: character = uuid
```

Seen in:

```bash
sudo journalctl -u event-platform.service -n 80 --no-pager | grep -iE 'character = uuid|UndefinedFunction|ERROR'
```

Typical failing query: loading **bookings** with related **events / users / tickets** (`joinedload(Booking.event)`, `joinedload(Booking.tickets)`, etc.).

Health endpoint could still return `healthy` while these routes crashed.

### B) Related production issues around the same time (not the same root cause)

| Symptom | Cause |
|--------|--------|
| Host “Could not save event details…” | CSRF / cookie domain: site on `jodevents.com`, API on `api.jodevents.com` |
| Forgot-password OTP never arrives | SMTP not configured; API still returns a generic success message |
| Razorpay / payment work | Separate feature; not the cause of `character = uuid` |

---

## 2. Why it happened

### Schema vs SQLAlchemy type mismatch

- Alembic / live DB historically stores many IDs as **`CHAR(36)`** (text-like).
- App `GUID` type was mapped on PostgreSQL to **native `UUID`**.
- `Booking.booking_id` was declared as **`PG_UUID`** directly.
- `Ticket.booking_id` / other FKs were still **`CHAR`** in the live DB (or treated differently).

Postgres does **not** auto-compare `character` and `uuid`. Any join/filter that mixes them fails with:

`operator does not exist: character = uuid`

Example join that failed:

```text
tickets.booking_id (character) = bookings.booking_id (uuid)
```

and/or:

```text
bookings.event_id (character) = events.id (uuid)
```

### Why it showed up after payment / recent deploys

Payment work itself did not invent this DB drift. Deploying newer model/code paths that **eager-load bookings + tickets + events** hit joins that older code paths may not have stressed as often. Pull/`reset` to newer branch also made the live app use UUID-typed columns in SQLAlchemy against a CHAR-heavy DB.

### Why the first “cast event join only” fix was not enough

Casting only `Booking.event` ↔ `Event.id` still left:

`Ticket.booking_id` ↔ `Booking.booking_id`

broken because `booking_id` stayed native UUID in the Booking model.

---

## 3. How it was solved (code)

Commits on `krithish-feature` (approx):

| Commit | What |
|--------|------|
| `ff748e5` | Cast text joins for booking/ticket/event/wishlist relationships |
| `34d0952` / `9580059` | **Root fix:** treat IDs as `CHAR(36)` consistently |

### Root fix details

1. **`backend/Models/base.py` — `GUID`**
   - Always use `CHAR(36)` (including PostgreSQL).
   - Do **not** map `GUID` → native Postgres `UUID` (that caused bind/join type skew vs live CHAR columns).

2. **`backend/Models/booking.py`**
   - `booking_id` changed from `PG_UUID` → `GUID`.
   - Relationships use cast-to-text `primaryjoin` where CHAR/UUID drift is possible.

3. **`backend/Models/ticket.py` / `event.py` / `wishlist.py`**
   - Same cast-safe joins for event and booking relationships.

### CSRF / SMTP (separate but needed for “fully live”)

- `AUTH_COOKIE_DOMAIN=.jodevents.com` so auth/CSRF cookies work across apex + `api.` subdomain.
- CSRF middleware allows same-site requests from the marketing site to the API.
- SMTP env vars required for real OTP email delivery.
- Frontend organizer save: `credentials: "include"` + clearer API errors.

---

## 4. How to put it live on EC2 (checklist)

### Backend (EC2)

```bash
cd /var/www/Event_platform-booking
git fetch origin
git reset --hard origin/krithish-feature
git log -1 --oneline

source backend/.venv/bin/activate
pip install -r backend/requirements.txt

# Edit backend/.env if needed:
# AUTH_COOKIE_DOMAIN=.jodevents.com
# SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM
# RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET

sudo systemctl restart event-platform.service
curl -s https://api.jodevents.com/api/health
```

Verify SQL error is gone (after exercising the failing page):

```bash
sudo journalctl -u event-platform.service --since "2 minutes ago" --no-pager \
  | grep -iE 'character = uuid|UndefinedFunction'
```

**No output** after a real page hit ⇒ join error fixed.

### Frontend (Cloudflare Pages)

- Upload the full `frontend/` folder (not git auto-deploy).
- Includes organizer CSRF / credentials fixes.

### Browser smoke test

1. Log **out** then **in** (required after cookie-domain change).
2. Host: save event.
3. Open bookings / tickets / host attendees.
4. Payment (Razorpay) if keys are set.
5. Forgot-password OTP if SMTP is set.

---

## 5. Commands that are safe vs risky

**Safe / preferred on this server**

```bash
git fetch origin
git reset --hard origin/krithish-feature
sudo systemctl restart event-platform.service
```

**Avoid unless you know why**

- Merging `main` into the deploy branch blindly  
- Creating a new venv when `backend/.venv` already works  
- Random `git pull` when histories diverged (use `fetch` + `reset --hard` to match GitHub)

Venv path on this box: **`backend/.venv`** (not repo-root `.venv`).

---

## 6. If `character = uuid` returns

1. Confirm deploy commit is recent enough:

   ```bash
   git log -1 --oneline
   grep -n "CHAR(36)" backend/Models/base.py
   grep -n "booking_id" backend/Models/booking.py
   ```

2. Confirm service restarted after pull.

3. Inspect live column types:

   ```sql
   SELECT table_name, column_name, data_type
   FROM information_schema.columns
   WHERE table_name IN ('bookings', 'tickets', 'events')
     AND column_name IN ('booking_id', 'event_id', 'id', 'ticket_id');
   ```

4. Prefer code staying on **CHAR/GUID + cast joins**. Only alter columns to native UUID with a planned migration if you intentionally standardize the whole DB.

---

## 7. Short “future me” summary

| Item | Answer |
|------|--------|
| Error | `operator does not exist: character = uuid` |
| Why | Live DB IDs are mostly `CHAR`; app treated some as Postgres `UUID` → broken joins |
| Fix | `GUID` = always `CHAR(36)`; `Booking.booking_id` = `GUID`; cast-safe relationships |
| Live | `reset --hard origin/krithish-feature` → restart service → upload frontend → re-login → smoke test |
| Still healthy? | `/api/health` alone is not enough; check journal after hitting bookings/tickets |

---

## 8. Related files

- `backend/Models/base.py` — `GUID` type  
- `backend/Models/booking.py`  
- `backend/Models/ticket.py`  
- `backend/Models/event.py`  
- `backend/Models/wishlist.py`  
- `backend/Services/csrf.py` / `runtime_env.py` / `APIs/auth.py` — cookie domain + CSRF  
- `backend/.env.example` — `AUTH_COOKIE_DOMAIN`, SMTP, Razorpay  
- `docs/STAGING_AND_PRODUCTION.md` — broader deploy notes  
