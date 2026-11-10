# Flashcard Generation Overhaul — Implementation Plan

Status: implemented in the working tree (no commit yet).

## Goal

Replace one-source-at-a-time, immediately-persisted generation with a single
page-aware draft pass that the learner can edit and approve, and keep every
approved set together as a real batch that can be practised on its own.

## Product requirements

- Page awareness applies to newly ingested PDFs only. Existing PDFs stay
  unpaged and keep working.
- Page-aware sources offer auto-detected chapters plus a manual page-range
  fallback.
- Generation is one LLM call over all selected sources, producing 1–20 drafts
  (default 10).
- The preview is editable per card (front/back) and selectable per card.
  Nothing is saved until the learner presses “Add N cards”.
- Pasted text and YouTube sources get a free-text Focus field. Focus terms are
  used both to rank matching chunks (FTS) and as an instruction to the model.
- The Cards tab groups cards by real generation batch, newest first, and each
  batch can be practised separately.
- No quiz/ship work, batch delete/undo, card types, server-side PDF parsing,
  page backfill for old PDFs, YouTube timestamp ranges, review-UX changes,
  rate-limit/provider changes, retroactive batches, or bundle/perf work.

## Data model

- `card_batches` is a real table (`id`, `notebook_id`, `source_summary`,
  `focus`, `card_count`, `created_at`). Grouping by a date string is not enough
  because multiple generations can happen on the same day.
- `cards.batch_id` references `card_batches` with `ON DELETE SET NULL`, so
  deleting a batch keeps its cards (they fall back to the legacy “Generated”
  group).
- `source_chunks.page` stores the 1-based page number for new page-aware
  sources. `sources.text` stores pages joined by form feed (`\f`); no extra page
  table is introduced.
- `applySchema` adds `cards.batch_id` and `source_chunks.page` best-effort for
  pre-existing databases.

## Ingest and chapters

- `extractPdfText` returns `{ pageCount, text, pages }`; `text` is
  `pages.join('\f')`.
- `chunkPages` chunks each page independently, so a chunk never crosses a page
  boundary and every chunk keeps an accurate page tag. Overlap stays inside a
  page.
- `ingestTextSource` accepts either `text` or `pages[]`, validates non-empty
  content, stores page-tagged chunks, and reports `chunks`.
- `listSources` exposes `pageCount` from `MAX(page)`; the UI uses it to decide
  whether page controls apply.
- `detectChapters` scans the first non-empty line of each page for
  Chapter/Unit/Module/Section/Part headings (numbers, roman numerals, or a
  single letter). Repeated running headers collapse into one chapter.
- `GET /api/notebooks/:id/sources/:sourceId/chapters` returns detected chapters
  or `[]` for unpaged sources.

## Generation API

`POST /api/notebooks/:id/cards/generate`

- Body: `{ sources: [{ sourceId, from?, to? }], count?, focus? }`.
- Resolves every selected source against the notebook (404 for unknown/foreign
  sources), rejects page ranges on unpaged sources, invalid ranges, and ranges
  entirely outside the stored span; overlapping ranges are clamped.
- Builds a ~12k-character context split evenly across selected sources.
  Each source is sampled with stratified sampling (start/middle/end), with
  focus FTS hits preferred inside each stratum.
- Makes one model call (retry only when the reply is not parseable JSON).
- Deduplicates normalized fronts against existing notebook cards and inside the
  draft. Returns `{ drafts, skippedDuplicates, sourceSummary }` and writes
  nothing.
- A single selected source keeps `sourceId` on each draft; multi-source drafts
  use `sourceId: null` and carry provenance in `sourceSummary`.

## Commit API

`POST /api/notebooks/:id/cards/batch`

- Body: `{ cards: [{ front, back, sourceId? }], sourceSummary, focus? }`.
- Validates card count (1–30), front/back limits, summary length, and source
  ownership.
- Inserts the batch, all cards, and their initial FSRS review rows in one
  interactive write transaction. Card `created_at` and `generated_at` use the
  batch timestamp.

## UI

- **Generate sheet** (`GenerateCardsSheet.tsx`): Configure → Preview.
  - Source checkboxes; paged sources show chapter picker and From/To page
    inputs. Chapter selection fills the range; editing the range clears the
    chapter choice.
  - Focus textarea (1000 chars), count chips (5/10/20), and a single
    “Generate preview” action.
  - Preview shows inline-editable front/back fields, per-card checkboxes,
    select all/none, duplicate count, Back, Regenerate, and “Add N cards”.
- **Cards tab**: groups cards by `batch.id` (newest batch first), with
  collapsible sections, relative date + time, source summary, focus, actual card
  count, and a per-batch Practice button. Cards without a batch are split into
  “Manual” and legacy “Generated” groups.
- **Practice**: `/review/session?notebook=<id>&batch=<id>` forces practice
  semantics and filters to that batch; the session label is the batch source
  summary.
- New CSS covers batch groups, source pickers, page ranges, count chips, draft
  cards, and checkboxes.

## Tests

- `cards.test.ts`: draft-only generation, one-call behavior, dedupe, count
  clamping, page filtering/clamping, unpaged range rejection, focus scoping,
  stratified sampling, batch commit/validation, and batch deletion behavior.
- `chunker.test.ts`: page tags, long-page splitting without crossing pages,
  empty pages.
- `pages.test.ts`: chapter ranges, unit/module/section/part and roman/letter
  headings, repeated headers, first-line-only scanning, plain prose.
- `pdf-source.test.ts`: form-feed storage, page-tagged chunks, page counts,
  scoped FTS, pages API validation, chapter endpoint and unpaged behavior.
- `bundle.test.ts`: `batches` embedded with cards, batch card metadata, and
  legacy manual cards staying `batchId: null`.
- `db.test.ts`: legacy schema upgrade adds `batch_id` and `page` idempotently.

## Verification

- `npm test`: 20 files / 199 tests green before the final db/plan additions.
- `npx tsc --noEmit`: no errors in `src/`; the only remaining diagnostics come
  from the untracked `freellmapi/` tree.
- `npm run lint`: no warnings in changed app code.
- `npm run build`: compilation succeeds, then Next’s typecheck fails on the
  pre-existing untracked `freellmapi/` tree, not on StudyLoop code.

## Known trade-off

Multi-source drafts lose per-card source attribution (`sourceId = null`);
provenance lives in `batch.sourceSummary`. This is accepted for the first
version.
