"use client";

import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { Icon, plural } from "@/components/ui/icons";

export interface NotebookMenuDeps {
  title: string;
  dueCount: number;
  onAddSource: () => void;
  onGenerate: () => void;
  onStartReview: () => void;
  onDelete: () => void;
}

export function NotebookMenuSheet({ deps }: { deps: NotebookMenuDeps }) {
  const { close } = useSheet();
  return (
    <SheetFrame
      title={deps.title}
      sub="Notebook actions"
      body={
        <div className="stack--8">
          <button className="setting-row" type="button" onClick={deps.onAddSource}>
            <span className="setting-row__icon">
              <Icon name="plus" size={18} />
            </span>
            <span className="setting-row__main">
              <span className="setting-row__title">Add a source</span>
              <span className="setting-row__sub">PDF, paste, or YouTube</span>
            </span>
            <span className="setting-row__trail">
              <Icon name="chevron" size={18} />
            </span>
          </button>
          <button className="setting-row" type="button" onClick={deps.onGenerate}>
            <span className="setting-row__icon">
              <Icon name="sparkle" size={18} className="i-sparkle" />
            </span>
            <span className="setting-row__main">
              <span className="setting-row__title">Generate flashcards</span>
              <span className="setting-row__sub">From every indexed source</span>
            </span>
            <span className="setting-row__trail">
              <Icon name="chevron" size={18} />
            </span>
          </button>
          <button className="setting-row" type="button" onClick={deps.onStartReview}>
            <span className="setting-row__icon">
              <Icon name="review" size={18} />
            </span>
            <span className="setting-row__main">
              <span className="setting-row__title">Start review</span>
              <span className="setting-row__sub">{plural(deps.dueCount, "card")} due now</span>
            </span>
            <span className="setting-row__trail">
              <Icon name="chevron" size={18} />
            </span>
          </button>
          <button
            className="setting-row"
            type="button"
            style={{ color: "#a63a17" }}
            onClick={deps.onDelete}
          >
            <span className="setting-row__icon" style={{ background: "var(--accent-soft)", color: "#a63a17" }}>
              <Icon name="trash" size={18} />
            </span>
            <span className="setting-row__main">
              <span className="setting-row__title">Delete notebook</span>
              <span className="setting-row__sub">Removes sources, chat, and cards</span>
            </span>
          </button>
        </div>
      }
      foot={
        <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={close}>
          Close
        </button>
      }
    />
  );
}
