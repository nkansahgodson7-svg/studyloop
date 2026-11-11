import { getJson } from "./api";

export interface NotebookSource {
  id: number;
  kind: "pdf" | "youtube" | "text";
  title: string;
  url: string | null;
  meta: string;
  pageCount?: number | null;
  createdAt: string;
}

export interface NotebookCard {
  id: number;
  front: string;
  back: string;
  createdAt: string;
  generatedAt?: string | null;
  batchId?: number | null;
  batchCreatedAt?: string | null;
  batchSourceSummary?: string | null;
  due: string;
  state: number;
  stability?: number;
}

export interface NotebookBatch {
  id: number;
  createdAt: string;
  sourceSummary: string;
  focus: string | null;
  cardCount: number;
}

export interface NotebookBundle {
  id: number;
  title: string;
  sources: NotebookSource[];
  cards: NotebookCard[];
  batches: NotebookBatch[];
}

export async function loadNotebook(id: number): Promise<NotebookBundle> {
  const bundle = await getJson<NotebookBundle>(`/api/notebooks/${id}/bundle`);
  return {
    ...bundle,
    sources: bundle.sources.map((source) => (source.meta === "{}" ? { ...source, meta: "" } : source))
  };
}

export function dueCount(cards: NotebookCard[], now = Date.now()): number {
  return cards.filter((card) => new Date(card.due).getTime() <= now).length;
}
