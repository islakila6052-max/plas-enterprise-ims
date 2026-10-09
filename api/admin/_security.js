// api/admin/_security.js
// Shared hardening helpers for the /api/admin serverless functions.
//
// Implemented here (H5 rate limiting, H6 password policy) rather than in each
// handler so the rules cannot drift apart between endpoints.

/**
 * SECURITY (L5/L6): Origin / CORS policy for the /api serverless functions.
 *
 * The app is same-origin today: the browser calls `/api/...` on the same host
 * that serves the SPA, and authentication is a Supabase Bearer token rather
 * than a cookie, so there is no CSRF exposure.
 *
 * This guard exists so that stays TRUE if auth ever moves to cookies. A
 * cross-origin form post or fetch cannot set an `Authorization` header, but it
 * CAN reach a cookie-authenticated endpoint, so an explicit Origin check is the
 * defence-in-depth for that future migration. It is cheap, and it also blocks
 * a malicious page from using the victim's browser as a confused deputy.
 *
 * Requests with NO Origin header (server-to-server, curl, health checks) are
 * allowed: the Origin header is a browser-only mechanism, and treating its
 * absence as hostile would break legitimate API consumers. Auth is still
 * enforced by the caller-identity check in each handler.
 */
const ALLOWED_ORIGINS = [
  "https://plas-enterprise-ims.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** True when a request originates from a browser we trust. */
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  // Non-browser client (no Origin): allowed - see the note above.
  if (!origin) return true;

  // Vercel preview deployments use *.vercel.app; allow them explicitly rather
  // than adding a wildcard to the main allowlist.
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;

  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Reject a cross-origin browser request. Returns true when it handled the
 * response, so callers can `if (denyCrossOrigin(req, res)) return;`.
 */
export function denyCrossOrigin(req, res) {
  if (isAllowedOrigin(req)) return false;
  res.setHeader?.("Vary", "Origin");
  res.status(403).json({ error: "Forbidden: cross-origin request rejected." });
  return true;
}

/** Fixed-window in-memory rate limiter, keyed by client IP + route bucket. */
const _buckets = new Map();

/**
 * @param {object} req        Vercel-style request
 * @param {string} key        Bucket name, e.g. "create-user"
 * @param {number} limit      Max requests allowed per window
 * @param {number} windowMs   Window length in ms
 * @returns {{ ok: boolean, retryAfter: number }}
 */
export function rateLimit(req, key, limit, windowMs) {
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  const now = Date.now();
  const id = `${key}:${ip}`;

  // Opportunistic cleanup so a long-lived instance cannot grow unbounded.
  if (_buckets.size > 5000) {
    for (const [k, v] of _buckets) {
      if (v.resetAt <= now) _buckets.delete(k);
    }
  }

  const entry = _buckets.get(id);
  if (!entry || entry.resetAt <= now) {
    _buckets.set(id, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Send a 429 and stop further processing. Returns true when it handled the
 * response, so callers can `if (denyRateLimit(...)) return;`.
 */
export function denyRateLimit(res, retryAfter) {
  res.setHeader?.("Retry-After", String(retryAfter));
  res.status(429).json({
    error: "Too many requests. Please wait a moment and try again.",
  });
  return true;
}

// Passwords that must never be accepted, regardless of length.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "iloveyou", "admin123", "administrator",
  "letmein123", "welcome123", "abc12345", "abc123456", "monkey123", "dragon123",
  "sunshine", "princess", "football", "baseball", "trustno1", "superman",
  "internship", "intern123", "company123",
]);

/**
 * Server-side password policy (H6). This is the enforcement point - the UI's
 * strength meter is advisory only and is trivially bypassed.
 *
 * @returns {{ ok: boolean, message?: string }}
 */
export function validatePassword(password, email) {
  const pw = String(password ?? "");

  if (pw.length < 12) {
    return { ok: false, message: "Password must be at least 12 characters long." };
  }
  if (pw.length > 200) {
    return { ok: false, message: "Password must be at most 200 characters long." };
  }
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return {
      ok: false,
      message: "Password must include an uppercase letter, a lowercase letter and a number.",
    };
  }
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    return { ok: false, message: "That password is too common. Please choose another." };
  }
  // Reject the password when it is (or contains) the email local-part.
  const localPart = String(email ?? "").split("@")[0];
  if (localPart && localPart.length >= 4 && pw.toLowerCase().includes(localPart.toLowerCase())) {
    return { ok: false, message: "Password must not contain your email address." };
  }
  return { ok: true };
}

/** Reject over-long or malformed free-text input before it reaches the DB. */
export function str(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}
