// src/components/ui/Badge.jsx
import { cn } from "@/utils/cn";

const TONES = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-brand-100 text-brand-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-blue-100 text-blue-700",
  brand: "bg-brand-100 text-brand-700",
};

/** Small status / category pill. */
export default function Badge({ children, tone = "gray", className = "" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone] ?? TONES.gray,
        className,
      )}>
      {children}
    </span>
  );
}
