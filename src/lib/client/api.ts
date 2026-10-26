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

export function isDue(card: CardRow, now = Date.now()): boolean {
  return new Date(card.due).getTime() <= now;
}

export async function loadNotebookViews(now = Date.now()): Promise<NotebookView[]> {
  const notebooks = await getJson<Notebook[]>("/api/notebooks");
  return Promise.all(
    notebooks.map(async (notebook) => {
      const [sources, cardsResult] = await Promise.all([
        getJson<SourceRow[]>(`/api/notebooks/${notebook.id}/sources`),
        getJson<{ cards: CardRow[] }>(`/api/notebooks/${notebook.id}/cards`)
      ]);
      const cards = cardsResult.cards;
      return {
        notebook,
        sources: sources.length,
        cards: cards.length,
        due: cards.filter((card) => isDue(card, now)).length
      };
    })
  );
}
