export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...((init?.headers ?? {}) as Record<string, string>) }
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Request failed: ${res.status}`), { status: res.status });
  }
  return (await res.json()) as T;
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

