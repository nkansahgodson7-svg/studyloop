"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon, TONES, plural } from "@/components/ui/icons";
import { useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { SheetFrame } from "@/components/ui/Sheet";
import AddSourceSheetContent from "@/components/notebook/AddSourceSheet";
import ChatPanel from "@/components/notebook/ChatPanel";
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

function CardsPanelView({
  bundle,
  generating,
  onReview,
  onPractice,
  onGenerate
}: {
  bundle: NotebookBundle;
  generating: boolean;
  onReview: () => void;
  onPractice: () => void;
  onGenerate: () => void;
}) {
  const due = dueCount(bundle.cards);

  return (
    <div className="stack--16">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2>Flashcards</h2>
        <span className="badge badge--neutral">{plural(bundle.cards.length, "card")}</span>
      </div>
      <button className="btn btn--ai btn--block" type="button" disabled={generating} onClick={onGenerate}>
        <Icon name="sparkle" size={17} className="i-sparkle" /> {generating ? "Reading sources…" : "Generate from sources"}
      </button>
      {generating ? (
        <div className="processing">
          <div className="processing__row">
            <span className="spinner" /> Scanning {plural(bundle.sources.length, "source")} and drafting cards…
          </div>
          <div className="skeleton" style={{ height: 68 }} />
          <div className="skeleton" style={{ height: 68 }} />
          <div className="skeleton" style={{ height: 68 }} />
        </div>
      ) : null}
      {!generating && bundle.cards.length === 0 ? (
        <div className="empty">
          <p className="h3">No cards yet</p>
          <p className="small">Generate a first set from your sources, then review them daily.</p>
        </div>
      ) : null}
      {!generating && bundle.cards.length > 0 ? (
        <div className="stack--8">
          {(() => {
            const study = bundle.cards.filter((card) => !card.generatedAt);
            const generated = bundle.cards.filter((card) => card.generatedAt);
            const groups: Array<{ label: string; items: typeof study }> = [];
            if (study.length) groups.push({ label: `Study cards · ${study.length}`, items: study });
            if (generated.length) groups.push({ label: `Generated · ${generated.length}`, items: generated });
            return groups.map((group) => (
              <div className="stack--8" key={group.label}>
                <h3 className="h4" style={{ marginTop: 6 }}>
                  {group.label}
                </h3>
                {group.items.map((card) => (
                  <CardRowView key={card.id} card={card} />
                ))}
              </div>
            ));
          })()}
        </div>
      ) : null}
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
  const [generating, setGenerating] = useState(false);

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
    if (generating) return;
    if (!bundle) return;
    if (bundle.sources.length === 0) {
      toast("No new cards in these sources");
      return;
    }
    sheet.open(
      <GenerateCardsSheetContent
        sources={bundle.sources}
        onConfirm={(sourceIds) => {
          setGenerating(true);
          sheet.close();
          setTab("cards");
          void runGeneration(sourceIds);
        }}
      />
    );
  }

  async function runGeneration(sourceIds: number[]) {
    setGenerating(true);
    try {
      let createdTotal = 0;
      let lastError = "";
      for (const sourceId of sourceIds) {
        const res = await fetch(`/api/notebooks/${id}/cards/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId })
        });
        const body = (await res.json().catch(() => null)) as { error?: string; created?: number } | null;
        if (res.ok && typeof body?.created === "number") {
          createdTotal += body.created;
        } else if (body?.error) {
          lastError = body.error;
        }
      }
      if (createdTotal === 0) {
        toast(lastError || "No new cards in these sources");
      } else {
        void notebookViewsCache.load({ force: true }).catch(() => undefined);
        summaryCache.invalidate();
        await reload(true);
        toast("Cards generated");
      }
    } catch {
      toast("Cards could not be generated");
    } finally {
      setGenerating(false);
    }
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
              onClick={() => setTab(value)}
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
          <ChatPanel bundle={bundle} notebookId={id} />
        ) : (
          <CardsPanelView
            bundle={bundle}
            generating={generating}
            onReview={startReview}
            onPractice={() => router.push(`/review/session?notebook=${id}&practice=1`)}
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
        {plural(bundle.sources.length, "source")} — every answer cites its segment.
      </div>
    </div>
  );
}
