"use client";

import Link from "next/link";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon, TONES, plural } from "@/components/ui/icons";
import { useNotebookList } from "@/lib/client/useNotebooks";

export default function LibraryPage() {
  const { views, openCreateSheet } = useNotebookList();
  const rows = views ?? [];

  return (
    <ScreenSection className="has-tabbar">
      <div className="greet">
        <div className="greet__text">
          <p className="eyebrow">{rows.length} notebooks</p>
          <h1 className="h1">Library</h1>
        </div>
        <div className="greet__actions">
          <button className="icon-btn icon-btn--outline" type="button" onClick={openCreateSheet} aria-label="New notebook">
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <div className="px stack--16" style={{ marginTop: 14 }}>
        <p className="muted small text-pretty">
          Every notebook holds its own sources, chat, and card loop. Keep one per course.
        </p>
        <div className="rows">
          {views === null ? null : rows.length === 0 ? (
            <div className="empty">
              <Icon name="layers" size={26} />
              <p className="h3">No notebooks yet</p>
              <p className="small">Create one per course, then add a PDF, a paste, or a lecture link.</p>
              <button className="btn btn--primary btn--sm" type="button" onClick={openCreateSheet}>
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
      </div>
    </ScreenSection>
  );
}
