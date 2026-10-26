"use client";

import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon, TONES, plural } from "@/components/ui/icons";
import { useNotebookList } from "@/lib/client/useNotebooks";

const GRADE_HINT = "Grades follow Again 10m, Hard 1d, Good 3d, Easy 7d.";

export default function ReviewPage() {
  const router = useRouter();
  const { views } = useNotebookList();
  const rows = (views ?? []).filter((view) => view.due > 0);
  const due = rows.reduce((sum, view) => sum + view.due, 0);
  const total = (views ?? []).reduce((sum, view) => sum + view.cards, 0);
  const scheduled = Math.max(0, total - due);

  function startReview(notebookId: number) {
    router.push(`/review/session?notebook=${notebookId}`);
  }

  return (
    <ScreenSection className="has-tabbar">
      <div className="greet">
        <div className="greet__text">
          <p className="eyebrow">Spaced repetition</p>
          <h1 className="h1">Review</h1>
        </div>
      </div>
      <div className="px stack--16" style={{ marginTop: 14 }}>
        {views === null ? null : due > 0 ? (
          <>
            <div className="card--dark card" style={{ padding: 22 }}>
              <p className="eyebrow">Due right now</p>
              <div className="hstack" style={{ alignItems: "flex-end", gap: 10, margin: "6px 0 18px" }}>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 58,
                    lineHeight: 0.86,
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {due}
                </span>
                <span className="small" style={{ color: "rgba(247,243,231,.7)", paddingBottom: 6 }}>
                  cards ready
                  <br />
                  to review
                </span>
              </div>
              <p className="tiny muted">Review one notebook at a time — mixed subjects break the loop.</p>
            </div>
            <div className="section-head" style={{ marginTop: 26 }}>
              <h2>By notebook</h2>
            </div>
            <div className="rows">
              {rows.map((view) => {
                const tone = TONES[view.notebook.id % TONES.length];
                return (
                  <button
                    key={view.notebook.id}
                    className="row"
                    type="button"
                    onClick={() => startReview(view.notebook.id)}
                  >
                    <span className={`row__tile ${tone}`} aria-hidden="true">
                      {(view.notebook.title.charAt(0) || "N").toUpperCase()}
                    </span>
                    <span className="row__main">
                      <span className="row__title">{view.notebook.title}</span>
                      <span className="row__meta">
                        {plural(view.cards, "card")} · {plural(view.due, "card")} due
                      </span>
                    </span>
                    <span className="row__trail">
                      <span className="badge">{view.due}</span>
                      <Icon name="chevron" size={18} />
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty" style={{ borderStyle: "solid", background: "var(--surface)" }}>
            <span className="row__tile tone-sage">
              <Icon name="check" size={22} />
            </span>
            <p className="h3">All caught up</p>
            <p className="small">No cards are due right now. You can still practice ahead of schedule.</p>
            <button
              className="btn btn--secondary btn--sm"
              type="button"
              style={{ display: "none" }}
              onClick={() => startReview(0)}
            >
              Practice all cards
            </button>
          </div>
        )}
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {scheduled ? `${scheduled} cards are scheduled ahead. ${GRADE_HINT}` : GRADE_HINT}
        </p>
      </div>
    </ScreenSection>
  );
}
