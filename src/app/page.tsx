"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Ring } from "@/components/ui/Ring";
import { Icon, TONES, initialsOf, greeting, todayLabel, plural } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { useNotebookList } from "@/lib/client/useNotebooks";
import { getJson } from "@/lib/client/api";

interface UserSummary {
  streak: number;
  dueTotal: number;
  cardsTotal: number;
  mastery: number;
  reviewedToday: number;
}

interface Me {
  email: string;
}

function nameFromEmail(email: string): string {
  const prefix = email.split("@")[0] || "learner";
  const name =
    prefix.toLowerCase() === "demo"
      ? "Ada Lovelace"
      : prefix
          .split(/[._-]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
  return name || "learner";
}

export default function HomePage() {
  const router = useRouter();
  const { toast } = useToast();
  const { views, openCreateSheet } = useNotebookList();
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const [user, nextSummary] = await Promise.all([
        getJson<Me>("/api/auth/me"),
        getJson<UserSummary>("/api/me/summary")
      ]);
      if (!alive.current) return;
      setMe(user);
      setSummary(nextSummary);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (!alive.current) return;
      if (status === 401) {
        router.replace("/login");
        return;
      }
      toast("Could not load your data");
    }
  }, [router, toast]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  function openNewNotebook() {
    openCreateSheet();
  }

  const name = me ? nameFromEmail(me.email) : "learner";
  const due = summary?.dueTotal ?? 0;
  const rows = views ?? [];

  return (
    <ScreenSection className="has-tabbar">
      {views === null && summary === null ? null : (
        <>
          <header className="greet">
            <div className="greet__text">
              <p className="eyebrow">{todayLabel()}</p>
              <h1 className="h1">
                {greeting()},
                <br />
                {name.split(" ")[0]}
              </h1>
            </div>
            <div className="greet__actions">
              <Link className="icon-btn icon-btn--outline" href="/settings" aria-label="Settings">
                <Icon name="sliders" />
              </Link>
              <span className="avatar" aria-hidden="true">
                {initialsOf(name)}
              </span>
            </div>
          </header>

          <div className="px stack--20" style={{ marginTop: 16 }}>
            <section className="hero" aria-label="Today's review loop">
              <div className="hero__row">
                <div>
                  <p className="eyebrow">Today’s loop</p>
                  <h2 className="hero__title">
                    Keep the
                    <br />
                    loop unbroken.
                  </h2>
                  <p className="hero__stat">
                    <Icon name="flame" size={15} /> {plural(summary?.streak ?? 0, "day")} streak
                  </p>
                </div>
                <Ring pct={(summary?.mastery ?? 0) / 100} size={96} label="mastery" />
              </div>
              <div className="hero__foot">
                <span className="small" style={{ color: "rgba(247,243,231,.76)" }}>
                  {due ? `${plural(due, "card")} due today` : "All caught up"}
                </span>
                <Link className="btn btn--sm" href={due ? "/review" : "/library"}>
                  {due ? "Review" : "Add material"} <Icon name="arrow" size={16} />
                </Link>
              </div>
            </section>

            <section>
              <div className="section-head">
                <h2>Your notebooks</h2>
                <button className="btn btn--ghost btn--sm" type="button" onClick={openNewNotebook}>
                  <Icon name="plus" size={15} /> New
                </button>
              </div>
              <div className="rows">
                {rows.length === 0 ? (
                  <div className="empty">
                    <Icon name="layers" size={26} />
                    <p className="h3">No notebooks yet</p>
                    <p className="small">Create one per course, then add a PDF, a paste, or a lecture link.</p>
                    <button className="btn btn--primary btn--sm" type="button" onClick={openNewNotebook}>
                      <Icon name="plus" size={15} /> New notebook
                    </button>
                  </div>
                ) : (
                  rows.map((view) => {
                    const { notebook } = view;
                    const tone = TONES[notebook.id % TONES.length];
                    return (
                      <Link key={notebook.id} className="row" href={`/notebooks/${notebook.id}`}>
                        <span className={`row__tile ${tone}`} aria-hidden="true">
                          {(notebook.title.charAt(0) || "N").toUpperCase()}
                        </span>
                        <span className="row__main">
                          <span className="row__title">{notebook.title}</span>
                          <span className="row__meta">
                            {plural(view.sources, "source")} · {plural(view.cards, "card")}
                            {view.due ? ` · ${view.due} due` : ""}
                          </span>
                        </span>
                        <span className="row__trail">
                          {view.due ? <span className="badge" aria-label={`${view.due} cards due`}>{view.due}</span> : null}
                          <Icon name="chevron" size={18} />
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </ScreenSection>
  );
}
