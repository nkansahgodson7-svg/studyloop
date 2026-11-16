"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Markdown from "@/components/chat/Markdown";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/icons";
import {
  saveQuizAnswers,
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAttemptState,
  type QuizExamMeta
} from "@/lib/client/quiz";
import type { QuizAnswers, QuizKind, QuizPublicItem } from "@/lib/quiz";

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function answeredValue(answers: QuizAnswers, item: QuizPublicItem): boolean {
  const value = answers[String(item.id)];
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export default function QuizTakePage() {
  const params = useParams<{ id: string; examId: string }>();
  const notebookId = Number(params.id);
  const examId = Number(params.examId);
  const router = useRouter();
  const sheet = useSheet();
  const { toast } = useToast();

  const [attempt, setAttempt] = useState<QuizAttemptState | null>(null);
  const [exam, setExam] = useState<QuizExamMeta | null>(null);
  const [items, setItems] = useState<QuizPublicItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const answersRef = useRef<QuizAnswers>({});
  const attemptRef = useRef<QuizAttemptState | null>(null);
  const submittedRef = useRef(false);
  const startedRef = useRef(false);

  const resultsHref = (attemptId: number) =>
    `/notebooks/${notebookId}/quiz/${examId}/results/${attemptId}`;

  useEffect(() => {
    if (!Number.isInteger(examId) || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const started = await startQuizAttempt(examId);
        if (started.attempt.status !== "in_progress") {
          router.replace(resultsHref(started.attempt.id));
          return;
        }
        setAttempt(started.attempt);
        attemptRef.current = started.attempt;
        setExam(started.exam);
        setItems(started.items);
        setAnswers(started.attempt.answers);
        answersRef.current = started.attempt.answers;
        setRemaining(started.attempt.remainingSeconds);
        const firstUnanswered = started.items.findIndex(
          (item) => !answeredValue(started.attempt.answers, item)
        );
        setIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [examId, router]);

  // Autosave, debounced so typing a short answer does not spam the route.
  useEffect(() => {
    if (!attempt) return;
    const timer = setTimeout(() => {
      void saveQuizAnswers(attempt.id, answers)
        .then((saved) => {
          if (saved.expired) {
            void submit(true);
          }
        })
        .catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
    // submit is stable enough for this effect; it reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, attempt]);

  const submit = useCallback(
    async (auto = false) => {
      const current = attemptRef.current;
      if (!current || submittedRef.current) return;
      submittedRef.current = true;
      setBusy(true);
      sheet.close();
      try {
        await saveQuizAnswers(current.id, answersRef.current).catch(() => undefined);
        await submitQuizAttempt(current.id);
        if (auto) toast("Time is up — exam submitted");
        router.replace(resultsHref(current.id));
      } catch (err) {
        submittedRef.current = false;
        setBusy(false);
        toast((err as Error).message || "Could not submit the exam");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, sheet, toast]
  );

  // Countdown: derive from a fixed deadline so a background tab cannot drift.
  const deadlineRef = useRef<number | null>(null);
  useEffect(() => {
    if (!attempt || attempt.remainingSeconds == null) return;
    deadlineRef.current = Date.now() + attempt.remainingSeconds * 1000;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline == null) return;
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [attempt]);

  useEffect(() => {
    if (remaining !== 0 || !attempt) return;
    void submit(true);
  }, [remaining, attempt, submit]);

  const item = items[index] ?? null;
  const answered = items.filter((entry) => answeredValue(answers, entry)).length;
  const unanswered = items.length - answered;

  function setAnswer(value: QuizAnswers[string]) {
    if (!item) return;
    setAnswers((prev) => {
      const next = { ...prev, [String(item.id)]: value };
      answersRef.current = next;
      return next;
    });
  }

  function toggleMulti(optionIndex: number) {
    if (!item) return;
    const current = answers[String(item.id)];
    const list = Array.isArray(current) ? current : [];
    const next = list.includes(optionIndex)
      ? list.filter((entry) => entry !== optionIndex)
      : [...list, optionIndex].sort((a, b) => a - b);
    setAnswer(next);
  }

  function confirmSubmit() {
    sheet.open(
      <SheetFrame
        title="Submit the exam?"
        sub={unanswered > 0 ? `${unanswered} unanswered` : "All questions answered"}
        body={
          <p className="small">
            You cannot change answers after submitting. Unanswered questions score 0.
          </p>
        }
        foot={
          <>
            <button className="btn btn--primary btn--block" type="button" onClick={() => void submit()}>
              Submit exam
            </button>
            <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={() => sheet.close()}>
              Keep working
            </button>
          </>
        }
      />
    );
  }

  function leave() {
    void (async () => {
      const current = attemptRef.current;
      if (current) {
        await saveQuizAnswers(current.id, answersRef.current).catch(() => undefined);
      }
      const href = `/notebooks/${notebookId}/quiz/${examId}`;
      router.push(href);
    })();
  }

  if (error) {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={leave} aria-label="Back">
            <Icon name="back" />
          </button>
          <span className="topbar__title grow">Mock exam</span>
        </div>
        <div className="px">
          <div className="empty">
            <p className="h3">Couldn’t start the exam</p>
            <p className="small">{error}</p>
            <a className="btn btn--primary btn--sm" href={`/notebooks/${notebookId}?tab=quiz`}>
              Back to quizzes
            </a>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (!attempt || !exam || !item) {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={leave} aria-label="Back">
            <Icon name="back" />
          </button>
          <span className="topbar__title grow">Mock exam</span>
        </div>
        <div className="px stack--16" role="status" aria-busy="true">
          <span className="sr-only">Preparing the exam…</span>
          <Skeleton height={12} width={120} />
          <Skeleton height={52} />
          <Skeleton height={180} radius="var(--r-lg)" />
          <Skeleton height={48} radius="var(--r-pill)" />
        </div>
      </ScreenSection>
    );
  }

  const progress = Math.round(((index + 1) / items.length) * 100);

  return (
    <ScreenSection>
      <div className="topbar">
        <button className="icon-btn" type="button" onClick={leave} aria-label="Back to exam">
          <Icon name="back" />
        </button>
        <span className="topbar__title grow">{exam.title}</span>
        {remaining != null ? (
          <span className="badge" aria-label="Time remaining">
            <Icon name="clock" size={14} /> {formatClock(remaining)}
          </span>
        ) : (
          <span className="small muted">
            {index + 1} / {items.length}
          </span>
        )}
      </div>

      <div className="px stack--16">
        <div className="stack--6" aria-hidden="true">
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "var(--line)",
              overflow: "hidden"
            }}
          >
            <div style={{ height: "100%", width: `${progress}%`, background: "var(--brand)" }} />
          </div>
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <span className="tiny muted">
              Question {index + 1} of {items.length}
            </span>
            {remaining != null ? (
              <span className="tiny muted">
                {answered} answered · {unanswered} left
              </span>
            ) : null}
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="hstack" style={{ gap: 8, marginBottom: 10 }}>
            <span className="badge">{item.topic || "General"}</span>
            <span className="tiny muted">{kindLabel(item.kind)}</span>
          </div>
          <Markdown text={item.prompt} />
        </div>

        <div className="stack--8">
          {item.kind === "mcq" || item.kind === "truefalse" || item.kind === "multi" ? (
            (item.kind === "truefalse" ? ["True", "False"] : item.options).map((option, optionIndex) => {
              const value = answers[String(item.id)];
              const isSelected =
                item.kind === "multi"
                  ? Array.isArray(value) && value.includes(optionIndex)
                  : item.kind === "truefalse"
                    ? value === (optionIndex === 0)
                    : value === optionIndex;
              return (
                <button
                  key={`${item.id}-${optionIndex}`}
                  className={`kind ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (item.kind === "multi") toggleMulti(optionIndex);
                    else if (item.kind === "truefalse") setAnswer(optionIndex === 0);
                    else setAnswer(optionIndex);
                  }}
                >
                  <span className="grow">
                    <span className="kind__title" style={{ display: "block" }}>
                      {option}
                    </span>
                  </span>
                  {isSelected ? <Icon name="check" size={18} /> : null}
                </button>
              );
            })
          ) : item.kind === "fillin" ? (
            <div className="field">
              <label className="label" htmlFor="quizAnswer">
                Your answer
              </label>
              <input
                className="input"
                id="quizAnswer"
                type="text"
                value={typeof answers[String(item.id)] === "string" ? (answers[String(item.id)] as string) : ""}
                placeholder="Type the missing word or phrase"
                onChange={(event) => setAnswer(event.target.value)}
              />
            </div>
          ) : (
            <div className="field">
              <label className="label" htmlFor="quizAnswer">
                Your answer
              </label>
              <textarea
                className="textarea"
                id="quizAnswer"
                value={typeof answers[String(item.id)] === "string" ? (answers[String(item.id)] as string) : ""}
                placeholder="Explain in your own words"
                maxLength={4000}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </div>
          )}
        </div>

        <div className="hstack" style={{ gap: 10 }}>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
            disabled={index === 0 || busy}
          >
            <Icon name="back" size={16} /> Back
          </button>
          {index < items.length - 1 ? (
            <button
              className="btn btn--primary grow"
              type="button"
              onClick={() => setIndex((prev) => Math.min(items.length - 1, prev + 1))}
              disabled={busy}
            >
              Next <Icon name="arrow" size={16} />
            </button>
          ) : (
            <button className="btn btn--primary grow" type="button" onClick={confirmSubmit} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" /> Grading…
                </>
              ) : (
                "Submit exam"
              )}
            </button>
          )}
        </div>
      </div>
    </ScreenSection>
  );
}

function kindLabel(kind: QuizKind): string {
  switch (kind) {
    case "mcq":
      return "Choose one";
    case "multi":
      return "Choose all that apply";
    case "truefalse":
      return "True or false";
    case "fillin":
      return "Fill in the blank";
    default:
      return "Short answer";
  }
}
