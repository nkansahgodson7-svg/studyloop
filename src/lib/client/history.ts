"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const HISTORY_KEY = "__studyloopNav";

interface RouteMemory {
  path: string;
  from: string | null;
  /** Marks the onboarding entry the user already left, so a browser back does not reopen setup. */
  onboardingComplete?: boolean;
}

type NavState = Record<string, unknown> & { [HISTORY_KEY]?: RouteMemory };

// Last route this tab rendered. New history entries inherit it as their origin;
// restored entries already carry their own memory.
let lastPath: string | null = null;

function readState(): NavState {
  return (window.history.state ?? {}) as NavState;
}

function writeState(state: NavState, memory: RouteMemory): void {
  window.history.replaceState({ ...state, [HISTORY_KEY]: memory }, "");
}

/**
 * Stamps the current history entry with the path it came from. Next.js creates
 * fresh entries without this marker, so an existing marker means the browser is
 * restoring an entry (back/forward) or we replaced the current one.
 */
export function rememberRoute(path: string): void {
  if (typeof window === "undefined") return;
  const state = readState();
  const stored = state[HISTORY_KEY];

  if (stored?.path === path) {
    lastPath = path;
    return;
  }

  // A replace keeps the entry's original origin; a push starts from the path
  // that was rendered before this navigation.
  const from = stored ? stored.from : lastPath;
  writeState(state, { path, from });
  lastPath = path;
}

/** Marks the onboarding entry as finished before navigating into the app. */
export function markOnboardingComplete(): void {
  if (typeof window === "undefined") return;
  const state = readState();
  const memory = state[HISTORY_KEY] ?? { path: window.location.pathname, from: null };
  writeState(state, { ...memory, onboardingComplete: true });
}

export function leftOnboardingHere(): boolean {
  if (typeof window === "undefined") return false;
  return readState()[HISTORY_KEY]?.onboardingComplete === true;
}

/**
 * Returns a back handler that uses real history only when the previous entry is
 * an acceptable origin. Otherwise it replaces the current entry with the
 * screen's logical parent, which keeps repeated back taps from cycling.
 */
export function useSmartBack(fallback: string, allowHistory: (from: string) => boolean): () => void {
  const router = useRouter();
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const allowRef = useRef(allowHistory);
  allowRef.current = allowHistory;

  return useCallback(() => {
    const memory = readState()[HISTORY_KEY];
    if (memory?.from && memory.from !== memory.path && allowRef.current(memory.from)) {
      router.back();
      return;
    }
    router.replace(fallbackRef.current);
  }, [router]);
}
