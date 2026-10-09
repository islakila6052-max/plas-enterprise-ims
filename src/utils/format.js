// src/utils/format.js
/**
 * Formatting helpers for dates, times and numbers used across the UI.
 */

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Format an ISO string or Date as e.g. "Jul 15, 2026". */
export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** Format an ISO string or Date as e.g. "Jul 15, 2026, 02:30 PM". */
export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

/** Format an ISO string or Date as e.g. "02:30 PM". */
export function formatTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : timeFmt.format(d);
}

/** Today's date as YYYY-MM-DD (for <input type="date">). */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Asia/Manila is the single operating timezone for Attendance (UTC+8, no DST).
 * All attendance day selections, "today" detection, previous-day detection,
 * claim eligibility and wall-clock time-out parsing use this timezone, so the
 * attendance domain never mixes UTC-derived dates with browser-local cutoffs.
 */
export const ATTENDANCE_TIMEZONE = "Asia/Manila";

/**
 * SECURITY (M2): sanitise a user-supplied search term before it is embedded
 * in a PostgREST `.or()` / `.ilike()` filter string.
 *
 * The query builder is not a SQL engine, so this is not classic SQL injection
 * - values always travel as bound parameters. But an unescaped search term can
 * still break out of the intended filter expression: PostgREST treats `,`
 * `.` `(` `)` as structural, so a term like `a),or(1.eq.1` alters the parsed
 * filter and can return unintended rows, or produce a 500.
 *
 * We keep letters, digits, spaces and a few name characters (so real searches
 * like "De La Cruz" still work) and drop everything structural. Commas are
 * replaced with a space rather than removed, so "Smith, John" still matches.
 *
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string} safe filter fragment, or "" when nothing usable remains
 */
export function sanitizeSearch(value, maxLength = 80) {
  return String(value ?? "")
    .replace(/[,()]/g, " ")
    .replace(/[^A-Za-z0-9 .'\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function zoneParts(instant, timeZone, extra = {}) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...extra,
  });
  return Object.fromEntries(
    dtf
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}

/** Today's calendar date (YYYY-MM-DD) in the attendance timezone (Asia/Manila). */
export function todayDateInAttendanceTZ(now = new Date()) {
  const p = zoneParts(now, ATTENDANCE_TIMEZONE);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minute of day (0-1439) right now, in the attendance timezone. */
export function nowMinuteInAttendanceTZ(now = new Date()) {
  const p = zoneParts(now, ATTENDANCE_TIMEZONE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/**
 * Build a UTC ISO instant from a Manila wall-clock date ("YYYY-MM-DD") and a
 * "HH:mm" wall-clock time. Asia/Manila is a fixed UTC+8 with no DST, so the
 * instant is the naive wall time minus 8 hours.
 */
export function manilaWallTimeToISO(dateStr, hhmm) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(hhmm).split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - 8 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}


/**
 * Compute decimal hours between two ISO timestamps.
 * @returns {number} hours rounded to 2 decimals (0 if invalid).
 */
export function diffHours(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

/** Format decimal hours as "Xh Ym". */
export function formatHours(hours) {
  if (hours == null || Number.isNaN(hours)) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

/** Format a number with thousands separators. */
export function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

/** Get initials from a full name. */
export function getInitials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Relative time like "2 hours ago" (lightweight). */
export function timeAgo(value) {
  if (!value) return "—";
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return "—";
  const secs = Math.floor((Date.now() - d) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
