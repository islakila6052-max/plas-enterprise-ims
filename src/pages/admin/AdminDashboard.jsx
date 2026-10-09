// src/pages/admin/AdminDashboard.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StatCard from "@/components/ui/StatCard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { BarChart, DonutChart } from "@/components/ui/Chart";
import { dashboardService } from "@/services/dashboardService";
import { useAuth } from "@/contexts/AuthContext";
import { formatNumber } from "@/utils/format";

const ICONS = {
  interns: "interns",
  active: "active",
  completed: "completed",
  eval: "eval",
  attendance: "attendance",
  archived: "archived",
};

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchStats() {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const s = await dashboardService.adminStats();
      setStats(s);
    } catch (err) {
      setError(err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Wait until the session/profile is resolved before querying. Firing
    // these count() calls unauthenticated makes PostgREST reject the request
    // (e.g. 400 on evaluations?status=neq.completed) and the dashboard
    // silently shows zeros.
    if (!profile) return;
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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
    { label: "Total Interns", value: formatNumber(stats.totalInterns), icon: ICONS.interns, tone: "brand" },
    { label: "Active Interns", value: formatNumber(stats.activeInterns), icon: ICONS.active, tone: "green" },
    { label: "Completed Internships", value: formatNumber(stats.completedInternships), icon: ICONS.completed, tone: "blue" },
    { label: "Archived Interns", value: formatNumber(stats.archivedInterns), icon: ICONS.archived, tone: "slate" },
    { label: "Pending Evaluations", value: formatNumber(stats.pendingEvaluations), icon: ICONS.eval, tone: "amber" },
    { label: "Attendance Today", value: formatNumber(stats.attendanceToday), icon: ICONS.attendance, tone: "red" },
  ];

  const internStatusData = [
    { label: "Active", value: stats.activeInterns },
    { label: "Completed", value: stats.completedInternships },
    { label: "Pending Evals", value: stats.pendingEvaluations },
    { label: "Archived", value: stats.archivedInterns, color: "#94a3b8" },
  ];

  const attendanceData = [
    { label: "Present", value: stats.attendanceToday },
    { label: "Pending", value: Math.max(0, stats.totalInterns - stats.attendanceToday) },
  ];

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <h2 className="text-xl font-bold text-slate-800">
          Welcome back, {profile?.full_name?.split(" ")[0] ?? "Admin"}
        </h2>
        <p className="text-sm text-slate-500">
          Here's an overview of your internship program.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="animate-fade-up lg:col-span-2">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">Intern Status</h3>
            <p className="mt-0.5 text-sm text-slate-500">Breakdown of current interns.</p>
          </div>
          <div className="p-5">
            <DonutChart
              data={internStatusData}
              centerValue={stats.totalInterns}
              centerLabel="Total interns"
            />
          </div>
        </Card>

        <Card className="animate-fade-up">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">Attendance Today</h3>
            <p className="mt-0.5 text-sm text-slate-500">Checked-in vs not yet.</p>
          </div>
          <div className="p-5">
            <BarChart data={attendanceData} />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-up">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">Quick actions</h3>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <Link
              to="/admin/interns"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              + Add / Manage Interns
            </Link>
            <Link
              to="/admin/attendance"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Review Attendance
            </Link>
            <Link
              to="/admin/reports"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Generate Reports
            </Link>
            <Link
              to="/admin/settings"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              System Settings
            </Link>
          </div>
        </Card>

        <Card className="animate-fade-up">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">Program summary</h3>
          </div>
          <dl className="divide-y divide-brand-50 p-5 text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-slate-500">Active vs Completed</dt>
              <dd className="font-medium text-slate-700">
                {stats.activeInterns} / {stats.completedInternships}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-500">Archived interns</dt>
              <dd className="font-medium text-slate-700">{stats.archivedInterns}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-500">Evaluations awaiting review</dt>
              <dd className="font-medium text-slate-700">{stats.pendingEvaluations}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-slate-500">Checked in today</dt>
              <dd className="font-medium text-slate-700">{stats.attendanceToday}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
