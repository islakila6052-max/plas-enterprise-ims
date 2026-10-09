// src/components/ui/Spinner.jsx
import { cn } from "@/utils/cn";

/** Centered spinner for loading states. */
export default function Spinner({ className = "", label }) {
  return (
    <div className={cn("flex items-center justify-center gap-3 py-10", className)}>
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label && <span className="text-sm text-slate-500">{label}</span>}
    </div>
  );
}
