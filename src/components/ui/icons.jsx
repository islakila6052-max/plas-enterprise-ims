// src/components/ui/icons.jsx
/**
 * Central, professional icon set for the whole app.
 *
 * Every icon is a thin, consistent stroke (Lucide-style) so the sidebar,
 * stat cards, empty states, and document lists all share one visual language.
 * Icons render with `currentColor`, so they inherit text color / tone.
 *
 * Usage:
 *   import { Icon } from "@/components/ui/icons";
 *   <Icon name="dashboard" className="h-5 w-5" />
 *
 * Or use a specific glyph directly:
 *   import { DashboardIcon, UsersIcon } from "@/components/ui/icons";
 */
import { cn } from "@/utils/cn";

// Each entry is the inner SVG markup (paths) for a 24x24 viewBox.
const PATHS = {
  dashboard:
    "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  users:
    "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  userCheck:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm9 2l2 2 4-4",
  userPlus:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm6 0v6m3-3h-6",
  clock:
    "M12 22a10 10 0 100-20 10 10 0 000 20zm0-16v6l4 2",
  calendarCheck:
    "M16 2v4M8 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm8 11l2 2 4-4",
  book:
    "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 016.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z",
  fileText:
    "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  star:
    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  megaphone:
    "M3 11v2a1 1 0 001 1h2l9 5V5L6 10H4a1 1 0 00-1 1zm13-3v8M18 7v10",
  barChart:
    "M12 20V10M18 20V4M6 20v-6",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  user:
    "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  checkCircle:
    "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3",
  circle:
    "M12 22a10 10 0 100-20 10 10 0 000 20z",
  hourglass:
    "M6 2h12M6 22h12M6 2c0 4 4 6 6 8 2-2 6-4 6-8M6 22c0-4 4-6 6-8 2 2 6 4 6 8",
  target:
    "M12 22a10 10 0 100-20 10 10 0 000 20zm0-4a6 6 0 100-12 6 6 0 000 12zm0-4a2 2 0 100-4 2 2 0 000 4z",
  bell:
    "M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z",
  file:
    "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6",
  graduationCap:
    "M22 10v6M2 10l10-5 10 5-10 5zM6 12v5c3 1.5 6 1.5 9 0v-5",
  building:
    "M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2M10 21v-4h4v4",
  institutions:
    "M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2M10 21v-4h4v4",
  clipboardCheck:
    "M9 2h6a1 1 0 011 1v2h2a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2V3a1 1 0 011-1zm1 7l2 2 4-4",
  logOut:
    "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  menu:
    "M3 12h18M3 6h18M3 18h18",
  chevronDown:
    "M6 9l6 6 6-6",
  close:
    "M18 6L6 18M6 6l12 12",
  search:
    "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  plus:
    "M12 5v14M5 12h14",
  download:
    "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  eye:
    "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff:
    "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24",
  alertCircle:
    "M12 22a10 10 0 100-20 10 10 0 000 20zm0-14v4m0 4h.01",
  shield:
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  pieChart:
    "M21.21 15.89A10 10 0 118 2.83M22 12A10 10 0 0012 2v10z",
  archive:
    "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
};

// Friendly aliases used by callers.
const ALIASES = {
  interns: "users",
  assigned: "userCheck",
  attendance: "clock",
  journal: "book",
  documents: "fileText",
  evaluation: "star",
  evaluations: "star",
  announcements: "megaphone",
  reports: "barChart",
  profile: "user",
  audit: "shield",
  hours: "clock",
  required: "target",
  remaining: "hourglass",
  today: "calendarCheck",
  announce: "megaphone",
  active: "checkCircle",
  completed: "checkCircle",
  eval: "star",
  pending: "inbox",
  archived: "archive",
};

function resolve(name) {
  if (!name) return null;
  return PATHS[name] ?? PATHS[ALIASES[name]] ?? PATHS[name.toLowerCase()] ?? null;
}

/**
 * Generic icon renderer.
 * @param {{ name: string, className?: string, strokeWidth?: number }} props
 */
export function Icon({ name, className = "h-5 w-5", strokeWidth = 2 }) {
  const d = resolve(name);
  if (!d) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export { PATHS as ICON_PATHS, ALIASES as ICON_ALIASES };
export default Icon;
