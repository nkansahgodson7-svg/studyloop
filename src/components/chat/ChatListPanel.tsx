"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { authRedirectFor } from "@/lib/client/api";
import { startOptimisticNav } from "@/lib/client/optimistic-nav";
import {
  createConversation,
  loadConversations,
  type ChatConversation
} from "@/lib/client/chat";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatListPanel({
  notebookId,
  notebookTitle,
  hasSources
}: {
  notebookId: number;
  notebookTitle: string;
  hasSources: boolean;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setConversations(await loadConversations(notebookId));
      setError(null);
    } catch (err) {
      const redirect = authRedirectFor(err);
      if (redirect) {
        router.replace(redirect);
        return;
      }
      setError((err as Error).message);
      setConversations([]);
    }
  }, [notebookId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startChat() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const conversation = await createConversation(notebookId);
      const href = `/notebooks/${notebookId}/chat/${conversation.id}`;
      startOptimisticNav(href);
      router.push(href);
    } catch (err) {
      const redirect = authRedirectFor(err);
      if (redirect) {
        router.replace(redirect);
        return;
      }
      setError((err as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="stack--16">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2>Chat</h2>
        {conversations ? (
          <span className="badge badge--neutral">
            {conversations.length} {conversations.length === 1 ? "chat" : "chats"}
          </span>
        ) : null}
      </div>

      <button
        className="btn btn--ai btn--block"
        type="button"
        onClick={() => void startChat()}
        disabled={creating}
      >
        <Icon name="plus" size={17} /> {creating ? "Starting…" : "New chat"}
      </button>

      {error ? (
        <p className="small chat-drawer__error" role="alert">
          {error}
          <button className="chat-error__retry" type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}

      {conversations === null ? (
        <div className="stack--8" role="status" aria-busy="true">
          <span className="sr-only">Loading chats…</span>
          <div className="skeleton" style={{ height: 66 }} />
          <div className="skeleton" style={{ height: 66 }} />
          <div className="skeleton" style={{ height: 66 }} />
        </div>
      ) : conversations.length === 0 ? (
        <div className="empty">
          <p className="h3">No chats yet</p>
          <p className="small">
            {hasSources
              ? `Ask questions across ${notebookTitle}’s sources, or anything else you’re studying.`
              : "This notebook has no sources yet, so answers come from general knowledge."}
          </p>
        </div>
      ) : (
        <div className="rows">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className="row chat-row"
              onClick={() => {
                const href = `/notebooks/${notebookId}/chat/${conversation.id}`;
                startOptimisticNav(href);
                router.push(href);
              }}
            >
              <span className="row__tile tone-lilac">
                <Icon name="sparkle" size={18} className="i-sparkle" />
              </span>
              <span className="row__main">
                <span className="row__title">{conversation.title}</span>
                <span className="row__meta">
                  {conversation.preview || "No messages yet"} ·{" "}
                  {relativeTime(conversation.updatedAt)}
                </span>
              </span>
              <Icon name="chevron" size={16} className="i-muted" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
