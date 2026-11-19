"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { usePathname } from "next/navigation";
import { directionFor, rootPath, titleFor, type NavDirection } from "@/lib/navigation";
import { rememberRoute } from "@/lib/client/history";
import { takePendingSnapshot, useOptimisticNavigation } from "@/lib/client/optimistic-nav";
import { TabBar } from "@/components/ui/TabBar";
import { NavProgress } from "@/components/ui/NavProgress";
import { RouteSkeleton } from "@/components/ui/RouteSkeleton";
import { ToastProvider } from "@/components/ui/Toast";
import { SheetProvider } from "@/components/ui/Sheet";

interface ExitState {
  key: string;
  dir: NavDirection;
  html: string;
  scrollTop: number;
}

interface NavEntry {
  dir: NavDirection;
  path: string;
  claimed: boolean;
}

const NavEntryContext = createContext<(pathname: string) => NavDirection>(() => "none");

/** Returns the direction of the navigation that led to `pathname`, once. */
export function useNavEntry(): (pathname: string) => NavDirection {
  return useContext(NavEntryContext);
}

const EXIT_DURATION: Record<NavDirection, number> = { push: 340, pop: 300, fade: 220, none: 0 };

/** How long an unclaimed entry direction stays valid for a late-mounting screen. */
const ENTRY_TTL_MS = 1500;

/**
 * How long a navigation may take before the shell takes over with a
 * destination skeleton. Fast navigations stay quiet; slow ones never show the
 * old screen as if the click did nothing.
 */
const GHOST_DELAY_MS = 120;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const prevPath = useRef<string | null>(null);
  const { pending, pendingTarget } = useOptimisticNavigation();
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [exit, setExit] = useState<ExitState | null>(null);
  const [ghostPath, setGhostPath] = useState<string | null>(null);
  const entryRef = useRef<NavEntry>({ dir: "none", path: "", claimed: true });
  // Filled during render, applied in a layout effect: a state update made while
  // the router is rendering the new route can be discarded with that render.
  const pendingExitRef = useRef<ExitState | null>(null);

  // Hand the direction to whichever screen mounts at the destination. Screens
  // claim it once, so a screen that mounts later (loading -> loaded) does not
  // replay the animation.
  const claimEntry = useCallback((path: string): NavDirection => {
    const entry = entryRef.current;
    if (entry.claimed || entry.path !== path) return "none";
    entry.claimed = true;
    return entry.dir;
  }, []);
  const entryContext = useMemo(() => claimEntry, [claimEntry]);

  // Detect a route change exactly once. This branch must not run on the
  // follow-up render caused by the state updates below: `prevPath` is advanced
  // here, so a second pass would compare the new path to itself and report
  // "none".
  const prev = prevPath.current;
  prevPath.current = pathname;
  if (prev !== null && prev !== pathname) {
    const capturedDir = directionFor(prev, pathname);
    if (capturedDir !== "none") {
      entryRef.current = { dir: capturedDir, path: pathname, claimed: false };
      // Prefer the snapshot taken at click time: by this render the router may
      // already have swapped the children, and an empty viewport would make the
      // incoming screen slide in over nothing.
      const snapshot = takePendingSnapshot();
      const el = snapshot ? null : (viewRef.current?.querySelector(".screen") as HTMLElement | null);
      const outgoing = snapshot ?? (el ? { html: el.innerHTML, scrollTop: el.scrollTop } : null);
      if (outgoing) {
        pendingExitRef.current = { key: pathname, dir: capturedDir, ...outgoing };
      }
    }
  }

  useLayoutEffect(() => {
    const pending = pendingExitRef.current;
    if (pending === null) return;
    pendingExitRef.current = null;
    setExit(pending);
  }, [pathname]);

  // A navigation that never commits a new screen (aborted, blocked) must not
  // leave a direction behind for some later, unrelated screen to animate with.
  useEffect(() => {
    const entry = entryRef.current;
    if (entry.claimed) return;
    const timer = setTimeout(() => {
      entry.claimed = true;
    }, ENTRY_TTL_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!exit) return;
    const timer = setTimeout(() => setExit(null), EXIT_DURATION[exit.dir]);
    return () => clearTimeout(timer);
  }, [exit]);

  useEffect(() => {
    rememberRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    document.title = `${titleFor(pathname)} — StudyLoop`;
  }, [pathname]);

  // The skeleton only appears if the route is actually slow. If the destination
  // commits first, or the pending timeout fires, this effect clears it.
  const ghostEligible =
    pending &&
    pendingTarget !== null &&
    rootPath(pendingTarget) !== rootPath(pathname);

  useEffect(() => {
    if (!ghostEligible || pendingTarget === null) {
      setGhostPath(null);
      return;
    }
    const target = pendingTarget;
    const timer = setTimeout(() => setGhostPath(target), GHOST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ghostEligible, pendingTarget]);

  const showGhost =
    ghostPath !== null && rootPath(ghostPath) !== rootPath(pathname);

  return (
    <NavEntryContext.Provider value={entryContext}>
      <div className={`shell ${isAdmin ? "shell--admin" : ""}`}>
        <NavProgress active={pending} />
        <span className="sr-only" role="status" aria-live="polite">
          {pending && pendingTarget ? `Opening ${titleFor(pendingTarget)}` : ""}
        </span>
        <SheetProvider>
          <ToastProvider>
            <main className="view">
              <div ref={viewRef}>{children}</div>
              {exit !== null ? (
                <div
                  key={exit.key}
                  className={`screen screen--${exit.dir}-out`}
                  aria-hidden="true"
                  inert
                  style={{
                    zIndex: exit.dir === "pop" ? 2 : 1,
                    pointerEvents: "none"
                  }}
                  dangerouslySetInnerHTML={{ __html: exit.html }}
                  ref={(node) => {
                    if (node) node.scrollTop = exit.scrollTop;
                  }}
                />
              ) : null}
              {showGhost ? <RouteSkeleton path={ghostPath} /> : null}
            </main>
            <TabBar />
          </ToastProvider>
        </SheetProvider>
      </div>
    </NavEntryContext.Provider>
  );
}
