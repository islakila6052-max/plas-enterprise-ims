// src/routes/ProtectedRoute.jsx
import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { CloudOff, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";

/**
 * Gate that requires an authenticated user with a resolved profile/role.
 * Redirects to /login (preserving the attempted location) when unauthenticated.
 */
export default function ProtectedRoute({ children }) {
  const {
    isAuthenticated,
    role,
    loading,
    profileError,
    retrying,
    retryProfile,
  } = useAuth();
  const location = useLocation();
  // Local state so the "Try again" button can show its own spinner without
  // depending on the global loading flag the provider uses elsewhere.
  const [manualRetrying, setManualRetrying] = useState(false);

  // UX FIX: wait instead of showing an error.
  //
  // This used to flash "Couldn't load your profile" on every page refresh. The
  // cause was a race in AuthContext: on INITIAL_SESSION the provider called
  // setUser() and setLoading(false) before the profile query had resolved, so
  // this route briefly observed "signed in, but no role" and painted the error.
  // `loading` now stays true for the whole bootstrap (it covers both the
  // session and the profile fetch), and transient failures retry themselves, so
  // what the user sees on a refresh is the spinner below.
  if (loading || manualRetrying) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner
          label={retrying ? "Reconnecting…" : "Loading your workspace…"}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!role) {
    // Only a genuine load failure counts as "offline". A missing profile is a
    // real account state, and telling the user to check their network for it
    // would be misleading.
    const offline =
      !!profileError &&
      /network|internet|offline|failed to fetch|timeout|fetch/i.test(profileError);

    async function handleRetry() {
      if (manualRetrying) return;
      setManualRetrying(true);
      try {
        await retryProfile();
      } finally {
        setManualRetrying(false);
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="surface max-w-md p-6">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50">
            {offline ? (
              <WifiOff className="h-5 w-5 text-amber-600" aria-hidden />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden />
            )}
          </div>

          <h2 className="text-lg font-semibold text-slate-800">
            {offline
              ? retrying
                ? "Reconnecting…"
                : "Connection interrupted"
              : "Account not set up yet"}
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            {offline
              ? retrying
                ? "We’re reconnecting to your account. This usually takes a moment."
                : "We couldn’t reach the server to load your profile. This is usually brief — you can retry, or reload the page if it keeps happening."
              : "Your account is active, but no intern, supervisor or admin role has been assigned yet. Please contact an administrator to finish setting it up."}
          </p>

          {offline && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <Button onClick={handleRetry} loading={manualRetrying}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                Try again
              </Button>
              <p className="text-xs text-slate-400">
                Still not working?{" "}
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="font-medium text-brand-600 hover:underline"
                >
                  Reload the page
                </button>
              </p>
            </div>
          )}

          {!offline && (
            <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <CloudOff className="h-3.5 w-3.5" aria-hidden />
              Your data is safe — nothing has been lost.
            </p>
          )}
        </div>
      </div>
    );
  }

  return children;
}
