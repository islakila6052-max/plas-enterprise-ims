// src/pages/intern/InternDashboard.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StatCard from "@/components/ui/StatCard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { BarChart } from "@/components/ui/Chart";
import { dashboardService } from "@/services/dashboardService";
import { useAuth } from "@/contexts/AuthContext";
import { formatHours, formatNumber } from "@/utils/format";

const ICONS = {
  hours: "hours",
  required: "required",
  remaining: "remaining",
  today: "today",
  announce: "announce",
};

export default function InternDashboard() {
  const { profile, internId } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchStats() {
    if (!profile || !internId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await dashboardService.internStats(internId);
      setStats(s);
    } catch (err) {
      setError(err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !internId) return;
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, internId]);

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

  const progress = stats.requiredHours
    ? Math.min(100, (stats.hoursRendered / stats.requiredHours) * 100)
    : 0;

  const cards = [
    {
      label: "Hours Rendered",
      value: formatHours(stats.hoursRendered),
      icon: ICONS.hours,
      tone: "brand",
    },
    {
      label: "Required Hours",
      value: formatHours(stats.requiredHours),
      icon: ICONS.required,
      tone: "blue",
    },
    {
      label: "Remaining Hours",
      value: formatHours(stats.remainingHours),
      icon: ICONS.remaining,
      tone: "green",
    },
    {
      label: "Today's Attendance",
      value: formatNumber(stats.todayAttendance),
      icon: ICONS.today,
      tone: "amber",
    },
    {
      label: "Latest Announcements",
      value: formatNumber(stats.latestAnnouncements),
      icon: ICONS.announce,
      tone: "red",
    },
  ];

  const progressData = [
    { label: "Rendered", value: Math.round(stats.hoursRendered) },
    { label: "Remaining", value: Math.round(stats.remainingHours) },
  ];

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <h2 className="text-xl font-bold text-slate-800">
          Hi, {profile?.full_name?.split(" ")[0] ?? "Intern"} 👋
        </h2>
        <p className="text-sm text-slate-500">
          Keep track of your internship progress.
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
            <h3 className="text-base font-semibold text-slate-800">
              Progress to completion
            </h3>
          </div>
          <div className="p-5">
            <div className="mb-2 flex justify-between text-sm text-slate-500">
              <span>{formatHours(stats.hoursRendered)}</span>
              <span>{formatHours(stats.requiredHours)}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-brand-50">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {formatHours(stats.remainingHours)} remaining to finish your
              internship.
            </p>
            <div className="mt-4">
              <BarChart data={progressData} />
            </div>
          </div>
        </Card>

        <Card className="animate-fade-up">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-800">
              Quick links
            </h3>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <Link
              to="/intern/attendance"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Time In / Out
            </Link>
            <Link
              to="/intern/journal"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Submit Journal
            </Link>
            <Link
              to="/intern/documents"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              Upload Documents
            </Link>
            <Link
              to="/intern/announcements"
              className="rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
              View Announcements
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
