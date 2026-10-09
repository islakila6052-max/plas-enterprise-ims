// src/components/ui/ErrorAlert.jsx
import Button from "./Button";

/**
 * Displays a user-friendly error message with a Retry button.
 * Used when data fetching fails due to network issues.
 */
export default function ErrorAlert({ message, onRetry, loading }) {
  const isNetworkError =
    message?.toLowerCase().includes("no internet") ||
    message?.toLowerCase().includes("failed to fetch") ||
    message?.toLowerCase().includes("network") ||
    message?.toLowerCase().includes("offline");

  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"
      role="alert">
      <div className="mb-3 text-slate-400">
        {isNetworkError ? (
          <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1l22 22M16.72 11.06A10 10 0 0119 12.55M5 12.55a10 10 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 12M1.42 9a16 16 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" />
          </svg>
        ) : (
          <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <h3 className="text-sm font-semibold text-slate-700">
        {isNetworkError ? "Connection issue" : "Something went wrong"}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        {message || "An unexpected error occurred. Please try again."}
      </p>
      {onRetry && (
        <div className="mt-4">
          <Button onClick={onRetry} loading={loading} variant="primary" size="sm">
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
