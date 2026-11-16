"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon, plural } from "@/components/ui/icons";
import { useSmartBack } from "@/lib/client/history";
import { startOptimisticNav } from "@/lib/client/optimistic-nav";
import { deleteQuiz, getQuiz, type QuizDetailResponse } from "@/lib/client/quiz";
import { QUIZ_KIND_LABELS, scorePercent, type QuizAttemptSummary } from "@/lib/quiz";

type Status = "loading" | "ready" | "missing" | "failed";

function attemptMeta(attempt: QuizAttemptSummary): string {
  const date = attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleDateString() : "";
  if (attempt.status === "in_progress") return date || "Started";
  const score = scorePercent(attempt.score);
  const minutes = attempt.durationMs ? `${Math.max(1, Math.round(attempt.durationMs / 60_000))} min` : "";
  return [score != null ? `${score}%` : "Not graded", date, minutes].filter(Boolean).join(" · ");
}

export default function QuizExamPage() {
  const params = useParams<{ id: string; examId: string }>();
  const notebookId = Number(params.id);
  const examId = Number(params.examId);
  const router = useRouter();
  const sheet = useSheet();
  const { toast } = useToast();
  const [data, setData] = useState<QuizDetailResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const goBack = useSmartBack(`/notebooks/${notebookId}?tab=quiz`, (from) => from === `/notebooks/${notebookId}`);

  const load = useCallback(async () => {
    if (!Number.isInteger(examId)) {
      setStatus("missing");
      return;
    }
    setStatus("loading");
    try {
      setData(await getQuiz(examId));
      setStatus("ready");
    } catch (err) {
      const code = (err as { status?: number }).status;
      setError((err as Error).message);
      setStatus(code === 404 ? "missing" : "failed");
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  function start() {
    const href = `/notebooks/${notebookId}/quiz/${examId}/take`;
    startOptimisticNav(href);
    router.push(href);
  }

  function openResult(attemptId: number) {
    const href = `/notebooks/${notebookId}/quiz/${examId}/results/${attemptId}`;
    startOptimisticNav(href);
    router.push(href);
  }

  function confirmDelete() {
    if (!data) return;
    sheet.open(
      <SheetFrame
        title="Delete this exam?"
        sub={data.exam.title}
        body={
          <p className="small">
            The questions and every attempt will be removed. Flashcards you already added are kept.
          </p>
        }
        foot={
          <>
            <button
              className="btn btn--primary btn--block"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    await deleteQuiz(examId);
                    sheet.close();
                    toast("Exam deleted");
                    const href = `/notebooks/${notebookId}?tab=quiz`;
                    startOptimisticNav(href);
                    router.replace(href);
                  } catch {
                    toast("Could not delete exam");
                  }
                })();
              }}
            >
              Delete exam
            </button>
            <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={() => sheet.close()}>
              Cancel
            </button>
          </>
        }
      />
    );
  }

  if (status === "loading") {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={goBack} aria-label="Back">
            <Icon name="back" />
          </button>
          <span className="topbar__title grow">Mock exam</span>
        </div>
        <div className="px stack--16" role="status" aria-busy="true">
          <span className="sr-only">Opening exam…</span>
          <div className="nb-hero">
            <Skeleton height={58} width={58} radius="18px" />
            <div className="nb-hero__main">
              <Skeleton height={24} width={196} radius="var(--r-sm)" />
              <Skeleton height={11} width={148} />
            </div>
          </div>
          <Skeleton height={96} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      </ScreenSection>
    );
  }

  if (!data) {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={goBack} aria-label="Back">
            <Icon name="back" />
          </button>
        </div>
        <div className="px">
          <div className="empty">
            <p className="h3">{status === "missing" ? "Exam not found" : "Couldn’t open this exam"}</p>
            <p className="small">
              {status === "missing" ? "It may have been deleted." : error ?? "Check your connection and try again."}
            </p>
            {status === "missing" ? (
              <a className="btn btn--primary btn--sm" href={`/notebooks/${notebookId}?tab=quiz`}>
                Back to quizzes
              </a>
            ) : (
              <button className="btn btn--primary btn--sm" type="button" onClick={() => void load()}>
                Try again
              </button>
            )}
          </div>
        </div>
      </ScreenSection>
    );
  }

  const active = data.attempts.find((attempt) => attempt.status === "in_progress") ?? null;
  const graded = data.attempts.find((attempt) => attempt.status === "graded") ?? null;
  const typeLabels = data.exam.config.types.map((kind) => QUIZ_KIND_LABELS[kind]).join(" · ");
  const cta = active ? "Resume exam" : graded ? "Retake exam" : "Start exam";

  return (
    <ScreenSection>
      <div className="topbar">
        <button className="icon-btn" type="button" onClick={goBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <span className="topbar__title grow">Mock exam</span>
        <button className="icon-btn" type="button" onClick={confirmDelete} aria-label="Delete exam">
          <Icon name="trash" size={19} />
        </button>
      </div>

      <div className="nb-hero">
        <span className="nb-hero__badge tone-sky" aria-hidden="true">
          <Icon name="review" size={22} />
        </span>
        <div className="nb-hero__main">
          <h1 className="nb-hero__title">{data.exam.title}</h1>
          <p className="nb-hero__meta">
            {plural(data.exam.questionCount, "question")} ·{" "}
            {data.exam.config.timerMinutes ? `${data.exam.config.timerMinutes} min` : "untimed"}
          </p>
        </div>
      </div>

      <div className="px stack--16">
        <div className="card card--flat spread">
          <div>
            <p className="h3">{cta}</p>
            <p className="small muted">
              {typeLabels || "Mixed questions"}
              {graded ? ` · best ${scorePercent(Math.max(...data.attempts.map((a) => a.score ?? 0)))}%` : ""}
            </p>
          </div>
          <button className="btn btn--sm btn--primary" type="button" onClick={start}>
            <Icon name="play" size={15} /> {cta}
          </button>
        </div>

        {active ? (
          <p className="ai-note">
            <Icon name="clock" size={16} /> One attempt is open. Answers are saved as you go and resume on any device.
          </p>
        ) : null}

        <section>
          <div className="section-head">
            <h2>Attempts</h2>
          </div>
          {data.attempts.length === 0 ? (
            <div className="empty">
              <p className="h3">No attempts yet</p>
              <p className="small">Start the exam to get a score and a question-by-question review.</p>
            </div>
          ) : (
            <div className="rows">
              {data.attempts.map((attempt) => (
                <button
                  key={attempt.id}
                  className="row"
                  type="button"
                  onClick={() => openResult(attempt.id)}
                >
                  <span className="row__tile tone-sage" aria-hidden="true">
                    <Icon name={attempt.status === "graded" ? "check" : "clock"} size={18} />
                  </span>
                  <span className="row__main">
                    <span className="row__title">{attemptMeta(attempt)}</span>
                    <span className="row__meta">
                      {attempt.status === "graded"
                        ? "Graded"
                        : attempt.status === "grading_failed"
                          ? "Needs grading"
                          : attempt.status === "in_progress"
                            ? "In progress"
                            : "Submitted"}
                    </span>
                  </span>
                  <span className="row__trail">
                    <Icon name="chevron" size={18} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </ScreenSection>
  );
}
