// src/lib/api.js
import { supabase } from "@/lib/supabase";
import { onlineManager } from "@/lib/onlineManager";

/**
 * Default retry configuration for network requests.
 */
const DEFAULT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1000,
};

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify an error from a Supabase or fetch call.
 * Returns a user-friendly message and a flag indicating
 * whether the error is a connectivity issue.
 */
export function classifyError(error) {
  if (!error) {
    return { message: "Something went wrong. Please try again.", isNetworkError: false };
  }

  const raw = error.message || error.error_description || "Something went wrong. Please try again.";

  // Supabase network errors typically have no code or a generic code
  const isNetworkError =
    error.name === "TypeError" ||
    raw.toLowerCase().includes("failed to fetch") ||
    raw.toLowerCase().includes("network") ||
    raw.toLowerCase().includes("offline") ||
    error.code === "ETIMEDOUT" ||
    error.code === "ECONNREFUSED" ||
    error.code === "ECONNRESET" ||
    error.code === "ENOTFOUND";

  if (isNetworkError) {
    return {
      message: "No internet connection. Please check your network and try again.",
      isNetworkError: true,
    };
  }

  return { message: friendlyMessage(raw), isNetworkError: false };
}

/**
 * Map raw Supabase / PostgREST / Auth errors to plain-language messages.
 * Falls back to the raw message when no mapping applies.
 */
function friendlyMessage(raw) {
  const lower = String(raw).toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid email or password")) {
    return "Incorrect email or password. Please try again.";
  }
  if (lower.includes("email not confirmed")) {
    return "Your email is not confirmed yet. Please check your inbox for a confirmation link.";
  }
  if (lower.includes("too many requests") || lower.includes("rate limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("jwt") || lower.includes("token") || lower.includes("session")) {
    if (lower.includes("expired")) return "Your session has expired. Please sign in again.";
  }
  if (lower.includes("duplicate") || lower.includes("already exists") || lower.includes("already registered") || lower.includes("unique")) {
    return raw; // callers refine duplicate-email copy per context
  }
  if (lower.includes("row-level security") || lower.includes("rls") || lower.includes("not allowed") || lower.includes("permission denied")) {
    return "You don't have permission to perform this action.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The request timed out. Please check your connection and try again.";
  }
  if (lower.includes("500") || lower.includes("internal server error")) {
    return "The server had a problem. Please try again in a moment.";
  }
  return raw;
}

/**
 * Execute an async function with automatic retry on network failures.
 *
 * @param {Function} fn        - Async function to execute (e.g. a Supabase call)
 * @param {Object}   options   - { maxAttempts, baseDelayMs, onError }
 * @returns {Promise<{data: any, error: Error|null}>}
 */
export async function withRetry(fn, options = {}) {
  const { maxAttempts = DEFAULT_RETRY.maxAttempts, baseDelayMs = DEFAULT_RETRY.baseDelayMs, onError } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // If we're offline, don't even try — bail immediately with a clear error.
    if (!onlineManager.isOnline) {
      return { data: null, error: new Error("No internet connection. Please check your network and try again.") };
    }

    try {
      const result = await fn();
      return result;
    } catch (err) {
      lastError = err;
      const { isNetworkError } = classifyError(err);

      // If it's a network error and we have attempts left, retry with backoff.
      if (isNetworkError && attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // exponential backoff
        await sleep(delay);
        continue;
      }

      // Non-network error or last attempt — break and surface it.
      break;
    }
  }

  if (typeof onError === "function") {
    onError(lastError);
  }

  return { data: null, error: lastError };
}

/**
 * Wrap a Supabase query so that it always returns `{ data, error }`.
 * Handles offline state, network errors, and classification.
 *
 * Usage:
 *   const { data, error } = await api(supabase.from("x").select("*"));
 */
export async function api(queryPromise) {
  // Quick offline check before making the request.
  if (!onlineManager.isOnline) {
    return { data: null, error: new Error("No internet connection. Please check your network and try again.") };
  }

  try {
    const result = await queryPromise;
    return result;
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Supabase client reference for direct use when needed.
 * Prefer using `api()` or `withRetry()` for all Supabase calls.
 */
export { supabase };
