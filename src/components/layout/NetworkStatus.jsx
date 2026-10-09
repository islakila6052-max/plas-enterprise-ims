// src/components/layout/NetworkStatus.jsx
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

/**
 * Banner that appears at the top of the screen when the user
 * goes offline. Uses react-hot-toast for non-blocking toasts
 * on reconnect.
 */
export default function NetworkStatus() {
  const isOnline = useOnlineStatus();
  const [showBanner, setShowBanner] = useState(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const prevOnline = useRef(isOnline);
  const toastIdRef = useRef(null);

  useEffect(() => {
    const wasOnline = prevOnline.current;
    prevOnline.current = isOnline;
    // Skip the initial mount — only react to transitions so we don't
    // toast "Connection restored" on every page load.
    if (wasOnline === isOnline) {
      setShowBanner(!isOnline);
      return;
    }
    if (!isOnline) {
      setShowBanner(true);
      // Dismiss any reconnect toast
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    } else {
      setShowBanner(false);
      // Show a "reconnected" toast only on offline -> online transitions.
      toastIdRef.current = toast.success("Connection restored.", {
        duration: 3000,
        position: "top-center",
      });
    }
  }, [isOnline]);

  if (!showBanner) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg"
      role="alert"
      aria-live="polite"
    >
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 1l22 22M16.72 11.06A10 10 0 0119 12.55M5 12.55a10 10 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 12M1.42 9a16 16 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" />
      </svg>
      <span>No internet connection. Some features are temporarily unavailable.</span>
    </div>
  );
}
