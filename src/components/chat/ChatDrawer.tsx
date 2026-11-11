"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import {
  createConversation,
  deleteConversation,
  loadConversations,
  renameConversation,
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

export default function ChatDrawer({
  notebookId,
  currentId,
  onOpen,
  onDeleted
}: {
  notebookId: number;
  currentId: number;
  onOpen: (id: number) => void;
  onDeleted: (id: number) => void;
}) {
  const { close } = useSheet();
  const [conversations, setConversations] = useState<ChatConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadConversations(notebookId)
      .then((list) => {
        if (!cancelled) setConversations(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  async function startChat() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const conversation = await createConversation(notebookId);
      close();
      onOpen(conversation.id);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  async function saveTitle(id: number) {
    const title = draft.trim();
    if (title.length === 0) return;
    try {
      const updated = await renameConversation(id, title);
      setConversations((prev) =>
        prev?.map((item) => (item.id === id ? { ...item, title: updated.title } : item)) ?? null
      );
      setRenamingId(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this chat? Its messages cannot be recovered.")) return;
    try {
      await deleteConversation(id);
      setConversations((prev) => prev?.filter((item) => item.id !== id) ?? null);
      close();
      onDeleted(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <SheetFrame
      className="chat-drawer-panel"
      title="Chats"
      sub="Every chat in this notebook"
      body={
        <div className="chat-drawer">
          {error ? (
            <p className="small chat-drawer__error" role="alert">
              {error}
            </p>
          ) : null}
          {conversations === null ? (
            <p className="small muted">Loading chats…</p>
          ) : conversations.length === 0 ? (
            <p className="small muted">No chats yet. Start one below.</p>
          ) : (
            <ul className="chat-drawer__list">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="chat-drawer__item">
                  {renamingId === conversation.id ? (
                    <form
                      className="chat-drawer__rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveTitle(conversation.id);
                      }}
                    >
                      <input
                        className="input"
                        value={draft}
                        maxLength={80}
                        aria-label="Chat title"
                        onChange={(event) => setDraft(event.target.value)}
                        autoFocus
                      />
                      <button className="btn btn--primary btn--sm" type="submit">
                        Save
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`chat-drawer__open ${conversation.id === currentId ? "is-active" : ""}`}
                        onClick={() => {
                          close();
                          onOpen(conversation.id);
                        }}
                      >
                        <span className="chat-drawer__title">{conversation.title}</span>
                        <span className="chat-drawer__meta">
                          {conversation.preview || "No messages yet"} ·{" "}
                          {relativeTime(conversation.updatedAt)}
                        </span>
                      </button>
                      <div className="chat-drawer__actions">
                        <button
                          type="button"
                          aria-label={`Rename ${conversation.title}`}
                          onClick={() => {
                            setRenamingId(conversation.id);
                            setDraft(conversation.title);
                          }}
                        >
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${conversation.title}`}
                          onClick={() => void remove(conversation.id)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      foot={
        <button
          className="btn btn--primary btn--block"
          type="button"
          onClick={() => void startChat()}
          disabled={creating}
        >
          <Icon name="plus" size={16} /> {creating ? "Starting…" : "New chat"}
        </button>
      }
    />
  );
}
