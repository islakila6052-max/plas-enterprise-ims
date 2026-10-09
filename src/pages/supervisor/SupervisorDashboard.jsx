// src/pages/supervisor/SupervisorDashboard.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StatCard from "@/components/ui/StatCard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { BarChart } from "@/components/ui/Chart";
import { dashboardService } from "@/services/dashboardService";
import { useAuth } from "@/contexts/AuthContext";
import { formatNumber } from "@/utils/format";

const ICONS = {
  assigned: "assigned",
  archived: "archived",
  attendance: "attendance",
  journal: "journal",
  eval: "eval",
};

export default function SupervisorDashboard() {
  const { profile, supervisorId } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchStats() {
    if (!profile || !supervisorId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await dashboardService.supervisorStats(supervisorId);
      setStats(s);
    } catch (err) {
      setError(err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !supervisorId) return;
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, supervisorId]);

  if (loading && !stats) return <Spinner label="Loading dashboard…" />;

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <ErrorAlert
          message={error.message}
          onRetry={fetchStats}
          loading={loading}
        />
      </div>
    );
  }

  const cards = [
    {
      label: "Assigned Interns",
      value: formatNumber(stats.assignedInterns),
      // Show how many of the assigned interns are currently archived so the
      // supervisor can see when the admin archives one of them.
      hint:
        stats.archivedInterns > 0
          ? `${formatNumber(stats.archivedInterns)} archived`
          : undefined,
      icon: ICONS.assigned,
      tone: "brand",
    },
    {
      label: "Archived Interns",
      value: formatNumber(stats.archivedInterns),
      icon: ICONS.archived,
      tone: "slate",
    },
    { label: "Attendance Today", value: formatNumber(stats.attendanceToday), icon: ICONS.attendance, tone: "green" },
    { label: "Pending Journals", value: formatNumber(stats.pendingJournals), icon: ICONS.journal, tone: "amber" },
    { label: "Pending Evaluations", value: formatNumber(stats.pendingEvaluations), icon: ICONS.eval, tone: "red" },
  ];

  const workloadData = [
    { label: "Pending Journals", value: stats.pendingJournals },
    { label: "Pending Evals", value: stats.pendingEvaluations },
    { label: "Attendance Today", value: stats.attendanceToday },
    { label: "Archived", value: stats.archivedInterns },
  ];

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <h2 className="text-xl font-bold text-slate-800">
          Welcome, {profile?.full_name?.split(" ")[0] ?? "Supervisor"}
        </h2>
        <p className="text-sm text-slate-500">
          Track and evaluate your assigned interns.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-up">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">Your workload</h3>
            <p className="mt-0.5 text-sm text-slate-500">Items needing your attention.</p>
          </div>
          <div className="p-5">
            <BarChart data={workloadData} />
          </div>
        </Card>

        <Card className="animate-fade-up">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">Your responsibilities</h3>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <Link
              to="/supervisor/interns"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              View Assigned Interns
            </Link>
            <Link
              to="/supervisor/journals"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Review Journals
            </Link>
            <Link
              to="/supervisor/evaluations"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Submit Evaluations
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
