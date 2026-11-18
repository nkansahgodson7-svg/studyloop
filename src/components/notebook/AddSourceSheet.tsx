"use client";

import { useState, type ReactNode } from "react";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/icons";
import { addSourceErrorMessage, extractErrorMessage } from "@/lib/client/extract-error";
import { describePhase, type Phase } from "@/lib/client/upload-progress";
import { useUploadThing } from "@/lib/client/uploadthing";

type Kind = "pdf" | "ppt" | "text" | "youtube";

// A legacy .ppt sent in one request hits the host's 4.5 MB body cap, so decks
// above this go through storage instead. Must match MAX_PPT_BYTES in
// src/lib/server/sources.ts.
const LEGACY_PPT_MAX_BYTES = 4 * 1024 * 1024;

// Must match MAX_RELAYED_FILE_BYTES in src/lib/server/source-files.ts.
const LEGACY_PPT_RELAY_MAX_BYTES = 40 * 1024 * 1024;

const KINDS: Array<{ kind: Kind; title: string; sub: string; glyph: string; tone: string }> = [
  { kind: "pdf", title: "PDF", sub: "Lecture slides, textbook chapters", glyph: "file", tone: "tone-butter" },
  { kind: "ppt", title: "PowerPoint", sub: "Slides (.ppt, .pptx)", glyph: "file", tone: "tone-butter" },
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
  const [uploadPercent, setUploadPercent] = useState(0);
  const { startUpload } = useUploadThing("sourceFile", {
    onUploadProgress: (percent) => setUploadPercent(percent)
  });
  const [kind, setKind] = useState<Kind>("pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function submit(data: FormData) {
    if (busy) return;
    setError(null);
    setPhase(null);
    setUploadPercent(0);

    let init: RequestInit;
    let pptUpload = false;
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
        setPhase({ kind: "reading", unit: "page", done: 0, total: 0 });
        const { pages, pageCount } = await extractPdfText(await file.arrayBuffer(), (done, total) =>
          setPhase({ kind: "reading", unit: "page", done, total })
        );
        setPhase({ kind: "indexing", unit: "pages", total: pageCount });
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: file.name, pages, kind: "pdf", pageCount })
        };
      } catch (error) {
        setBusy(false);
        setError(extractErrorMessage(error, "pdf"));
        return;
      }
    } else if (kind === "ppt") {
      const fileInput = document.querySelector<HTMLInputElement>("#pptFile");
      const file = fileInput?.files?.[0];
      if (!file) {
        setError("Choose a PowerPoint file first.");
        return;
      }
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.pptx')) {
        setBusy(true);
        try {
          const { extractPptxText, MAX_PPTX_BYTES } = await import("@/lib/ppt/extract");
          if (file.size > MAX_PPTX_BYTES) {
            setBusy(false);
            setError("PowerPoint file too large (max 40 MB).");
            return;
          }
          setPhase({ kind: "reading", unit: "slide", done: 0, total: 0 });
          const { pages, pageCount } = await extractPptxText(await file.arrayBuffer(), (done, total) =>
            setPhase({ kind: "reading", unit: "slide", done, total })
          );
          // Keep the original deck for rendered slide previews. Without storage
          // configured the source still works from the extracted text.
          let fileKey: string | undefined;
          setPhase({ kind: "uploading", label: "Uploading the original deck" });
          try {
            const uploaded = await startUpload([file]);
            fileKey = uploaded?.[0]?.key;
          } catch {
            fileKey = undefined;
          }
          setPhase({ kind: "indexing", unit: "slides", total: pageCount });
          init = {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: file.name, pages, kind: "ppt", pageCount, fileKey })
          };
        } catch (error) {
          setBusy(false);
          setError(extractErrorMessage(error, "ppt"));
          return;
        }
      } else if (lower.endsWith('.ppt')) {
        // Legacy binary format is parsed server-side, so the bytes have to
        // reach the server. A direct request is capped by the host at 4.5 MB,
        // so bigger decks are parked in storage and pulled back by custom id.
        pptUpload = true;
        if (file.size > LEGACY_PPT_RELAY_MAX_BYTES) {
          const mb = (file.size / (1024 * 1024)).toFixed(1);
          setError(
            `This .ppt is ${mb} MB, and the limit is 40 MB. Save it as .pptx from PowerPoint and upload that.`
          );
          return;
        }
        if (file.size > LEGACY_PPT_MAX_BYTES) {
          setBusy(true);
          setPhase({ kind: 'uploading', label: 'Uploading the deck' });
          let customId: string | undefined;
          try {
            const uploaded = await startUpload([file]);
            customId = uploaded?.[0]?.serverData?.customId ?? undefined;
          } catch {
            customId = undefined;
          }
          if (!customId) {
            setBusy(false);
            setPhase(null);
            setError(
              'This deck is too large to send directly, and upload storage is unavailable. Save it as .pptx and upload that.'
            );
            return;
          }
          setPhase({ kind: 'uploading', label: 'Reading and indexing the slides' });
          init = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: file.name, kind: 'ppt', customId })
          };
        } else {
          const formData = new FormData();
          formData.append('file', file);
          init = { method: 'POST', body: formData };
          setPhase({ kind: 'uploading', label: 'Uploading the deck' });
        }
      } else {
        setError("Choose a .ppt or .pptx file.");
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
      const url =
        kind === "youtube"
          ? `/api/notebooks/${notebookId}/sources/youtube`
          : pptUpload
            ? `/api/notebooks/${notebookId}/sources/ppt`
            : `/api/notebooks/${notebookId}/sources`;
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(addSourceErrorMessage(res.status, body?.error));
        return;
      }
      onSuccess();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
      setPhase(null);
      setUploadPercent(0);
    }
  }

  const processing: ReactNode = busy ? (
    <div className="processing">
      <div className="processing__row">
        <span className="spinner" />{" "}
        {phase
          ? describePhase(phase, uploadPercent)
          : kind === "pdf"
            ? "Extracting pages and indexing"
            : kind === "ppt"
              ? "Extracting slides and indexing"
              : kind === "youtube"
                ? "Fetching transcript"
                : "Chunking and indexing"}
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
                {fileName ? "Tap to replace" : "Up to 300 pages · 40 MB"}
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
    ppt: (
      <>
        <div className="field">
          <span className="label">PowerPoint file</span>
          <label className="file-picker" htmlFor="pptFile">
            <span className="file-picker__icon">
              <Icon name="file" size={20} />
            </span>
            <span className="file-picker__main">
              <span className="file-picker__title">{fileName ?? "Choose a PowerPoint"}</span>
              <span className="file-picker__sub">
                {fileName ? "Tap to replace" : "Up to 300 slides · 40 MB"}
              </span>
            </span>
            <span className="file-picker__action">{fileName ? "Change" : "Browse"}</span>
            <input
              className="sr-only"
              id="pptFile"
              name="file"
              type="file"
              accept="application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,.ppt,.pptx"
              aria-label="PowerPoint file"
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
                  if (meta.kind !== "pdf" && meta.kind !== "ppt") setFileName(null);
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
            disabled={busy || ((kind === "pdf" || kind === "ppt") && !fileName)}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <span className="spinner" /> Working…
              </>
            ) : kind === "ppt" ? (
              "Add PowerPoint"
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
