"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { directionFor, titleFor, type NavDirection } from "@/lib/navigation";
import { TabBar } from "@/components/ui/TabBar";
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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const firstCommit = useRef(true);
  const prevPath = useRef<string | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [exit, setExit] = useState<ExitState | null>(null);
  const [direction, setDirection] = useState<NavDirection>("none");

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
  if (firstCommit.current) {
    firstCommit.current = false;
  }

  useEffect(() => {
    if (!exit) return;
    const timer = setTimeout(() => setExit(null), EXIT_DURATION[exit.dir]);
    return () => clearTimeout(timer);
  }, [exit]);

  useEffect(() => {
    document.title = `${titleFor(pathname)} — StudyLoop`;
  }, [pathname]);

  return (
    <NavDirectionContext.Provider value={direction}>
      <div className={`shell ${isAdmin ? "shell--admin" : ""}`}>
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
            </main>
            <TabBar />
          </ToastProvider>
        </SheetProvider>
      </div>
    </NavDirectionContext.Provider>
  );
}
