// src/main.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import "@/styles/global.css";
import App from "@/App";
import { AuthProvider } from "@/contexts/AuthContext";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { logger } from "@/lib/logger";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/**
 * Global handler for unhandled promise rejections.
 * Catches "Failed to fetch" and other network errors that
 * would otherwise crash the app or show raw error dialogs.
 */
function handleUnhandledRejection(event) {
  const error = event.reason;
  if (!error) return;

  const message = error.message || String(error);

  // Ignore expected errors that are already handled by the app.
  const isNetworkError =
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("offline") ||
    message.includes("No internet");

  if (isNetworkError) {
    // Prevent the default browser console error from being noisy.
    event.preventDefault();
    // The NetworkStatus banner and onlineManager already handle
    // the UI feedback — no need to show a toast here.
    return;
  }

  // For non-network unhandled rejections, log but don't crash.
  // L3: routed through the redacting logger - the raw reason object can carry
  // query fragments or PII, and this is a no-op in production.
  logger.error("[IMS] Unhandled promise rejection:", error);
  event.preventDefault();
}

window.addEventListener("unhandledrejection", handleUnhandledRejection);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
