"use client";

import { useCallback, useEffect, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { rootPath } from "@/lib/navigation";

/**
 * Imperative store for in-flight route changes.
 *
 * A click records its destination before Next.js has committed anything, which
 * lets the shell paint feedback immediately: the tab goes active, a progress
 * bar appears, and after a short delay a destination-shaped skeleton takes over
 * the view. On slow networks that is the difference between "the app is
 * broken" and "it is working on it".
 *
 * The store is module-level and deliberately router-free so both links and
 * programmatic navigations can participate without prop drilling.
 */

const listeners = new Set<() => void>();

// If the destination never commits (offline, server error, cancelled push) we
// must stop claiming progress instead of leaving the bar spinning forever.
const PENDING_TIMEOUT_MS = 15_000;

let pendingTarget: string | null = null;
let pendingOrigin: string | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function normalize(href: string): string {
  const hash = href.indexOf("#");
  return hash === -1 ? href : href.slice(0, hash);
}

export function getPendingNavTarget(): string | null {
  return pendingTarget;
}

/** Records where a click is heading before the router has committed it. */
export function startOptimisticNav(href: string): void {
  if (typeof window === "undefined") return;
  const target = normalize(href);
  // Clicking the screen you are already on is not a transition.
  if (rootPath(target) === rootPath(window.location.pathname)) return;
  if (pendingTarget === target) return;
  if (pendingTarget === null) pendingOrigin = rootPath(window.location.pathname);
  pendingTarget = target;
  emit();
}

/** Clears in-flight state once the destination has rendered. */
export function settleOptimisticNav(): void {
  if (pendingTarget === null) return;
  pendingTarget = null;
  pendingOrigin = null;
  emit();
}

/** True for an ordinary same-tab click; lets modifier clicks open new tabs. */
export function isPlainNavClick(event: ReactMouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * onClick helper for <Link>/<a>. It never calls preventDefault, so Next.js
 * still owns the actual navigation.
 */
export function optimisticLinkClick(href: string) {
  return (event: ReactMouseEvent) => {
    if (isPlainNavClick(event)) startOptimisticNav(href);
  };
}

export function usePendingNavTarget(): string | null {
  return useSyncExternalStore(subscribe, getPendingNavTarget, () => null);
}

export function useOptimisticNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const pendingTarget = usePendingNavTarget();

  // The destination pathname is the settle signal. Search-param-only pushes
  // (tab switches) share a pathname and therefore settle immediately; those
  // screens update their own state synchronously anyway. Any other pathname
  // change also settles (redirects, browser back while a push is in flight).
  useEffect(() => {
    if (pendingTarget === null) return;
    if (
      rootPath(pendingTarget) === rootPath(pathname) ||
      (pendingOrigin !== null && rootPath(pathname) !== pendingOrigin)
    ) {
      settleOptimisticNav();
    }
  }, [pathname, pendingTarget]);

  useEffect(() => {
    if (pendingTarget === null) return;
    const timer = setTimeout(settleOptimisticNav, PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingTarget]);

  const navigate = useCallback(
    (href: string, opts?: { scroll?: boolean }) => {
      startOptimisticNav(href);
      router.push(href, { scroll: opts?.scroll ?? true });
    },
    [router]
  );

  const replace = useCallback(
    (href: string) => {
      startOptimisticNav(href);
      router.replace(href);
    },
    [router]
  );

  return {
    pending: pendingTarget !== null,
    pendingTarget,
    navigate,
    replace
  };
}
