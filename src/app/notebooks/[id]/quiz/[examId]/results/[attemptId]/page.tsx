"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Markdown from "@/components/chat/Markdown";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Ring } from "@/components/ui/Ring";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Icon, plural } from "@/components/ui/icons";
import { useSmartBack } from "@/lib/client/history";
import { startOptimisticNav } from "@/lib/client/optimistic-nav";
import {
  addMissedCards,
  correctAnswerText,
  getQuizAttempt,
  givenAnswerText,
  submitQuizAttempt
} from "@/lib/client/quiz";
import { scorePercent, type QuizAttemptResult, type QuizBreakdownRow } from "@/lib/quiz";
import { invalidateNotebook } from "@/lib/client/notebook-data";

function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

function Breakdown({ title, rows }: { title: string; rows: QuizBreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <div className="card card--flat stack--8">
        {rows.map((row) => {
          const pct = row.max > 0 ? row.earned / row.max : 0;
          return (
            <div key={row.label} className="stack--6">
              <div className="hstack" style={{ justifyContent: "space-between" }}>
                <span className="small">{row.label}</span>
                <span className="tiny muted">
                  {Math.round(row.earned * 10) / 10} / {row.max}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(pct * 100)}%`,
                    background: pct >= 0.7 ? "var(--sage-strong, #7d9a72)" : "var(--brand)"
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function QuizResultsPage() {
  const params = useParams<{ id: string; examId: string; attemptId: string }>();
  const notebookId = Number(params.id);
  const examId = Number(params.examId);
  const attemptId = Number(params.attemptId);
  const router = useRouter();
  const { toast } = useToast();
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"missed" | "grade" | null>(null);

  const goBack = useSmartBack(`/notebooks/${notebookId}?tab=quiz`, (from) => from === `/notebooks/${notebookId}`);

  const load = useCallback(async () => {
    if (!Number.isInteger(attemptId)) {
      setError("unknown attempt");
      return;
    }
    try {
      const data = await getQuizAttempt(attemptId);
      if (data.result) {
        setResult(data.result);
        setError(null);
        return;
      }
      // Still in progress: the take screen owns that state.
      router.replace(`/notebooks/${notebookId}/quiz/${examId}/take`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [attemptId, examId, notebookId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMissed() {
    if (!result || busy) return;
    setBusy("missed");
    try {
      const added = await addMissedCards(result.attempt.id);
      toast(
        added.created > 0
          ? `${plural(added.created, "card")} added to flashcards`
          : "Those questions are already in your deck"
      );
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function gradeAgain() {
    if (!result || busy) return;
    setBusy("grade");
    try {
      await submitQuizAttempt(result.attempt.id);
      invalidateNotebook(notebookId);
      await load();
      toast("Exam graded");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={goBack} aria-label="Back">
            <Icon name="back" />
          </button>
          <span className="topbar__title grow">Results</span>
        </div>
        <div className="px">
          <div className="empty">
            <p className="h3">Couldn’t load these results</p>
            <p className="small">{error}</p>
            <a className="btn btn--primary btn--sm" href={`/notebooks/${notebookId}?tab=quiz`}>
              Back to quizzes
            </a>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (!result) {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={goBack} aria-label="Back">
            <Icon name="back" />
          </button>
          <span className="topbar__title grow">Results</span>
        </div>
        <div className="px stack--16" role="status" aria-busy="true">
          <span className="sr-only">Scoring the exam…</span>
          <Skeleton height={132} radius="var(--r-lg)" />
          <Skeleton height={88} />
          <Skeleton height={180} />
        </div>
      </ScreenSection>
    );
  }

  const pct = result.attempt.score ?? 0;
  const missed = result.items.filter((item) => item.score < 1).length;

  return (
    <ScreenSection>
      <div className="topbar">
        <button className="icon-btn" type="button" onClick={goBack} aria-label="Back to quiz">
          <Icon name="back" />
        </button>
        <span className="topbar__title grow">Results</span>
        <span className="small muted">{result.exam.title.slice(0, 24)}</span>
      </div>

      <div className="px stack--16">
        <div className="card card--flat hstack" style={{ gap: 18, alignItems: "center" }}>
          <Ring pct={pct} size={96} label="score" />
          <div className="stack--6 grow">
            <p className="h3">
              {Math.round(result.earned * 10) / 10} of {result.max} points
            </p>
            <p className="tiny muted">
              {[result.attempt.durationMs ? formatDuration(result.attempt.durationMs) : "", result.attempt.submittedAt ? new Date(result.attempt.submittedAt).toLocaleDateString() : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {!result.graded ? (
          <div className="card card--flat stack--8">
            <p className="h3">Short answers were not graded</p>
            <p className="small muted">
              Your objective answers are saved. The grading service did not answer — try again.
            </p>
            <button className="btn btn--primary btn--sm" type="button" onClick={() => void gradeAgain()} disabled={busy !== null}>
              {busy === "grade" ? (
                <>
                  <span className="spinner" /> Grading…
                </>
              ) : (
                "Grade again"
              )}
            </button>
          </div>
        ) : null}

        {result.breakdown ? (
          <>
            <Breakdown title="By topic" rows={result.breakdown.byTopic} />
            <Breakdown title="By question type" rows={result.breakdown.byKind} />
          </>
        ) : null}

        <section>
          <div className="section-head">
            <h2>Review</h2>
            <span className="tiny muted">
              {result.items.length - missed} / {result.items.length} correct
            </span>
          </div>
          <div className="stack--12">
            {result.items.map((item, position) => {
              const wrong = item.score < 1;
              return (
                <div key={item.id} className="card card--flat stack--8">
                  <div className="hstack" style={{ justifyContent: "space-between", gap: 10 }}>
                    <span className="tiny muted">
                      {position + 1} · {item.topic || "General"}
                    </span>
                    <span className="badge" style={{ gap: 5 }}>
                      {wrong ? <Icon name="close" size={13} /> : <Icon name="check" size={13} />}
                      {scorePercent(item.score)}%
                    </span>
                  </div>
                  <Markdown text={item.prompt} />
                  <p className="small">
                    <span className="muted">Your answer: </span>
                    {givenAnswerText(item, item.answer)}
                  </p>
                  {wrong ? (
                    <p className="small">
                      <span className="muted">Correct answer: </span>
                      {correctAnswerText(item)}
                    </p>
                  ) : null}
                  {item.explanation ? <p className="small muted">{item.explanation}</p> : null}
                  {item.feedback ? (
                    <p className="small">
                      <span className="muted">Feedback: </span>
                      {item.feedback}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <div className="stack--8">
          {result.graded && missed > 0 ? (
            <button className="btn btn--secondary btn--block" type="button" onClick={() => void addMissed()} disabled={busy !== null}>
              <Icon name="plus" size={16} />
              {busy === "missed" ? " Adding…" : ` Add ${plural(missed, "missed question")} to flashcards`}
            </button>
          ) : null}
          <button
            className="btn btn--primary btn--block"
            type="button"
            onClick={() => {
              const href = `/notebooks/${notebookId}/quiz/${examId}/take`;
              startOptimisticNav(href);
              router.push(href);
            }}
          >
            <Icon name="rotate" size={16} /> Retake exam
          </button>
          <button
            className="btn btn--ghost btn--sm btn--block"
            type="button"
            onClick={() => {
              const href = `/notebooks/${notebookId}?tab=quiz`;
              startOptimisticNav(href);
              router.push(href);
            }}
          >
            Done
          </button>
        </div>
      </div>
    </ScreenSection>
  );
}
