/**
 * JOD Events — Health & Backend Connection Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides dynamic API base URL resolution, backend health checking, auto-retry logic,
 * and user-friendly fallback notifications.
 *
 * Public API (window.JodHealth & window):
 *   getApiBaseUrl()                  → Returns dynamic API base URL string
 *   checkBackendHealth(timeoutMs)    → Promise<boolean> (true if server online)
 *   retryConnection(...)             → Periodically retries pinging backend until online
 *   showFriendlyError(alertEl, msg)  → Renders user-friendly message banner
 */

window.JodHealth = (() => {
  "use strict";

  const DEFAULT_PORT = "8001";

  /**
   * Determine backend API base URL dynamically based on environment.
   */
  function getApiBaseUrl() {
    if (window.JodConfig && typeof window.JodConfig.getApiOrigin === "function") {
      return window.JodConfig.getApiOrigin();
    }
    if (window.JOD_API_BASE_OVERRIDE) {
      return String(window.JOD_API_BASE_OVERRIDE).replace(/\/$/, "");
    }
    return "";
  }

  /**
   * Verify if the FastAPI backend is online and reachable.
   */
  async function checkBackendHealth(timeoutMs = 4000) {
    const baseUrl = getApiBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`${baseUrl}/health`, {
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
      clearTimeout(timer);
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
      maxRetries = 15,
      delayMs = 2000,
    } = options;

    let attempt = 0;

    async function attemptPing() {
      attempt++;
      onProgress(attempt, maxRetries);
      const ok = await checkBackendHealth(3000);
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
   * Display a clean, user-friendly fallback banner instead of a raw red error box.
   */
  function showFriendlyError(alertEl, message, type = "info") {
    if (!alertEl) return;
    alertEl.className = `form-alert is-visible alert-${type}`;

    const icon = type === "warning" || type === "info" ? "⏳" : type === "success" ? "✓" : "⚠️";
    const msgEl = alertEl.querySelector(".alert-msg") || alertEl;

    if (alertEl.querySelector(".alert-msg")) {
      const iconSpan = alertEl.querySelector("span:first-child");
      if (iconSpan) iconSpan.textContent = icon;
      msgEl.textContent = message || "Connecting to server, please wait…";
    } else {
      alertEl.innerHTML = `<span>${icon}</span><span class="alert-msg"></span>`;
      const msgSpan = alertEl.querySelector(".alert-msg");
      if (msgSpan) msgSpan.textContent = message || "Connecting to server, please wait…";
    }
  }

  return {
    getApiBaseUrl,
    checkBackendHealth,
    retryConnection,
    showFriendlyError,
  };
})();

window.escHtml = function escHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

// Expose modular functions directly on window object for requirements
window.getApiBaseUrl = window.JodHealth.getApiBaseUrl;
window.checkBackendHealth = window.JodHealth.checkBackendHealth;
window.retryConnection = window.JodHealth.retryConnection;
window.showFriendlyError = window.JodHealth.showFriendlyError;
