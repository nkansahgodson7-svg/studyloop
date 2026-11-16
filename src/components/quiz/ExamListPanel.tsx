"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { Icon, plural } from "@/components/ui/icons";
import { RowSkeletonList } from "@/components/ui/Skeleton";
import type { NotebookSource } from "@/lib/client/notebook-data";
import { listQuizzes } from "@/lib/client/quiz";
import { optimisticLinkClick, startOptimisticNav } from "@/lib/client/optimistic-nav";
import { scorePercent, type QuizExamSummary } from "@/lib/quiz";
import GenerateExamSheetContent from "@/components/quiz/GenerateExamSheet";

function metaFor(exam: QuizExamSummary): string {
  const parts = [plural(exam.questionCount, "question")];
  parts.push(exam.timerMinutes ? `${exam.timerMinutes} min` : "untimed");
  if (exam.lastAttempt) parts.push(`last ${scorePercent(exam.lastAttempt.score)}%`);
  return parts.join(" · ");
}

export default function ExamListPanel({
  notebookId,
  notebookTitle,
  sources
}: {
  notebookId: number;
  notebookTitle: string;
  sources: NotebookSource[];
}) {
  const router = useRouter();
  const sheet = useSheet();
  const { toast } = useToast();
  const [exams, setExams] = useState<QuizExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listQuizzes(notebookId);
      setExams(data.quizzes);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [notebookId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openGenerate() {
    if (sources.length === 0) {
      toast("Add a source first");
      return;
    }
    sheet.open(
      <GenerateExamSheetContent
        notebookId={notebookId}
        sources={sources}
        onCreated={(examId) => {
          sheet.close();
          toast("Mock exam ready");
          void load();
          const href = `/notebooks/${notebookId}/quiz/${examId}`;
          startOptimisticNav(href);
          router.push(href);
        }}
      />
    );
  }

  return (
    <div className="stack--16">
      <div className="card card--flat spread">
        <div>
          <p className="h3">{exams ? plural(exams.length, "mock exam") : "Mock exams"}</p>
          <p className="small muted">Exam-mode practice with a score and topic breakdown</p>
        </div>
        <button className="btn btn--sm btn--primary" type="button" onClick={openGenerate}>
          <Icon name="sparkle" size={15} className="i-sparkle" /> New
        </button>
      </div>

      {error ? (
        <div className="empty" style={{ borderStyle: "solid", background: "var(--surface)" }}>
          <p className="h3">Couldn’t load exams</p>
          <p className="small">{error}</p>
          <button className="btn btn--secondary btn--sm" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : exams === null ? (
        <RowSkeletonList count={2} />
      ) : exams.length === 0 ? (
        <div className="empty">
          <Icon name="review" size={26} />
          <p className="h3">No mock exams yet</p>
          <p className="small">
            Generate one from your sources: questions, a timer if you want it, and a graded review at the end.
          </p>
          <button className="btn btn--primary btn--sm" type="button" onClick={openGenerate}>
            <Icon name="sparkle" size={15} className="i-sparkle" /> Generate a mock exam
          </button>
        </div>
      ) : (
        <div className="rows">
          {exams.map((exam) => {
            const href = `/notebooks/${notebookId}/quiz/${exam.id}`;
            return (
              <Link
                key={exam.id}
                className="row"
                href={href}
                onClick={optimisticLinkClick(href)}
              >
                <span className="row__tile tone-sky" aria-hidden="true">
                  <Icon name="review" size={18} />
                </span>
                <span className="row__main">
                  <span className="row__title">{exam.title}</span>
                  <span className="row__meta">{metaFor(exam)}</span>
                </span>
                <span className="row__trail">
                  {exam.activeAttempt ? (
                    <span className="badge">Resume</span>
                  ) : exam.bestScore != null ? (
                    <span className="badge">{scorePercent(exam.bestScore)}%</span>
                  ) : null}
                  <Icon name="chevron" size={18} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="ai-note">
        <Icon name="sparkle" size={16} className="i-sparkle" /> Questions are written only from{" "}
        {notebookTitle}’s sources. Missed questions can be added to flashcards after grading.
      </div>
    </div>
  );
}
