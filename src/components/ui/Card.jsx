// src/components/ui/Card.jsx
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

/**
 * Surface card used for panels and dashboard widgets.
 *
 * Forwards its ref to the underlying div so callers can scroll to it or measure
 * it. Previously a ref passed here was silently dropped.
 */
export const Card = forwardRef(function Card({ children, className = "", ...props }, ref) {
  return (
    <div ref={ref} className={cn("surface", className)} {...props}>
      {children}
    </div>
  );
});

export default Card;

/** Card header with title + optional action slot. */
export function CardHeader({ title, subtitle, action, className = "" }) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4",
        className,
      )}>
      <div>
        {title && (
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        )}
        {subtitle && (
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
