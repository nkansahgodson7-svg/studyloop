"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon, TONES, plural } from "@/components/ui/icons";
import { useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { SheetFrame } from "@/components/ui/Sheet";
import AddSourceSheetContent from "@/components/notebook/AddSourceSheet";
import ChatListPanel from "@/components/chat/ChatListPanel";
import { NotebookMenuSheet } from "@/components/notebook/NotebookMenuSheet";
import GenerateCardsSheetContent from "@/components/notebook/GenerateCardsSheet";
import { dueCount, loadNotebook, type NotebookBundle, type NotebookCard } from "@/lib/client/notebook-data";
import { authRedirectFor } from "@/lib/client/api";
import { notebookViewsCache, summaryCache } from "@/lib/client/cache";

type Tab = "overview" | "chat" | "cards";

/**
 * `bundle === null` alone cannot tell "still fetching" from "no such notebook",
 * so the screen used to paint the not-found panel for the whole duration of the
 * bundle request. Track the load explicitly instead.
 */
type LoadStatus = "loading" | "ready" | "missing" | "failed";

function sourceTone(kind: string): string {
  return kind === "pdf" ? "tone-butter" : kind === "youtube" ? "tone-sky" : "tone-sage";
}

function sourceGlyph(kind: string): string {
  return kind === "pdf" ? "file" : kind === "youtube" ? "play" : "text";
}

function sourceLabel(kind: string): string {
  return kind === "pdf" ? "PDF" : kind === "youtube" ? "YouTube" : "Note";
}

/**
 * Owns its busy state: the sheet keeps a snapshot of the node it was opened
 * with, so the confirm button has to re-render itself to show progress.
 */
function DeleteNotebookSheet({ title, onConfirm }: { title: string; onConfirm: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);

  return (
    <SheetFrame
      title="Delete notebook"
      sub={title}
      body={
        <p className="small text-pretty" style={{ color: "var(--ink-2)" }}>
          This removes its sources, chat history, and flashcards. It cannot be undone.
        </p>
      }
      foot={
        <button
          className="btn btn--danger btn--block"
          type="button"
          disabled={deleting}
          aria-busy={deleting}
          onClick={() => {
            if (deleting) return;
            setDeleting(true);
            void onConfirm().finally(() => setDeleting(false));
          }}
        >
          {deleting ? (
            <>
              <span className="spinner" /> Deleting…
            </>
          ) : (
            "Delete notebook"
          )}
        </button>
      }
    />
  );
}

function SourceRowView({
  source,
  notebookId,
  onDelete
}: {
  source: NotebookBundle["sources"][number];
  notebookId: number;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (deleting) return;
    if (!confirm("Delete this source?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources/${source.id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        toast("Source deleted");
        onDelete();
      } else {
        toast("Could not delete source");
      }
    } catch {
      toast("Could not delete source");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="row source-row">
      <span className={`row__tile ${sourceTone(source.kind)}`}>
        <Icon name={sourceGlyph(source.kind)} size={21} />
      </span>
      <span className="row__main">
        <span className="row__title">{source.title}</span>
        <span className="row__meta">
          <span className="source-row__sub">
            {sourceLabel(source.kind)}
            {source.meta ? (
              <>
                <span className="dot" />
                {source.meta}
              </>
            ) : null}
          </span>
        </span>
      </span>
      <button
        className="icon-btn icon-btn--outline"
        type="button"
        aria-label={deleting ? "Deleting source" : "Delete source"}
        aria-busy={deleting}
        disabled={deleting}
        onClick={() => void remove()}
      >
        {deleting ? <span className="spinner" /> : <Icon name="trash" size={16} />}
      </button>
    </div>
  );
}

function CardRowView({ card }: { card: NotebookCard }) {
  const due = new Date(card.due).getTime() - Date.now();
  const state =
    due <= 0
      ? { text: "Due", cls: "" }
      : due < 3600000
        ? { text: `${Math.ceil(due / 60000)}m`, cls: "badge--neutral" }
        : due < 86400000
          ? { text: `${Math.round(due / 3600000)}h`, cls: "badge--neutral" }
          : { text: `${Math.round(due / 86400000)}d`, cls: "badge--neutral" };
  return (
    <div className="card-row">
      <div className="card-row__body">
        <p className="card-row__front">{card.front}</p>
        <p className="card-row__back">{card.back}</p>
      </div>
      <span className={`card-row__state badge ${state.cls}`}>{state.text}</span>
    </div>
  );
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function relativeBatchDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameCalendarDay(date, now)) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(date, yesterday)) return `Yesterday · ${time}`;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  return `${date.toLocaleDateString([], options)} · ${time}`;
}

function BatchGroup({
  title,
  sub,
  focus,
  count,
  onPractice,
  children
}: {
  title: string;
  sub: string;
  focus?: string | null;
  count: number;
  onPractice?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`batch-group${open ? " is-open" : ""}`}>
      <div className="batch-group__head">
        <button
          className="batch-group__toggle"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="batch-group__chevron" aria-hidden="true">
            <Icon name="chevron" size={16} />
          </span>
          <span className="batch-group__meta">
            <span className="batch-group__date">{title}</span>
            <span className="batch-group__summary">{sub}</span>
            {focus ? <span className="batch-group__focus">Focus: {focus}</span> : null}
          </span>
          <span className="badge badge--neutral">{plural(count, "card")}</span>
        </button>
        {onPractice ? (
          <button className="btn btn--sm btn--secondary" type="button" onClick={onPractice}>
            Practice
          </button>
        ) : null}
      </div>
      {open ? <div className="batch-group__cards">{children}</div> : null}
    </section>
  );
}

function CardsPanelView({
  bundle,
  onReview,
  onPractice,
  onPracticeBatch,
  onGenerate
}: {
  bundle: NotebookBundle;
  onReview: () => void;
  onPractice: () => void;
  onPracticeBatch: (batchId: number) => void;
  onGenerate: () => void;
}) {
  const due = dueCount(bundle.cards);
  const batches = (bundle.batches ?? [])
    .map((batch) => ({
      batch,
      cards: bundle.cards.filter((card) => card.batchId === batch.id)
    }))
    .filter((group) => group.cards.length > 0);
  const manual = bundle.cards.filter((card) => card.batchId == null && !card.generatedAt);
  const legacy = bundle.cards.filter((card) => card.batchId == null && Boolean(card.generatedAt));

  return (
    <div className="stack--16">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2>Flashcards</h2>
        <span className="badge badge--neutral">{plural(bundle.cards.length, "card")}</span>
      </div>
      <button className="btn btn--ai btn--block" type="button" onClick={onGenerate}>
        <Icon name="sparkle" size={17} className="i-sparkle" /> Generate from sources
      </button>
      {bundle.cards.length === 0 ? (
        <div className="empty">
          <p className="h3">No cards yet</p>
          <p className="small">Generate a first set from your sources, then review them daily.</p>
        </div>
      ) : (
        <div className="stack--16">
          {batches.map(({ batch, cards }) => (
            <BatchGroup
              key={batch.id}
              title={relativeBatchDate(batch.createdAt)}
              sub={batch.sourceSummary}
              focus={batch.focus}
              count={cards.length}
              onPractice={() => onPracticeBatch(batch.id)}
            >
              <div className="stack--8">
                {cards.map((card) => (
                  <CardRowView key={card.id} card={card} />
                ))}
              </div>
            </BatchGroup>
          ))}
          {manual.length > 0 ? (
            <BatchGroup title="Manual" sub="Cards you added by hand" count={manual.length}>
              <div className="stack--8">
                {manual.map((card) => (
                  <CardRowView key={card.id} card={card} />
                ))}
              </div>
            </BatchGroup>
          ) : null}
          {legacy.length > 0 ? (
            <BatchGroup title="Generated" sub="Older generated cards" count={legacy.length}>
              <div className="stack--8">
                {legacy.map((card) => (
                  <CardRowView key={card.id} card={card} />
                ))}
              </div>
            </BatchGroup>
          ) : null}
        </div>
      )}
      <div style={{ position: "sticky", bottom: "calc(12px + env(safe-area-inset-bottom))", paddingTop: 6 }}>
        <button className="btn btn--primary btn--block" type="button" onClick={due ? onReview : onPractice}>
          {due ? `Review ${plural(due, "card")}` : "Practice all cards"}
        </button>
      </div>
    </div>
  );
}

export default function NotebookScreen() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sheet = useSheet();
  const { toast } = useToast();
  const id = Number(params.id);
  const [bundle, setBundle] = useState<NotebookBundle | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [tab, setTab] = useState<Tab>((search.get("tab") as Tab) || "overview");

  useEffect(() => {
    const value = search.get("tab");
    if (value === "overview" || value === "chat" || value === "cards") setTab(value);
  }, [search]);

  function chooseTab(value: Tab) {
    setTab(value);
    router.replace(`/notebooks/${id}${value === "overview" ? "" : `?tab=${value}`}`);
  }

  const reload = useCallback(
    async (_silent = false) => {
      if (!Number.isInteger(id)) {
        setStatus("missing");
        return;
      }
      // A silent refresh keeps what is already on screen; only a first load
      // swaps the page out for the skeleton.
      if (!_silent) setStatus("loading");
      try {
        const next = await loadNotebook(id);
        setBundle(next);
        setStatus("ready");
      } catch (error) {
        const code = (error as { status?: number }).status;
        const redirect = authRedirectFor(error);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        if (_silent) return;
        setBundle(null);
        setStatus(code === 404 ? "missing" : "failed");
      }
    },
    [id, router]
  );

  useEffect(() => {
    void reload();
  }, [id, reload]);

  const handleSourceDeleted = useCallback(() => {
    void reload(true);
    void notebookViewsCache.load({ force: true }).catch(() => undefined);
    summaryCache.invalidate();
  }, [reload]);

  function openAddSource() {
    if (!bundle) return;
    sheet.open(<AddSourceSheetContent notebookId={id} notebookTitle={bundle.title} onSuccess={() => {
      sheet.close();
      toast("Source added");
      void notebookViewsCache.load({ force: true }).catch(() => undefined);
      void reload(true);
    }} />);
  }

  function openMenu() {
    if (!bundle) return;
    sheet.open(
      <NotebookMenuSheet
        deps={{
          title: bundle.title,
          dueCount: dueCount(bundle.cards),
          onAddSource: openAddSource,
          onGenerate: handleGenerate,
          onStartReview: startReview,
          onDelete: confirmDelete
        }}
      />
    );
  }

  function confirmDelete() {
    sheet.open(<DeleteNotebookSheet title={bundle?.title ?? ""} onConfirm={performDelete} />);
  }

  async function performDelete() {
    try {
      const res = await fetch(`/api/notebooks/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        sheet.close();
        toast("Notebook deleted");
        const current = notebookViewsCache.get();
        if (current) notebookViewsCache.set(current.filter((view) => view.notebook.id !== id));
        else notebookViewsCache.invalidate();
        summaryCache.invalidate();
        router.push("/library");
      } else {
        sheet.close();
        toast("Could not delete notebook");
      }
    } catch {
      sheet.close();
      toast("Could not delete notebook");
    }
  }

  function startReview() {
    router.push(`/review/session?notebook=${id}`);
  }

  function handleGenerate() {
    if (!bundle) return;
    if (bundle.sources.length === 0) {
      toast("Add a source first");
      return;
    }
    sheet.open(
      <GenerateCardsSheetContent
        notebookId={id}
        sources={bundle.sources}
        onCommitted={(count) => {
          sheet.close();
          setTab("cards");
          toast(`${count} ${count === 1 ? "card" : "cards"} added`);
          void notebookViewsCache.load({ force: true }).catch(() => undefined);
          summaryCache.invalidate();
          void reload(true);
        }}
      />
    );
  }

  if (status === "loading") {
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={() => router.back()} aria-label="Back">
            <Icon name="back" />
          </button>
          <span className="topbar__title grow">Notebook</span>
        </div>
        <div className="px stack--16" style={{ marginTop: 6 }} role="status" aria-busy="true">
          <span className="sr-only">Opening notebook…</span>
          <div className="skeleton" style={{ height: 96 }} />
          <div className="skeleton" style={{ height: 44 }} />
          <div className="skeleton" style={{ height: 68 }} />
          <div className="skeleton" style={{ height: 68 }} />
        </div>
      </ScreenSection>
    );
  }

  if (!bundle) {
    const missing = status === "missing";
    return (
      <ScreenSection>
        <div className="topbar">
          <button className="icon-btn" type="button" onClick={() => router.back()} aria-label="Back">
            <Icon name="back" />
          </button>
        </div>
        <div className="px">
          <div className="empty">
            <p className="h3">{missing ? "Notebook not found" : "Couldn’t open this notebook"}</p>
            <p className="small">
              {missing ? "It may have been deleted. Head back to your library." : "Check your connection and try again."}
            </p>
            {missing ? (
              <a className="btn btn--primary btn--sm" href="/library">
                Open library
              </a>
            ) : (
              <button className="btn btn--primary btn--sm" type="button" onClick={() => void reload()}>
                Try again
              </button>
            )}
          </div>
        </div>
      </ScreenSection>
    );
  }

  const due = dueCount(bundle.cards);
  const tone = TONES[id % TONES.length];
  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["chat", "Chat"],
    ["cards", "Cards"]
  ];

  return (
    <ScreenSection>
      <div className="topbar">
        <button className="icon-btn" type="button" onClick={() => router.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <span className="topbar__title grow">{bundle.title}</span>
        <button className="icon-btn" type="button" onClick={openMenu} aria-label="Notebook options">
          <Icon name="dots" size={20} className="i-dots" />
        </button>
      </div>

      <div className="nb-hero">
        <span className={`nb-hero__badge ${tone}`} aria-hidden="true">
          {(bundle.title.charAt(0) || "N").toUpperCase()}
        </span>
        <div className="nb-hero__main">
          <h1 className="nb-hero__title">{bundle.title}</h1>
          <p className="nb-hero__meta">
            {plural(bundle.sources.length, "source")} · {plural(bundle.cards.length, "card")}
            {due ? ` · ${due} due` : ""}
          </p>
        </div>
      </div>

      <div className="px">
        <div className="segmented" role="tablist" aria-label="Notebook sections">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "is-active" : ""}
              onClick={() => chooseTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tabpanel px">
        {tab === "overview" ? (
          <OverviewPanelView
            bundle={bundle}
            due={due}
            onAdd={openAddSource}
            onReview={startReview}
            onDeleteSource={handleSourceDeleted}
          />
        ) : tab === "chat" ? (
          <ChatListPanel
            notebookId={id}
            notebookTitle={bundle.title}
            hasSources={bundle.sources.length > 0}
          />
        ) : (
          <CardsPanelView
            bundle={bundle}
            onReview={startReview}
            onPractice={() => router.push(`/review/session?notebook=${id}&practice=1`)}
            onPracticeBatch={(batchId) => router.push(`/review/session?notebook=${id}&batch=${batchId}`)}
            onGenerate={handleGenerate}
          />
        )}
      </div>
    </ScreenSection>
  );
}

function OverviewPanelView({
  bundle,
  due,
  onAdd,
  onReview,
  onDeleteSource
}: {
  bundle: NotebookBundle;
  due: number;
  onAdd: () => void;
  onReview: () => void;
  onDeleteSource: () => void;
}) {
  return (
    <div className="stack--16">
      <div className="card card--flat spread">
        <div>
          <p className="h3">{due ? `${plural(due, "card")} due` : "No cards due"}</p>
          <p className="small muted">
            {plural(bundle.cards.length, "card")} in this notebook · {plural(bundle.sources.length, "source")}
          </p>
        </div>
        <button className={`btn btn--sm ${due ? "btn--primary" : "btn--secondary"}`} type="button" onClick={onReview}>
          {due ? "Review" : "Practice"}
        </button>
      </div>

      <section>
        <div className="section-head">
          <h2>Sources</h2>
          <button className="btn btn--sm btn--secondary" type="button" onClick={onAdd}>
            <Icon name="plus" size={15} /> Add
          </button>
        </div>
        {bundle.sources.length ? (
          <div className="rows">
            {bundle.sources.map((source) => (
              <SourceRowView
                key={source.id}
                source={source}
                notebookId={bundle.id}
                onDelete={onDeleteSource}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <p className="h3">No sources yet</p>
            <p className="small">Add a PDF, paste your notes, or link a lecture.</p>
            <button className="btn btn--secondary btn--sm" type="button" onClick={onAdd}>
              Add a source
            </button>
          </div>
        )}
      </section>

      <div className="ai-note">
        <Icon name="sparkle" size={16} className="i-sparkle" /> Open Chat to ask across all{" "}
        {plural(bundle.sources.length, "source")} — answers show which sources they used.
      </div>
    </div>
  );
}
