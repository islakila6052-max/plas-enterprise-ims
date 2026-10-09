// src/components/ui/Chart.jsx
import { cn } from "@/utils/cn";

/**
 * Lightweight, dependency-free SVG charts for the dashboards.
 * - <BarChart> : horizontal bars for a single series.
 * - <DonutChart>: simple donut for proportions.
 * Both are purely presentational (frontend-only) and theme with the green palette.
 */

const PALETTE = ["#15803d", "#16a34a", "#22c55e", "#86efac", "#bbf7d0", "#4ade80"];

export function BarChart({ data, className = "" }) {
  const safe = Array.isArray(data) ? data : [];
  const max = Math.max(1, ...safe.map((d) => d.value));
  return (
    <div className={cn("space-y-3", className)}>
      {safe.length === 0 ? (
        <p className="text-sm text-slate-400">No data available.</p>
      ) : (
        safe.map((d, i) => (
          <div key={d.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-slate-600">{d.label}</span>
              <span className="font-semibold text-slate-800">{d.value}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-brand-50">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(d.value / max) * 100}%`,
                  backgroundColor: PALETTE[i % PALETTE.length],
                }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function DonutChart({ data, size = 160, thickness = 22, centerLabel, centerValue }) {
  const safe = Array.isArray(data) ? data : [];
  const total = Math.max(1, safe.reduce((s, d) => s + d.value, 0));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#dcfce7"
          strokeWidth={thickness}
        />
        {data.map((d, i) => {
          const len = (d.value / total) * circumference;
          const seg = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={d.color ?? PALETTE[i % PALETTE.length]}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div className="space-y-1.5">
        {centerValue !== undefined && (
          <p className="text-2xl font-bold text-slate-800">{centerValue}</p>
        )}
        {centerLabel && <p className="text-xs text-slate-400">{centerLabel}</p>}
        <div className="mt-2 space-y-1">
          {data.map((d, i) => (
            <div key={d.label} className="flex items-center gap-2 text-sm">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: d.color ?? PALETTE[i % PALETTE.length] }}
              />
              <span className="text-slate-600">{d.label}</span>
              <span className="ml-auto font-medium text-slate-800">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
