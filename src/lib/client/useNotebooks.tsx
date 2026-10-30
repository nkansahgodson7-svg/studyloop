"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { authRedirectFor, getJson } from "./api";
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
        const redirect = authRedirectFor(error);
        if (redirect) {
          router.replace(redirect);
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
    async (title: string): Promise<string | null> => {
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
        return null;
      } catch (error) {
        const status = (error as { status?: number }).status;
        // The sheet surfaces this inline; it stays visible after any toast.
        return status === 401
          ? "Your session expired — sign in again."
          : "Could not create notebook. Check your connection and try again.";
      } finally {
        setCreating(false);
      }
    },
    [closeSheet, router, toast]
  );

  const openCreateSheet = useCallback(() => {
    openSheet(<NewNotebookSheetContent create={create} />);
  }, [create, openSheet]);

  return { views, creating, create, openCreateSheet };
}

/**
 * Self-contained sheet. The sheet stores a snapshot of the node it was opened
 * with, so any loading state has to live in a component of its own for the
 * submit button to actually flip to its spinner/disabled state.
 */
function NewNotebookSheetContent({ create }: { create: (title: string) => Promise<string | null> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <SheetFrame
      title="New notebook"
      sub="One notebook per course works best."
      formId="newNotebookForm"
      onSubmit={(data) => {
        if (submitting) return;
        const title = (data.get("title") ?? "").toString().trim();
        if (!title) return;
        setError(null);
        setSubmitting(true);
        void create(title)
          .then((message) => setError(message))
          .finally(() => setSubmitting(false));
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
              disabled={submitting}
            />
          </div>
          <p className="hint">You can add PDFs, pasted notes, and lecture links once it exists.</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
      foot={
        <button
          className="btn btn--primary btn--block"
          type="submit"
          form="newNotebookForm"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <span className="spinner" /> Creating…
            </>
          ) : (
            "Create notebook"
          )}
        </button>
      }
    />
  );
}
