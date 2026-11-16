"use client";

export interface CardDraft {
  front: string;
  back: string;
  sourceId: number | null;
}

export interface CardGenerateInput {
  sources: Array<{ sourceId: number; from?: number; to?: number }>;
  count: number;
  focus?: string;
}

export interface CardGenerateResult {
  drafts: CardDraft[];
  skippedDuplicates: number;
  sourceSummary: string;
}

export type CardGenerationPhase = "reading" | "writing" | "checking";

export interface CardGenerationProgress {
  phase: CardGenerationPhase;
  drafted: number;
  total: number;
}

export async function generateCards(
  notebookId: number,
  input: CardGenerateInput,
  onProgress?: (progress: CardGenerationProgress) => void
): Promise<CardGenerateResult> {
  const res = await fetch(`/api/notebooks/${notebookId}/cards/generate`, {
    method: "POST",
    headers: { accept: "application/x-ndjson", "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      code = body?.code;
    } catch {
      // Non-JSON error bodies fall back to the generic message.
    }
    throw Object.assign(new Error(message), { status: res.status, code });
  }

  // A proxy or older deployment may answer with plain JSON; accept both.
  if (!(res.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
    return (await res.json()) as CardGenerateResult;
  }
  if (!res.body) {
    throw new Error("Card generation ended unexpectedly — try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: CardGenerateResult | null = null;
  let failure: Error | null = null;

  const handleLine = (line: string) => {
    if (line.trim().length === 0) return;
    const event = JSON.parse(line) as {
      type: string;
      status?: number;
      error?: string;
      code?: string;
      retryAfter?: string | null;
      total?: number;
      drafted?: number;
      drafts?: CardDraft[];
      skippedDuplicates?: number;
      sourceSummary?: string;
    };
    if (event.type === "prepared") {
      onProgress?.({ phase: "writing", drafted: 0, total: event.total ?? input.count });
    } else if (event.type === "checking") {
      onProgress?.({ phase: "checking", drafted: 0, total: input.count });
    } else if (event.type === "progress") {
      onProgress?.({
        phase: "checking",
        drafted: event.drafted ?? 0,
        total: event.total ?? input.count
      });
    } else if (event.type === "done") {
      result = {
        drafts: event.drafts ?? [],
        skippedDuplicates: event.skippedDuplicates ?? 0,
        sourceSummary: event.sourceSummary ?? "Selected sources"
      };
    } else if (event.type === "error") {
      const status = event.status ?? 500;
      const message =
        status === 429 && event.retryAfter
          ? `Too many requests — try again in ${event.retryAfter}s.`
          : event.error ?? "Card generation failed — try again.";
      failure = Object.assign(new Error(message), { status, code: event.code });
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  handleLine(buffer + decoder.decode());

  if (failure) throw failure;
  if (!result) throw new Error("Card generation ended unexpectedly — try again.");
  return result;
}
