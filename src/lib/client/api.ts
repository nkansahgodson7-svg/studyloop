export interface ApiError extends Error {
  status: number;
  code?: string;
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...((init?.headers ?? {}) as Record<string, string>) }
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
    throw Object.assign(new Error(message), { status: res.status, code }) as ApiError;
  }
  return (await res.json()) as T;
}

/** Where an auth failure should send the user, if anywhere. */
export function authRedirectFor(error: unknown): "/login" | "/account-disabled" | null {
  const status = (error as { status?: number }).status;
  if (status === 403 && (error as { code?: string }).code === "account_disabled") {
    return "/account-disabled";
  }
  return status === 401 ? "/login" : null;
}

export interface Notebook {
  id: number;
  title: string;
  createdAt: string;
}

export interface SourceRow {
  id: number;
  title: string;
  kind: string;
  createdAt: string;
}

export interface CardRow {
  id: number;
  notebookId?: number;
  sourceId?: number | null;
  front: string;
  back: string;
  createdAt: string;
  generatedAt?: string | null;
  due: string;
  state: number;
  stability?: number;
}

export interface NotebookView {
  notebook: Notebook;
  sources: number;
  cards: number;
  due: number;
}

