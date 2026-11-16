import type { Client } from '@libsql/client';
import {
  parseQuizConfig,
  remainingSecondsFor,
  type QuizAnswer,
  type QuizAnswers,
  type QuizAttemptStatus,
  type QuizAttemptSummary,
  type QuizBreakdown,
  type QuizCorrect,
  type QuizExamConfig,
  type QuizExamSummary,
  type QuizItemFeedback,
  type QuizKind,
  type QuizPublicItem
} from '../quiz';

export interface QuizExamRow {
  id: number;
  notebookId: number;
  title: string;
  topic: string;
  config: QuizExamConfig;
  createdAt: string;
}

export interface QuizItemRow extends QuizPublicItem {
  examId: number;
  options: string[];
  correct: QuizCorrect;
  explanation: string;
  sourceId: number | null;
}

export interface QuizAttemptRow {
  id: number;
  examId: number;
  userId: number;
  status: QuizAttemptStatus;
  answers: QuizAnswers;
  startedAt: string;
  submittedAt: string | null;
  gradedAt: string | null;
  durationMs: number | null;
  score: number | null;
  feedback: Record<string, QuizItemFeedback> | null;
  breakdown: QuizBreakdown | null;
  gradedBy: string;
}

const EXAM_COLUMNS = 'id, notebook_id, title, topic, config, created_at';
const ITEM_COLUMNS = 'id, exam_id, ord, kind, topic, prompt, options, correct, explanation, source_id';
const ATTEMPT_COLUMNS =
  'id, exam_id, user_id, status, answers, started_at, submitted_at, graded_at, duration_ms, score, feedback, breakdown, graded_by';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isQuizKind(value: unknown): value is QuizKind {
  return (
    value === 'mcq' ||
    value === 'multi' ||
    value === 'truefalse' ||
    value === 'fillin' ||
    value === 'short'
  );
}

function rowToExam(row: Record<string, unknown>): QuizExamRow {
  return {
    id: Number(row.id),
    notebookId: Number(row.notebook_id),
    title: String(row.title),
    topic: String(row.topic ?? ''),
    config: parseQuizConfig(parseJson<unknown>(row.config, {})),
    createdAt: String(row.created_at)
  };
}

export function rowToItem(row: Record<string, unknown>): QuizItemRow {
  return {
    id: Number(row.id),
    examId: Number(row.exam_id),
    ord: Number(row.ord),
    kind: isQuizKind(row.kind) ? row.kind : 'mcq',
    topic: String(row.topic ?? ''),
    prompt: String(row.prompt),
    options: parseJson<string[]>(row.options, []),
    correct: parseJson<QuizCorrect>(row.correct, { index: 0 }),
    explanation: String(row.explanation ?? ''),
    sourceId: row.source_id == null ? null : Number(row.source_id)
  };
}

function rowToAttempt(row: Record<string, unknown>): QuizAttemptRow {
  return {
    id: Number(row.id),
    examId: Number(row.exam_id),
    userId: Number(row.user_id),
    status: String(row.status) as QuizAttemptStatus,
    answers: parseJson<QuizAnswers>(row.answers, {}),
    startedAt: String(row.started_at),
    submittedAt: row.submitted_at == null ? null : String(row.submitted_at),
    gradedAt: row.graded_at == null ? null : String(row.graded_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    score: row.score == null ? null : Number(row.score),
    feedback: row.feedback == null ? null : parseJson<Record<string, QuizItemFeedback>>(row.feedback, {}),
    breakdown: row.breakdown == null ? null : parseJson<QuizBreakdown>(row.breakdown, { byTopic: [], byKind: [] }),
    gradedBy: String(row.graded_by ?? 'auto')
  };
}

export function publicItem(item: QuizItemRow): QuizPublicItem {
  return {
    id: item.id,
    ord: item.ord,
    kind: item.kind,
    topic: item.topic,
    prompt: item.prompt,
    options: item.options
  };
}

export interface NewQuizItem {
  kind: QuizKind;
  topic: string;
  prompt: string;
  options: string[];
  correct: QuizCorrect;
  explanation: string;
  sourceId: number | null;
}

export async function createQuizExam(
  db: Client,
  input: {
    notebookId: number;
    title: string;
    topic: string;
    config: QuizExamConfig;
    items: NewQuizItem[];
    createdAt?: Date;
  }
): Promise<{ exam: QuizExamRow; items: QuizItemRow[] }> {
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const transaction = await db.transaction('write');
  let examId = 0;
  try {
    const examResult = await transaction.execute({
      sql: `INSERT INTO quiz_exams (notebook_id, title, topic, config, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        input.notebookId,
        input.title,
        input.topic,
        JSON.stringify(input.config),
        createdAt
      ]
    });
    examId = Number(examResult.lastInsertRowid);
    let ord = 0;
    for (const item of input.items) {
      await transaction.execute({
        sql: `INSERT INTO quiz_exam_items
                (exam_id, ord, kind, topic, prompt, options, correct, explanation, source_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          examId,
          ord,
          item.kind,
          item.topic,
          item.prompt,
          JSON.stringify(item.options),
          JSON.stringify(item.correct),
          item.explanation,
          item.sourceId
        ]
      });
      ord += 1;
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  const created = await db.execute({
    sql: `SELECT ${EXAM_COLUMNS} FROM quiz_exams WHERE id = ?`,
    args: [examId]
  });
  const examRow = rowToExam(created.rows[0]!);
  const items = await listQuizItems(db, examRow.id);
  return { exam: examRow, items };
}

export async function quizExamOwned(
  db: Client,
  userId: number,
  examId: number
): Promise<QuizExamRow | null> {
  if (!Number.isInteger(examId)) return null;
  const result = await db.execute({
    sql: `SELECT e.id, e.notebook_id, e.title, e.topic, e.config, e.created_at
          FROM quiz_exams e JOIN notebooks nb ON nb.id = e.notebook_id
          WHERE e.id = ? AND nb.user_id = ?`,
    args: [examId, userId]
  });
  return result.rows[0] ? rowToExam(result.rows[0]) : null;
}

export async function listQuizItems(db: Client, examId: number): Promise<QuizItemRow[]> {
  const result = await db.execute({
    sql: `SELECT ${ITEM_COLUMNS} FROM quiz_exam_items WHERE exam_id = ? ORDER BY ord`,
    args: [examId]
  });
  return result.rows.map(rowToItem);
}

export async function deleteQuizExam(db: Client, userId: number, examId: number): Promise<boolean> {
  const owned = await quizExamOwned(db, userId, examId);
  if (!owned) return false;
  await db.execute({ sql: 'DELETE FROM quiz_exams WHERE id = ?', args: [examId] });
  return true;
}

function answeredCount(answers: QuizAnswers): number {
  return Object.values(answers).filter((answer) => {
    if (answer == null) return false;
    if (typeof answer === 'string') return answer.trim().length > 0;
    if (Array.isArray(answer)) return answer.length > 0;
    return true;
  }).length;
}

export async function listQuizExams(
  db: Client,
  notebookId: number,
  userId: number,
  now = new Date()
): Promise<QuizExamSummary[]> {
  const result = await db.execute({
    sql: `SELECT e.id, e.notebook_id, e.title, e.topic, e.config, e.created_at,
                 (SELECT COUNT(*) FROM quiz_exam_items i WHERE i.exam_id = e.id) AS question_count,
                 (SELECT MAX(a.score) FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.score IS NOT NULL) AS best_score,
                 (SELECT a.id FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.status IN ('submitted', 'graded', 'grading_failed')
                   ORDER BY a.submitted_at DESC, a.id DESC LIMIT 1) AS last_attempt_id,
                 (SELECT a.score FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.status IN ('submitted', 'graded', 'grading_failed')
                   ORDER BY a.submitted_at DESC, a.id DESC LIMIT 1) AS last_score,
                 (SELECT a.submitted_at FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.status IN ('submitted', 'graded', 'grading_failed')
                   ORDER BY a.submitted_at DESC, a.id DESC LIMIT 1) AS last_at,
                 (SELECT a.id FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.status = 'in_progress'
                   ORDER BY a.started_at DESC, a.id DESC LIMIT 1) AS active_id,
                 (SELECT a.answers FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.status = 'in_progress'
                   ORDER BY a.started_at DESC, a.id DESC LIMIT 1) AS active_answers,
                 (SELECT a.started_at FROM quiz_exam_attempts a
                   WHERE a.exam_id = e.id AND a.user_id = ? AND a.status = 'in_progress'
                   ORDER BY a.started_at DESC, a.id DESC LIMIT 1) AS active_started_at
          FROM quiz_exams e
          WHERE e.notebook_id = ?
          ORDER BY e.created_at DESC, e.id DESC`,
    args: [userId, userId, userId, userId, userId, userId, userId, notebookId]
  });

  return result.rows.map((row) => {
    const exam = rowToExam(row);
    const activeId = row.active_id == null ? null : Number(row.active_id);
    const activeStartedAt = row.active_started_at == null ? null : String(row.active_started_at);
    const activeAnswers = activeId == null ? null : parseJson<QuizAnswers>(row.active_answers, {});
    return {
      id: exam.id,
      notebookId: exam.notebookId,
      title: exam.title,
      topic: exam.topic,
      createdAt: exam.createdAt,
      questionCount: Number(row.question_count ?? 0),
      timerMinutes: exam.config.timerMinutes,
      types: exam.config.types,
      lastAttempt:
        row.last_attempt_id == null
          ? null
          : {
              id: Number(row.last_attempt_id),
              score: Number(row.last_score ?? 0),
              at: String(row.last_at ?? exam.createdAt)
            },
      bestScore: row.best_score == null ? null : Number(row.best_score),
      activeAttempt:
        activeId == null || activeAnswers == null || activeStartedAt == null
          ? null
          : {
              id: activeId,
              answered: answeredCount(activeAnswers),
              remainingSeconds: remainingSecondsFor(
                activeStartedAt,
                exam.config.timerMinutes,
                now
              )
            }
    };
  });
}

export async function quizAttemptOwned(
  db: Client,
  userId: number,
  attemptId: number
): Promise<QuizAttemptRow | null> {
  if (!Number.isInteger(attemptId)) return null;
  const result = await db.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS.split(', ')
      .map((column) => `a.${column}`)
      .join(', ')}
          FROM quiz_exam_attempts a
          JOIN quiz_exams e ON e.id = a.exam_id
          JOIN notebooks nb ON nb.id = e.notebook_id
          WHERE a.id = ? AND a.user_id = ? AND nb.user_id = ?`,
    args: [attemptId, userId, userId]
  });
  return result.rows[0] ? rowToAttempt(result.rows[0]) : null;
}

export async function startQuizAttempt(
  db: Client,
  examId: number,
  userId: number,
  now = new Date()
): Promise<QuizAttemptRow> {
  const existing = await db.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM quiz_exam_attempts
          WHERE exam_id = ? AND user_id = ? AND status = 'in_progress'
          ORDER BY started_at DESC, id DESC LIMIT 1`,
    args: [examId, userId]
  });
  if (existing.rows[0]) {
    return rowToAttempt(existing.rows[0]);
  }
  const startedAt = now.toISOString();
  const created = await db.execute({
    sql: `INSERT INTO quiz_exam_attempts (exam_id, user_id, status, answers, started_at)
          VALUES (?, ?, 'in_progress', '{}', ?)`,
    args: [examId, userId, startedAt]
  });
  return {
    id: Number(created.lastInsertRowid),
    examId,
    userId,
    status: 'in_progress',
    answers: {},
    startedAt,
    submittedAt: null,
    gradedAt: null,
    durationMs: null,
    score: null,
    feedback: null,
    breakdown: null,
    gradedBy: 'auto'
  };
}

/** Merges answers into the in-progress attempt; submitted attempts are frozen. */
export async function saveQuizAnswers(
  db: Client,
  attemptId: number,
  patch: QuizAnswers
): Promise<QuizAttemptRow | null> {
  const result = await db.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM quiz_exam_attempts WHERE id = ?`,
    args: [attemptId]
  });
  const row = result.rows[0];
  if (!row) return null;
  const attempt = rowToAttempt(row);
  if (attempt.status !== 'in_progress') return attempt;
  const merged: QuizAnswers = { ...attempt.answers };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      delete merged[key];
      continue;
    }
    merged[key] = value as QuizAnswer;
  }
  await db.execute({
    sql: 'UPDATE quiz_exam_attempts SET answers = ? WHERE id = ?',
    args: [JSON.stringify(merged), attemptId]
  });
  return { ...attempt, answers: merged };
}

export interface AttemptResultPatch {
  status: QuizAttemptStatus;
  score: number | null;
  feedback: Record<string, QuizItemFeedback> | null;
  breakdown: QuizBreakdown | null;
  submittedAt: string | null;
  gradedAt: string | null;
  durationMs: number | null;
  gradedBy: string;
}

export async function saveQuizAttemptResult(
  db: Client,
  attemptId: number,
  patch: AttemptResultPatch
): Promise<QuizAttemptRow> {
  await db.execute({
    sql: `UPDATE quiz_exam_attempts
          SET status = ?, score = ?, feedback = ?, breakdown = ?,
              submitted_at = ?, graded_at = ?, duration_ms = ?, graded_by = ?
          WHERE id = ?`,
    args: [
      patch.status,
      patch.score,
      patch.feedback == null ? null : JSON.stringify(patch.feedback),
      patch.breakdown == null ? null : JSON.stringify(patch.breakdown),
      patch.submittedAt,
      patch.gradedAt,
      patch.durationMs,
      patch.gradedBy,
      attemptId
    ]
  });
  const attempt = await quizAttemptOwnedById(db, attemptId);
  if (!attempt) throw new Error('attempt disappeared after update');
  return attempt;
}

async function quizAttemptOwnedById(db: Client, attemptId: number): Promise<QuizAttemptRow | null> {
  const result = await db.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM quiz_exam_attempts WHERE id = ?`,
    args: [attemptId]
  });
  return result.rows[0] ? rowToAttempt(result.rows[0]) : null;
}

export async function listQuizAttempts(
  db: Client,
  examId: number,
  userId: number
): Promise<QuizAttemptSummary[]> {
  const result = await db.execute({
    sql: `SELECT id, exam_id, status, score, started_at, submitted_at, duration_ms
          FROM quiz_exam_attempts
          WHERE exam_id = ? AND user_id = ?
          ORDER BY started_at DESC, id DESC`,
    args: [examId, userId]
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    examId: Number(row.exam_id),
    status: String(row.status) as QuizAttemptStatus,
    score: row.score == null ? null : Number(row.score),
    startedAt: String(row.started_at),
    submittedAt: row.submitted_at == null ? null : String(row.submitted_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms)
  }));
}

export async function ownNotebookForExam(
  db: Client,
  userId: number,
  examId: number
): Promise<number | null> {
  const exam = await quizExamOwned(db, userId, examId);
  return exam ? exam.notebookId : null;
}
