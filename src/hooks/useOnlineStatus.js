// src/hooks/useOnlineStatus.js
import { useState, useEffect, useCallback } from "react";
import { onlineManager } from "@/lib/onlineManager";

/**
 * React hook that tracks the browser's online/offline state.
 *
 * Returns `true` when the browser has a network connection,
 * `false` when it does not.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(onlineManager.isOnline);

  useEffect(() => {
    return onlineManager.subscribe((online) => {
      setIsOnline(online);
    });
  }, []);

  return isOnline;
}

/**
 * React hook that registers a callback when the connection is restored.
 *
 * @param {Function} callback - Called once when the browser comes back online.
 * @param {boolean}  immediate - If true, call immediately when online already.
 */
export function useOnReconnect(callback, immediate = false) {
  const savedCallback = useCallback(callback, []);

  useEffect(() => {
    // If already online and immediate is requested, fire once.
    if (immediate && onlineManager.isOnline) {
      savedCallback();
    }

    return onlineManager.onReconnect(savedCallback);
  }, [savedCallback, immediate]);
}
