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

- [ ] Task 12: Cards + FSRS — `fsrs.ts` wrapper, cards/reviews schema+repo,
  generate-from-selection (streamed, ≤ 10/call), manual add/edit
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
