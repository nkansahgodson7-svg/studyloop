"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import type { ChatMessage } from "@/lib/client/chat";
import Markdown from "./Markdown";
import SourcesUsed from "./SourcesUsed";

export function groundingLabel(grounding: ChatMessage["grounding"]): string | null {
  if (grounding === "sources") return "From your sources";
  if (grounding === "general") return "General knowledge";
  if (grounding === "mixed") return "Sources + general";
  return null;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MessageBubble({
  message,
  streaming = false,
  busy = false,
  error = null,
  onRegenerate,
  onRetry,
  onEdit
}: {
  message: ChatMessage;
  streaming?: boolean;
  busy?: boolean;
  error?: string | null;
  onRegenerate?: () => void;
  onRetry?: () => void;
  onEdit?: (content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [confirmingEdit, setConfirmingEdit] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [message.content, editing]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: nothing to show.
    }
  }

  const isUser = message.role === "user";
  const label = isUser ? null : groundingLabel(message.grounding);
  const hasText = message.content.trim().length > 0;

  if (isUser) {
    return (
      <div className="chat-turn chat-turn--user">
        <div className="msg msg--user">
          {editing ? (
            <div className="msg-edit">
              <textarea
                className="msg-edit__input"
                value={draft}
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Edit your question"
              />
              <div className="msg-edit__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                    setConfirmingEdit(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                {confirmingEdit ? (
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => {
                      const value = draft.trim();
                      if (value.length === 0) return;
                      setEditing(false);
                      setConfirmingEdit(false);
                      onEdit?.(value);
                    }}
                    disabled={busy || draft.trim().length === 0}
                  >
                    Resend & replace
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => setConfirmingEdit(true)}
                    disabled={busy || draft.trim().length === 0 || draft.trim() === message.content}
                  >
                    Save
                  </button>
                )}
              </div>
              {confirmingEdit ? (
                <p className="msg-edit__warn">
                  This replaces every message after this question.
                </p>
              ) : null}
            </div>
          ) : (
            <p>{message.content}</p>
          )}
          {!editing ? (
            <div className="msg__actions">
              <button type="button" onClick={copy} aria-label="Copy question">
                <Icon name={copied ? "check" : "copy"} size={14} />
              </button>
              {onEdit ? (
                <button type="button" onClick={() => setEditing(true)} aria-label="Edit question">
                  <Icon name="edit" size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <div className="chat-error" role="alert">
            <Icon name="alert" size={14} />
            <span>{error}</span>
            {onRetry ? (
              <button type="button" className="chat-error__retry" onClick={onRetry} disabled={busy}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="chat-turn chat-turn--ai">
      <div className="msg msg--ai" aria-busy={streaming && !hasText ? true : undefined}>
        <div className="msg__label">
          <Icon name="sparkle" size={12} className="i-sparkle" /> StudyLoop
          {message.status === "stopped" ? <span className="msg__badge">Stopped</span> : null}
        </div>
        {hasText ? (
          <Markdown text={message.content} />
        ) : streaming ? (
          <div className="msg__body">
            <span className="typing" aria-label="Thinking">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}
        {label ? (
          <div className={`grounding grounding--${message.grounding}`}>
            <span className="grounding__dot" aria-hidden="true" />
            {label}
          </div>
        ) : null}
        {label === "General knowledge" || label === "Sources + general" ? (
          <p className="grounding__note">Verify with your course material.</p>
        ) : null}
        <SourcesUsed sources={message.sources} />
        {!streaming && hasText ? (
          <div className="msg__actions">
            <button type="button" onClick={copy} aria-label="Copy answer">
              <Icon name={copied ? "check" : "copy"} size={14} />
            </button>
            {onRegenerate ? (
              <button type="button" onClick={onRegenerate} aria-label="Regenerate answer" disabled={busy}>
                <Icon name="rotate" size={14} />
              </button>
            ) : null}
            <span className="msg__time">{timeLabel(message.createdAt)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
