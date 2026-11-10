"use client";

import { useState, type ReactNode } from "react";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/icons";

type Kind = "pdf" | "text" | "youtube";

const KINDS: Array<{ kind: Kind; title: string; sub: string; glyph: string; tone: string }> = [
  { kind: "pdf", title: "PDF", sub: "Lecture slides, textbook chapters", glyph: "file", tone: "tone-butter" },
  { kind: "text", title: "Paste text", sub: "Notes, summaries, transcripts", glyph: "text", tone: "tone-sage" },
  { kind: "youtube", title: "YouTube", sub: "Transcript from a lecture link", glyph: "play", tone: "tone-sky" }
];

export default function AddSourceSheetContent({
  notebookId,
  notebookTitle,
  onSuccess
}: {
  notebookId: number;
  notebookTitle: string;
  onSuccess: () => void;
}) {
  const { close } = useSheet();
  const [kind, setKind] = useState<Kind>("pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function submit(data: FormData) {
    if (busy) return;
    setError(null);

    let init: RequestInit;
    if (kind === "youtube") {
      const url = ((data.get("url") ?? "") as string).trim();
      init = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      };
    } else if (kind === "pdf") {
      const fileInput = document.querySelector<HTMLInputElement>("#pdfFile");
      const file = fileInput?.files?.[0];
      if (!file) {
        setError("Choose a PDF first.");
        return;
      }
      setBusy(true);
      try {
        const { extractPdfText } = await import("@/lib/pdf/extract");
        const { pages, pageCount } = await extractPdfText(await file.arrayBuffer());
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: file.name, pages, kind: "pdf", pageCount })
        };
      } catch {
        setBusy(false);
        setError("Could not read that PDF.");
        return;
      }
    } else {
      const text = ((data.get("text") ?? "") as string).trim();
      if (text.length < 20) {
        setError("Paste at least a paragraph (20+ characters).");
        return;
      }
      init = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: ((data.get("title") ?? "") as string).trim() || undefined, text })
      };
    }

    setBusy(true);
    try {
      const res = await fetch(
        kind === "youtube" ? `/api/notebooks/${notebookId}/sources/youtube` : `/api/notebooks/${notebookId}/sources`,
        init
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Could not add source (${res.status})`);
        return;
      }
      onSuccess();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  const processing: ReactNode = busy ? (
    <div className="processing">
      <div className="processing__row">
        <span className="spinner" />{" "}
        {kind === "pdf" ? "Extracting pages and indexing" : kind === "youtube" ? "Fetching transcript" : "Chunking and indexing"}
      </div>
      <div className="processing__row">
        <Icon name="check" size={15} /> Chunks will be searchable from Chat
      </div>
    </div>
  ) : null;

  const fields: Record<Kind, ReactNode> = {
    pdf: (
      <>
        <div className="field">
          <span className="label">PDF file</span>
          <label className="file-picker" htmlFor="pdfFile">
            <span className="file-picker__icon">
              <Icon name="file" size={20} />
            </span>
            <span className="file-picker__main">
              <span className="file-picker__title">{fileName ?? "Choose a PDF"}</span>
              <span className="file-picker__sub">
                {fileName ? "Tap to replace" : "Up to 100 pages · 40 MB"}
              </span>
            </span>
            <span className="file-picker__action">{fileName ? "Change" : "Browse"}</span>
            <input
              className="sr-only"
              id="pdfFile"
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              aria-label="PDF file"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
            />
          </label>
        </div>
      </>
    ),
    text: (
      <>
        <div className="field">
          <label className="label" htmlFor="srcTitle">
            Title
          </label>
          <input className="input" id="srcTitle" name="title" type="text" maxLength={120} placeholder="Lecture notes" />
        </div>
        <div className="field">
          <label className="label" htmlFor="srcText">
            Paste text
          </label>
          <textarea className="textarea" id="srcText" name="text" placeholder="Paste any study material here" required />
        </div>
      </>
    ),
    youtube: (
      <>
        <div className="field">
          <label className="label" htmlFor="ytUrl">
            YouTube URL
          </label>
          <input className="input" id="ytUrl" name="url" type="url" placeholder="https://www.youtube.com/watch?v=…" required />
        </div>
        <p className="hint">The transcript is fetched server-side, then split into searchable chunks.</p>
      </>
    )
  };

  return (
    <SheetFrame
      title="Add a source"
      sub={notebookTitle}
      formId="addSourceForm"
      onSubmit={(data) => void submit(data)}
      body={
        <>
          <div className="kind-list">
            {KINDS.map((meta) => (
              <button
                key={meta.kind}
                className={`kind ${kind === meta.kind ? "is-selected" : ""}`}
                type="button"
                aria-pressed={kind === meta.kind}
                onClick={() => {
                  setKind(meta.kind);
                  setError(null);
                  if (meta.kind !== "pdf") setFileName(null);
                }}
              >
                <span className={`kind__tile ${meta.tone}`}>
                  <Icon name={meta.glyph} size={19} />
                </span>
                <span className="grow">
                  <span className="kind__title" style={{ display: "block" }}>
                    {meta.title}
                  </span>
                  <span className="kind__sub" style={{ display: "block" }}>
                    {meta.sub}
                  </span>
                </span>
                {kind === meta.kind ? <Icon name="check" size={18} /> : null}
              </button>
            ))}
          </div>
          <div className="stack--8" style={{ marginTop: 4 }}>
            {fields[kind]}
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {processing}
        </>
      }
      foot={
        <>
          <button
            className="btn btn--primary btn--block"
            type="submit"
            form="addSourceForm"
            disabled={busy || (kind === "pdf" && !fileName)}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <span className="spinner" /> Working…
              </>
            ) : kind === "pdf" ? (
              "Add PDF"
            ) : kind === "youtube" ? (
              "Add transcript"
            ) : (
              "Save source"
            )}
          </button>
          <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={close}>
            Cancel
          </button>
        </>
      }
    />
  );
}
