// src/lib/dtr.js
// Daily Time Record: builds the printable record from attendance data.
//
// PURE LOGIC AND READ-ONLY. It never touches the network and never writes. The
// caller reads the rows and passes them in, so generating a DTR cannot create a
// record, edit one, or change an hour count. There is no separate attendance
// store: these are the same rows the Time In / Time Out screen writes.
//
// SINGLE SOURCE OF TRUTH. Every Time In, Time Out, status and hour value is
// read straight from the `attendance` table. Nothing is typed in, hard-coded or
// assumed. The only judgement applied is what to SHOW for a row that does or
// does not exist:
//
//   * Time In / Time Out print exactly as stored; a missing value prints as a
//     dash, never a guess.
//   * Hours come from `attendance.total_hours`, which the database itself
//     computes on time-out. Hours appear only for a CLOSED shift (both
//     time_in and time_out present), so an open shift never counts as work.
//   * Status is the row's own stored status, including 'absent'. The DTR never
//     INFERS an absence: a date with no row is reported as having no record,
//     which is a statement about the data rather than an accusation.
//   * Dates after today are "Upcoming" - a shift that has not happened cannot
//     be an absence.
//
// Re-running after a record is corrected naturally shows the update, because
// the rows are re-read on every call.

import { ATTENDANCE_STATUS, ATTENDANCE_STATUS_LABELS } from "./constants";
import { ATTENDANCE_TIMEZONE } from "@/utils/format";

/** Status shown when a date has no attendance row at all. */
export const NO_RECORD = "No record";

/** `YYYY-MM-DD` in UTC, offset from a `YYYY-MM-DD` start. */
function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Inclusive list of dates from -> to, capped so a bad range cannot run away. */
export function eachDate(fromISO, toISO) {
  const out = [];
  let cur = fromISO;
  let guard = 0;
  while (cur <= toISO && guard < 800) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** "Monday" for a `YYYY-MM-DD` string. */
export function dayName(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * `HH:MM` in Asia/Manila - Philippine Time (PHT, UTC+8, no DST).
 *
 * `hourCycle: "h23"` is deliberate and important. Asking for `hour12: false`
 * alone is NOT reliable: several engines resolve that to hour cycle h24, which
 * renders midnight as "24:00" instead of "00:00". Pinning h23 is the only way
 * to guarantee a true 24-hour clock reading 00:00-23:00.
 *
 * The source columns are `timestamptz`, stored by Postgres in UTC. Converting
 * with an explicit timeZone is what makes the printed clock read as Philippine
 * wall-clock time rather than UTC.
 */
export function manilaTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ATTENDANCE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** Label printed on the record, so the timezone is never ambiguous. */
export const TIMEZONE_LABEL = "Philippine Time (PHT, UTC+8)";

/** Day of the month as a number, e.g. 1 for the 1st. */
export function dayOfMonth(isoDate) {
  return Number(String(isoDate ?? "").slice(8, 10)) || 0;
}

/**
 * Short readable date for a table cell, e.g. "1 Sep 2026".
 * A DTR should read like a document, not like a database dump.
 */
export function shortDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return String(isoDate);
  return `${d} ${MONTH_SHORT[m - 1] ?? ""} ${y}`;
}

/** Long human date, e.g. "1 September 2026". */
export function longDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Round to 2dp, so a signed total has no float dust (0.1 + 0.2 problems). */
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** "8.00" for a printed total. */
export function formatHoursValue(n) {
  return round2(n).toFixed(2);
}

/** Bounds of the calendar month containing `today`, offset by whole months. */
export function monthBounds(today, offsetMonths = 0) {
  const [y, m] = String(today).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  const yy = t.getUTCFullYear();
  const mm = t.getUTCMonth() + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    from: `${yy}-${pad(mm)}-01`,
    to: `${yy}-${pad(mm)}-${pad(last)}`,
  };
}

/**
 * Build the DTR for one intern over one date range.
 *
 * @param {object} opts
 * @param {Array}  opts.records        attendance rows for THIS intern in range
 * @param {string} opts.from           inclusive `YYYY-MM-DD`
 * @param {string} opts.to             inclusive `YYYY-MM-DD`
 * @param {string} opts.today          `YYYY-MM-DD`; later dates are upcoming
 * @param {number} [opts.requiredHours] from interns.required_hours
 * @returns {{ days: Array, summary: object }}
 */
export function buildDtr({
  records = [],
  from,
  to,
  today,
  requiredHours = 0,
}) {
  // date -> the stored row. Last write wins, matching the
  // attendance_unique_per_day index (one row per intern per day).
  const byDate = new Map();
  for (const r of records) {
    const key = String(r?.date ?? "").slice(0, 10);
    if (key) byDate.set(key, r);
  }

  const days = eachDate(from, to).map((date) => {
    const rec = byDate.get(date) ?? null;
    const isFuture = date > today;
    const hasIn = Boolean(rec?.time_in);
    const hasOut = Boolean(rec?.time_out);
    const closed = hasIn && hasOut;

    // Hours are shown ONLY for a completed time-in/time-out pair, and always
    // from the stored total_hours. An open shift is still in progress, so it
    // must not be presented as rendered work.
    const hours = closed ? round2(rec.total_hours) : 0;

    let status;
    if (!rec) {
      // No row: report the absence of data, not an absence. Writing "Absent"
      // here would invent a finding the system never recorded.
      status = isFuture ? "Upcoming" : NO_RECORD;
    } else if (rec.status === ATTENDANCE_STATUS.ABSENT) {
      // A stored absence is shown as-is, even if a stray time-in exists.
      status = ATTENDANCE_STATUS_LABELS[ATTENDANCE_STATUS.ABSENT];
    } else if (isFuture) {
      status = "Upcoming";
    } else {
      // Present / Late / Pending all come straight from the stored value.
      status = ATTENDANCE_STATUS_LABELS[rec.status] ?? rec.status;
    }

    return {
      date,
      dayOfMonth: dayOfMonth(date),
      displayDate: shortDate(date),
      dayName: dayName(date),
      timeIn: manilaTime(rec?.time_in),
      timeOut: manilaTime(rec?.time_out),
      status,
      hours,
      completed: closed,
      hasRecord: Boolean(rec),
      isFuture,
      remark: rec?.remarks || "",
    };
  });

  // The total is the sum of stored hours over COMPLETED shifts only. Nothing
  // is estimated, prorated, or inferred for open or missing days.
  const totalHours = round2(
    days.filter((d) => d.completed).reduce((s, d) => s + d.hours, 0),
  );
  const required = round2(requiredHours);

  const summary = {
    totalHours,
    requiredHours: required,
    remainingHours: round2(Math.max(0, required - totalHours)),
    percentComplete: required > 0 ? Math.min(100, Math.round((totalHours / required) * 100)) : 0,
    daysWithRecord: days.filter((d) => d.hasRecord).length,
    daysPresent: days.filter((d) => d.status === "Present").length,
    daysLate: days.filter((d) => d.status === "Late").length,
    daysAbsent: days.filter((d) => d.status === "Absent").length,
    // An open shift: time-in exists, time-out does not. Counted separately so
    // it stays visible without ever entering the total.
    openShifts: days.filter((d) => d.hasRecord && !d.completed && !d.isFuture).length,
    daysNoRecord: days.filter((d) => !d.hasRecord && !d.isFuture).length,
    entries: days.length,
  };

  return { days, summary };
}
