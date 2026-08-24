# ── Stage 1: builder ──────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

RUN adduser --disabled-password --gecos "" --uid 10001 appuser

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --chown=appuser:appuser FastAPI ./FastAPI
COPY --chown=appuser:appuser APIs ./APIs
COPY --chown=appuser:appuser Authentication ./Authentication
COPY --chown=appuser:appuser Models ./Models
COPY --chown=appuser:appuser Services ./Services
COPY --chown=appuser:appuser Utils ./Utils

# Writable at runtime for Jinja2 template path init (non-root appuser).
RUN mkdir -p /app/templates && chown appuser:appuser /app/templates

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=8 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

CMD ["uvicorn", "FastAPI.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
