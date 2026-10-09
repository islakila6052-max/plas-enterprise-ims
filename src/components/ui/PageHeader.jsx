// src/components/ui/PageHeader.jsx
import { cn } from "@/utils/cn";

/** Standard page header with title, description and optional action. */
export default function PageHeader({ title, description, action, className = "" }) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}>
      <div>
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
