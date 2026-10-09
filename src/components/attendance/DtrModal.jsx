// src/components/attendance/DtrModal.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Printer } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { Input, Select } from "@/components/ui/Input";
import { attendanceService } from "@/services/attendanceService";
import {
  buildDtr,
  monthBounds,
  formatHoursValue,
  longDate,
  NO_RECORD,
} from "@/lib/dtr";
import { buildDtrDocument, printDtr } from "@/lib/dtrPrint";
import { supabase } from "@/lib/supabase";
import { settingsService } from "@/services/settingsService";
import { useAuth } from "@/contexts/AuthContext";
import { todayDateInAttendanceTZ } from "@/utils/format";

const RANGE_OPTIONS = [
  { value: "this_month", label: "This Month" },
  { value: "prev_month", label: "Previous Month" },
  { value: "ojt", label: "Entire OJT Period" },
  { value: "custom", label: "Custom Date Range" },
];

/**
 * Shown when the `settings` row has no company_name yet. Kept in step with
 * the printed record so a blank settings row still produces a correct DTR.
 */
const DEFAULT_COMPANY = "PLAS ENTERPRISE & ENGINEERING SERVICES";

const EMPTY_META = {
  name: "",
  studentNumber: "",
  department: "",
  institution: "",
  startDate: "",
  endDate: "",
  requiredHours: 0,
};

/**
 * Daily Time Record generator.
 *
 * READ-ONLY BY CONSTRUCTION. The only data call is the read-only
 * `listForRange`; it never invokes a create/update method, so clicking
 * Generate or Print cannot create, alter or delete an attendance record.
 *
 * OWNERSHIP: `internId` comes from `useAuth()` - the signed-in intern's own
 * profile - and is never taken from a URL parameter, query string or prop. The
 * database enforces the same rule independently through the RLS policy on
 * `attendance` (migration 0045), so a hand-crafted request naming another
 * intern returns no rows rather than that intern's data.
 */
export default function DtrModal({ open, onClose }) {
  const { profile, internId } = useAuth();
  const today = todayDateInAttendanceTZ();

  const [rangePreset, setRangePreset] = useState("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dtr, setDtr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [internMeta, setInternMeta] = useState(EMPTY_META);
  const [company, setCompany] = useState(DEFAULT_COMPANY);

  const { from, to } = useMemo(() => {
    if (rangePreset === "this_month") return monthBounds(today, 0);
    if (rangePreset === "prev_month") return monthBounds(today, -1);
    if (rangePreset === "ojt") {
      const b = monthBounds(today);
      return {
        from: internMeta.startDate || b.from,
        to: internMeta.endDate || b.to,
      };
    }
    return { from: customFrom, to: customTo };
  }, [rangePreset, customFrom, customTo, today, internMeta]);

  useEffect(() => {
    if (!open) return;
    const b = monthBounds(today);
    setRangePreset("this_month");
    setCustomFrom(b.from);
    setCustomTo(b.to);
    setDtr(null);
    setError(null);
  }, [open, today]);

  useEffect(() => {
    if (!open || !internId) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("interns")
          .select(
            "full_name, student_number, start_date, end_date, required_hours, school, department:departments(name), institution:institutions(institution_name)",
          )
          .eq("id", internId)
          .maybeSingle();
        if (active && data) {
          setInternMeta({
            name: data.full_name || profile?.full_name || "",
            studentNumber: data.student_number || "",
            department: data.department?.name || "",
            institution: data.institution?.institution_name || data.school || "",
            startDate: data.start_date || "",
            endDate: data.end_date || "",
            requiredHours: Number(data.required_hours) || 0,
          });
        }
      } catch {
        /* the DTR still works; the header simply shows less */
      }
      try {
        const s = await settingsService.get();
        if (active && String(s?.company_name ?? "").trim()) {
          setCompany(String(s.company_name).trim());
        }
      } catch {
        /* keep the default company name */
      }
    })();
    return () => {
      active = false;
    };
  }, [open, internId, profile]);

  const generate = useCallback(async () => {
    if (!internId) {
      toast.error("Your intern profile isn&apos;t linked yet.");
      return;
    }
    if (!from || !to) {
      toast.error("Choose a start and end date.");
      return;
    }
    if (from > to) {
      toast.error("The start date must be on or before the end date.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const records = await attendanceService.listForRange({ internId, from, to });
      setDtr(
        buildDtr({ records, from, to, today, requiredHours: internMeta.requiredHours }),
      );
    } catch (err) {
      setError(err);
      setDtr(null);
    } finally {
      setLoading(false);
    }
  }, [internId, from, to, today, internMeta.requiredHours]);

  function handlePrint() {
    if (!dtr) {
      toast.error("Generate the DTR first.");
      return;
    }
    setPrinting(true);
    try {
      const html = buildDtrDocument({
        dtr,
        from,
        to,
        intern: {
          name: internMeta.name || profile?.full_name || "",
          studentNumber: internMeta.studentNumber,
          department: internMeta.department,
          institution: internMeta.institution,
          position: "Intern",
          startDate: internMeta.startDate ? longDate(internMeta.startDate) : "",
          endDate: internMeta.endDate ? longDate(internMeta.endDate) : "",
        },
        company,
        generatedAt: longDate(today),
      });
      if (!printDtr(html)) {
        toast.error("Pop-up blocked. Please allow pop-ups to print the DTR.");
      }
    } catch (err) {
      toast.error(err.message || "Could not build the DTR.");
    } finally {
      setPrinting(false);
    }
  }

  const summary = dtr?.summary;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Daily Time Record"
      description="Generate and print a DTR built from your own attendance records."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handlePrint} disabled={!dtr || loading} loading={printing}>
            <Printer className="mr-2 h-4 w-4" aria-hidden />
            Print / Save as PDF
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Select
              label="Period"
              value={rangePreset}
              onChange={(e) => setRangePreset(e.target.value)}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          {rangePreset === "custom" && (
            <>
              <Input
                type="date"
                label="From"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <Input
                type="date"
                label="To"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">
            {longDate(from)} &mdash; {longDate(to)}
          </span>
          <Button onClick={generate} loading={loading} size="sm">
            Generate DTR
          </Button>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}

        {loading ? (
          <Spinner label="Building your DTR..." />
        ) : dtr ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                <p className="text-[11px] text-brand-700">Hours rendered</p>
                <p className="text-lg font-bold tabular-nums text-brand-800">
                  {formatHoursValue(summary.totalHours)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">Present / Late</p>
                <p className="text-lg font-bold tabular-nums text-slate-700">
                  {summary.daysPresent} / {summary.daysLate}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">Absent</p>
                <p className="text-lg font-bold tabular-nums text-slate-700">
                  {summary.daysAbsent}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">Open shifts</p>
                <p className="text-lg font-bold tabular-nums text-slate-700">
                  {summary.openShifts}
                </p>
              </div>
            </div>

            {summary.daysWithRecord === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No attendance records exist for this period. The DTR will print
                with every date marked as &quot;{NO_RECORD}&quot; and zero hours.
              </p>
            )}

            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Date</th>
                    <th className="px-2 py-2 font-semibold">In</th>
                    <th className="px-2 py-2 font-semibold">Out</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 text-right font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {dtr.days.map((d) => (
                    <tr
                      key={d.date}
                      className={
                        d.status === "Absent"
                          ? "bg-red-50/50"
                          : !d.hasRecord
                            ? "text-slate-400"
                            : d.completed
                              ? ""
                              : "bg-amber-50/50"
                      }
                    >
                      <td className="px-2 py-1.5 tabular-nums">{d.date}</td>
                      <td className="px-2 py-1.5 tabular-nums">{d.timeIn || "-"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{d.timeOut || "-"}</td>
                      <td className="px-2 py-1.5">{d.status}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.completed ? formatHoursValue(d.hours) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">
            Choose a period and select <strong>Generate DTR</strong> to preview
            your record.
          </p>
        )}
      </div>
    </Modal>
  );
}
