// src/components/ui/EmptyState.jsx
import { Icon } from "@/components/ui/icons";

/** Friendly empty state used when a list/table has no rows. */
export default function EmptyState({ title, description, icon, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 text-slate-400">
          {typeof icon === "string" ? (
            <Icon name={icon} className="h-10 w-10" />
          ) : (
            icon
          )}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
