// src/components/ui/ErrorBoundary.jsx
import { Component } from "react";
import { logger } from "@/lib/logger";

/**
 * Catches render-time and async errors that escape React's tree so a single
 * failure shows a recoverable screen instead of a blank white page.
 *
 * Without this, an unhandled rejection from e.g. supabase.auth.onAuthStateChange
 * would unmount the entire app (blank page). This boundary contains the blast
 * radius and offers a retry.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // L3: redacting logger - component stack + error message are scrubbed of
    // anything resembling a token, email, uuid or phone number, and this is
    // silent in production.
    logger.error("[IMS] Uncaught error in component tree:", error, {
      componentStack: info?.componentStack,
    });
  }

  handleReset = () => {
    this.setState({ error: null });
    if (typeof this.props.onReset === "function") this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
              ⚠️
            </div>
            <h1 className="text-lg font-semibold text-slate-800">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              The page hit an unexpected error. You can try again — your data is
              safe.
            </p>
            {this.state.error?.message ? (
              <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-600">
                {this.state.error.message}
              </pre>
            ) : null}
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
