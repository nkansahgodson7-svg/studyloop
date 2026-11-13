type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let pending: Promise<void> | null = null;

/**
 * KaTeX is ~77 kB gzipped, and most answers contain no maths. Loading it only
 * when a formula actually appears keeps it out of the chat route's first load.
 */
export function loadKatex(): Promise<void> {
  if (katex) return Promise.resolve();
  pending ??= import("katex")
    .then((mod) => {
      katex = mod.default ?? (mod as unknown as Katex);
    })
    .catch(() => {
      // A failed chunk load leaves the formula as plain text; do not retry on
      // every render.
      pending = null;
    });
  return pending;
}

/** Returns null until KaTeX has loaded. */
export function renderTex(tex: string, displayMode: boolean): string | null {
  if (!katex) return null;
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html"
    });
  } catch {
    return tex;
  }
}
