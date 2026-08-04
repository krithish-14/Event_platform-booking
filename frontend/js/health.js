/**
 * JOD Events — Health & Backend Connection Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides dynamic API base URL resolution with automatic candidate fallback,
 * backend health checking, auto-retry logic, and user-friendly fallback notifications.
 */

window.JodHealth = (() => {
  "use strict";

  const DEFAULT_PORT = "8001";
  let cachedWorkingUrl = null;

  /**
   * Determine backend API base URL dynamically based on environment.
   */
  function getApiBaseUrl() {
    if (cachedWorkingUrl) return cachedWorkingUrl;

    if (typeof window === "undefined" || !window.location) {
      return `http://127.0.0.1:${DEFAULT_PORT}`;
    }

    if (window.JOD_API_BASE_OVERRIDE) {
      return window.JOD_API_BASE_OVERRIDE;
    }

    const host = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";

    if (!host || host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.")) {
      const targetHost = (host === "localhost" || !host) ? "127.0.0.1" : host;
      return `${protocol}//${targetHost}:${DEFAULT_PORT}`;
    }

    if (window.location.port && window.location.port !== "80" && window.location.port !== "443") {
      return `${protocol}//${host}:${DEFAULT_PORT}`;
    }

    return `${window.location.origin}`;
  }

  /**
   * Resolve working base URL by probing candidate URLs (127.0.0.1 vs localhost).
   */
  async function resolveWorkingBaseUrl(timeoutMs = 2500) {
    if (cachedWorkingUrl) return cachedWorkingUrl;

    const base = getApiBaseUrl();
    const candidates = [
      base,
      "http://127.0.0.1:8001",
      "http://localhost:8001"
    ];
    const unique = [...new Set(candidates)];

    for (const url of unique) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(`${url}/health`, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timer);
        if (resp.ok) {
          cachedWorkingUrl = url;
          return url;
        }
      } catch (_) {}
    }
    return base;
  }

  /**
   * Verify if the FastAPI backend is online and reachable.
   */
  async function checkBackendHealth(timeoutMs = 3000) {
    try {
      const url = await resolveWorkingBaseUrl(timeoutMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(`${url}/health`, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return data.status === "healthy" || data.status === "ok" || resp.status === 200;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Retry connection periodically until backend responds or maxRetries reached.
   */
  function retryConnection(options = {}) {
    const {
      onSuccess = () => {},
      onError = () => {},
      onProgress = () => {},
      maxRetries = 10,
      delayMs = 1500,
    } = options;

    let attempt = 0;

    async function attemptPing() {
      attempt++;
      onProgress(attempt, maxRetries);
      const ok = await checkBackendHealth(2500);
      if (ok) {
        onSuccess();
        return;
      }
      if (attempt < maxRetries) {
        setTimeout(attemptPing, delayMs);
      } else {
        onError(new Error(`Backend server unreachable after ${maxRetries} attempts.`));
      }
    }

    attemptPing();
  }

  /**
   * Display a clean, user-friendly fallback banner.
   */
  function showFriendlyError(alertEl, message, type = "info") {
    if (!alertEl) return;
    alertEl.className = `form-alert is-visible alert-${type}`;

    const icon = type === "warning" || type === "info" ? "⏳" : type === "success" ? "✓" : "⚠️";
    const msgEl = alertEl.querySelector(".alert-msg");

    if (msgEl) {
      const iconSpan = alertEl.querySelector("span:first-child");
      if (iconSpan) iconSpan.textContent = icon;
      msgEl.textContent = message || "Connecting to server, please wait…";
    } else {
      alertEl.innerHTML = `<span>${icon}</span><span class="alert-msg">${message || "Connecting to server, please wait…"}</span>`;
    }
  }

  return {
    getApiBaseUrl,
    resolveWorkingBaseUrl,
    checkBackendHealth,
    retryConnection,
    showFriendlyError,
  };
})();

// Expose modular functions directly on window object for requirements
window.getApiBaseUrl = window.JodHealth.getApiBaseUrl;
window.resolveWorkingBaseUrl = window.JodHealth.resolveWorkingBaseUrl;
window.checkBackendHealth = window.JodHealth.checkBackendHealth;
window.retryConnection = window.JodHealth.retryConnection;
window.showFriendlyError = window.JodHealth.showFriendlyError;
