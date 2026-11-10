"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Ring } from "@/components/ui/Ring";
import { Icon, clamp, plural } from "@/components/ui/icons";
import { authRedirectFor, getJson, type CardRow, type Notebook, type SourceRow } from "@/lib/client/api";
import type { UserSummary } from "@/lib/client/summary";
import { notebookViewsCache, summaryCache } from "@/lib/client/cache";

type GradeKey = "again" | "hard" | "good" | "easy";
const RATING: Record<GradeKey, number> = { again: 1, hard: 2, good: 3, easy: 4 };

interface QueueEntry {
  cardId: number;
  notebookId: number;
  front: string;
  back: string;
  sourceTitle: string | null;
}

interface SessionState {
  key: string;
  label: string;
  queue: QueueEntry[];
  index: number;
  revealed: boolean;
  finished: boolean;
  reviewed: number;
  grades: Record<GradeKey, number>;
}

function resetCardStyles(el: HTMLElement) {
  el.style.transform = "";
  el.style.opacity = "";
  el.style.borderColor = "";
}

function cueHotColor(grade: GradeKey | null): string {
  switch (grade) {
    case "again":
      return "#e8c5b6";
    case "good":
      return "#b8d2b0";
    case "easy":
      return "#b2cdb9";
    case "hard":
      return "#e0cd8f";
    default:
      return "";
  }
}

export default function ReviewSessionPage() {
  return (
    <Suspense fallback={<SessionFallback />}>
      <ReviewSession />
    </Suspense>
  );
}

function SessionFallback() {
  return (
    <ScreenSection>
      <div className="px">
        <div className="empty" style={{ borderStyle: "solid", background: "var(--surface)" }}>
          <span className="spinner" style={{ width: 22, height: 22 }} />
          <p className="small">Preparing your review…</p>
        </div>
      </div>
    </ScreenSection>
  );
}

function ReviewSession() {
  const router = useRouter();
  const search = useSearchParams();
  const notebookParam = search.get("notebook");
  const practice = search.get("practice") === "1" || notebookParam === "all";
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const sessionRef = useRef<SessionState | null>(null);
  const gradingRef = useRef(false);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const swipeRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    rawX: number;
    rawY: number;
    committed: boolean;
  }>({ pointerId: null, startX: 0, startY: 0, rawX: 0, rawY: 0, committed: false });

  const THRESHOLD_X = 72;
  const THRESHOLD_Y = 86;

  useEffect(() => {
    void (async () => {
      try {
        const notebooks: Notebook[] = notebookParam && notebookParam !== "all"
          ? [{ id: Number(notebookParam), title: "", createdAt: "" }]
          : await getJson<Notebook[]>("/api/notebooks");
        const collected = await Promise.all(
          notebooks.map(async (notebook) => {
            const [sources, cardsRes, detail] = await Promise.all([
              getJson<SourceRow[]>(`/api/notebooks/${notebook.id}/sources`),
              getJson<{ cards: CardRow[] }>(`/api/notebooks/${notebook.id}/cards`),
              notebookParam && notebookParam !== "all" ? getJson<Notebook>(`/api/notebooks/${notebook.id}`) : Promise.resolve(null)
            ]);
            return { notebook, sources, cards: cardsRes.cards, title: detail?.title };
          })
        );
        const queue: QueueEntry[] = [];
        let label = "All notebooks";
        const now = Date.now();
        for (const { notebook, sources, cards, title } of collected) {
          const sourceTitles = new Map(sources.map((source) => [source.id, source.title]));
          if (title) label = title;
          for (const card of cards) {
            const due = card.due ? new Date(card.due).getTime() : now;
            if (!practice && due > now) continue;
            queue.push({
              cardId: card.id,
              notebookId: notebook.id,
              front: card.front,
              back: card.back,
              sourceTitle: sourceTitles.get(card.sourceId ?? -1) ?? null
            });
          }
        }
        setSession({
          key: notebookParam ?? "all",
          label,
          queue,
          index: 0,
          revealed: false,
        finished: false,
        reviewed: 0,
        grades: { again: 0, hard: 0, good: 0, easy: 0 }
      });
      } catch (error) {
        const redirect = authRedirectFor(error);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [notebookParam, practice, router]);

  function grade(next: GradeKey) {
    const prev = sessionRef.current;
    if (!prev || prev.finished || !prev.revealed) return;
    if (gradingRef.current) return;
    gradingRef.current = true;
    window.setTimeout(() => {
      gradingRef.current = false;
    }, 300);
    const entry = prev.queue[prev.index];
    if (entry) {
      void fetch(`/api/cards/${entry.cardId}/grade`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: RATING[next] })
      }).catch(() => undefined);
    }
    const index = prev.index + 1;
    const grades = { ...prev.grades, [next]: prev.grades[next] + 1 };
    const reviewed = prev.reviewed + 1;
    const finished = index >= prev.queue.length;
    const nextSession: SessionState = { ...prev, index, revealed: false, finished, grades, reviewed };
    sessionRef.current = nextSession;
    setSession(nextSession);
  }

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      const current = sessionRef.current;
      if (!current || current.finished) return;
      if (event.key === "Escape") {
        window.location.href = "/review";
        return;
      }
      if (!current.revealed) {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          setSession((prev) => (prev ? { ...prev, revealed: true } : prev));
        }
        return;
      }
      const map: Record<string, GradeKey> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const next = map[event.key];
      if (next) {
        event.preventDefault();
        grade(next);
      }
    },
    []
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session?.finished) return;
    const timer = window.setTimeout(() => {
      void notebookViewsCache.load({ force: true }).catch(() => undefined);
      void summaryCache
        .load({ force: true })
        .then(setSummary)
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [session?.finished]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card || !session || !session.revealed || session.finished) return;
    // React reuses this DOM node across cards, so inline styles written by a
    // previous commit() would otherwise carry over and hide the next card.
    card.style.transition = "";
    resetCardStyles(card);
    const cues: Partial<Record<GradeKey, HTMLElement>> = {};
    for (const cue of document.querySelectorAll<HTMLElement>(".swipe-cue[data-cue]")) {
      cues[cue.dataset.cue as GradeKey] = cue;
    }
    const swipe = swipeRef.current;
    swipe.committed = false;

    const clearCues = () => {
      for (const cue of Object.values(cues)) {
        if (!cue) continue;
        cue.style.opacity = "0";
        cue.classList.remove("is-hot");
      }
    };
    const axisOf = () => (Math.abs(swipe.rawX) >= Math.abs(swipe.rawY) ? "x" : "y");
    const gradeForOffset = (): GradeKey | null => {
      if (axisOf() === "x") {
        if (swipe.rawX <= -THRESHOLD_X) return "again";
        if (swipe.rawX >= THRESHOLD_X) return "good";
        return null;
      }
      if (swipe.rawY <= -THRESHOLD_Y) return "easy";
      if (swipe.rawY >= THRESHOLD_Y) return "hard";
      return null;
    };
    const paintCues = () => {
      clearCues();
      const horizontal = axisOf() === "x";
      const progress = horizontal ? Math.abs(swipe.rawX) / THRESHOLD_X : Math.abs(swipe.rawY) / THRESHOLD_Y;
      if (progress < 0.08) return;
      const next = gradeForOffset() ?? (horizontal ? (swipe.rawX < 0 ? "again" : "good") : swipe.rawY < 0 ? "easy" : "hard");
      const cue = cues[next];
      if (cue) {
        cue.style.opacity = String(clamp(progress * 1.2, 0, 1));
        cue.classList.toggle("is-hot", progress >= 1);
      }
      card.style.borderColor = cueHotColor(next);
    };
    const resetCard = () => {
      card.style.transition = "transform 0.2s var(--ease-out), opacity 0.16s ease";
      resetCardStyles(card);
      clearCues();
      if (swipe.pointerId !== null) {
        try {
          card.releasePointerCapture(swipe.pointerId);
        } catch {
          /* capture already released or never taken */
        }
      }
      swipe.pointerId = null;
      swipe.rawX = 0;
      swipe.rawY = 0;
    };
    const commit = (next: GradeKey) => {
      if (swipe.committed) return;
      swipe.committed = true;
      const vector =
        next === "again" ? { x: -1, y: 0 } :
        next === "good" ? { x: 1, y: 0 } :
        next === "easy" ? { x: 0, y: -1 } : { x: 0, y: 1 };
      const distance = Math.max(window.innerWidth, window.innerHeight) * 1.15;
      const rotate = vector.x ? vector.x * 14 : swipe.rawX * 0.03;
      clearCues();
      const cue = cues[next];
      if (cue) {
        cue.style.opacity = "1";
        cue.classList.add("is-hot");
      }
      card.style.transition = "transform 0.26s var(--ease-out), opacity 0.22s ease";
      card.style.transform = `translate(${vector.x * distance}px, ${vector.y * distance}px) rotate(${rotate}deg)`;
      card.style.opacity = "0";
      window.setTimeout(() => {
        // Clear the exit styles before advancing so the next card paints
        // visible, and so a blocked grade() leaves a usable card behind.
        card.style.transition = "";
        resetCardStyles(card);
        grade(next);
      }, 200);
    };

    const onDown = (event: PointerEvent) => {
      if (swipe.committed) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      swipe.pointerId = event.pointerId;
      swipe.startX = event.clientX;
      swipe.startY = event.clientY;
      swipe.rawX = 0;
      swipe.rawY = 0;
      card.style.transition = "none";
      try {
        card.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointers have no capture target */
      }
    };
    const onMove = (event: PointerEvent) => {
      if (swipe.pointerId !== event.pointerId || swipe.committed) return;
      swipe.rawX = event.clientX - swipe.startX;
      swipe.rawY = event.clientY - swipe.startY;
      const horizontal = axisOf() === "x";
      const dragX = horizontal ? swipe.rawX : swipe.rawX * 0.2;
      const dragY = horizontal ? swipe.rawY * 0.2 : swipe.rawY;
      card.style.transform = `translate(${dragX}px, ${dragY}px) rotate(${clamp(swipe.rawX * 0.035, -9, 9)}deg)`;
      paintCues();
    };
    const finish = (event: PointerEvent) => {
      if (swipe.pointerId !== event.pointerId || swipe.committed) return;
      const next = gradeForOffset();
      if (next) {
        commit(next);
        return;
      }
      resetCard();
    };

    card.addEventListener("pointerdown", onDown);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
    return () => {
      card.removeEventListener("pointerdown", onDown);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", finish);
      card.removeEventListener("pointercancel", finish);
    };
  }, [session, session?.revealed, session?.index]);

  if (loading) {
    return (
      <ScreenSection>
        <div className="px">
          <div className="empty" style={{ borderStyle: "solid", background: "var(--surface)" }}>
            <span className="spinner" style={{ width: 22, height: 22 }} />
            <p className="small">Preparing your review…</p>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (!session) {
    return (
      <ScreenSection>
        <div className="px">
          <div className="empty">
            <p className="h3">Session unavailable</p>
            <p className="small">Head back to the review hub and pick a notebook.</p>
            <Link className="btn btn--primary btn--sm" href="/review">
              Open review
            </Link>
          </div>
        </div>
      </ScreenSection>
    );
  }

  const total = session.queue.length;
  const done = session.finished ? total : Math.min(session.index, total);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const entry = session.queue[session.index] ?? null;

  function header(label: string) {
    return (
      <div className="session-top">
        <Link className="icon-btn" href="/review" aria-label="End review">
          <Icon name="close" />
        </Link>
        <div className="session-top__mid">
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Review progress"
          >
            <div className="progress__fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="session-top__count">
            {session && session.finished ? `${total} of ${total}` : `${Math.min((session?.index ?? 0) + 1, total)} of ${total}`} · {label}
          </p>
        </div>
        <span style={{ width: 44 }} aria-hidden="true" />
      </div>
    );
  }

  if (session.finished) {
    const again = session.grades.again;
    const solid = session.grades.good + session.grades.easy;
    const accuracy = session.reviewed ? Math.round((solid / session.reviewed) * 100) : 0;
    return (
      <ScreenSection className="screen--fixed">
        {header(session.label)}
        <div className="summary">
          <Ring size={132} stroke={8} light pct={1} value={String(session.reviewed)} label="reviewed" />
          <h1 className="h1">Loop closed.</h1>
          <p className="muted small text-pretty" style={{ maxWidth: 280 }}>
            Every card has a next due date. Come back tomorrow to keep the streak alive.
          </p>
          <div className="summary__stats">
            <div className="summary__stat">
              <strong>{session.reviewed}</strong>
              <span>cards reviewed</span>
            </div>
            <div className="summary__stat">
              <strong>{summary?.streak ?? 0}</strong>
              <span>day streak</span>
            </div>
            <div className="summary__stat">
              <strong>{accuracy}%</strong>
              <span>good or easy</span>
            </div>
          </div>
          {again ? <p className="tiny muted">{plural(again, "card")} marked Again will return in 10 minutes.</p> : null}
          <Link className="btn btn--primary btn--block" href="/">
            Back to today
          </Link>
          <Link className="btn btn--ghost btn--sm btn--block" href="/review">
            Review hub
          </Link>
        </div>
      </ScreenSection>
    );
  }

  if (!total || !entry) {
    return (
      <ScreenSection className="screen--fixed">
        {header(session.label)}
        <div className="summary">
          <span className="row__tile tone-sage" style={{ width: 56, height: 56, borderRadius: 18 }}>
            <Icon name="check" size={26} />
          </span>
          <h1 className="h1">Nothing due</h1>
          <p className="muted small text-pretty" style={{ maxWidth: 280 }}>
            No cards are due in {session.label} right now. Practice ahead to keep the loop warm.
          </p>
          <Link className="btn btn--secondary" href={`/review/session?notebook=${session.key}&practice=1`}>
            Practice all cards
          </Link>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => window.history.back()}>
            Back to review
          </button>
        </div>
      </ScreenSection>
    );
  }

  const revealed = session.revealed;
  const prompt = (
    <>
      <p className="eyebrow">Prompt</p>
      <p className="flash__prompt">{entry.front}</p>
      <p className="flash__hint">
        <Icon name="eye" size={14} /> Tap to reveal
      </p>
    </>
  );
  const answer = (
    <>
      <div className="flash__back">
        <p className="eyebrow">Answer</p>
        <p className="flash__answer">{entry.back}</p>
        <p className="flash__source">
          From {entry.sourceTitle ?? "your notes"} · {session.label}
        </p>
      </div>
      <p className="flash__hint">
        <Icon name="rotate" size={14} /> Swipe or tap a grade
      </p>
    </>
  );

  return (
    <ScreenSection className="screen--fixed">
      {header(session.label)}
      <div className="flash-wrap">
        {revealed ? (
          <div className="swipe-cues" aria-hidden="true">
            <span className="swipe-cue swipe-cue--again" data-cue="again">
              Again
            </span>
            <span className="swipe-cue swipe-cue--good" data-cue="good">
              Good
            </span>
            <span className="swipe-cue swipe-cue--easy" data-cue="easy">
              Easy
            </span>
            <span className="swipe-cue swipe-cue--hard" data-cue="hard">
              Hard
            </span>
          </div>
        ) : null}
        <button
          ref={cardRef}
          className={`flash${revealed ? " flash--swipe" : ""}`}
          type="button"
          aria-label={revealed ? "Answer revealed" : "Reveal answer"}
          onClick={() => !revealed && setSession((prev) => (prev ? { ...prev, revealed: true } : prev))}
        >
          {revealed ? answer : prompt}
        </button>
      </div>
      {revealed ? (
        <>
          <div className="grades" aria-label="Grade this card">
            <button className="grade grade--again" type="button" onClick={() => grade("again")}>
              <span>Again</span>
              <small>10 min</small>
            </button>
            <button className="grade grade--hard" type="button" onClick={() => grade("hard")}>
              <span>Hard</span>
              <small>1 day</small>
            </button>
            <button className="grade grade--good" type="button" onClick={() => grade("good")}>
              <span>Good</span>
              <small>3 days</small>
            </button>
            <button className="grade grade--easy" type="button" onClick={() => grade("easy")}>
              <span>Easy</span>
              <small>7 days</small>
            </button>
          </div>
          <p className="tiny muted center" style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}>
            Swipe card · tap a grade · 1–4
          </p>
        </>
      ) : (
        <p className="tiny muted center" style={{ padding: "0 20px calc(20px + env(safe-area-inset-bottom))" }}>
          Tap the card to reveal
        </p>
      )}
    </ScreenSection>
  );
}
