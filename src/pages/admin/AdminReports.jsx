"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "react-hot-toast";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import { Input, Select } from "@/components/ui/Input";
import { internService } from "@/services/internService";
import { supervisorService } from "@/services/supervisorService";
import { departmentService } from "@/services/departmentService";
import { institutionService } from "@/services/institutionService";
import { programService } from "@/services/programService";
import { attendanceService } from "@/services/attendanceService";
import { journalService } from "@/services/journalService";
import { evaluationService } from "@/services/evaluationService";
import { settingsService } from "@/services/settingsService";
import { formatDate, formatTime, formatHours } from "@/utils/format";
import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { logger } from "@/lib/logger";
import {
  INTERN_STATUS,
  INTERN_STATUS_LABELS,
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_LABELS,
  JOURNAL_STATUS,
  JOURNAL_STATUS_LABELS,
  EVALUATION_RECOMMENDATIONS,
} from "@/lib/constants";

const REPORTS = [
  {
    key: "intern_list",
    label: "Intern List",
    columns: [
      { key: "Name", header: "Name" },
      { key: "Student No.", header: "Student No." },
      { key: "Department", header: "Department" },
      { key: "Institution", header: "Institution" },
      { key: "Program", header: "Program" },
      { key: "Status", header: "Status" },
      { key: "Required Hours", header: "Required Hours" },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    columns: [
      { key: "Intern", header: "Intern" },
      { key: "Student No.", header: "Student No." },
      { key: "Date", header: "Date" },
      { key: "Time In", header: "Time In" },
      { key: "Time Out", header: "Time Out" },
      { key: "Hours", header: "Hours" },
      { key: "Status", header: "Status" },
    ],
  },
  {
    key: "journals",
    label: "Daily Journals",
    columns: [
      { key: "Intern", header: "Intern" },
      { key: "Student No.", header: "Student No." },
      { key: "Date", header: "Date" },
      { key: "Hours Worked", header: "Hours Worked" },
      { key: "Status", header: "Status" },
    ],
  },
  {
    key: "evaluations",
    label: "Evaluation Summary",
    columns: [
      { key: "Intern", header: "Intern" },
      { key: "Overall Rating", header: "Overall Rating" },
      { key: "Recommendation", header: "Recommendation" },
      { key: "Status", header: "Status" },
    ],
  },
  {
    key: "hours",
    label: "Hours Rendered",
    columns: [
      { key: "Name", header: "Name" },
      { key: "Required Hours", header: "Required Hours" },
      { key: "Rendered Hours", header: "Rendered Hours" },
    ],
  },
];

// --- Default filter helpers ---
function defaultInternListFilters() {
  return {
    departmentId: "",
    status: "",
    institutionId: "",
    programId: "",
    createdFrom: "",
    createdTo: "",
  };
}

function defaultAttendanceFilters() {
  return {
    dateFrom: "",
    dateTo: "",
    internId: "",
    status: "",
  };
}

function defaultJournalsFilters() {
  return {
    dateFrom: "",
    dateTo: "",
    internId: "",
    status: "",
  };
}

function defaultEvaluationsFilters() {
  return {
    ratingMin: "",
    ratingMax: "",
    recommendation: "",
  };
}

function defaultHoursFilters() {
  return {
    dateFrom: "",
    dateTo: "",
    internId: "",
    departmentId: "",
    minHours: "",
  };
}

function lastThirtyDaysRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return {
    dateFrom: from.toISOString().split("T")[0],
    dateTo: to.toISOString().split("T")[0],
  };
}

// --- Persisted filter state, one object per report type ---
function defaultFiltersMap() {
  const range = lastThirtyDaysRange();
  return {
    intern_list: defaultInternListFilters(),
    attendance: { ...defaultAttendanceFilters(), ...range },
    journals: { ...defaultJournalsFilters(), ...range },
    evaluations: defaultEvaluationsFilters(),
    hours: { ...defaultHoursFilters(), ...range },
  };
}

/** Count truthy (non-empty) filter values in a single report type's filter set. */
function countActiveFilters(f) {
  if (!f || typeof f !== "object") return 0;
  return Object.values(f).filter((v) => v !== "" && v != null && v !== false)
    .length;
}

// --- Build filter objects per report type ---
function buildInternListFilters(f) {
  const {
    departmentId,
    status,
    institutionId,
    programId,
    createdFrom,
    createdTo,
  } = f;
  const obj = {};
  if (departmentId) obj.departmentId = departmentId;
  if (status) obj.status = status;
  if (institutionId) obj.institutionId = institutionId;
  if (programId) obj.programId = programId;
  if (createdFrom) obj.createdFrom = createdFrom;
  if (createdTo) obj.createdTo = createdTo;
  return obj;
}

function buildAttendanceFilters(f) {
  const { dateFrom, dateTo, internId, status } = f;
  const obj = {};
  if (dateFrom) obj.dateFrom = dateFrom;
  if (dateTo) obj.dateTo = dateTo;
  if (internId) obj.internId = internId;
  if (status) obj.status = status;
  return obj;
}

function buildJournalsFilters(f) {
  const { dateFrom, dateTo, internId, status } = f;
  const obj = {};
  if (dateFrom) obj.dateFrom = dateFrom;
  if (dateTo) obj.dateTo = dateTo;
  if (internId) obj.internId = internId;
  if (status) obj.status = status;
  return obj;
}

function buildEvaluationsFilters(f) {
  const { ratingMin, ratingMax, recommendation } = f;
  const obj = {};
  if (ratingMin) obj.ratingMin = Number(ratingMin);
  if (ratingMax) obj.ratingMax = Number(ratingMax);
  if (recommendation) obj.recommendation = recommendation;
  return obj;
}

// --- Helper functions to get values from objects with different property names ---
const getInstitutionId = (item) => item?.id || item?.institution_id || item?.Id;
const getInstitutionName = (item) =>
  item?.name || item?.institution_name || item?.Name || "Unnamed";

const getProgramId = (item) => item?.id || item?.program_id || item?.Id;
const getProgramName = (item) =>
  item?.name || item?.program_name || item?.Name || "Unnamed";

const getDepartmentId = (item) => item?.id || item?.department_id || item?.Id;
const getDepartmentName = (item) =>
  item?.name || item?.department_name || item?.Name || "Unnamed";

// --- Main Component ---
export default function AdminReports() {
  const [type, setType] = useState("intern_list");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [allPrograms, setAllPrograms] = useState([]); // Store all programs with institution_id
  const [interns, setInterns] = useState([]);

  // Filters are persisted per report type in a nested object so that switching
  // between report types never loses filters the admin already configured.
  const [filters, setFilters] = useState(() => {
    const base = defaultFiltersMap();
    try {
      const stored = localStorage.getItem("adminReportsFilters");
      if (stored) {
        const parsed = JSON.parse(stored);
        for (const key of Object.keys(base)) {
          if (
            parsed &&
            typeof parsed[key] === "object" &&
            parsed[key] !== null
          ) {
            base[key] = { ...base[key], ...parsed[key] };
          }
        }
      }
    } catch {
      // Ignore corrupted/unavailable storage; fall back to defaults.
    }
    return base;
  });

  // Load dropdown data
  useEffect(() => {
    async function loadData() {
      try {
        const [deptRes, instRes, progRes, internRes] = await Promise.all([
          departmentService.list(),
          institutionService.list(),
          programService.list(),
          internService.list({ page: 1, pageSize: 500 }),
        ]);

        // Handle departments
        const deptData = Array.isArray(deptRes) ? deptRes : deptRes?.data || [];
        setDepartments(deptData);

        // Handle institutions
        const instData = Array.isArray(instRes) ? instRes : instRes?.data || [];
        setInstitutions(instData);

        // Handle ALL programs (with institution_id)
        const progData = Array.isArray(progRes) ? progRes : progRes?.data || [];
        setAllPrograms(progData);

        // Handle interns
        const internData = internRes?.data || [];
        setInterns(internData);
      } catch (err) {
        logger.error("Failed to load filter options:", err);
        toast.error("Failed to load filter options");
      }
    }
    loadData();
  }, []);

  // Get filtered programs based on selected institution
  const filteredPrograms = useMemo(() => {
    const currentFiltersForType = filters[type] || {};
    const selectedInstitutionId = currentFiltersForType.institutionId;

    if (!selectedInstitutionId) {
      // If no institution selected, show all programs
      return allPrograms;
    }

    // Filter programs by selected institution
    return allPrograms.filter((p) => {
      const instId = p?.institution_id || p?.institutionId;
      return String(instId) === String(selectedInstitutionId);
    });
  }, [allPrograms, filters, type]);

  useEffect(() => {
    try {
      localStorage.setItem("adminReportsFilters", JSON.stringify(filters));
    } catch {
      // Ignore storage quota / privacy errors.
    }
  }, [filters]);

  // fetchData with filters
  async function fetchData() {
    const typeFilters = filters[type] || {};
    switch (type) {
      case "intern_list": {
        const res = await internService.list({
          page: 1,
          pageSize: 1000,
          ...buildInternListFilters(typeFilters),
        });
        return (res.data ?? []).map((r) => ({
          Name: r.full_name ?? "—",
          "Last Name": r.last_name ?? "",
          Department: r.department?.name ?? "",
          Institution: r.institution?.institution_name ?? "",
          Program: r.program?.program_name ?? "",
          Status: r.status ?? "",
          "Required Hours": r.required_hours ?? 0,
        }));
      }
      case "attendance": {
        const res = await attendanceService.adminList({
          page: 1,
          pageSize: 1000,
          ...buildAttendanceFilters(typeFilters),
        });
        return (res.data ?? []).map((a) => ({
          Intern: a.intern?.full_name ?? "—",
          "Last Name": a.intern?.last_name ?? "",
          Date: formatDate(a.date),
          "Time In": a.time_in ? formatTime(a.time_in) : "—",
          "Time Out": a.time_out ? formatTime(a.time_out) : "—",
          Hours: formatHours(a.total_hours ?? 0),
          Status: a.status ?? "",
        }));
      }
      case "journals": {
        const res = await journalService.list({
          page: 1,
          pageSize: 1000,
          ...buildJournalsFilters(typeFilters),
        });
        return (res.data ?? []).map((j) => ({
          Intern: j.intern?.full_name ?? "—",
          "Last Name": j.intern?.last_name ?? "",
          Date: formatDate(j.date),
          "Hours Worked": j.hours_worked ?? 0,
          Status: j.status ?? "",
        }));
      }
      case "evaluations": {
        const res = await evaluationService.list({
          page: 1,
          pageSize: 1000,
          ...buildEvaluationsFilters(typeFilters),
        });
        return (res.data ?? []).map((e) => ({
          Intern: e.intern?.full_name ?? "—",
          "Overall Rating": `${e.overall_rating ?? "—"}/5`,
          Recommendation: e.final_recommendation ?? "—",
          Status: e.status ?? "",
        }));
      }
      case "hours": {
        const [internsRes, attRes] = await Promise.all([
          internService.list({
            page: 1,
            pageSize: 1000,
            ...buildInternListFilters(typeFilters),
          }),
          attendanceService.adminList({
            page: 1,
            pageSize: 5000,
            ...buildAttendanceFilters(typeFilters),
          }),
        ]);
        const renderedByIntern = (attRes.data ?? []).reduce((acc, r) => {
          if (r.intern_id) {
            acc[r.intern_id] =
              (acc[r.intern_id] ?? 0) + (Number(r.total_hours) || 0);
          }
          return acc;
        }, {});
        const minHours = Number(typeFilters.minHours) || 0;
        let interns = internsRes.data ?? [];
        if (typeFilters.internId) {
          const selected = String(typeFilters.internId);
          interns = interns.filter((i) => String(i.id) === selected);
        }
        return interns
          .filter((i) => (renderedByIntern[i.id] ?? 0) >= minHours)
          .map((i) => ({
            Name: i.full_name ?? "—",
            "Required Hours": i.required_hours ?? 0,
            "Rendered Hours": formatHours(renderedByIntern[i.id] ?? 0),
          }));
      }
      default:
        return [];
    }
  }

  async function generatePreview() {
    if (busy) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    // Validate date ranges before hitting the database.
    const tf = filters[type] || {};
    if (tf.dateFrom && tf.dateTo && tf.dateFrom > tf.dateTo) {
      toast.error("The From date cannot be after the To date.");
      return;
    }
    if (tf.createdFrom && tf.createdTo && tf.createdFrom > tf.createdTo) {
      toast.error("The From date cannot be after the To date.");
      return;
    }
    setBusy(true);
    try {
      const data = await fetchData();
      setPreview(data);
      toast.success(`Preview generated: ${data.length} records`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportPDF() {
    if (busy) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("No internet connection. Please check your network and try again.");
      return;
    }
    setBusy(true);
    try {
      const data = await fetchData();
      if (!data.length) {
        toast.error("No data to export.");
        return;
      }

      let companyName = "Internship Management System";
      try {
        const settings = await settingsService.get();
        if (settings?.company_name) companyName = settings.company_name;
      } catch {
        /* use default */
      }

      const doc = new jsPDF({
        orientation: data.length > 5 ? "landscape" : "portrait",
      });

      const reportLabel = REPORTS.find((r) => r.key === type)?.label ?? type;
      const generated = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const rows = data.map((d) => Object.values(d));
      const rawHeaders = Object.keys(data[0]);
      const headers = rawHeaders.map((h) =>
        h
          .replace(/([A-Z])/g, " $1")
          .replace(/^\s/, "")
          .replace(/\s+/g, " ")
          .trim(),
      );

      doc.setFontSize(16);
      doc.setTextColor(21, 128, 61);
      doc.text(companyName, 14, 18);
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.text(`Report: ${reportLabel}`, 14, 26);
      doc.text(`Generated: ${generated}  ·  ${data.length} records`, 14, 33);

      autoTable(doc, {
        head: [headers],
        body: rows,
        startY: 40,
        margin: { left: 14, right: 14 },
        styles: {
          fontSize: 9,
          cellPadding: 4,
          lineColor: [226, 232, 240],
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [21, 128, 61],
          textColor: 255,
          fontStyle: "bold",
          halign: "center",
        },
        bodyStyles: {
          textColor: [51, 65, 85],
          valign: "middle",
        },
        alternateRowStyles: {
          fillColor: [240, 253, 244],
        },
        columnStyles: {},
        didDrawPage: (hookData) => {
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(
            `Page ${hookData.pageNumber}`,
            doc.internal.pageSize.getWidth() - 20,
            doc.internal.pageSize.getHeight() - 10,
            { align: "right" },
          );
          doc.text(
            `IMS Report — ${reportLabel}`,
            14,
            doc.internal.pageSize.getHeight() - 10,
          );
        },
      });

      doc.save(`IMS-${type}-Report.pdf`);
      toast.success("PDF exported.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  function printPreview() {
    if (busy) return;
    if (!preview || !preview.length)
      return toast.error("Generate a preview first.");
    try {
      const escapeHtml = (v) =>
        String(v ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const headers = Object.keys(preview[0]);
      const rows = preview.map((d) => Object.values(d));
      const html = `
      <h2>IMS Report — ${escapeHtml(type)}</h2>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:12px">
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
      const w = window.open("", "_blank");
      if (!w) {
        toast.error("Pop-up blocked. Please allow pop-ups to print this report.");
        return;
      }
      w.document.write(`<html><body>${html}</body></html>`);
      w.document.close();
      w.focus();
      w.print();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const previewColumns = REPORTS.find((r) => r.key === type)?.columns ?? [];

  function updateTypeFilters(updater) {
    setFilters((f) => {
      const prev = f[type] || {};
      const next = typeof updater === "function" ? updater(prev) : updater;
      return { ...f, [type]: next };
    });
  }

  const currentFilters = filters[type] || {};

  // Handle institution change - clear program selection when institution changes
  const handleInstitutionChange = (value) => {
    updateTypeFilters((f) => ({
      ...f,
      institutionId: value,
      programId: "", // Reset program when institution changes
    }));
  };

  // Render filter fields based on report type
  const renderFilterFields = () => {
    switch (type) {
      case "intern_list":
        return (
          <>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Department
              </label>
              <Select
                value={currentFilters.departmentId || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    departmentId: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {departments.map((d) => (
                  <option key={getDepartmentId(d)} value={getDepartmentId(d)}>
                    {getDepartmentName(d)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Status
              </label>
              <Select
                value={currentFilters.status || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, status: e.target.value }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {Object.values(INTERN_STATUS).map((s) => (
                  <option key={s} value={s}>
                    {INTERN_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[140px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Institution
              </label>
              <Select
                value={currentFilters.institutionId || ""}
                onChange={(e) => handleInstitutionChange(e.target.value)}
                className="w-full text-sm"
                size="sm">
                <option value="">All Institutions</option>
                {institutions.map((i) => (
                  <option key={getInstitutionId(i)} value={getInstitutionId(i)}>
                    {getInstitutionName(i)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Program
              </label>
              <Select
                value={currentFilters.programId || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    programId: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">
                  {currentFilters.institutionId
                    ? "All Programs"
                    : "Select Institution First"}
                </option>
                {filteredPrograms.map((p) => (
                  <option key={getProgramId(p)} value={getProgramId(p)}>
                    {getProgramName(p)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                From
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.createdFrom || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    createdFrom: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                To
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.createdTo || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    createdTo: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>
          </>
        );

      case "attendance":
        return (
          <>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                From
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.dateFrom || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                To
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.dateTo || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[150px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Intern
              </label>
              <Select
                value={currentFilters.internId || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, internId: e.target.value }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {interns.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.full_name || i.name || "—"}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Status
              </label>
              <Select
                value={currentFilters.status || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, status: e.target.value }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {Object.values(ATTENDANCE_STATUS).map((s) => (
                  <option key={s} value={s}>
                    {ATTENDANCE_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
          </>
        );

      case "journals":
        return (
          <>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                From
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.dateFrom || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                To
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.dateTo || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[150px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Intern
              </label>
              <Select
                value={currentFilters.internId || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, internId: e.target.value }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {interns.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.full_name || i.name || "—"}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Status
              </label>
              <Select
                value={currentFilters.status || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, status: e.target.value }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {Object.values(JOURNAL_STATUS).map((s) => (
                  <option key={s} value={s}>
                    {JOURNAL_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
          </>
        );

      case "evaluations":
        return (
          <>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Min Rating
              </label>
              <Select
                value={currentFilters.ratingMin || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    ratingMin: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                <option value="1">1 Star</option>
                <option value="2">2 Stars</option>
                <option value="3">3 Stars</option>
                <option value="4">4 Stars</option>
                <option value="5">5 Stars</option>
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Max Rating
              </label>
              <Select
                value={currentFilters.ratingMax || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    ratingMax: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                <option value="1">1 Star</option>
                <option value="2">2 Stars</option>
                <option value="3">3 Stars</option>
                <option value="4">4 Stars</option>
                <option value="5">5 Stars</option>
              </Select>
            </div>

            <div className="flex-1 min-w-[140px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Recommendation
              </label>
              <Select
                value={currentFilters.recommendation || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    recommendation: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {EVALUATION_RECOMMENDATIONS.map((rec) => (
                  <option key={rec.value} value={rec.value}>
                    {rec.label}
                  </option>
                ))}
              </Select>
            </div>
          </>
        );

      case "hours":
        return (
          <>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                From
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.dateFrom || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                To
              </label>
              <Input
                type="date"
                maxLength={10}
                value={currentFilters.dateTo || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
                className="w-full text-sm"
                size="sm"
              />
            </div>

            <div className="flex-1 min-w-[150px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Intern
              </label>
              <Select
                value={currentFilters.internId || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({ ...f, internId: e.target.value }))
                }
                className="w-full text-sm"
                size="sm">
                <option value="">All</option>
                {interns.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.full_name || i.name || "—"}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Min Hours
              </label>
              <Input
                type="number"
                value={currentFilters.minHours || ""}
                onChange={(e) =>
                  updateTypeFilters((f) => ({
                    ...f,
                    minHours: e.target.value,
                  }))
                }
                className="w-full text-sm"
                size="sm"
                placeholder="e.g. 100"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Generate and export internship reports."
      />
      <Card>
        <div className="space-y-4 p-5">
          {/* Row 1: Report type buttons */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Select report
            </p>
            <div className="flex flex-wrap gap-2">
              {REPORTS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => {
                    setType(r.key);
                    setPreview(null);
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                    type === r.key
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-brand-100 text-slate-600 hover:bg-brand-50"
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Filter fields + Action buttons */}
          <div className="flex flex-wrap items-end gap-3 border-t border-brand-100 pt-4">
            {renderFilterFields()}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 ml-auto">
              <Button
                variant="secondary"
                onClick={generatePreview}
                disabled={busy}
                size="sm">
                Generate Preview
              </Button>
              <Button onClick={exportPDF} disabled={busy} size="sm">
                Download PDF
              </Button>
              <Button
                variant="secondary"
                onClick={printPreview}
                disabled={busy}
                size="sm">
                Print
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {preview && (
        <Card className="mt-6">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">
              Preview — {REPORTS.find((r) => r.key === type)?.label}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {preview.length} records
            </p>
          </div>
          <Table columns={previewColumns} rows={preview} rowKey={(_, i) => i} />
        </Card>
      )}
    </div>
  );
}
