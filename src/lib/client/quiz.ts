"use client";

import type {
  QuizAnswers,
  QuizAttemptResult,
  QuizAttemptStatus,
  QuizAttemptSummary,
  QuizExamSummary,
  QuizKind,
  QuizPublicItem
} from "@/lib/quiz";

export interface QuizAttemptState {
  id: number;
  examId: number;
  status: QuizAttemptStatus;
  answers: QuizAnswers;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number | null;
  score: number | null;
  remainingSeconds: number | null;
}

export interface QuizExamMeta {
  id: number;
  title: string;
  notebookId: number;
  timerMinutes: number | null;
  questionCount: number;
}

export interface QuizStartResponse {
  attempt: QuizAttemptState;
  exam: QuizExamMeta;
  items: QuizPublicItem[];
}

export interface QuizAttemptResponse {
  attempt: QuizAttemptState;
  exam: QuizExamMeta;
  items?: QuizPublicItem[];
  result?: QuizAttemptResult;
}

export interface QuizDetailResponse {
  exam: {
    id: number;
    notebookId: number;
    title: string;
    topic: string;
    config: { types: QuizKind[]; requestedCount: number; timerMinutes: number | null; sourceSummary: string };
    createdAt: string;
    questionCount: number;
  };
  items: QuizPublicItem[];
  attempts: QuizAttemptSummary[];
}

export interface QuizGenerateInput {
  sources: Array<{ sourceId: number; from?: number; to?: number }>;
  types: QuizKind[];
  count: number;
  timerMinutes?: number | null;
  focus?: string;
}

export type QuizGenerationPhase = 'reading' | 'writing' | 'saving';

export interface QuizGenerationProgress {
  phase: QuizGenerationPhase;
  written: number;
  total: number;
}

export interface QuizGenerateResult {
  exam: QuizDetailResponse['exam'];
  items: QuizPublicItem[];
  requested: number;
  generated: number;
  truncated: boolean;
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...((init.headers ?? {}) as Record<string, string>) }
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    let retryAfter: string | null = null;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      code = body?.code;
    } catch {
      // Non-JSON error bodies fall back to the generic message.
    }
    if (res.status === 429) {
      retryAfter = res.headers.get("retry-after");
      if (retryAfter) message = `Too many requests — try again in ${retryAfter}s.`;
    }
    throw Object.assign(new Error(message), { status: res.status, code });
  }
  return (await res.json()) as T;
}

export function listQuizzes(notebookId: number): Promise<{ quizzes: QuizExamSummary[] }> {
  return send(`/api/notebooks/${notebookId}/quizzes`, { method: "GET" });
}

export function getQuiz(examId: number): Promise<QuizDetailResponse> {
  return send(`/api/quizzes/${examId}`, { method: "GET" });
}

export async function generateQuiz(
  notebookId: number,
  input: QuizGenerateInput,
  onProgress?: (progress: QuizGenerationProgress) => void
): Promise<QuizGenerateResult> {
  const res = await fetch(`/api/notebooks/${notebookId}/quizzes/generate`, {
    method: "POST",
    headers: { accept: "application/x-ndjson", "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      code = body?.code;
    } catch {
      // Non-JSON error bodies fall back to the generic message.
    }
    throw Object.assign(new Error(message), { status: res.status, code });
  }

  // A proxy or older deployment may answer with plain JSON; accept both.
  if (!(res.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
    return (await res.json()) as QuizGenerateResult;
  }
  if (!res.body) {
    throw new Error("Generation ended unexpectedly — try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: QuizGenerateResult | null = null;
  let failure: Error | null = null;

  const handleLine = (line: string) => {
    if (line.trim().length === 0) return;
    const event = JSON.parse(line) as {
      type: string;
      status?: number;
      error?: string;
      code?: string;
      retryAfter?: string | null;
      written?: number;
      total?: number;
      requested?: number;
      generated?: number;
      exam?: QuizGenerateResult["exam"];
      items?: QuizPublicItem[];
      truncated?: boolean;
    };
    if (event.type === "prepared") {
      onProgress?.({ phase: "writing", written: 0, total: event.total ?? input.count });
    } else if (event.type === "progress") {
      onProgress?.({
        phase: "writing",
        written: event.written ?? 0,
        total: event.total ?? input.count
      });
    } else if (event.type === "done") {
      onProgress?.({
        phase: "saving",
        written: event.generated ?? 0,
        total: event.requested ?? input.count
      });
      result = {
        exam: event.exam as QuizGenerateResult["exam"],
        items: event.items ?? [],
        requested: event.requested ?? input.count,
        generated: event.generated ?? 0,
        truncated: Boolean(event.truncated)
      };
    } else if (event.type === "error") {
      const status = event.status ?? 500;
      const message =
        status === 429 && event.retryAfter
          ? `Too many requests — try again in ${event.retryAfter}s.`
          : event.error ?? "Generation failed — try again.";
      failure = Object.assign(new Error(message), { status, code: event.code });
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  handleLine(buffer + decoder.decode());

  if (failure) throw failure;
  if (!result) throw new Error("Generation ended unexpectedly — try again.");
  return result;
}

export function deleteQuiz(examId: number): Promise<{ deleted: boolean }> {
  return send(`/api/quizzes/${examId}`, { method: "DELETE" });
}

export function startQuizAttempt(examId: number): Promise<QuizStartResponse> {
  return send(`/api/quizzes/${examId}/attempts`, { method: "POST" });
}

export function getQuizAttempt(attemptId: number): Promise<QuizAttemptResponse> {
  return send(`/api/quiz-attempts/${attemptId}`, { method: "GET" });
}

export function saveQuizAnswers(
  attemptId: number,
  answers: QuizAnswers
): Promise<{ saved: boolean; expired: boolean; remainingSeconds: number | null }> {
  return send(`/api/quiz-attempts/${attemptId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers })
  });
}

export function submitQuizAttempt(attemptId: number): Promise<QuizAttemptResult & { gradingError?: string }> {
  return send(`/api/quiz-attempts/${attemptId}/submit`, { method: "POST" });
}

export function addMissedCards(attemptId: number): Promise<{ created: number; skipped: number }> {
  return send(`/api/quiz-attempts/${attemptId}/missed-cards`, { method: "POST" });
}

/** Display text for the stored correct answer. */
export function correctAnswerText(
  item: { kind: QuizKind; options: string[]; correct: QuizAttemptResult["items"][number]["correct"] }
): string {
  if (item.kind === "short") return (item.correct as { modelAnswer: string }).modelAnswer;
  if (item.kind === "fillin") return (item.correct as { accepted: string[] }).accepted[0] ?? "";
  if (item.kind === "truefalse") return (item.correct as { value: boolean }).value ? "True" : "False";
  if (item.kind === "mcq") {
    return item.options[(item.correct as { index: number }).index] ?? "";
  }
  return (item.correct as { indexes: number[] }).indexes
    .map((index) => item.options[index] ?? "")
    .filter(Boolean)
    .join("; ");
}

/** Display text for what the user answered. */
export function givenAnswerText(
  item: { kind: QuizKind; options: string[] },
  answer: QuizAnswers[string]
): string {
  if (answer === null || answer === undefined) return "No answer";
  if (item.kind === "truefalse") return answer ? "True" : "False";
  if (item.kind === "mcq") {
    return typeof answer === "number" ? item.options[answer] ?? "No answer" : "No answer";
  }
  if (item.kind === "multi") {
    const list = Array.isArray(answer)
      ? answer.map((index) => item.options[index] ?? "").filter(Boolean)
      : [];
    return list.length > 0 ? list.join("; ") : "No answer";
  }
  return typeof answer === "string" && answer.trim().length > 0 ? answer : "No answer";
}
