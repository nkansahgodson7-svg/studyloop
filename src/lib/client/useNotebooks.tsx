"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { getJson, loadNotebookViews, type NotebookView } from "./api";

export function useNotebookList() {
  const router = useRouter();
  const { open: openSheet, close: closeSheet } = useSheet();
  const { toast } = useToast();
  const [views, setViews] = useState<NotebookView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await loadNotebookViews();
      if (!alive.current) return;
      setViews(next);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (!alive.current) return;
      if (status === 401) {
        router.replace("/login");
        return;
      }
      toast("Could not load your notebooks");
    }
  }, [router, toast]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const create = useCallback(
    async (title: string) => {
      setCreating(true);
      try {
        const notebook = await getJson<{ id: number }>("/api/notebooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title })
        });
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

  return { views, creating, load, create, openCreateSheet };
}
