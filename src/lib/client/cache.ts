import { getJson, type NotebookView } from "./api";
import type { UserSummary } from "./summary";

export interface SessionUser {
  id: number;
  email: string;
  role: "admin" | "user";
  hasPersonalKey: boolean;
}

export interface Cache<T> {
  get(): T | null;
  set(value: T): void;
  isFresh(): boolean;
  load(options?: { force?: boolean }): Promise<T>;
  subscribe(listener: (value: T) => void): () => void;
  invalidate(): void;
  clear(): void;
}

/**
 * Small client-side cache for read-heavy screens. Keeps the last value while a
 * background refresh runs, so tab switches paint instantly instead of blanking.
 */
export function createCache<T>(url: string, ttlMs: number): Cache<T> {
  let data: T | null = null;
  let loadedAt = 0;
  let inflight: Promise<T> | null = null;
  const listeners = new Set<(value: T) => void>();

  function publish(value: T): void {
    data = value;
    loadedAt = Date.now();
    for (const listener of listeners) listener(value);
  }

  return {
    get: () => data,
    set: (value) => publish(value),
    isFresh: () => data !== null && Date.now() - loadedAt < ttlMs,
    load({ force = false } = {}) {
      if (!force && data !== null && Date.now() - loadedAt < ttlMs) {
        return Promise.resolve(data);
      }
      if (inflight) return inflight;
      inflight = getJson<T>(url)
        .then((next) => {
          publish(next);
          return next;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate() {
      loadedAt = 0;
    },
    clear() {
      data = null;
      loadedAt = 0;
    }
  };
}

export const meCache = createCache<SessionUser>("/api/auth/me", 60_000);
export const summaryCache = createCache<UserSummary>("/api/me/summary", 15_000);
export const notebookViewsCache = createCache<NotebookView[]>("/api/notebooks/views", 30_000);

export function clearSessionCaches(): void {
  meCache.clear();
  summaryCache.clear();
  notebookViewsCache.clear();
}
