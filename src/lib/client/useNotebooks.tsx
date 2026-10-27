"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { getJson } from "./api";
import { notebookViewsCache } from "./cache";

export function useNotebookList() {
  const router = useRouter();
  const { open: openSheet, close: closeSheet } = useSheet();
  const { toast } = useToast();
  const [views, setViews] = useState(() => notebookViewsCache.get());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = notebookViewsCache.subscribe((next) => {
      if (active) setViews(next);
    });

    if (!notebookViewsCache.isFresh()) {
      void notebookViewsCache.load().catch((error) => {
        if (!active) return;
        if ((error as { status?: number }).status === 401) {
          router.replace("/login");
          return;
        }
        if (notebookViewsCache.get() === null) {
          toast("Could not load your notebooks");
        }
      });
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router, toast]);

  const create = useCallback(
    async (title: string) => {
      setCreating(true);
      try {
        const notebook = await getJson<{ id: number; title?: string }>("/api/notebooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title })
        });
        const current = notebookViewsCache.get() ?? [];
        notebookViewsCache.set([
          {
            notebook: {
              id: notebook.id,
              title: notebook.title ?? title,
              createdAt: new Date().toISOString()
            },
            sources: 0,
            cards: 0,
            due: 0
          },
          ...current
        ]);
        closeSheet();
        toast("Notebook created");
        router.push(`/notebooks/${notebook.id}`);
      } catch {
        toast("Could not create notebook");
      } finally {
        setCreating(false);
      }
    },
    [closeSheet, router, toast]
  );

  const openCreateSheet = useCallback(() => {
    openSheet(
      <SheetFrame
        title="New notebook"
        sub="One notebook per course works best."
        formId="newNotebookForm"
        onSubmit={(data) => {
          const title = (data.get("title") ?? "").toString().trim();
          if (title) void create(title);
        }}
        body={
          <>
            <div className="field">
              <label className="label" htmlFor="nbTitle">
                Notebook title
              </label>
              <input
                className="input"
                id="nbTitle"
                name="title"
                type="text"
                maxLength={120}
                placeholder="e.g. Organic Chemistry"
                required
              />
            </div>
            <p className="hint">You can add PDFs, pasted notes, and lecture links once it exists.</p>
          </>
        }
        foot={
          <button className="btn btn--primary btn--block" type="submit" form="newNotebookForm" disabled={creating}>
            Create notebook
          </button>
        }
      />
    );
  }, [create, creating, openSheet]);

  return { views, creating, create, openCreateSheet };
}
