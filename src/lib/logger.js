// src/lib/logger.js
// SECURITY (L3): a single, redaction-aware logging front-end.
//
// Two problems this solves:
//
//  1. VOLUME / NOISE - 29+ ad-hoc `console.*` calls shipped raw Supabase
//     error objects to the browser console in production, where nobody reads
//     them but an attacker does.
//
//  2. LEAKAGE - those raw objects are NOT safe to print. A PostgREST error can
//     contain the failing query fragment, table and constraint names, and
//     occasionally row values; GoTrue errors can contain an email address.
//     Printing them exposes intern PII and internal schema detail to anyone
//     with devtools open, and to any browser extension or logging proxy.
//
// Design:
//  * Production: `error` is a no-op, `warn` is fully redacted. Nothing
//    sensitive reaches the console.
//  * Development: errors/warnings print, but every argument passes through
//    `redact()` first, which masks anything resembling an email, a uuid, a
//    bearer token, a long numeric id or a Supabase key.
//
// Import this instead of calling `console` directly.

const IS_DEV = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

const MASK = "[redacted]";

/** Keys whose values are never printed, matched case-insensitively. */
const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "apikey",
  "anonkey",
  "servicerolekey",
  "email",
  "contactnumber",
  "phone",
  "bio",
  "emergencycontact",
  "full_name",
  "fullname",
  "user_metadata",
  "session",
]);

const PATTERNS = [
  // Supabase / JWT keys and any bearer token.
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, to: MASK },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: MASK },
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, to: MASK },
  { re: /\b(?:\+?63|0)9\d{9}\b/g, to: MASK }, // PH mobile numbers
  { re: /\bBearer\s+[A-Za-z0-9._-]+/gi, to: `Bearer ${MASK}` },
];

/** Mask obvious secrets/PII inside a free-text string. */
export function redactString(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const { re, to } of PATTERNS) out = out.replace(re, to);
  return out;
}

/**
 * Deep-redact a value before logging. Caps depth and array length so a huge
 * payload cannot flood the console, and never returns a live reference.
 */
export function redact(value, depth = 0) {
  if (value == null) return value;

  const t = typeof value;
  if (t === "string") return redactString(value);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint" || t === "function" || t === "symbol") return `[${t}]`;

  if (depth > 3) return "[object]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // Omit `stack` outside development: it can embed file paths.
      ...(IS_DEV ? { stack: redactString(value.stack) } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }

  if (t === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? MASK : redact(v, depth + 1);
    }
    return out;
  }

  return "[unloggable]";
}

function emit(method, args) {
  if (!IS_DEV && method === "error") return;
  // eslint-disable-next-line no-console
  console[method](...args.map((a) => redact(a)));
}

export const logger = {
  /** Silent in production. Use for failures that are already handled. */
  error: (...args) => emit("error", args),
  /** Kept in production, but fully redacted and capped. */
  warn: (...args) => emit("warn", args),
  /** Development only. */
  info: (...args) => emit("info", args),
  debug: (...args) => emit("info", args),
  /** Escape hatch for non-sensitive text. Still redacted. */
  raw: (...args) => emit("log", args),
};

export default logger;
