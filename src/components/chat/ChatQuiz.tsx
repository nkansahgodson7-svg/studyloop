"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Markdown from "./Markdown";
import { Icon } from "@/components/ui/icons";
import {
  correctAnswerText,
  getQuiz,
  getQuizAttempt,
  givenAnswerText,
  saveQuizAnswers,
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAttemptState,
  type QuizDetailResponse
} from "@/lib/client/quiz";
import {
  scorePercent,
  type QuizAnswers,
  type QuizAttemptResult,
  type QuizPublicItem
} from "@/lib/quiz";

type Status = "loading" | "taking" | "result" | "failed";

function answeredValue(answers: QuizAnswers, item: QuizPublicItem): boolean {
  const value = answers[String(item.id)];
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function kindLabel(item: QuizPublicItem): string {
  switch (item.kind) {
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

/**
 * A quiz generated from chat, answered in place. The exam is already stored, so
 * the same attempt, answers, and result also show up in the Quiz tab.
 */
export default function ChatQuiz({ examId }: { examId: number }) {
  const [detail, setDetail] = useState<QuizDetailResponse | null>(null);
  const [attempt, setAttempt] = useState<QuizAttemptState | null>(null);
  const [items, setItems] = useState<QuizPublicItem[]>([]);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setStatus("loading");
      setError(null);
      setResult(null);
      try {
        const quiz = await getQuiz(examId);
        if (cancelled) return;
        setDetail(quiz);

        const active = quiz.attempts.find((entry) => entry.status === "in_progress");
        const finished =
          quiz.attempts.find((entry) => entry.status === "graded") ??
          quiz.attempts.find((entry) => entry.status === "grading_failed");
        if (!active && finished) {
          const done = await getQuizAttempt(finished.id);
          if (cancelled) return;
          if (done.result) {
            setResult(done.result);
            setStatus("result");
            return;
          }
        }

        const started = await startQuizAttempt(examId);
        if (cancelled) return;
        setAttempt(started.attempt);
        setItems(started.items);
        setAnswers(started.attempt.answers);
        const firstUnanswered = started.items.findIndex(
          (item) => !answeredValue(started.attempt.answers, item)
        );
        setIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
        setStatus("taking");
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || "Could not open this quiz.");
        setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, reloadKey]);

  async function retake() {
    setStatus("loading");
    setError(null);
    setResult(null);
    try {
      const started = await startQuizAttempt(examId);
      setAttempt(started.attempt);
      setItems(started.items);
      setAnswers(started.attempt.answers);
      setIndex(0);
      setStatus("taking");
    } catch (err) {
      setError((err as Error).message || "Could not start the quiz.");
      setStatus("failed");
    }
  }

  function setAnswer(value: QuizAnswers[string]) {
    const item = items[index];
    if (!item) return;
    setAnswers((prev) => ({ ...prev, [String(item.id)]: value }));
  }

  function toggleMulti(optionIndex: number) {
    const item = items[index];
    if (!item) return;
    const current = answers[String(item.id)];
    const list = Array.isArray(current) ? current : [];
    setAnswer(
      list.includes(optionIndex)
        ? list.filter((entry) => entry !== optionIndex)
        : [...list, optionIndex].sort((a, b) => a - b)
    );
  }

  async function submit() {
    if (!attempt || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // The result is graded from the stored attempt, so flush local answers
      // before submitting.
      await saveQuizAnswers(attempt.id, answers);
      const finished = await submitQuizAttempt(attempt.id);
      setResult(finished);
      setAttempt(null);
      setStatus("result");
    } catch (err) {
      setError((err as Error).message || "Could not submit the quiz.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="chat-quiz" role="status" aria-busy="true">
        <div className="chat-quiz__head">
          <p className="chat-quiz__eyebrow">Quiz</p>
          <span className="chat-quiz__meta">Opening…</span>
        </div>
        <div className="chat-quiz__skeleton" />
        <div className="chat-quiz__skeleton chat-quiz__skeleton--short" />
        <span className="sr-only">Opening the quiz…</span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="chat-quiz" role="alert">
        <div className="chat-quiz__head">
          <p className="chat-quiz__eyebrow">Quiz</p>
          <span className="chat-quiz__meta">Saved in the Quiz tab</span>
        </div>
        <p className="small">{error ?? "Could not open this quiz."}</p>
        <button
          className="btn btn--secondary btn--sm"
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (status === "result" && result) {
    const percent = scorePercent(result.attempt.score) ?? 0;
    const notebookId = result.exam.notebookId;
    return (
      <div className="chat-quiz chat-quiz--result">
        <div className="chat-quiz__head">
          <div>
            <p className="chat-quiz__eyebrow">Quiz result</p>
            <p className="chat-quiz__title">{result.exam.title}</p>
          </div>
          <span className="chat-quiz__meta">Graded</span>
        </div>

        <div className="chat-quiz__score" aria-live="polite">
          <span className="chat-quiz__scoreValue">{percent}%</span>
          <span className="small muted">
            {result.earned} of {result.max} correct
          </span>
        </div>

        <ul className="chat-quiz__review">
          {result.items.map((item, itemIndex) => {
            const correct = item.score >= 1;
            return (
              <li key={item.id} className="chat-quiz__reviewItem">
                <div className="chat-quiz__reviewHead">
                  <span
                    className={`chat-quiz__mark${correct ? " is-correct" : " is-wrong"}`}
                    aria-hidden="true"
                  >
                    <Icon name={correct ? "check" : "close"} size={12} />
                  </span>
                  <span className="chat-quiz__reviewPrompt">
                    <span className="sr-only">
                      Question {itemIndex + 1} {correct ? "correct" : "incorrect"}:
                    </span>
                    <Markdown text={item.prompt} />
                  </span>
                </div>
                <p className="chat-quiz__answer">
                  {correct ? "Correct" : `Your answer: ${givenAnswerText(item, item.answer)}`}
                  {!correct ? (
                    <>
                      <br />
                      Correct answer: {correctAnswerText(item)}
                    </>
                  ) : null}
                </p>
                {item.explanation ? (
                  <p className="chat-quiz__explain">{item.explanation}</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="chat-quiz__foot">
          <Link className="btn btn--ghost btn--sm" href={`/notebooks/${notebookId}?tab=quiz`}>
            Saved to Quiz tab
          </Link>
          <button className="btn btn--secondary btn--sm" type="button" onClick={() => void retake()}>
            Retake
          </button>
        </div>
      </div>
    );
  }

  const item = items[index];
  if (!item) return null;
  const answered = items.filter((entry) => answeredValue(answers, entry)).length;
  const current = answers[String(item.id)];
  const progress = Math.round(((index + 1) / items.length) * 100);
  const isLast = index === items.length - 1;

  return (
    <div className="chat-quiz">
      <div className="chat-quiz__head">
        <div>
          <p className="chat-quiz__eyebrow">Quiz</p>
          <p className="chat-quiz__title">{detail?.exam.title ?? "Quick quiz"}</p>
        </div>
        <span className="chat-quiz__meta">{items.length} questions</span>
      </div>

      <div className="chat-quiz__progress">
        <div className="chat-quiz__progressRow">
          <span className="tiny muted">
            Question {index + 1} of {items.length}
          </span>
          <span className="tiny muted">
            {answered} answered
          </span>
        </div>
        <div
          className="chat-quiz__bar"
          role="progressbar"
          aria-label="Quiz progress"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={index + 1}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="chat-quiz__question">
        <div className="hstack" style={{ gap: 8, marginBottom: 8 }}>
          <span className="badge">{item.topic || "General"}</span>
          <span className="tiny muted">{kindLabel(item)}</span>
        </div>
        <div className="chat-quiz__prompt">
          <Markdown text={item.prompt} />
        </div>
      </div>

      <div className="chat-quiz__options" role="group" aria-label="Answer choices">
        {item.kind === "mcq" || item.kind === "truefalse" || item.kind === "multi" ? (
          (item.kind === "truefalse" ? ["True", "False"] : item.options).map(
            (option, optionIndex) => {
              const isSelected =
                item.kind === "multi"
                  ? Array.isArray(current) && current.includes(optionIndex)
                  : item.kind === "truefalse"
                    ? current === (optionIndex === 0)
                    : current === optionIndex;
              return (
                <button
                  key={`${item.id}-${optionIndex}`}
                  className={`chat-quiz__option${isSelected ? " is-selected" : ""}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (item.kind === "multi") toggleMulti(optionIndex);
                    else if (item.kind === "truefalse") setAnswer(optionIndex === 0);
                    else setAnswer(optionIndex);
                  }}
                >
                  <span>{option}</span>
                  {isSelected ? <Icon name="check" size={16} /> : null}
                </button>
              );
            }
          )
        ) : item.kind === "fillin" ? (
          <label className="field">
            <span className="label">Your answer</span>
            <input
              className="input"
              type="text"
              value={typeof current === "string" ? current : ""}
              placeholder="Type the missing word or phrase"
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
        ) : (
          <label className="field">
            <span className="label">Your answer</span>
            <textarea
              className="textarea"
              value={typeof current === "string" ? current : ""}
              placeholder="Explain in your own words"
              maxLength={4000}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
        )}
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="chat-quiz__foot">
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={index === 0 || submitting}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
        >
          Back
        </button>
        {isLast ? (
          <button
            className="btn btn--primary btn--sm grow"
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="spinner" /> Grading…
              </>
            ) : (
              "Submit quiz"
            )}
          </button>
        ) : (
          <button
            className="btn btn--primary btn--sm grow"
            type="button"
            onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))}
          >
            Next <Icon name="arrow" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
