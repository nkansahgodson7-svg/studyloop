"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { authRedirectFor } from "@/lib/client/api";
import { notebookViewsCache } from "@/lib/client/cache";
import {
  createConversation,
  deleteConversation,
  seedConversation
} from "@/lib/client/chat";
import { useSmartBack } from "@/lib/client/history";
import Composer from "./Composer";

const FALLBACK_ERROR =
  "Could not start a new chat. Check your connection and try again.";

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  // Network failures surface as "Failed to fetch", which says nothing useful.
  if (!message || message === "Failed to fetch") return FALLBACK_ERROR;
  return message;
}

/**
 * The destination of every "New chat" click. It paints the chat frame
 * immediately and creates the conversation in the background, then replaces
 * the URL with the real chat. The created conversation is handed over in
 * memory so the chat screen opens without a second detail request.
 */
export default function NewChatScreen({ notebookId }: { notebookId: number }) {
  const router = useRouter();
  const [notebookTitle] = useState(
    () =>
      notebookViewsCache
        .get()
        ?.find((view) => view.notebook.id === notebookId)?.notebook.title ?? null
  );
  const [status, setStatus] = useState<"creating" | "failed">("creating");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const aliveRef = useRef(true);

  const goBack = useSmartBack(
    `/notebooks/${notebookId}?tab=chat`,
    (from) =>
      from === `/notebooks/${notebookId}` ||
      from.startsWith(`/notebooks/${notebookId}/chat`)
  );

  const start = useCallback(() => {
    setStatus("creating");
    setError(null);
    createConversation(notebookId)
      .then((conversation) => {
        if (!aliveRef.current) {
          // The user left before creation finished; don't leave an empty
          // conversation behind in their history.
          void deleteConversation(conversation.id).catch(() => undefined);
          return;
        }
        seedConversation(conversation);
        router.replace(`/notebooks/${notebookId}/chat/${conversation.id}`);
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        const redirect = authRedirectFor(err);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        setStatus("failed");
        setError(describeError(err));
      });
  }, [notebookId, router]);

  useEffect(() => {
    aliveRef.current = true;
    // StrictMode remounts effects; only the real mount may create a chat.
    if (!startedRef.current) {
      startedRef.current = true;
      start();
    }
    return () => {
      aliveRef.current = false;
    };
  }, [start]);

  if (status === "failed") {
    return (
      <ScreenSection className="chat-screen">
        <div className="chat-head">
          <div className="chat-head__row">
            <button
              className="icon-btn"
              type="button"
              onClick={goBack}
              aria-label="Back to notebook"
            >
              <Icon name="back" />
            </button>
            <div className="chat-head__title">New chat</div>
          </div>
          {notebookTitle ? <p className="chat-head__sub">{notebookTitle}</p> : null}
        </div>
        <div className="px">
          <div className="empty">
            <p className="h3">Couldn’t start this chat</p>
            <p className="small">{error}</p>
            <button className="btn btn--primary btn--sm" type="button" onClick={start}>
              Try again
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={goBack}>
              Back to notebook
            </button>
          </div>
        </div>
      </ScreenSection>
    );
  }

  return (
    <ScreenSection className="chat-screen">
      <div className="chat-shell">
        <div className="chat-head">
          <div className="chat-head__row">
            <button
              className="icon-btn"
              type="button"
              onClick={goBack}
              aria-label="Back to notebook"
            >
              <Icon name="back" />
            </button>
            <div className="chat-head__title">New chat</div>
          </div>
          {notebookTitle ? <p className="chat-head__sub">{notebookTitle}</p> : null}
        </div>

        <div className="chat-thread">
          <div className="chat-empty">
            <span className="chat-empty__mark tone-sage">
              <Icon name="sparkle" size={22} className="i-sparkle" />
            </span>
            <h1 className="chat-empty__title">Starting a new chat</h1>
            <p className="chat-empty__sub">
              {notebookTitle
                ? `Setting up a conversation in ${notebookTitle}.`
                : "Setting up a fresh conversation."}{" "}
              You can ask your first question in a moment.
            </p>
            <p className="small muted" role="status" aria-busy="true">
              <span className="spinner" /> Creating conversation…
            </p>
          </div>
        </div>

        <div className="chat-compose">
          <Composer
            value=""
            onChange={() => undefined}
            onSend={() => undefined}
            onStop={() => undefined}
            streaming={false}
            disabled
            placeholder="Creating chat…"
          />
        </div>
      </div>
    </ScreenSection>
  );
}
