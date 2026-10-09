// src/components/ui/Avatar.jsx
import { cn } from "@/utils/cn";
import { getInitials } from "@/utils/format";

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

/** Avatar with image fallback to initials. */
export default function Avatar({ src, name, size = "md", className = "" }) {
  const initials = getInitials(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-700",
        SIZES[size],
        className,
      )}>
      {src ? (
        <img
          src={src}
          alt={name ?? "User"}
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}
