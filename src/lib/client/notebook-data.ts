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

const BUNDLE_TTL_MS = 30_000;

const bundleCache = new Map<number, { value: NotebookBundle; at: number }>();
const inflightBundles = new Map<number, Promise<NotebookBundle>>();

function normalize(bundle: NotebookBundle): NotebookBundle {
  return {
    ...bundle,
    sources: bundle.sources.map((source) => (source.meta === "{}" ? { ...source, meta: "" } : source))
  };
}

function peekNotebook(id: number): NotebookBundle | null {
  const entry = bundleCache.get(id);
  return entry && Date.now() - entry.at < BUNDLE_TTL_MS ? entry.value : null;
}

/**
 * Loads a notebook bundle, sharing one request across screens. Opening a chat
 * used to refetch the whole bundle the notebook page had just loaded; now it
 * reads the cache, so only the conversation is fetched.
 */
export async function loadNotebook(
  id: number,
  { force = false }: { force?: boolean } = {}
): Promise<NotebookBundle> {
  if (!force) {
    const cached = peekNotebook(id);
    if (cached) return cached;
    const pending = inflightBundles.get(id);
    if (pending) return pending;
  }
  const request = getJson<NotebookBundle>(`/api/notebooks/${id}/bundle`)
    .then((bundle) => {
      const value = normalize(bundle);
      bundleCache.set(id, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (inflightBundles.get(id) === request) inflightBundles.delete(id);
    });
  inflightBundles.set(id, request);
  return request;
}

export function dueCount(cards: NotebookCard[], now = Date.now()): number {
  return cards.filter((card) => new Date(card.due).getTime() <= now).length;
}
