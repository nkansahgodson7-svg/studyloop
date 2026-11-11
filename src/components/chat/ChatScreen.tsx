"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { useSheet } from "@/components/ui/Sheet";
import { authRedirectFor } from "@/lib/client/api";
import { useSmartBack } from "@/lib/client/history";
import { loadNotebook } from "@/lib/client/notebook-data";
import {
  ChatRequestError,
  editQuestion,
  loadConversation,
  regenerateAnswer,
  retryQuestion,
  sendQuestion,
  type ChatConversation,
  type ChatDetail,
  type ChatMessage,
  type ChatSourceRef,
  type Grounding,
  type StreamHandlers
} from "@/lib/client/chat";
import ChatDrawer from "./ChatDrawer";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";

interface StreamState {
  userText: string | null;
  userMessageId: number | null;
  text: string;
  grounding: Grounding | null;
  sources: ChatSourceRef[];
}

interface TurnError {
  userMessageId: number | null;
  message: string;
}

const SUGGESTIONS = [
  "Explain the key ideas in my sources",
  "Quiz me on the main concepts",
  "Summarize this notebook in five points"
];

function describeError(error: unknown): string {
  if (error instanceof ChatRequestError) {
    if (error.status === 429) {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
      return `You've reached the chat limit. Try again in about ${minutes} ${
        minutes === 1 ? "minute" : "minutes"
      }.`;
    }
    if (error.status === 0) {
      return "Could not reach StudyLoop. Check your connection and try again.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

export default function ChatScreen({
  chatId,
  notebookId
}: {
  chatId: number;
  notebookId: number;
}) {
  const router = useRouter();
  const sheet = useSheet();

  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("Notebook");
  const [hasSources, setHasSources] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [stream, setStream] = useState<StreamState | null>(null);
  const [turnError, setTurnError] = useState<TurnError | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickRef = useRef(true);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const loadingOlderRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const hasMoreRef = useRef(false);
  const loadOlderRef = useRef<() => Promise<void>>(async () => undefined);

  messagesRef.current = messages;
  hasMoreRef.current = hasMore;

  const refresh = useCallback(async (): Promise<ChatDetail> => {
    const detail = await loadConversation(chatId);
    setConversation(detail.conversation);
    setMessages(detail.messages);
    setHasMore(detail.hasMore);
    return detail;
  }, [chatId]);

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!oldest || !hasMoreRef.current || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const scroller = scrollerRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    try {
      const page = await loadConversation(chatId, oldest.id);
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
      requestAnimationFrame(() => {
        if (scroller) {
          scroller.scrollTop += scroller.scrollHeight - previousHeight;
        }
      });
    } catch {
      // Keep the messages already loaded; scrolling up can retry.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatId]);

  loadOlderRef.current = loadOlder;

  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setMessages([]);
    setLoadError(null);
    setMissing(false);
    setTurnError(null);
    setStream(null);

    void (async () => {
      try {
        const [detail, notebook] = await Promise.all([
          loadConversation(chatId),
          loadNotebook(notebookId).catch(() => null)
        ]);
        if (cancelled) return;
        setConversation(detail.conversation);
        setMessages(detail.messages);
        setHasMore(detail.hasMore);
        if (notebook) {
          setNotebookTitle(notebook.title);
          setHasSources(notebook.sources.length > 0);
        }
      } catch (error) {
        if (cancelled) return;
        const redirect = authRedirectFor(error);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        if ((error as { status?: number }).status === 404) {
          setMissing(true);
        } else {
          setLoadError(describeError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [chatId, notebookId, router]);

  useEffect(() => {
    const scroller = rootRef.current?.closest(".screen") as HTMLElement | null;
    if (!scroller) return;
    scrollerRef.current = scroller;
    const onScroll = () => {
      const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickRef.current = gap < 90;
      setAtBottom(gap < 90);
      if (scroller.scrollTop < 70) {
        void loadOlderRef.current();
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [conversation?.id]);

  useEffect(() => {
    if (!stickRef.current) return;
    sentinelRef.current?.scrollIntoView({ block: "end" });
  }, [messages, stream?.text, stream?.grounding, turnError]);

  async function runTurn(
    seed: { userText: string | null; userMessageId: number | null },
    op: (handlers: StreamHandlers, signal: AbortSignal) => Promise<void>
  ) {
    if (abortRef.current || !conversation) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setTurnError(null);
    stickRef.current = true;
    setAtBottom(true);
    setStream({ ...seed, text: "", grounding: null, sources: [] });
    let userId = seed.userMessageId;

    try {
      await op(
        {
          onStart: (id) => {
            userId = id;
            setStream((prev) => (prev ? { ...prev, userMessageId: id } : prev));
          },
          onGrounding: (label, sources) =>
            setStream((prev) => (prev ? { ...prev, grounding: label, sources } : prev)),
          onDelta: (text) =>
            setStream((prev) => (prev ? { ...prev, text: prev.text + text } : prev))
        },
        controller.signal
      );
      await refresh().catch(() => {
        setTurnError({
          userMessageId: userId,
          message: "The answer finished but could not be loaded. Reload the page to see it."
        });
      });
    } catch (error) {
      const redirect = authRedirectFor(error);
      if (redirect) {
        router.replace(redirect);
        return;
      }

      if (controller.signal.aborted) {
        // Give the server a beat to persist the partial answer.
        await new Promise((resolve) => setTimeout(resolve, 350));
        const detail = await refresh().catch(() => null);
        const last = detail?.messages[detail.messages.length - 1];
        if (last?.role === "user") {
          setTurnError({ userMessageId: last.id, message: "Generation stopped." });
        }
      } else {
        await refresh().catch(() => null);
        const message = describeError(error);
        if (userId != null) {
          setTurnError({ userMessageId: userId, message });
        } else {
          setTurnError({ userMessageId: null, message });
          if (seed.userText) setInput(seed.userText);
        }
      }
    } finally {
      setStream(null);
      abortRef.current = null;
    }
  }

  function send(text: string) {
    const question = text.trim();
    if (!question || stream || !conversation) return;
    setInput("");
    void runTurn({ userText: question, userMessageId: null }, (handlers, signal) =>
      sendQuestion(conversation.id, question, handlers, signal)
    );
  }

  function regenerate(messageId: number) {
    if (!conversation) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index >= 0) setMessages((prev) => prev.slice(0, index));
    void runTurn({ userText: null, userMessageId: null }, (handlers, signal) =>
      regenerateAnswer(conversation.id, messageId, handlers, signal)
    );
  }

  function retry(messageId: number) {
    if (!conversation) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index >= 0) setMessages((prev) => prev.slice(0, index + 1));
    void runTurn({ userText: null, userMessageId: messageId }, (handlers, signal) =>
      retryQuestion(conversation.id, messageId, handlers, signal)
    );
  }

  function edit(messageId: number, content: string) {
    if (!conversation) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index >= 0) {
      setMessages((prev) =>
        prev.slice(0, index + 1).map((message) =>
          message.id === messageId ? { ...message, content } : message
        )
      );
    }
    void runTurn({ userText: content, userMessageId: messageId }, (handlers, signal) =>
      editQuestion(conversation.id, messageId, content, handlers, signal)
    );
  }

  function openDrawer() {
    if (!conversation) return;
    sheet.open(
      <ChatDrawer
        notebookId={notebookId}
        currentId={conversation.id}
        onOpen={(id) => router.push(`/notebooks/${notebookId}/chat/${id}`)}
        onDeleted={() => router.replace(`/notebooks/${notebookId}?tab=chat`)}
      />
    );
  }

  const backHref = `/notebooks/${notebookId}?tab=chat`;
  const goBack = useSmartBack(
    backHref,
    (from) => from === `/notebooks/${notebookId}` || from.startsWith(`/notebooks/${notebookId}/chat/`)
  );

  if (missing) {
    return (
      <ScreenSection className="chat-screen">
        <div className="chat-head">
          <div className="chat-head__row">
            <button className="icon-btn" type="button" onClick={goBack} aria-label="Back to notebook">
              <Icon name="back" />
            </button>
            <div className="chat-head__title">Chat</div>
          </div>
        </div>
        <div className="px">
          <div className="empty">
            <p className="h3">Chat not found</p>
            <p className="small">It may have been deleted. Open the notebook to start another.</p>
            <button className="btn btn--primary btn--sm" type="button" onClick={goBack}>
              Back to notebook
            </button>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (!conversation) {
    return (
      <ScreenSection className="chat-screen">
        <div className="chat-head">
          <div className="chat-head__row">
            <button className="icon-btn" type="button" onClick={goBack} aria-label="Back to notebook">
              <Icon name="back" />
            </button>
            <div className="chat-head__title">Chat</div>
          </div>
        </div>
        {loadError ? (
          <div className="px">
            <div className="empty">
              <p className="h3">Couldn’t open this chat</p>
              <p className="small">{loadError}</p>
              <button
                className="btn btn--primary btn--sm"
                type="button"
                onClick={() => router.refresh()}
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="chat-thread px" role="status" aria-busy="true">
            <span className="sr-only">Opening chat…</span>
            <div className="skeleton" style={{ height: 64, width: "72%" }} />
            <div className="skeleton" style={{ height: 108 }} />
            <div className="skeleton" style={{ height: 64, width: "58%", alignSelf: "flex-end" }} />
            <div className="skeleton" style={{ height: 88 }} />
          </div>
        )}
      </ScreenSection>
    );
  }

  const empty = messages.length === 0 && !stream;
  const quickPlaceholder = hasSources ? "Ask about your sources…" : "Ask anything…";

  return (
    <ScreenSection className="chat-screen">
      <div ref={rootRef} className="chat-shell">
        <div className="chat-head">
          <div className="chat-head__row">
            <button className="icon-btn" type="button" onClick={goBack} aria-label="Back to notebook">
              <Icon name="back" />
            </button>
            <div className="chat-head__title">{conversation.title}</div>
            <button className="icon-btn" type="button" onClick={openDrawer} aria-label="Chat history">
              <Icon name="history" />
            </button>
          </div>
          <p className="chat-head__sub">{notebookTitle}</p>
        </div>

        <div className="chat-thread">
          {loadingOlder ? (
            <p className="chat-thread__hint" role="status">
              Loading earlier messages…
            </p>
          ) : null}

          {empty ? (
            <div className="chat-empty">
              <span className="chat-empty__mark tone-sage">
                <Icon name="sparkle" size={22} className="i-sparkle" />
              </span>
              <h1 className="chat-empty__title">Ask about {notebookTitle}</h1>
              <p className="chat-empty__sub">
                {hasSources
                  ? "Answers use your sources when they help. You’ll always see which ones."
                  : "This notebook has no sources yet, so answers come from general knowledge. Add sources any time."}
              </p>
              <div className="chat-empty__chips">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chat-chip"
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              busy={Boolean(stream)}
              error={
                turnError?.userMessageId === message.id ? turnError.message : null
              }
              onRetry={() => retry(message.id)}
              onRegenerate={
                message.role === "assistant" ? () => regenerate(message.id) : undefined
              }
              onEdit={
                message.role === "user" ? (content) => edit(message.id, content) : undefined
              }
            />
          ))}

          {stream ? (
            <>
              {stream.userText ? (
                <MessageBubble
                  message={{
                    id: -1,
                    conversationId: conversation.id,
                    role: "user",
                    content: stream.userText,
                    grounding: null,
                    sources: [],
                    status: "complete",
                    createdAt: new Date().toISOString()
                  }}
                  busy
                />
              ) : null}
              <MessageBubble
                message={{
                  id: -2,
                  conversationId: conversation.id,
                  role: "assistant",
                  content: stream.text,
                  grounding: stream.grounding,
                  sources: stream.sources,
                  status: "complete",
                  createdAt: new Date().toISOString()
                }}
                streaming
                busy
              />
            </>
          ) : null}

          {turnError && turnError.userMessageId == null ? (
            <div className="chat-error chat-error--banner" role="alert">
              <Icon name="alert" size={14} />
              <span>{turnError.message}</span>
              <button
                type="button"
                className="chat-error__retry"
                onClick={() => setTurnError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div ref={sentinelRef} className="chat-thread__end" />
        </div>

        {!atBottom ? (
          <button
            type="button"
            className="chat-jump"
            aria-label="Jump to latest message"
            onClick={() => {
              stickRef.current = true;
              setAtBottom(true);
              sentinelRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
            }}
          >
            <Icon name="arrow" size={16} className="chat-jump__icon" />
          </button>
        ) : null}

        <div className="chat-compose">
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onStop={() => abortRef.current?.abort()}
            streaming={Boolean(stream)}
            disabled={false}
            placeholder={quickPlaceholder}
          />
          <p className="chat-compose__hint">
            AI can be wrong. Check important details.
          </p>
        </div>
      </div>
    </ScreenSection>
  );
}
