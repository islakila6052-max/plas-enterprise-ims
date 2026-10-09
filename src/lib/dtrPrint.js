// src/lib/dtrPrint.js
// Renders the Daily Time Record as a standalone printable document.
//
// It is opened in a new window so the browser's own print dialog handles paper
// size and "Save as PDF". That is more dependable than driving the page from
// inside the SPA, and it means the intern can save a PDF with nothing
// installed. The window contains ONLY the record - no navigation, sidebar or
// dashboard chrome - so what prints is exactly what a signed DTR should be.
//
// SECURITY: values such as the intern name, company and remarks come from the
// database and are interpolated into an HTML string, so every one of them goes
// through escapeHtml() first. A value containing markup cannot inject into the
// printed document. The only unescaped interpolation is STYLE, a literal
// defined in this file.

import {
  longDate,
  shortDate,
  formatHoursValue,
  TIMEZONE_LABEL,
} from "./dtr";

/** Escape text destined for an HTML text node or attribute value. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A4 portrait, 12mm margins, compact rows so a month fits on 1-2 pages. */
const STYLE = [
  "@page { size: A4 portrait; margin: 12mm 12mm 14mm; }",
  "* { box-sizing: border-box; }",
  "body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #111827;",
  "  font-size: 11px; margin: 0; line-height: 1.35;",
  "  -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
  ".center { text-align: center; }",
  ".company { font-size: 15px; font-weight: 700; letter-spacing: .3px; }",
  ".subtitle { font-size: 10px; color: #4b5563; margin-top: 1px; }",
  "h1 { font-size: 16px; letter-spacing: 2.5px; margin: 9px 0 3px;",
  "  text-transform: uppercase; font-weight: 700; }",
  ".rule { border-bottom: 2px solid #166534; margin: 5px 0 10px; }",
  ".tznote { font-size: 8.5px; color: #6b7280; margin-top: 4px; }",
  ".meta { width: 100%; border-collapse: collapse; margin-bottom: 11px; }",
  ".meta td { padding: 2px 0; vertical-align: top; }",
  ".meta .label { color: #4b5563; width: 92px; font-weight: 600; }",
  ".meta .val { font-weight: 500; }",
  ".period { border: 1px solid #166534; border-radius: 3px; padding: 4px 10px;",
  "  display: inline-block; font-weight: 600; }",
  "table.dtr { width: 100%; border-collapse: collapse; }",
  "table.dtr th, table.dtr td { border: 1px solid #9ca3af; padding: 2.5px 4px;",
  "  vertical-align: middle; }",
  "table.dtr thead th { background: #166534; color: #fff; font-weight: 600;",
  "  text-align: center; font-size: 9.5px; text-transform: uppercase;",
  "  letter-spacing: .4px; border-color: #166534; }",
  ".num { text-align: center; width: 28px; }",
  ".date { width: 82px; text-align: center; }",
  ".day { width: 74px; text-align: center; }",
  ".time { width: 54px; text-align: center; }",
  ".hrs { width: 56px; text-align: center; }",
  ".status { width: 78px; text-align: center; }",
  "tr.norecord td { background: #f9fafb; color: #9ca3af; }",
  "tr.absent td { background: #fef2f2; }",
  "tr.absent .status { color: #b91c1c; font-weight: 700; }",
  "tr.open td { background: #fffbeb; }",
  "tr.future td { color: #9ca3af; }",
  "tfoot td { background: #f0fdf4; font-weight: 700; font-size: 12px; }",
  ".totallabel { text-align: right; letter-spacing: .4px; }",
  ".summary { margin-top: 9px; font-size: 9.5px; color: #4b5563;",
  "  display: flex; gap: 16px; flex-wrap: wrap; }",
  ".summary span { white-space: nowrap; }",
  ".summary b { color: #111827; }",
  ".sign { display: flex; gap: 22px; margin-top: 28px; }",
  ".sign div { flex: 1; text-align: center; }",
  ".line { border-top: 1px solid #111827; margin: 24px 0 3px; }",
  ".cap { font-size: 10px; color: #4b5563; }",
  ".note { margin-top: 11px; font-size: 8.5px; color: #6b7280; }",
  "@media print {",
  "  .noprint { display: none !important; }",
  "  table.dtr thead { display: table-header-group; }",
  "  tr { page-break-inside: avoid; }",
  "}",
  "@media screen {",
  "  body { background: #f3f4f6; padding: 16px; }",
  "  .noprint { max-width: 210mm; margin: 0 auto 12px; background: #fff;",
  "    padding: 11px 14px; border-radius: 8px; font-family: 'Segoe UI', Arial, sans-serif;",
  "    display: flex; gap: 10px; align-items: center; box-shadow: 0 1px 4px rgba(0,0,0,.08); }",
  "  .noprint button { font: inherit; font-size: 13px; padding: 8px 15px;",
  "    border-radius: 6px; border: 0; cursor: pointer; background: #166534; color: #fff; }",
  "  .noprint button.ghost { background: #6b7280; }",
  "  .noprint .hint { color: #6b7280; font-size: 12.5px; }",
  "  .doc { background: #fff; max-width: 210mm; margin: 0 auto;",
  "    padding: 12mm; box-shadow: 0 4px 18px rgba(0,0,0,.12); }",
  "}",
].join("\n");

/** Row tinting by state, so a long sheet is scannable at a glance. */
function rowClass(d) {
  if (d.isFuture) return "future";
  if (d.status === "Absent") return "absent";
  if (!d.hasRecord) return "norecord";
  if (!d.completed) return "open";
  return "";
}

/**
 * Build the complete printable DTR document.
 *
 * @param {object} opts
 * @param {{days:Array, summary:object}} opts.dtr
 * @param {string} opts.from
 * @param {string} opts.to
 * @param {object} opts.intern  { name, studentNumber, department, institution,
 *                                position, startDate, endDate }
 * @param {string} opts.company
 * @param {string} opts.generatedAt
 * @returns {string} a full, standalone HTML document
 */
export function buildDtrDocument({
  dtr,
  from,
  to,
  intern = {},
  company = "PLAS ENTERPRISE & ENGINEERING SERVICES",
  generatedAt = "",
}) {
  const days = dtr?.days ?? [];
  const summary = dtr?.summary ?? {};
  const D = escapeHtml;
  // A blank settings row yields "", which would print an empty header.
  // Coalesce so the record always names the company.
  const companyName = String(company || "").trim() || "PLAS ENTERPRISE & ENGINEERING SERVICES";
  const dash = "&mdash;";

  const bodyRows = days
    .map(
      (d, i) =>
        "<tr class=\"" +
        rowClass(d) +
        "\">" +
        '<td class="num">' +
        D(d.dayOfMonth || i + 1) +
        "</td>" +
        '<td class="date">' +
        D(d.displayDate || d.date) +
        "</td>" +
        '<td class="day">' +
        D(d.dayName) +
        "</td>" +
        '<td class="time">' +
        (d.timeIn ? D(d.timeIn) : dash) +
        "</td>" +
        '<td class="time">' +
        (d.timeOut ? D(d.timeOut) : dash) +
        "</td>" +
        '<td class="status">' +
        D(d.status) +
        "</td>" +
        '<td class="hrs">' +
        (d.completed ? D(formatHoursValue(d.hours)) : dash) +
        "</td></tr>",
    )
    .join("");

  const ojtPeriod =
    intern.startDate
      ? D(intern.startDate) +
        (intern.endDate ? "&nbsp;&nbsp;to&nbsp;&nbsp;" + D(intern.endDate) : "&nbsp;&nbsp;(ongoing)")
      : "&mdash;";

  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Daily Time Record - " +
      D(intern.name ?? "") +
      "</title>",
    "<style>" +
      STYLE +
      "</style></head><body>",

    '<div class="noprint">',
    '<button type="button" onclick="window.print()">Print / Save as PDF</button>',
    '<button type="button" class="ghost" onclick="window.close()">Close</button>',
    '<span class="hint">In the print dialog choose A4. Margins can stay on Default.</span>',
    "</div>",

    '<div class="doc">',
    '<div class="center">',
    '<div class="company">' +
      D(companyName) +
      "</div>",
    '<div class="subtitle">Internship Management System</div>',
    "</div>",
    '<h1 class="center">Daily Time Record</h1>',
    '<div class="center"><span class="period">Period: ',
    D(longDate(from)),
    "&nbsp;&mdash;&nbsp;",
    D(longDate(to)),
    "</span></div>",
    '<div class="center tznote">Times shown in ',
    D(TIMEZONE_LABEL),
    "</div>",
    '<div class="rule"></div>',

    '<table class="meta">',
    '<tr><td class="label">Name</td><td class="val">',
    D(intern.name || "-"),
    '</td><td class="label" style="width:78px">Position</td><td class="val">',
    D(intern.position || "Intern"),
    "</td></tr>",
    '<tr><td class="label">Student No.</td><td class="val">',
    D(intern.studentNumber || "-"),
    '</td><td class="label" style="width:78px">Department</td><td class="val">',
    D(intern.department || "-"),
    "</td></tr>",
    '<tr><td class="label">Institution</td><td class="val" colspan="3">',
    D(intern.institution || "-"),
    "</td></tr>",
    '<tr><td class="label">OJT Period</td><td class="val" colspan="3">',
    ojtPeriod,
    "</td></tr>",
    "</table>",

    '<table class="dtr"><thead><tr>',
    '<th class="num">#</th><th class="date">Date</th><th class="day">Day</th>',
    '<th class="time">Time In</th><th class="time">Time Out</th>',
    '<th class="status">Status</th><th class="hrs">Hours</th>',
    "</tr></thead><tbody>",
    bodyRows,
    "</tbody><tfoot><tr>",
    '<td class="totallabel" colspan="6">TOTAL HOURS RENDERED</td>',
    '<td class="hrs">',
    D(formatHoursValue(summary.totalHours)),
    "</td></tr></tfoot></table>",

    '<div class="summary">',
    "<span>Days with record: <b>" + D(String(summary.daysWithRecord ?? 0)) + "</b></span>",
    "<span>Present: <b>" + D(String(summary.daysPresent ?? 0)) + "</b></span>",
    "<span>Late: <b>" + D(String(summary.daysLate ?? 0)) + "</b></span>",
    "<span>Absent: <b>" + D(String(summary.daysAbsent ?? 0)) + "</b></span>",
    "<span>Open shifts: <b>" + D(String(summary.openShifts ?? 0)) + "</b></span>",
    "<span>No record: <b>" + D(String(summary.daysNoRecord ?? 0)) + "</b></span>",
    "</div>",

    '<div class="sign">',
    '<div><div class="line"></div><div class="cap">Intern Signature</div></div>',
    '<div><div class="line"></div><div class="cap">Supervisor Signature</div></div>',
    '<div><div class="line"></div><div class="cap">HR / Authorized Signature</div></div>',
    "</div>",

    '<p class="note">Generated ',
    D(generatedAt),
    " from the IMS attendance records shown above. Time In, Time Out, status and " +
      "hours are read directly from the database; hours are counted only where a " +
      "time-in and time-out pair exists, so an open shift contributes nothing. " +
      "&quot;No record&quot; means the system holds no attendance row for that date. " +
      "Total hours for the full OJT requirement: ",
    D(formatHoursValue(summary.requiredHours)),
    " (" + D(String(summary.percentComplete ?? 0)) + "% rendered).</p>",

    "</div></body></html>",
  ].join("");
}

/**
 * Open the DTR in a new window and open the print dialog.
 * @returns {boolean} false when the pop-up was blocked
 */
export function printDtr(html) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // Let the stylesheet apply before the dialog opens, otherwise the print
  // preview can flash unstyled.
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* the user can still print from the browser toolbar */
    }
  }, 300);
  return true;
}
