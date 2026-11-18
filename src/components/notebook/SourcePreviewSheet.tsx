"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SheetFrame } from "@/components/ui/Sheet";
import { getJson } from "@/lib/client/api";
import type { NotebookSource } from "@/lib/client/notebook-data";

interface SourceDetail {
  id: number;
  kind: NotebookSource["kind"];
  title: string;
  url: string | null;
  fileUrl: string | null;
  meta: string;
  pages: string[];
  createdAt: string;
}

function slideParts(page: string): { title: string; body: string[] } {
  // Speaker notes are stored after a blank line; they are not slide content.
  const content = page.split(/\n\nNotes:\n/)[0] ?? "";
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { title: lines[0] ?? "", body: lines.slice(1) };
}

function slideLabel(kind: NotebookSource["kind"]): string {
  return kind === "pdf" ? "PDF" : kind === "ppt" ? "PowerPoint" : kind === "youtube" ? "YouTube" : "Note";
}

export default function SourcePreviewSheetContent({
  notebookId,
  source
}: {
  notebookId: number;
  source: NotebookSource;
}) {
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setThumbs(null);
    setRenderFailed(false);
    setError(null);
    getJson<SourceDetail>(`/api/notebooks/${notebookId}/sources/${source.id}`)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this source.");
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, source.id]);

  // Real slide renderings come from the stored original .pptx. Anything that
  // fails (no stored file, legacy .ppt, blocked CDN) falls back to text cards.
  const fileUrl = detail?.fileUrl ?? null;
  const renderable = source.kind === "ppt" && /\.pptx$/i.test(source.title) && fileUrl != null;

  useEffect(() => {
    if (!fileUrl || !renderable) return;
    let cancelled = false;
    let urls: string[] = [];
    setThumbs(null);
    setRenderFailed(false);

    void (async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`file fetch failed: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const [{ loadPresentation, getSlides }, { renderSlideToSvg }] = await Promise.all([
          import("@office-kit/pptx"),
          import("@office-kit/pptx-preview")
        ]);
        const presentation = await loadPresentation(bytes);
        // SVG text layout keeps the thumbnails readable inside an <img>, and
        // avoids injecting deck-controlled markup into the page.
        const next = getSlides(presentation).map((slide) =>
          URL.createObjectURL(
            new Blob([renderSlideToSvg(presentation, slide, { textLayout: "svg" })], {
              type: "image/svg+xml"
            })
          )
        );
        if (cancelled) {
          next.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        urls = next;
        setThumbs(next);
      } catch {
        if (!cancelled) setRenderFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [fileUrl, renderable]);

  let body: ReactNode;
  if (error) {
    body = <p className="small muted">{error}</p>;
  } else if (!detail) {
    body = (
      <p className="small muted" aria-busy="true">
        <span className="spinner" /> Loading source…
      </p>
    );
  } else if (source.kind === "ppt") {
    body = (
      <>
        <div className="slide-grid">
          {detail.pages.map((page, index) => {
            const { title, body: lines } = slideParts(page);
            const image = !renderFailed ? thumbs?.[index] : undefined;
            return (
              <div className="slide-thumb" key={index}>
                <div className="slide-thumb__canvas">
                  {image ? (
                    <img
                      className="slide-thumb__image"
                      src={image}
                      alt={title ? `Slide ${index + 1}: ${title}` : `Slide ${index + 1}`}
                    />
                  ) : (
                    <>
                      <span className="slide-thumb__num">{index + 1}</span>
                      {title ? (
                        <>
                          <p className="slide-thumb__title">{title}</p>
                          {lines.length > 0 ? <p className="slide-thumb__body">{lines.join(" ")}</p> : null}
                        </>
                      ) : (
                        <p className="slide-thumb__empty">No text on this slide</p>
                      )}
                    </>
                  )}
                </div>
                <p className="slide-thumb__caption">Slide {index + 1}</p>
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    body = <div className="source-preview__text">{detail.pages.join("\n\n")}</div>;
  }

  const sub = [slideLabel(source.kind), source.meta].filter(Boolean).join(" · ");

  return <SheetFrame title={source.title} sub={sub || undefined} body={body} />;
}
