'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface CitationItem {
  n: number;
  sourceId: number;
  ord: number;
  sourceTitle: string;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations: CitationItem[];
}

type StreamFrame =
  | { type: 'citations'; items: CitationItem[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

export function Chat({ notebookId }: { notebookId: number }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [pendingCitations, setPendingCitations] = useState<CitationItem[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/notebooks/${notebookId}/chat/messages`);
    if (res.ok) {
      const body = (await res.json()) as { messages: ChatMessage[] };
      setMessages(body.messages);
    } else {
      setMessages([]);
    }
  }, [notebookId]);

  useEffect(() => {
    setMessages(null);
    setError(null);
    setPendingText(null);
    setPendingCitations(null);
    void load();
  }, [load]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    setError(null);
    setPendingText('');
    setPendingCitations(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed })
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Chat failed (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) {
            continue;
          }
          let frame: StreamFrame;
          try {
            frame = JSON.parse(part.slice('data: '.length)) as StreamFrame;
          } catch {
            continue;
          }
          if (frame.type === 'citations') {
            setPendingCitations(frame.items);
          } else if (frame.type === 'delta') {
            assembled += frame.text;
            setPendingText(assembled);
          } else if (frame.type === 'error') {
            setError(frame.error);
          } else if (frame.type === 'done') {
            finished = true;
          }
        }
      }
      if (finished) {
        setPendingText(null);
        setPendingCitations(null);
        setQuestion('');
        await load();
      }
    } finally {
      setBusy(false);
      setPendingText(null);
      setPendingCitations(null);
    }
  }

  function Citations({ items }: { items: CitationItem[] }) {
    return (
      <ol className="chat-citations">
        {items.map((item) => (
          <li key={item.n} title={`${item.sourceTitle} — segment ${item.ord + 1}`}>
            [{item.n}] {item.sourceTitle}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section aria-label="Chat" aria-busy={busy}>
      <h2>Chat</h2>
      {error ? (
        <p role="error" className="chat-error">
          {error}
        </p>
      ) : null}
      {messages === null ? (
        <p>Loading chat…</p>
      ) : (
        <div role="log" aria-live="polite" className="chat-log">
          {messages.map((message) => (
            <div key={message.id} className={`chat-message chat-${message.role}`}>
              <p>{message.content}</p>
              {message.role === 'assistant' && message.citations.length > 0 ? <Citations items={message.citations} /> : null}
            </div>
          ))}
          {pendingText !== null ? (
            <div className="chat-message chat-assistant" aria-live="polite">
              <p>{pendingText.length > 0 ? pendingText : 'Thinking…'}</p>
              {pendingCitations ? <Citations items={pendingCitations} /> : null}
            </div>
          ) : null}
          {messages.length === 0 && pendingText === null ? <p>Ask a question about the sources.</p> : null}
        </div>
      )}
      <form aria-label="Ask a question" onSubmit={ask}>
        <label htmlFor="chat-question">Question</label>
        <input
          id="chat-question"
          type="text"
          value={question}
          maxLength={1000}
          placeholder="Ask about the sources…"
          required
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Streaming…' : 'Ask'}
        </button>
      </form>
    </section>
  );
}
