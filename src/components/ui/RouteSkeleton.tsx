"use client";

import type { ReactNode } from "react";
import { GreetingSkeleton, HeroSkeleton, RowSkeletonList, Skeleton } from "@/components/ui/Skeleton";
import { rootPath } from "@/lib/navigation";

/**
 * Destination-shaped placeholder painted by the shell while a route change is
 * still in flight. It mirrors each screen's real layout so the wait shows the
 * structure that is actually coming, rather than a blank page or a spinner.
 *
 * It is inert and aria-hidden: assistive tech gets the live-region announcement
 * from the shell, and clicks fall through to the tab bar.
 */
function GhostScreen({
  children,
  tabbar = false
}: {
  children: ReactNode;
  tabbar?: boolean;
}) {
  return (
    <section
      className={`screen screen--ghost${tabbar ? " has-tabbar" : ""}`}
      aria-hidden="true"
      inert
    >
      {children}
    </section>
  );
}

function GhostTopBar() {
  return (
    <div className="topbar">
      <span className="icon-btn">
        <Skeleton height={20} width={20} radius="var(--r-pill)" />
      </span>
      <span className="topbar__title grow">
        <Skeleton height={14} width={132} />
      </span>
      <span className="icon-btn">
        <Skeleton height={20} width={20} radius="var(--r-pill)" />
      </span>
    </div>
  );
}

function TabPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <GhostScreen tabbar>
      <div className="greet">
        <div className="greet__text">
          <Skeleton height={10} width={76} />
          <h1 className="h1">{title}</h1>
        </div>
      </div>
      <div className="px stack--20" style={{ marginTop: 14 }}>
        {children}
      </div>
    </GhostScreen>
  );
}

function HomeGhost() {
  return (
    <GhostScreen tabbar>
      <GreetingSkeleton />
      <div className="px stack--20" style={{ marginTop: 16 }}>
        <HeroSkeleton />
        <section>
          <div className="section-head">
            <h2>Your notebooks</h2>
          </div>
          <RowSkeletonList />
        </section>
      </div>
    </GhostScreen>
  );
}

function LibraryGhost() {
  return (
    <TabPage title="Library">
      <Skeleton height={12} width="88%" />
      <RowSkeletonList />
    </TabPage>
  );
}

function ReviewGhost() {
  return (
    <TabPage title="Review">
      <div className="card card--dark" style={{ padding: 22 }}>
        <Skeleton height={10} width={82} dark />
        <Skeleton
          height={48}
          width={112}
          dark
          radius="var(--r-sm)"
          style={{ margin: "10px 0 14px" }}
        />
        <Skeleton height={12} width="70%" dark />
      </div>
      <div className="section-head">
        <h2>By notebook</h2>
      </div>
      <RowSkeletonList />
    </TabPage>
  );
}

function SettingsGhost() {
  return (
    <TabPage title="Settings">
      <div className="profile">
        <Skeleton height={40} width={40} radius="var(--r-pill)" />
        <div className="grow stack--6">
          <Skeleton height={14} width={124} />
          <Skeleton height={11} width={176} />
        </div>
      </div>
      <RowSkeletonList count={2} />
    </TabPage>
  );
}

function NotebookGhost() {
  return (
    <GhostScreen>
      <GhostTopBar />
      <div className="nb-hero">
        <Skeleton height={58} width={58} radius="18px" />
        <div className="nb-hero__main">
          <Skeleton height={24} width={168} radius="var(--r-sm)" />
          <Skeleton height={11} width={132} />
        </div>
      </div>
      <div className="px">
        <div className="segmented">
          <Skeleton height={44} radius="var(--r-pill)" />
          <Skeleton height={44} radius="var(--r-pill)" />
          <Skeleton height={44} radius="var(--r-pill)" />
        </div>
      </div>
      <div className="tabpanel px stack--16">
        <div className="card card--flat spread">
          <div className="stack--6">
            <Skeleton height={16} width={112} />
            <Skeleton height={11} width={152} />
          </div>
          <Skeleton height={34} width={86} radius="var(--r-pill)" />
        </div>
        <div className="section-head">
          <h2>Sources</h2>
        </div>
        <RowSkeletonList count={2} />
      </div>
    </GhostScreen>
  );
}

function ChatGhost() {
  return (
    <GhostScreen>
      <div className="chat-head">
        <div className="chat-head__row">
          <Skeleton height={38} width={38} radius="var(--r-pill)" />
          <div className="chat-head__title grow">
            <Skeleton height={14} width={150} />
          </div>
          <Skeleton height={38} width={38} radius="var(--r-pill)" />
        </div>
        <Skeleton height={11} width={110} style={{ marginTop: 8 }} />
      </div>
      <div className="chat-thread px">
        <Skeleton height={64} width="72%" />
        <Skeleton height={108} />
        <Skeleton height={64} width="58%" style={{ alignSelf: "flex-end" }} />
        <Skeleton height={88} />
      </div>
    </GhostScreen>
  );
}

function ReviewSessionGhost() {
  return (
    <GhostScreen>
      <GhostTopBar />
      <div className="px stack--16" style={{ marginTop: 8 }}>
        <Skeleton height={10} width={92} />
        <Skeleton height={30} width="62%" radius="var(--r-sm)" />
        <Skeleton height={360} radius="var(--r-lg)" />
        <Skeleton height={52} radius="var(--r-pill)" />
      </div>
    </GhostScreen>
  );
}

function GenericGhost() {
  return (
    <GhostScreen>
      <GhostTopBar />
      <div className="px stack--16" style={{ marginTop: 6 }}>
        <RowSkeletonList />
      </div>
    </GhostScreen>
  );
}

export function RouteSkeleton({ path }: { path: string }) {
  const pathname = rootPath(path);

  if (pathname === "/") return <HomeGhost />;
  if (pathname === "/review") return <ReviewGhost />;
  if (pathname === "/library" || pathname === "/notebooks") return <LibraryGhost />;
  if (pathname === "/settings") return <SettingsGhost />;
  if (pathname.startsWith("/review/session")) return <ReviewSessionGhost />;
  if (pathname.startsWith("/notebooks/")) {
    if (/\/chat\/(?:\d+|new)$/.test(pathname)) return <ChatGhost />;
    return <NotebookGhost />;
  }
  return <GenericGhost />;
}
