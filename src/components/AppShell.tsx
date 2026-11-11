"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { directionFor, rootPath, titleFor, type NavDirection } from "@/lib/navigation";
import { rememberRoute } from "@/lib/client/history";
import { useOptimisticNavigation } from "@/lib/client/optimistic-nav";
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

const NavDirectionContext = createContext<NavDirection>("none");

export function useNavDirection(): NavDirection {
  return useContext(NavDirectionContext);
}

const EXIT_DURATION: Record<NavDirection, number> = { push: 340, pop: 300, fade: 220, none: 0 };

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
  const [direction, setDirection] = useState<NavDirection>("none");
  const [ghostPath, setGhostPath] = useState<string | null>(null);

  let capturedExit: ExitState | null = null;
  let capturedDir: NavDirection = "none";
  const prev = prevPath.current;
  prevPath.current = pathname;
  if (prev !== null && prev !== pathname) {
    capturedDir = directionFor(prev, pathname);
    if (capturedDir !== "none") {
      const el = viewRef.current?.querySelector(".screen") as HTMLElement | null;
      if (el) {
        capturedExit = {
          key: pathname,
          dir: capturedDir,
          html: el.innerHTML,
          scrollTop: el.scrollTop
        };
      }
    }
  }

  if (capturedExit && (exit === null || exit.key !== capturedExit.key)) {
    setExit(capturedExit);
  }
  if (capturedDir !== direction) {
    setDirection(capturedDir);
  }

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
    <NavDirectionContext.Provider value={direction}>
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
                  className={`screen screen--${exit.dir === "pop" ? "pop-out" : ""}`}
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
    </NavDirectionContext.Provider>
  );
}
