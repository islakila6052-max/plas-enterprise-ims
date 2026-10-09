// src/lib/onlineManager.js
/**
 * Centralized online/offline state manager.
 *
 * Uses the browser's `online` / `offline` events so the entire app
 * reacts to connectivity changes from a single source of truth.
 *
 * Consumers subscribe to state changes; the manager also fires
 * reconnect callbacks so UI feedback stays in sync.
 */

class OnlineManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.listeners = new Set();
    this.reconnectCallbacks = new Set();
    this.cleanupFns = [];

    this.handleOnline = this.handleOnline.bind(this);
    this.handleOffline = this.handleOffline.bind(this);

    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);

    this.cleanupFns.push(() => {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    });
  }

  handleOnline() {
    this.isOnline = true;
    this.listeners.forEach((fn) => fn(true));
    this.reconnectCallbacks.forEach((fn) => {
      try {
        fn();
      } catch {
        /* swallow — each callback is responsible for its own errors */
      }
    });
  }

  handleOffline() {
    this.isOnline = false;
    this.listeners.forEach((fn) => fn(false));
  }

  /** Subscribe to connectivity changes. Returns an unsubscribe function. */
  subscribe(fn) {
    this.listeners.add(fn);
    // Immediately notify with current state so new subscribers get the right value.
    fn(this.isOnline);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Register a callback that fires when the connection is restored.
   * Returns an unsubscribe function.
   */
  onReconnect(fn) {
    this.reconnectCallbacks.add(fn);
    return () => {
      this.reconnectCallbacks.delete(fn);
    };
  }

  /** Tear down all listeners. */
  destroy() {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.listeners.clear();
    this.reconnectCallbacks.clear();
  }
}

/** Singleton — one manager for the whole app. */
export const onlineManager = new OnlineManager();

/** Convenience: is the browser currently online? */
export function isOnline() {
  return onlineManager.isOnline;
}

/** Subscribe to online/offline changes. */
export function subscribeOnline(fn) {
  return onlineManager.subscribe(fn);
}

/** Register a callback that fires once when connectivity is restored. */
export function onReconnect(fn) {
  return onlineManager.onReconnect(fn);
}
