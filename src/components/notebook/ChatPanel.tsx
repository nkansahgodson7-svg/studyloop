"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, plural } from "@/components/ui/icons";
import type { NotebookBundle, NotebookChatMessage } from "@/lib/client/notebook-data";

const GENERIC_SUGGESTIONS = [
  "Summarize the key points from my sources",
  "Quiz me on the most examinable details",
  "Explain a tricky concept in simpler terms"
];

export default function ChatPanel({
  bundle,
  notebookId
}: {
  bundle: NotebookBundle;
  notebookId: number;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<NotebookChatMessage[]>(bundle.messages);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    setMessages(bundle.messages);
  }, [bundle.messages]);

  useEffect(() => {
    const screen = logRef.current?.closest<HTMLElement>(".screen");
    if (!screen) return;
    const onScroll = () => {
      stickRef.current = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 120;
    };
    screen.addEventListener("scroll", onScroll, { passive: true });
    return () => screen.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const screen = logRef.current?.closest<HTMLElement>(".screen");
    if (screen && stickRef.current && messages.length > 0) screen.scrollTop = screen.scrollHeight;
  }, [messages]);

  async function send(text: string) {
    if (streaming || !text) return;
    setStreaming(true);
    setError(null);
    const stamp = -Date.now();
    const userMsg: NotebookChatMessage = {
      id: stamp,
      role: "user",
      content: text,
      citations: [],
      createdAt: new Date().toISOString()
    };
    const pending: NotebookChatMessage = {
      id: stamp - 0.1,
      role: "assistant",
      content: "",
      citations: [],
      createdAt: new Date().toISOString()
    };
    stickRef.current = true;
    setMessages((prev) => [...prev, userMsg, pending]);

    const updatePending = (patch: Partial<NotebookChatMessage>) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === pending.id ? { ...message, ...patch } : message))
      );
    };

    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text })
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Chat failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      const citations: NotebookChatMessage["citations"] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf("\n\n");
        while (sep >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          sep = buffer.indexOf("\n\n");
          if (!frame.startsWith("data: ")) continue;
          let parsed: { type?: string; text?: string; items?: NotebookChatMessage["citations"] };
          try {
            parsed = JSON.parse(frame.slice(6).trim());
          } catch {
            continue;
          }
          if (parsed.type === "citations" && Array.isArray(parsed.items)) {
            citations.push(...parsed.items);
            updatePending({ citations: [...citations] });
          } else if (parsed.type === "delta" && typeof parsed.text === "string") {
            answer += parsed.text;
            updatePending({ content: answer });
          } else if (parsed.type === "done") {
            updatePending({ content: answer, citations: [...citations] });
          }
        }
      }
      updatePending({ content: answer });
    } catch (requestError) {
      setMessages((prev) =>
        prev.filter((message) => message.id !== pending.id && message.id !== userMsg.id)
      );
      setError((requestError as Error).message || "Chat failed — try again");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="stack--8">
      <div className="chat" ref={logRef} aria-live="polite">
        {messages.length ? (
          messages.map((message, index) =>
            message.role === "user" ? (
              <div key={message.id} className="msg msg--user">
                <p>{message.content}</p>
              </div>
            ) : (
              <div
                key={message.id}
                className="msg msg--ai"
                aria-busy={streaming && index === messages.length - 1 && !message.content ? true : undefined}
              >
                <div className="msg__label">
                  <Icon name="sparkle" size={12} className="i-sparkle" /> StudyLoop
                </div>
                {message.content
                  ? message.content
                      .split("\n\n")
                      .map((part, partIndex) => <p key={partIndex}>{part}</p>)
                  : null}
                {message.citations.length ? (
                  <div className="cites">
                    {message.citations.map((cite, citeIndex) => (
                      <span key={citeIndex} className="cite">
                        <b>[{citeIndex + 1}]</b> {cite.sourceTitle}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          )
        ) : (
          <div className="empty" style={{ borderStyle: "solid", background: "var(--surface)" }}>
            <span className="row__tile tone-lilac">
              <Icon name="sparkle" size={20} className="i-sparkle" />
            </span>
            <p className="h3">Ask your notebook</p>
            <p className="small">Grounded in {plural(bundle.sources.length, "source")}. Answers cite the exact segment.</p>
          </div>
        )}
        {streaming && messages[messages.length - 1]?.content === "" ? (
          <div className="msg msg--ai" id="chatPending" aria-busy="true">
            <div className="msg__label">
              <Icon name="sparkle" size={12} className="i-sparkle" /> StudyLoop
            </div>
            <div className="msg__body">
              <span className="spinner" />
            </div>
          </div>
        ) : null}
      </div>
      {messages.length === 0 ? (
        <div className="suggest">
          {GENERIC_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" data-q={suggestion} onClick={() => void send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          const value = question.trim();
          setQuestion("");
          void send(value);
        }}
      >
        <div className="composer__inner">
          <input
            type="text"
            autoComplete="off"
            maxLength={500}
            placeholder={streaming ? "StudyLoop is answering…" : "Ask about your sources…"}
            aria-label="Ask a question"
            disabled={streaming}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="icon-btn" type="submit" aria-label="Send question" disabled={streaming}>
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
