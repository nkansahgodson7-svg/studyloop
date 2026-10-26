# Implementation Plan: StudyLoop MVP

## Overview

Build the minimal working phase of StudyLoop: a multi-user hosted study app
(Vercel + Turso) where each user uploads PDFs/text/YouTube into private
notebooks, chats with grounded answers, generates flashcards, and stays in a
daily FSRS review loop. Quiz generation + AI grading is included as the last
vertical slice of the MVP; verified deployability (`git push` to Vercel) is the
exit criterion.

## Architecture Decisions

- **Next.js (App Router) monolith** on Vercel Hobby — one repo, push-to-deploy
- **Turso/libSQL** as the DB: same SQL in prod (Turso) and dev/tests (local file)
  via `@libsql/client`; FTS5 for source retrieval; no ORM
- **Sessions in DB** (httpOnly signed cookie → `sessions` table); scrypt password
  hashes; first admin seeded by script from env, not public signup
- **Groq server-side only**; per-user BYO key override (AES-GCM with
  `ENCRYPTION_SECRET`); ~60s Vercel function cap mitigated with batches ≤ 6
- **All route handlers delegate to pure modules** (`repo.ts`, `ai/*`, `ingest/*`)
  so logic is testable without HTTP; handlers stay thin (validate → call → JSON)
- **Client-side PDF text extraction** with `pdfjs-dist` (no OCR), transcript
  fetch via `youtubei.js`

## Task List

### Phase 1: Foundation

- [ ] Task 1: Project scaffold — Next.js + strict TS + Vitest + oxlint + gate script
  + libSQL client wrapper (env-driven Turso/local-file) + schema DDL function
- [ ] Task 2: Users + sessions data layer — scrypt hash/verify, session token
  create/lookup/expiry, `getCurrentUser` helper, AES-GCM key envelope for BYO keys

### Checkpoint: Foundation
- [ ] `npm test && npm run typecheck && npm run lint && npm run build` green
- [ ] Repo tests prove the same SQL runs against local file DB

### Phase 2: Accounts (vertical slice)

- [x] Task 3: Login/logout — `/login` page + `/api/auth/login,logout,me` +
  `requireUser`/`requireAdmin` guards; `npm run seed:admin` bootstrap script
- [x] Task 4: Admin user management — create user, disable/enable user (API +
  minimal admin page); disabled users rejected at login
- [x] Task 5: BYO-key settings — save/clear personal Groq key (encrypted at rest)

### Checkpoint: Accounts
- [x] End-to-end: seed admin → login → create friend account → friend logs in →
  admin disables friend → friend logged out & cannot log back in
  (verified live in browser 2026-10-24: isolated-context friend session 401 after
  disable + login 403 "account disabled"; BYO key save/remove verified, DB stores
  `v1$` ciphertext with no plaintext)

### Phase 3: Notebooks + Sources

- [x] Task 6: Notebooks CRUD per user + notebook list/switch UI (commit afe83dd)
- [x] Task 7: Source ingest core — chunker + FTS5 indexing + text source (paste) (commit 242a20d)
- [x] Task 8: PDF source — pdfjs client extraction → text payload → ingest core (commit ebd5e73)
- [x] Task 9: YouTube source — URL → `youtubei.js` transcript → ingest core. LIVE fetch blocked 2026-10-24: YouTube times out datacenter egress (timedtext 200 + empty body for all formats; get_transcript 400 "Precondition check failed" = poToken guard, latest lib 18.3.0 included). DI fetcher design means the code path is fully testable and the UI degrades to a clear 502 banner; manual paste-transcript fallback is already available (Add a text source). Deployed egress may behave differently; revisit with PoToken/residential egress if needed.

### Checkpoint: Sources
- [x] A notebook has a PDF, a paste, and a YouTube source path; FTS search returns
  the right chunks for keyword queries (tested — PDF E2E 'calvin' match 2026-10-24).
  Deviation: live YouTube ingestion is blocked in this environment (see Task 9);
  verified via DI-fetched unit tests + UI 502 degradation instead.

### Phase 4: Grounded Chat

- [x] Task 10: Retrieval + Groq stream route — FTS top-k → cited prompt build →
  `/api/notebooks/:id/chat` SSE stream; refusal contract when retrieval is empty (commit f4426d7)
- [x] Task 11: Chat UI — streaming message list, citation chips, error/rate-limit
  states; messages persisted with citations (commit edc3018). Fix found live: FTS sentence
  queries returned nothing (implicit AND) → OR of quoted terms.

### Checkpoint: Chat
- [x] Ask about uploaded content → answer with citation — LIVE 2026-10-24 with the
  owner's BYO key: "What is photosynthesis and where does the Calvin cycle take place?"
  streamed with inline [1][2] citations and chip list ([1] fixture.pdf, [2] Lecture 4,
  [3-5] CSM 152 PDF). Default model switched to openai/gpt-oss-20b (llama-3.3-70b
  decommissioned on Groq — commit 9768074).
- [x] Ask about something not in sources → explicit refusal — live (mitochondria ask
  over real notebook data) + mocked-model test for the deterministic refusal (97 tests,
  console clean, error/503 states verified live).

### Phase 5: Review Loop (flashcards)

- [x] Task 12: Cards + FSRS — `fsrs.ts` wrapper, cards/reviews schema+repo,
  generate-from-selection (≤ 10/call), manual add/edit + grade routes — done
  2026-10-24 (commit 05ffe98; 119 tests). Deviation: generation is a single
  batched completion (NOT streamed) with one malformed-JSON retry → 502
  GENERATION_INVALID; default model openai/gpt-oss-20b. `reviews` got
  `fsrs_meta TEXT` (exact TS-FSRS state round-trip) + `review_log` streak
  ledger; `applySchema` is explicit (tests/seed call it; getDb() does not).
- [ ] Task 13: Review UI — Today due queue, 4-button grading, streak counter,
  card editor

### Checkpoint: Review loop
- [ ] Generate cards → grade → next due dates computed → queue shrinks →
  streak increments (tested with fixed FSRS fixtures)

### Phase 6: Quiz (questions + AI grading)

- [ ] Task 14: Quiz generation — topic-scoped, streamed batches ≤ 6 items,
  stored as `quiz_items`
- [ ] Task 15: Quiz play + AI grading — answer flow, AI-graded score saved

### Checkpoint: Quiz
- [ ] Generate ≥ 8 items from a topic → play → AI grades (mocked tests + manual)

### Phase 7: Ship

- [ ] Task 16: Prod wiring — Turso schema push script, Vercel env docs, security
  header/CSP cleanup, final gate + deploy walkthrough

### Checkpoint: Complete
- [ ] All spec success criteria #1–#11 verified or explicitly waived with reason
- [ ] Deployed URL works for admin + 1 friend account

### Phase 8: Pixel-perfect UI (frontend/ mockup → real app)

Goal: the real Next.js app becomes visually and interactionally indistinguishable
from `frontend/` (the validated mockup; `design.md` is the design system). Real
backend stays real; wherever the mockup simulates a behavior the backend can't do
yet, the backend is built up to meet it ("prototype spec wins"). Confirmed intent:
**visuals + motion + interactions on real data** (interview 2026-10-26).

#### Architecture Decisions

- **`frontend/styles.css` is ported near-verbatim into `globals.css`** (fonts
  @import kept; it is what the mockup loads). Class names stay byte-identical —
  pixel parity rides on the CSS, not on re-authored styles. No Tailwind, no CSS
  modules, no inline styles (current inline-styled pages get replaced).
- **Components adopt the mockup's exact DOM + class names.** New shared
  components under `src/components/ui/` (Icon, Btn, Row, Ring, Segmented, Hero,
  Sheet, Toast, …). Server components by default; client only for interaction.
- **Screen transition system reproduces `app.js swap()`**: per-route `<template>`
  entry animations (push-in / pop-in / fade-in classes) + a client snapshot
  overlay that keeps the outgoing `.screen` visible for the 260–300 ms exit
  animation (direction from a route-depth map: login 0 · tabs 1 · notebook 2 ·
  session 3; equal depth fades like the mockup's tab switches).
- **App chrome lives in the root layout**: `.frame` / `.shell` / `.view`,
  tab bar (pathname-driven), `.toasts`, `.sheet-root`. Root `layout.tsx` gains the
  mockup's metadata (viewport-fit=cover, theme-color, favicon, title map).
- **Auth guard mirrors the mockup's redirect rule**: client guard shell fetches
  `/api/auth/me`; unauthorized → `/login`, authorized on `/login` → `/`.
- **URLs stay App-Router-native** (`/`, `/review`, `/library`, `/notebooks/[id]`,
  `/review/session?key=…`, `/settings`) — the mockup's hash routes map onto them;
  admin is untouched.
- **Data flow mirrors `syncStateFromDB`**: per-notebook fetches for rows/counts,
  one compact `/api/me/summary` for home/review aggregates, real SSE chat frames,
  real FSRS grade POSTs, real AES-GCM BYO key flow. Mockup demo data (seed chat
  answers, hardcoded suggestions) is *not* faked back in — generic suggestions
  and honest empty/error/loading states instead.
- **Swipe physics ported 1:1 from `setupSwipe`** (thresholds 72/86, axis lock
  0.2× damp, tilt ±9°, progressive cue opacity + is-hot, fly-out commit ±1.15×
  diagonal, 200 ms spring-back, keyboard Space/1–4/Esc).

#### Vertical slices

- [ ] P8-1: Design foundation — `globals.css` ← full mockup CSS; layout shell +
  metadata + favicon; Icon set component
- [ ] P8-2: Transition & chrome system — ScreenSection entry classes,
  snapshot-overlay exits, TabBar, Toast provider, Sheet provider (scrim, focus
  trap, ESC, restore focus)
- [ ] P8-3: Auth surfaces — login screen port (demo account button → real login,
  hint copy), guard redirect, auth-aware redirect targets
- [ ] P8-4: Home "Today" — greeting, dark hero w/ mastery Ring + streak, rows,
  due badges, new-notebook sheet, loading/empty states
- [ ] P8-5: Library — rows, new notebook, honest empty state
- [ ] P8-6: Review hub — dark due-total card, per-notebook due rows, practice
  entry, scheduled footnote
- [ ] P8-7: Notebook detail scaffold + Overview — topbar/back/menu sheet,
  nb-hero, segmented tabs + tabpanel enter animation, summary card, source rows
  (kind tone + meta), ai-note
- [ ] P8-8: Add-source sheet — kind picker, PDF/text/YouTube fields, client PDF
  extraction, processing states, error rows → POST endpoints
- [ ] P8-9: Cards tab — AI generate button, source-select sheet, generating
  skeleton, Study/Generated groups, due badges, sticky review CTA
- [ ] P8-10: Chat tab — mockup DOM on real SSE (messages, typing dots, suggested
  prompts, composer sticky bar, citation chips, scroll-to-bottom)
- [ ] P8-11: Review session — fixed screen (progress header, flash reveal,
  swipe physics, grade grid, keyboard), practice/empty/summary screens, real
  grade POSTs + "next review in" toasts
- [ ] P8-12: Settings — profile, AI key row + key sheet (PUT/DELETE me/key),
  reset demo w/ confirm sheet, sign out
- [ ] P8-13: Backend parity bits — `GET /api/me/summary` (streak, due counts,
  mastery, reviewed-today); `cardsDue ?all=1` practice mode; source meta
  (chunks) surfaced in list; `POST /api/me/reset-demo` (wipe + faithful demo
  reseed incl. review states); demo account bootstrap
- [ ] P8-14: Cross-screen audit — titles, back paths, reduced motion, 320–720 px,
  200 % zoom, empty/error states everywhere, gate green
- [ ] P8-15: Browser parity pass — side-by-side vs mockup at 390/720 px per
  screen + motion walk (push/pop, sheet, swipe, toasts), drift fixes

Fulfills existing Task 13's UI half (Review UI: queue, grading, streak); the
card editor is dropped as not present in the mockup (protocol decision, not an
omission).

### Checkpoint: Pixel-perfect UI
- [ ] Screen-by-screen visual parity vs mockup at 390 px (and 720 px framed) live in browser
- [ ] Full primary flow on real data: login → today → notebook → add source →
  generate → review → grade → summary → today
- [ ] Motion parity: push/pop, tab fade, sheet, reveal, swipe grading, toasts, ring
- [ ] Gate green (`npm test && npm run typecheck && npm run lint && npm run build`)

## Deferred (post-MVP)

Audio/video features, personas, second provider fallback, admin usage
analytics, embeddings/semantic search, mobile/PWA polish.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `youtubei.js` API churn / IP rate-limits by YouTube | Medium | Isolate in one module; furnish manual paste-transcript fallback path |
| Groq free-tier rate limits under multi-user | Medium | BYO-key override; readable 429 errors; small prompts (FTS top-k, not full text) |
| Vercel ~60s function cap on generation calls | High | Batch sizes ≤ 6, stream early, timeout guard |
| libSQL/FTS5 dialect quirks vs standard SQLite | Medium | Data layer tests run the same SQL locally; one repo module |
| FSRS correctness | HIGH for trust | `ts-fsrs` library + fixture tests, never hand-rolled math |

## Open Questions

None.
