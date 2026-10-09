// src/components/ui/Modal.jsx
import { useEffect, useRef } from "react";
import { cn } from "@/utils/cn";
import { Icon } from "@/components/ui/icons";

/**
 * Accessible modal dialog.
 *
 * By default the dialog closes on Escape and on a backdrop click.
 *
 * Set `dismissible={false}` for data-entry forms (e.g. "Add Intern") where an
 * accidental backdrop click would silently discard everything the user typed.
 * The X button and any explicit Cancel action still close the dialog, so the
 * user is never trapped. When `dismissible` is false we also stop Escape from
 * closing, because the two dismissal paths should behave consistently — a user
 * who cannot dismiss by clicking outside should not lose work by reflexively
 * hitting Escape either.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}) {
  // Tracks whether the pointer went down on the backdrop itself. Without this,
  // a click that *starts* inside the scrolling panel and is released outside it
  // still fires the backdrop's onClick and closes the dialog.
  const backdropPressRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && dismissible) onClose?.();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;

  const widths = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  return (
    <div
      className="fixed inset-0 z-50 min-h-screen min-h-[100dvh] overflow-y-auto flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}>
      <div
        className="absolute inset-0 h-full w-full bg-slate-900/50 backdrop-blur-sm"
        onMouseDown={() => {
          backdropPressRef.current = true;
        }}
        onClick={() => {
          // Only treat this as a dismissal if the press began on the backdrop.
          if (dismissible && backdropPressRef.current) onClose?.();
          backdropPressRef.current = false;
        }}
      />
      <div
        className={cn(
          "relative z-10 w-full surface max-h-[90vh] overflow-y-auto",
          widths[size],
        )}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {title && (
              <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-slate-500">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
