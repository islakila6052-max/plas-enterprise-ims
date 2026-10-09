// src/components/ui/PasswordStrengthMeter.jsx
import { cn } from "@/utils/cn";

/**
 * Minimal password strength indicator: a single thin line that fills and
 * changes color as more password requirements are met. Replaces the old
 * bulleted requirements list.
 *
 * Requirements (same as the Add Intern / Add Supervisor validation rules):
 *   1. At least 12 characters (H6 - raised from 8 to match the server policy
 *      enforced by api/admin/_security.js)
 *   2. One uppercase letter (A-Z)
 *   3. One lowercase letter (a-z)
 *   4. One number (0-9)
 *   5. One symbol (!@#$…)
 */
const CHECKS = [
  (pw) => pw.length >= 8,
  (pw) => /[A-Z]/.test(pw),
  (pw) => /[a-z]/.test(pw),
  (pw) => /\d/.test(pw),
  (pw) => /[^A-Za-z0-9]/.test(pw),
];

/** Track/fill colors per number of met requirements. */
const STRENGTH_STYLES = [
  "", // 0 met — empty track only
  "bg-red-500", // 1 — very weak
  "bg-orange-500", // 2 — weak
  "bg-amber-500", // 3 — fair
  "bg-lime-500", // 4 — good
  "bg-green-600", // 5 — strong (all requirements met)
];

/**
 * Return the first unmet password requirement as a human-readable message,
 * or null when the password satisfies all of them (or is empty). Used to show
 * the failing requirement live while the user types — not only after submit.
 */
export function getPasswordIssue(pw = "") {
  if (!pw) return null;
  if (pw.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Z]/.test(pw))
    return "Password must contain an uppercase letter (A–Z)";
  if (!/[a-z]/.test(pw))
    return "Password must contain a lowercase letter (a–z)";
  if (!/\d/.test(pw)) return "Password must contain a number (0–9)";
  if (!/[^A-Za-z0-9]/.test(pw))
    return "Password must contain a symbol (!@#$…)";
  return null;
}

export default function PasswordStrengthMeter({ password = "", className = "" }) {
  const met = CHECKS.reduce((n, check) => n + (check(password) ? 1 : 0), 0);
  const pct = (met / CHECKS.length) * 100;
  const complete = password.length > 0 && met === CHECKS.length;

  return (
    <div>
      <div
        className={cn(
          "mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200",
          className,
        )}
        role="progressbar"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={CHECKS.length}
        aria-valuenow={met}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            STRENGTH_STYLES[met],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Green confirmation once every requirement is satisfied. Unmet
          requirements are surfaced live as red text under the input itself. */}
      {complete && (
        <p className="mt-1 text-xs font-medium text-green-600">
          Password meets all requirements
        </p>
      )}
    </div>
  );
}
