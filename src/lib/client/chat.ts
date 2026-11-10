import { getJson } from "./api";

export type Grounding = "sources" | "general" | "mixed";
export type MessageStatus = "complete" | "stopped" | "error";

export interface ChatSourceRef {
  sourceId: number;
  sourceTitle: string;
  ord: number;
  page: number | null;
  label: string;
}

export interface ChatConversation {
  id: number;
  notebookId: number;
  title: string;
  titleSource: "auto" | "user" | "fallback";
  createdAt: string;
  updatedAt: string;
  preview?: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  grounding: Grounding | null;
  sources: ChatSourceRef[];
  status: MessageStatus;
  createdAt: string;
}

export interface ChatDetail {
  conversation: ChatConversation;
  messages: ChatMessage[];
  hasMore: boolean;
}

export function loadConversations(notebookId: number): Promise<ChatConversation[]> {
  return getJson<ChatConversation[]>(`/api/notebooks/${notebookId}/chats`);
}

export function createConversation(notebookId: number): Promise<ChatConversation> {
  return getJson<ChatConversation>(`/api/notebooks/${notebookId}/chats`, { method: "POST" });
}

export function loadConversation(
  chatId: number,
  before?: number
): Promise<ChatDetail> {
  const query = before != null ? `?before=${before}` : "";
  return getJson<ChatDetail>(`/api/chats/${chatId}${query}`);
}

export function renameConversation(chatId: number, title: string): Promise<ChatConversation> {
  return getJson<ChatConversation>(`/api/chats/${chatId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  });
}

export function deleteConversation(chatId: number): Promise<{ deleted: boolean }> {
  return getJson<{ deleted: boolean }>(`/api/chats/${chatId}`, { method: "DELETE" });
}

export class ChatRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;
  readonly userMessageId?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      retryable?: boolean;
      userMessageId?: number;
      retryAfterSeconds?: number;
    } = {}
  ) {
    super(message);
    this.status = options.status ?? 0;
    this.code = options.code;
    this.retryable = options.retryable ?? true;
    this.userMessageId = options.userMessageId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface StreamHandlers {
  onStart?: (userMessageId: number) => void;
  onGrounding?: (label: Grounding, sources: ChatSourceRef[]) => void;
  onDelta?: (text: string) => void;
  onDone?: (messageId: number, createdAt: string) => void;
}

/**
 * Posts a turn and consumes the SSE stream. Aborting `signal` is not an error:
 * the server persists whatever it produced with status "stopped".
 */
export async function streamTurn(
  url: string,
  init: { method: "POST"; body?: string },
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: init.method,
    headers: { "content-type": "application/json" },
    body: init.body,
    signal
  });

  if (!res.ok || !res.body) {
    let message = `Chat failed (${res.status})`;
    let code: string | undefined;
    let userMessageId: number | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        userMessageId?: number;
      };
      if (body?.error) message = body.error;
      code = body?.code;
      userMessageId = body?.userMessageId;
    } catch {
      // Non-JSON errors keep the generic message.
    }
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    throw new ChatRequestError(message, {
      status: res.status,
      code,
      userMessageId,
      retryAfterSeconds:
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader
          : undefined
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
      if (!frame.startsWith("data: ")) continue;
      let parsed: {
        type?: string;
        text?: string;
        label?: Grounding;
        sources?: ChatSourceRef[];
        messageId?: number;
        createdAt?: string;
        userMessageId?: number;
        error?: string;
        code?: string;
        retryable?: boolean;
      };
      try {
        parsed = JSON.parse(frame.slice("data: ".length).trim()) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.type === "start" && typeof parsed.userMessageId === "number") {
        handlers.onStart?.(parsed.userMessageId);
      } else if (parsed.type === "grounding" && parsed.label) {
        handlers.onGrounding?.(parsed.label, parsed.sources ?? []);
      } else if (parsed.type === "delta" && typeof parsed.text === "string") {
        handlers.onDelta?.(parsed.text);
      } else if (parsed.type === "done" && typeof parsed.messageId === "number") {
        handlers.onDone?.(parsed.messageId, parsed.createdAt ?? new Date().toISOString());
      } else if (parsed.type === "error") {
        throw new ChatRequestError(parsed.error ?? "generation failed", {
          status: 502,
          code: parsed.code,
          retryable: parsed.retryable ?? true,
          userMessageId: parsed.userMessageId
        });
      }
    }
  }
}

export function sendQuestion(
  chatId: number,
  question: string,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  return streamTurn(
    `/api/chats/${chatId}/messages`,
    { method: "POST", body: JSON.stringify({ question }) },
    handlers,
    signal
  );
}

export function regenerateAnswer(
  chatId: number,
  messageId: number,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  return streamTurn(
    `/api/chats/${chatId}/messages/${messageId}/regenerate`,
    { method: "POST" },
    handlers,
    signal
  );
}

export function retryQuestion(
  chatId: number,
  messageId: number,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  return streamTurn(
    `/api/chats/${chatId}/messages/${messageId}/retry`,
    { method: "POST" },
    handlers,
    signal
  );
}

export function editQuestion(
  chatId: number,
  messageId: number,
  content: string,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  return streamTurn(
    `/api/chats/${chatId}/messages/${messageId}/edit`,
    { method: "POST", body: JSON.stringify({ question: content }) },
    handlers,
    signal
  );
}
