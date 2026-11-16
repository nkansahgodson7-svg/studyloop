"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/icons";
import { getJson } from "@/lib/client/api";
import { generateQuiz, type QuizGenerationPhase } from "@/lib/client/quiz";
import type { NotebookSource } from "@/lib/client/notebook-data";
import {
  QUIZ_COUNTS,
  QUIZ_KINDS,
  QUIZ_KIND_LABELS,
  QUIZ_TIMER_PRESETS,
  type QuizKind
} from "@/lib/quiz";

interface DetectedChapter {
  label: string;
  fromPage: number;
  toPage: number;
}

const DEFAULT_TYPES: QuizKind[] = ["mcq", "multi", "truefalse", "fillin"];

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Step({
  state,
  children
}: {
  state: "done" | "active" | "waiting";
  children: ReactNode;
}) {
  return (
    <li className={`gen__step is-${state}`} aria-current={state === "active" ? "step" : undefined}>
      <span className="gen__dot" aria-hidden="true">
        {state === "done" ? <Icon name="check" size={11} /> : null}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function GenerateExamSheetContent({
  notebookId,
  sources,
  onCreated
}: {
  notebookId: number;
  sources: NotebookSource[];
  onCreated: (examId: number) => void;
}) {
  const { close } = useSheet();
  const [selected, setSelected] = useState<Set<number>>(() => new Set(sources.map((source) => source.id)));
  const [chapters, setChapters] = useState<Record<number, DetectedChapter[]>>({});
  const [chapterChoice, setChapterChoice] = useState<Record<number, string>>({});
  const [types, setTypes] = useState<Set<QuizKind>>(() => new Set(DEFAULT_TYPES));
  const [count, setCount] = useState<(typeof QUIZ_COUNTS)[number]>(10);
  const [timed, setTimed] = useState(false);
  const [minutes, setMinutes] = useState<(typeof QUIZ_TIMER_PRESETS)[number]>(30);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<QuizGenerationPhase | null>(null);
  const [written, setWritten] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // The clock only exists so a 40-second wait does not look frozen; the bar and
  // counts below come from real server events.
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // The form scrolls; a failure must be visible without hunting for it.
  useEffect(() => {
    if (!error) return;
    document.getElementById("generateExamForm")?.scrollTo({ top: 0 });
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    for (const source of sources) {
      if (!(source.pageCount ?? 0)) continue;
      getJson<DetectedChapter[]>(`/api/notebooks/${notebookId}/sources/${source.id}/chapters`)
        .then((list) => {
          if (!cancelled) setChapters((prev) => ({ ...prev, [source.id]: Array.isArray(list) ? list : [] }));
        })
        .catch(() => {
          if (!cancelled) setChapters((prev) => ({ ...prev, [source.id]: [] }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [notebookId, sources]);

  function toggleSource(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }

  function toggleType(kind: QuizKind) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setError(null);
  }

  async function submit() {
    if (busy) return;
    const chosen = sources.filter((source) => selected.has(source.id));
    if (chosen.length === 0) {
      setError("Choose at least one source.");
      return;
    }
    if (types.size === 0) {
      setError("Choose at least one question type.");
      return;
    }
    const body = chosen.map((source) => {
      const index = chapterChoice[source.id];
      const chapter = index ? chapters[source.id]?.[Number(index)] : undefined;
      return chapter
        ? { sourceId: source.id, from: chapter.fromPage, to: chapter.toPage }
        : { sourceId: source.id };
    });

    setBusy(true);
    setError(null);
    setPhase("reading");
    setWritten(0);
    setProgressTotal(count);
    setElapsed(0);
    try {
      const created = await generateQuiz(
        notebookId,
        {
          sources: body,
          types: QUIZ_KINDS.filter((kind) => types.has(kind)),
          count,
          timerMinutes: timed ? minutes : null,
          focus: focus.trim() || undefined
        },
        (progress) => {
          setPhase(progress.phase);
          setWritten(progress.written);
          setProgressTotal(progress.total);
        }
      );
      onCreated(created.exam.id);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status ? (err as Error).message : "Network error — try again.");
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  const writtenPct =
    progressTotal > 0 ? Math.min(100, Math.round((written / progressTotal) * 100)) : 0;

  const progressBody = (
    <div className="gen">
      <div className="gen__head">
        <p className="gen__title">Writing your exam</p>
        <div className="gen__meta">
          <span>
            {written} of {progressTotal || count} questions
          </span>
          <span className="gen__clock">{clock(elapsed)}</span>
        </div>
      </div>
      <div
        className="gen__meter"
        role="progressbar"
        aria-label="Questions written"
        aria-valuemin={0}
        aria-valuemax={progressTotal || count}
        aria-valuenow={written}
      >
        <span className="gen__fill" style={{ width: `${writtenPct}%` }} />
      </div>
      <p className="sr-only" role="status">
        {written} of {progressTotal || count} questions written
      </p>
      <ol className="gen__steps">
        <Step state={phase === "reading" ? "active" : "done"}>Read the selected sources</Step>
        <Step state={phase === "writing" ? "active" : phase === "saving" ? "done" : "waiting"}>
          Write and check the questions
        </Step>
        <Step state={phase === "saving" ? "active" : "waiting"}>Save the exam</Step>
      </ol>
      <p className="hint">Usually 15–30 seconds. The exam is saved as soon as it is ready.</p>
    </div>
  );

  return (
    <SheetFrame
      title="New mock exam"
      sub={`${sources.length} ${sources.length === 1 ? "source" : "sources"} in this notebook`}
      formId="generateExamForm"
      onSubmit={() => void submit()}
      body={
        busy ? progressBody : (
        <div className="stack--16">
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="field">
            <span className="label">Sources</span>
            <div className="stack--8">
              {sources.map((source) => {
                const isSelected = selected.has(source.id);
                const list = chapters[source.id] ?? [];
                return (
                  <div key={source.id} className="stack--6">
                    <label className="hstack" style={{ gap: 10, alignItems: "center" }}>
                      <input
                        className="check"
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSource(source.id)}
                      />
                      <span className="grow small">{source.title}</span>
                      {source.pageCount ? <span className="tiny muted">{source.pageCount} pp</span> : null}
                    </label>
                    {isSelected && list.length > 0 ? (
                      <select
                        className="input"
                        aria-label={`Chapter for ${source.title}`}
                        value={chapterChoice[source.id] ?? ""}
                        onChange={(event) =>
                          setChapterChoice((prev) => ({ ...prev, [source.id]: event.target.value }))
                        }
                      >
                        <option value="">Whole source</option>
                        {list.map((chapter, index) => (
                          <option key={`${chapter.label}-${index}`} value={String(index)}>
                            {chapter.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field">
            <span className="label">Question types</span>
            <div className="stack--8">
              {QUIZ_KINDS.map((kind) => {
                const isSelected = types.has(kind);
                return (
                  <button
                    key={kind}
                    className={`kind ${isSelected ? "is-selected" : ""}`}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleType(kind)}
                  >
                    <span className="grow">
                      <span className="kind__title" style={{ display: "block" }}>
                        {QUIZ_KIND_LABELS[kind]}
                      </span>
                    </span>
                    {isSelected ? <Icon name="check" size={18} /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <span className="label">Questions</span>
            <div className="segmented">
              {QUIZ_COUNTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={count === option ? "is-active" : ""}
                  aria-pressed={count === option}
                  onClick={() => setCount(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="hstack" style={{ gap: 10, alignItems: "center" }}>
              <input
                className="check"
                type="checkbox"
                checked={timed}
                onChange={(event) => setTimed(event.target.checked)}
              />
              <span className="grow small">Timed mock exam</span>
              <Icon name="clock" size={16} />
            </label>
            {timed ? (
              <div className="segmented" style={{ marginTop: 8 }}>
                {QUIZ_TIMER_PRESETS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={minutes === option ? "is-active" : ""}
                    aria-pressed={minutes === option}
                    onClick={() => setMinutes(option)}
                  >
                    {option} min
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="quizFocus">
              Focus (optional)
            </label>
            <textarea
              className="textarea"
              id="quizFocus"
              value={focus}
              maxLength={1000}
              placeholder="e.g. alkene reactions and Markovnikov's rule"
              onChange={(event) => setFocus(event.target.value)}
            />
          </div>

        </div>
        )
      }
      foot={
        <>
          <button
            className="btn btn--primary btn--block"
            type="submit"
            form="generateExamForm"
            disabled={busy}
            aria-busy={busy ? true : undefined}
          >
            {busy ? (
              <>
                <span className="spinner" />
                {phase === "reading"
                  ? "Reading sources…"
                  : phase === "saving"
                    ? "Saving exam…"
                    : "Writing questions…"}
              </>
            ) : error ? (
              "Try again"
            ) : (
              `Generate ${count} questions`
            )}
          </button>
          {busy ? (
            <p className="tiny muted center">Keep this sheet open — the exam opens when it is ready.</p>
          ) : (
            <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={close}>
              Cancel
            </button>
          )}
        </>
      }
    />
  );
}
