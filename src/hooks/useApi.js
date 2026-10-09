// src/hooks/useApi.js
import { useState, useEffect, useCallback, useRef } from "react";
import { classifyError } from "@/lib/api";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Generic data-fetching hook with:
 *  - loading state
 *  - error state (with retry)
 *  - offline detection
 *  - automatic refetch on reconnect
 *
 * @param {Function} fetcher   - Async function that returns data (no arguments)
 * @param {Object}   options   - { immediate, deps, onError }
 * @returns {{ data, error, loading, isOnline, retry, refetch }}
 */
export function useApi(fetcher, options = {}) {
  const { immediate = true, deps = [], onError } = options;
  const isOnline = useOnlineStatus();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const fetcherRef = useRef(fetcher);
  const onErrorRef = useRef(onError);

  // Keep refs current without re-triggering the effect.
  fetcherRef.current = fetcher;
  onErrorRef.current = onError;

  const execute = useCallback(async () => {
    if (!isOnline) {
      setError(new Error("No internet connection. Some features are temporarily unavailable."));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      const classified = classifyError(err);
      setError(new Error(classified.message));
      setData(null);
      if (typeof onErrorRef.current === "function") {
        onErrorRef.current(err);
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  // Run the fetcher on mount and when deps change.
  useEffect(() => {
    if (immediate) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, ...deps]);

  // Auto-retry when coming back online.
  useEffect(() => {
    if (isOnline && (error || loading)) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const retry = useCallback(() => {
    execute();
  }, [execute]);

  const refetch = useCallback(() => {
    execute();
  }, [execute]);

  return { data, error, loading, isOnline, retry, refetch };
}

/**
 * Hook for fetching paginated/list data.
 * Same as useApi but returns `{ data, count }` shape.
 */
export function useList(fetcher, options = {}) {
  const result = useApi(fetcher, options);
  return {
    ...result,
    list: result.data?.data ?? [],
    count: result.data?.count ?? 0,
  };
}
