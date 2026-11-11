"use client";

import { useEffect, useMemo, useState } from "react";
import { SheetFrame } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/icons";
import { getJson } from "@/lib/client/api";
import type { NotebookSource } from "@/lib/client/notebook-data";

interface DetectedChapter {
  label: string;
  fromPage: number;
  toPage: number;
}

interface DraftItem {
  key: number;
  front: string;
  back: string;
  sourceId: number | null;
  selected: boolean;
}

const COUNTS = [5, 10, 20] as const;
const FOCUS_MAX = 1000;

function pageNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default function GenerateCardsSheetContent({
  notebookId,
  sources,
  onCommitted
}: {
  notebookId: number;
  sources: NotebookSource[];
  onCommitted: (count: number) => void | Promise<void>;
}) {
  const [step, setStep] = useState<"configure" | "preview">("configure");
  const [selected, setSelected] = useState<Set<number>>(() => new Set(sources.map((source) => source.id)));
  const [ranges, setRanges] = useState<Record<number, { from: string; to: string }>>({});
  const [chapterChoice, setChapterChoice] = useState<Record<number, string>>({});
  const [chapters, setChapters] = useState<Record<number, DetectedChapter[]>>({});
  const [chapterLoading, setChapterLoading] = useState<Set<number>>(() => new Set());
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [sourceSummary, setSourceSummary] = useState("");
  const [skippedDuplicates, setSkippedDuplicates] = useState(0);
  const [busy, setBusy] = useState<"generate" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pagedSources = useMemo(() => sources.filter((source) => (source.pageCount ?? 0) > 0), [sources]);
  const selectedDrafts = drafts.filter((draft) => draft.selected);
  const allSelected = drafts.length > 0 && drafts.every((draft) => draft.selected);

  useEffect(() => {
    let cancelled = false;
    for (const source of pagedSources) {
      setChapterLoading((prev) => new Set(prev).add(source.id));
      getJson<DetectedChapter[]>(`/api/notebooks/${notebookId}/sources/${source.id}/chapters`)
        .then((list) => {
          if (!cancelled) {
            setChapters((prev) => ({ ...prev, [source.id]: Array.isArray(list) ? list : [] }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setChapters((prev) => ({ ...prev, [source.id]: [] }));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setChapterLoading((prev) => {
              const next = new Set(prev);
              next.delete(source.id);
              return next;
            });
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [notebookId, pagedSources]);

  function toggleSource(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setError(null);
  }

  function setRange(sourceId: number, patch: { from?: string; to?: string }) {
    setRanges((prev) => {
      const current = prev[sourceId] ?? { from: "", to: "" };
      return { ...prev, [sourceId]: { ...current, ...patch } };
    });
    setChapterChoice((prev) => ({ ...prev, [sourceId]: "" }));
    setError(null);
  }

  function chooseChapter(sourceId: number, value: string) {
    setChapterChoice((prev) => ({ ...prev, [sourceId]: value }));
    if (value === "") {
      setRanges((prev) => ({ ...prev, [sourceId]: { from: "", to: "" } }));
      return;
    }
    const chapter = chapters[sourceId]?.[Number(value)];
    if (chapter) {
      setRanges((prev) => ({
        ...prev,
        [sourceId]: { from: String(chapter.fromPage), to: String(chapter.toPage) }
      }));
    }
    setError(null);
  }

  function buildSelection(): Array<{ sourceId: number; from?: number; to?: number }> | null {
    const chosen = sources.filter((source) => selected.has(source.id));
    if (chosen.length === 0) {
      setError("Choose at least one source.");
      return null;
    }
    const payload: Array<{ sourceId: number; from?: number; to?: number }> = [];
    for (const source of chosen) {
      const range = ranges[source.id];
      const from = range ? pageNumber(range.from) : undefined;
      const to = range ? pageNumber(range.to) : undefined;
      if (from !== undefined && to !== undefined && from > to) {
        setError(`Check the page range for ${source.title}.`);
        return null;
      }
      if (source.pageCount != null && source.pageCount > 0) {
        if (from !== undefined && from > source.pageCount) {
          setError(`Start page is past the end of ${source.title}.`);
          return null;
        }
        if (to !== undefined && to > source.pageCount) {
          setError(`End page is past the end of ${source.title}.`);
          return null;
        }
      }
      payload.push({ sourceId: source.id, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) });
    }
    return payload;
  }

  async function generate() {
    if (busy) return;
    setError(null);
    const selection = buildSelection();
    if (!selection) return;
    setBusy("generate");
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/cards/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: selection,
          count,
          ...(focus.trim() ? { focus: focus.trim() } : {})
        })
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        drafts?: Array<{ front?: unknown; back?: unknown; sourceId?: unknown }>;
        skippedDuplicates?: unknown;
        sourceSummary?: unknown;
      } | null;
      if (!res.ok) {
        setError(body?.error ?? `Could not generate cards (${res.status})`);
        return;
      }
      const nextDrafts: DraftItem[] = (body?.drafts ?? [])
        .map((draft, index) => ({
          key: index,
          front: typeof draft.front === "string" ? draft.front : "",
          back: typeof draft.back === "string" ? draft.back : "",
          sourceId: typeof draft.sourceId === "number" ? draft.sourceId : null,
          selected: true
        }))
        .filter((draft) => draft.front.length > 0 && draft.back.length > 0);
      setDrafts(nextDrafts);
      setSkippedDuplicates(typeof body?.skippedDuplicates === "number" ? body.skippedDuplicates : 0);
      setSourceSummary(typeof body?.sourceSummary === "string" ? body.sourceSummary : "Selected sources");
      setStep("preview");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (busy) return;
    setError(null);
    const chosen = drafts.filter((draft) => draft.selected);
    if (chosen.length === 0) {
      setError("Select at least one card.");
      return;
    }
    if (chosen.some((draft) => draft.front.trim().length === 0 || draft.back.trim().length === 0)) {
      setError("Every selected card needs a front and a back.");
      return;
    }
    setBusy("commit");
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/cards/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cards: chosen.map((draft) => ({
            front: draft.front.trim(),
            back: draft.back.trim(),
            ...(draft.sourceId != null ? { sourceId: draft.sourceId } : {})
          })),
          sourceSummary: sourceSummary || "Selected sources",
          ...(focus.trim() ? { focus: focus.trim() } : {})
        })
      });
      const body = (await res.json().catch(() => null)) as { error?: string; created?: number } | null;
      if (!res.ok) {
        setError(body?.error ?? `Could not save cards (${res.status})`);
        return;
      }
      await onCommitted(typeof body?.created === "number" ? body.created : chosen.length);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(key: number, patch: { front?: string; back?: string; selected?: boolean }) {
    setDrafts((prev) => prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
    setError(null);
  }

  const configBody = (
    <div className="stack--16">
      <div className="field">
        <span className="label">Sources</span>
        <div className="stack--8">
          {sources.map((source) => {
            const isSelected = selected.has(source.id);
            const paged = (source.pageCount ?? 0) > 0;
            const sourceChapters = chapters[source.id] ?? [];
            const range = ranges[source.id] ?? { from: "", to: "" };
            return (
              <div className={`source-pick${isSelected ? " is-selected" : ""}`} key={source.id}>
                <input
                  type="checkbox"
                  className="check"
                  id={`generate-source-${source.id}`}
                  data-source-id={source.id}
                  checked={isSelected}
                  onChange={(event) => toggleSource(source.id, event.target.checked)}
                />
                <div className="source-pick__main">
                  <label className="source-pick__title" htmlFor={`generate-source-${source.id}`}>
                    {source.title}
                  </label>
                  <span className="tiny muted">
                    {source.kind === "pdf" ? "PDF" : source.kind === "youtube" ? "YouTube" : "Note"}
                    {paged ? ` · ${source.pageCount} pages` : source.meta ? ` · ${source.meta}` : ""}
                  </span>
                  {isSelected && paged ? (
                    <div className="source-pick__controls">
                      {chapterLoading.has(source.id) ? (
                        <span className="tiny muted hstack">
                          <span className="spinner" /> Detecting chapters…
                        </span>
                      ) : sourceChapters.length > 0 ? (
                        <select
                          className="input"
                          aria-label={`Chapter for ${source.title}`}
                          value={chapterChoice[source.id] ?? ""}
                          onChange={(event) => chooseChapter(source.id, event.target.value)}
                        >
                          <option value="">All pages</option>
                          {sourceChapters.map((chapter, index) => (
                            <option key={`${chapter.fromPage}-${index}`} value={String(index)}>
                              {chapter.label} · pp. {chapter.fromPage}–{chapter.toPage}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <div className="page-range">
                        <span className="tiny muted">Pages</span>
                        <input
                          className="input"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={source.pageCount ?? undefined}
                          placeholder="From"
                          aria-label={`From page for ${source.title}`}
                          value={range.from}
                          onChange={(event) => setRange(source.id, { from: event.target.value })}
                        />
                        <span className="tiny muted">to</span>
                        <input
                          className="input"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={source.pageCount ?? undefined}
                          placeholder="To"
                          aria-label={`To page for ${source.title}`}
                          value={range.to}
                          onChange={(event) => setRange(source.id, { to: event.target.value })}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="generate-focus">
          Focus <span className="tiny muted">(optional)</span>
        </label>
        <textarea
          className="textarea focus-textarea"
          id="generate-focus"
          maxLength={FOCUS_MAX}
          placeholder="e.g. only the exam topics, or compare mitosis and meiosis"
          value={focus}
          onChange={(event) => {
            setFocus(event.target.value);
            setError(null);
          }}
        />
        <span className="hint">Narrows which passages are used and tells the model what to emphasise.</span>
      </div>

      <div className="field">
        <span className="label">Cards</span>
        <div className="choice-row">
          {COUNTS.map((value) => (
            <button
              key={value}
              className={`choice${count === value ? " is-selected" : ""}`}
              type="button"
              aria-pressed={count === value}
              onClick={() => setCount(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  const previewBody = (
    <div className="stack--16">
      <div className="preview-bar">
        <span className="small muted">
          {drafts.length ? `${drafts.length} drafted · ${selectedDrafts.length} selected` : "No new cards"}
          {skippedDuplicates > 0 ? ` · ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"} skipped` : ""}
        </span>
        {drafts.length > 0 ? (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => setDrafts((prev) => prev.map((draft) => ({ ...draft, selected: !allSelected })))}
          >
            {allSelected ? "Select none" : "Select all"}
          </button>
        ) : null}
      </div>
      {drafts.length === 0 ? (
        <div className="empty">
          <p className="h3">No new cards</p>
          <p className="small">Try a different source, page range, or focus — or regenerate.</p>
        </div>
      ) : (
        <div className="draft-list">
          {drafts.map((draft, index) => (
            <div className={`draft-card${draft.selected ? " is-selected" : ""}`} key={draft.key}>
              <div className="draft-card__head">
                <input
                  type="checkbox"
                  className="check"
                  aria-label={`Include card ${index + 1}`}
                  checked={draft.selected}
                  onChange={(event) => updateDraft(draft.key, { selected: event.target.checked })}
                />
                <span className="draft-card__index">Card {index + 1}</span>
              </div>
              <label className="field">
                <span className="label">Front</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={draft.front}
                  onChange={(event) => updateDraft(draft.key, { front: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Back</span>
                <textarea
                  className="textarea"
                  rows={3}
                  value={draft.back}
                  onChange={(event) => updateDraft(draft.key, { back: event.target.value })}
                />
              </label>
            </div>
          ))}
        </div>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <SheetFrame
      title={step === "configure" ? "Generate cards" : "Review drafts"}
      sub={step === "configure" ? "Choose sources, pages, and focus." : sourceSummary || "Edit and pick the cards to keep."}
      body={step === "configure" ? configBody : previewBody}
      foot={
        step === "configure" ? (
          <>
            <button
              className="btn btn--ai btn--block"
              type="button"
              disabled={busy !== null || selected.size === 0}
              aria-busy={busy === "generate"}
              onClick={() => void generate()}
            >
              {busy === "generate" ? (
                <>
                  <span className="spinner" /> Drafting cards…
                </>
              ) : (
                <>
                  <Icon name="sparkle" size={17} className="i-sparkle" /> Generate preview
                </>
              )}
            </button>
            <p className="tiny muted center">One pass over every selected source. Nothing is saved yet.</p>
          </>
        ) : (
          <>
            <button
              className="btn btn--primary btn--block"
              type="button"
              disabled={busy !== null || selectedDrafts.length === 0}
              aria-busy={busy === "commit"}
              onClick={() => void commit()}
            >
              {busy === "commit" ? (
                <>
                  <span className="spinner" /> Adding…
                </>
              ) : (
                `Add ${selectedDrafts.length} ${selectedDrafts.length === 1 ? "card" : "cards"}`
              )}
            </button>
            <div className="hstack">
              <button
                className="btn btn--ghost btn--sm grow"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setStep("configure");
                  setError(null);
                }}
              >
                Back
              </button>
              <button
                className="btn btn--secondary btn--sm grow"
                type="button"
                disabled={busy !== null}
                onClick={() => void generate()}
              >
                {busy === "generate" ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </>
        )
      }
    />
  );
}
