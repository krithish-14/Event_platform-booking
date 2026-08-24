# Development → Git → Staging → Automated tests → Manual verification → Production
#
# Never point local development at the production database.
# Never use production payment, Google, SMTP, or WhatsApp credentials in staging
# unless the provider documents those values as sandbox/test credentials.

## MANUAL ACTION REQUIRED — secret rotation (H2)

Do **not** rewrite git history. Treat any historical defaults as public.

Rotate before production if they were ever used on a reachable system:

1. Admin password
2. `SECRET_KEY` (invalidates all sessions)
3. `FILE_ENCRYPTION_KEY` (set `FILE_ENCRYPTION_KEY_PREVIOUS` first if encrypted rows exist)
4. Database password in `DATABASE_URL`
5. `GOOGLE_CLIENT_SECRET`
6. SMTP password

Generate locally (example): `python backend/scripts/generate_secrets.py`  
Put values only in gitignored `.env` / `.env.production`. Never commit them.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and fill local values.
2. Run PostgreSQL locally (or a dedicated dev instance).
3. Start the split-port servers: `python backend/start_servers.py`
   - Frontend: http://127.0.0.1:5500
   - API: http://127.0.0.1:8001
4. Run tests from `backend/`: `python -m pytest -q` or `python test_critical_security_fixes.py`

## Staging (same-origin HTTP on port 8080)

1. Copy `.env.staging.example` to `.env.production` (compose reads `.env.production`)
   or export the staging variables before compose.
2. `docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build`
3. Open http://127.0.0.1:8080
4. Manual checklist:
   - registration, login, Google login, OTP, password reset
   - event create/edit/publish, search, event details
   - booking, payment screenshot, admin verification, ticket, QR, check-in
   - cancellation, email/WhatsApp if configured
   - organizer dashboard, admin dashboard
   - file upload rejection of non-images, KYC visible only to owner/admin

## Production

1. Copy `.env.production.example` to `.env.production`.
2. Run `python backend/scripts/generate_secrets.py` and paste new values.
   Do not reuse development secrets.
3. Set `FRONTEND_URL`, `PUBLIC_APP_URL`, `ALLOWED_ORIGINS` (public HTTPS origins only — never `*`, localhost, or private IPs), Google redirect, SMTP.
4. Provision PostgreSQL and put the URL in `DATABASE_URL`.
5. Place TLS certificates in `deploy/certs/` (`fullchain.pem`, `privkey.pem`).
6. `docker compose -f docker-compose.yml -f docker-compose.tls.yml up --build -d`
7. Confirm HTTPS, HTTP→HTTPS redirect, `/health`, `/health/ready`, and `/api/auth/me`.

## Payment rule

Bookings become paid only after an authenticated admin verifies the payment
on the server. The browser must never be trusted to mark a booking as paid.
