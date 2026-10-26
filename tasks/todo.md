# StudyLoop MVP — Task Checklist

Spec: `docs/spec.md` · Plan: `tasks/plan.md`

## Phase 1: Foundation

- [ ] Task 1: Scaffold — Next.js + strict TS + Vitest + oxlint + gate script + libSQL client (env-driven Turso/local-file) + schema DDL
  - Acceptance: gate (`npm test && npm run typecheck && npm run lint && npm run build`) passes; `/api/health` returns `{ ok: true }`; opening DB creates schema
  - Verify: gate; repo test opens a temp local file DB and runs schema DDL + a no-op query
  - Files: package.json, tsconfig.json, vitest.config.ts, .gitignore, src/lib/db.ts, src/app/api/health/route.ts
  - Deps: None
- [ ] Task 2: Users/sessions data layer — scrypt, session tokens, `getCurrentUser`, AES-GCM key envelope
  - Acceptance: hash/verify roundtrip; expired session invalid; key encrypt/decrypt roundtrip
  - Verify: colocated unit tests; gate
  - Files: src/lib/server/repo.ts, src/lib/server/auth/*.ts + tests
  - Deps: Task 1

## Phase 2: Accounts

- [x] Task 3: Login/logout + guards + `seed:admin` script
  - Acceptance: seeded admin can log in; wrong password 401; disabled 403; guards reject unauthenticated API calls (tests)
  - Files: src/app/login/page.tsx, src/app/api/auth/*, src/lib/server/seed-admin.ts
  - Deps: Task 2
- [x] Task 4: Admin user management (create/disable)
  - Acceptance: admin-only route returns 403 for non-admin; disabled user's sessions purged, login blocked
  - Files: src/app/admin/page.tsx, src/app/api/admin/users/* + tests
  - Deps: Task 3
- [x] Task 5: BYO-key settings (save/clear, encrypted)
  - Acceptance: saved key decrypts server-side; never returned by any API response
  - Files: src/app/settings/page.tsx, src/app/api/me/key/* + tests
  - Deps: Task 3

## Phase 3: Notebooks + Sources

- [ ] Task 6: Notebooks CRUD + list/switch UI
  - Acceptance: notebooks invisible to other users' sessions (tested)
  - Files: src/lib/server/repo.ts, src/app/(admin)... no — src/app/notebooks/*, src/app/api/notebooks/*
- [ ] Task 7: Ingest core — chunker + FTS index + text source
  - Acceptance: chunk overlap sane; FTS top-k returns expected chunk for keyword (fixture test)
  - Files: src/lib/server/ingest/*.ts + tests
- [ ] Task 8: PDF source (client pdfjs → text)
  - Acceptance: ≤100-page PDF produces text source ≤ 30s
- [x] Task 9: YouTube source (youtubei.js) — done 2026-10-24. Unit tests verify extraction (video-id parsing, transcript segments, mocked fetcher, 400/502/404 paths). Browser E2E: invalid URL surfaced (400), live video surfaced a clear "no transcript available" (502) because YouTube's timedtext + get_transcript are hardened against datacenter IPs (timedtext returns 200 w/ empty body; get_transcript 400 "Precondition check failed"). Code path + UI degrade gracefully; owner can still paste an auto transcript manually via Add a text source until deployed egress works.
  - Acceptance: URL → transcript source ≤ 60s (mocked test + one live smoke)

## Phase 4: Grounded Chat

- [x] Task 10: Retrieval + streaming chat route with citations + refusal contract — done 2026-10-24 (commit f4426d7). Mocked-model tests cover the cited path, deterministic refusal, 503 no-key, 400/404.
- [x] Task 11: Chat UI (streaming list, citation chips, persistence) — done (commit edc3018). Live fix: FTS OR-query change. Live E2E with the owner's BYO Groq key streamed a cited answer; refusal verified live; model default set to openai/gpt-oss-20b (9768074).

## Phase 5: Review Loop

- [x] Task 12: FSRS wrapper + cards/reviews repo + card generation (≤10/call) + manual CRUD — done 2026-10-24 (commit 05ffe98). Fixture tests for due dates/lapses/streak; generation is one batched completion w/ malformed-retry (deviation, see plan.md); routes under /api/notebooks/[id]/cards* + /api/cards/[id]*.
  - Acceptance: fixture tests for due dates; generation produces editable cards
- [ ] Task 13: Review UI — Today queue, 4-button grading, streak, card editor
  - Acceptance: grading schedules next due; queue exact per user; streak increments

## Phase 6: Quiz

- [ ] Task 14: Quiz generation (topic-scoped, streamed batches ≤ 6)
- [ ] Task 15: Quiz play + AI grading (scores persisted)

## Phase 7: Ship

- [ ] Task 16: Turso push script + Vercel env docs + CSP/security polish + final gate + deploy walkthrough
  - Acceptance: spec success criteria #1–#11 check off; `git push` deploys; admin + friend accounts work on live URL

## Phase 8: Pixel-perfect UI (frontend/ mockup → real app)

Spec: `design.md` + `frontend/` mockup · Plan: `tasks/plan.md` Phase 8
Intent (confirmed 2026-10-26): visuals + motion + interactions indistinguishable
from the mockup, on the real backend; mockup behavior wins where backend gaps exist.

- [x] P8-1: Design foundation — globals.css ← full styles.css; shell layout +
  viewport/theme-color/favicon metadata; Icon set port
  - Acceptance: every CSS class in frontend/styles.css resolves identically in the app; fonts load the same; console clean
  - Verify: gate; dev-server page against a mockup screenshot at 390 px
  - Files: src/app/globals.css, src/app/layout.tsx, src/components/ui/icons.tsx
- [x] P8-2: Transition + chrome system — ScreenSection entry, snapshot exits,
  TabBar, Toast, Sheet providers
  - Acceptance: push/pop/fade directions match mockup's swap(); tab bar shows 4 items w/ 4 px brand dot; sheets trap focus, close on esc/scrim, restore focus; toasts ≥2.6 s one-at-a-time
  - Verify: gate; manual + browser motion walk
  - Files: src/components/ui/{ScreenSection,Transition,TabBar,Toast,Sheet}.tsx, src/lib/depth.ts
- [x] P8-3: Auth surfaces — login screen port + demo account + guard
  - Acceptance: parity DOM/classes; demo button logs in demo@studyloop.app; unauth redirect to /login; authed on /login → /
  - Verify: gate; live login flow
  - Files: src/app/login/page.tsx, src/components/ui/auth/*; deps P8-1, P8-2, P8-13
- [x] P8-4: Home "Today" — greeting + hero (ring/streak) + rows + new-notebook sheet
  - Acceptance: parity; real data (summary + notebooks); loading skeleton + empty state
  - Verify: gate; browser compare
  - Files: src/app/page.tsx, src/components/ui/{Ring,Hero,NotebookRow}.tsx; deps P8-2, P8-13
- [x] P8-5: Library — parity rows + honest empty state; deps P8-2
- [x] P8-6: Review hub — dark due card + per-notebook due rows; deps P8-2, P8-13
- [x] P8-7: Notebook scaffold + Overview — header/hero/segmented/tabs + sources; deps P8-2
- [x] P8-8: Add-source sheet — kinds/fields/processing; PDF/text/YT wiring; deps P8-2, P8-7
- [x] P8-9: Cards tab + generate sheet → real generation; deps P8-7
- [x] P8-10: Chat tab — mockup DOM on real SSE; deps P8-7, existing Chat.tsx logic
- [x] P8-11: Review session — fixed screen + swipe physics + keyboard + practice/summary; deps P8-2, P8-13
- [x] P8-12: Settings — profile/key row + key sheet/reset demo/sign out; deps P8-2, P8-13
- [x] P8-13: Backend parity — /api/me/summary, cardsDue ?all=1, source meta in
  list, POST /api/me/reset-demo (faithful reseed w/ review states), demo account
  - Acceptance: unit tests per endpoint; summary numbers correct on fixtures
  - Verify: npm test; gate
  - Files: src/lib/server/{summary,cards,sources,seed}.ts + tests, new route files
- [x] P8-14: Cross-screen audit — titles/back paths/reduced-motion/320 px/zoom/empties; gate
- [x] P8-15: Browser parity pass — side-by-side 390/720 px, motion walk, drift fixes

## Checkpoints

After each phase's tasks: full gate green + checkpoint list in plan.md reviewed before next phase.

### Phase 8 completion notes (2026-10-26)
- P8-13 delivered as P8-13a (GET /api/me/summary + streakDaysForUser) and P8-13b
  (source meta strings at ingest: "N pages · M chunks" pdf via client pageCount,
  "N min · M chunks" youtube via transcript duration, "N chunks" text; POST
  /api/me/reset-demo reseeding three demo notebooks with review state + generated
  flags). cardsDue ?all=1 dropped — practice mode builds its queue client-side.
- cards gained generated_at (schema ALTER best-effort) driving the cards-panel
  "Study cards / Generated" grouping; generation + demo seed set it.
- StrictMode purity fix in review session: grade side-effects moved out of the
  setState updater with a sessionRef + grading guard (was double-POSTing grades).
- /review/session wrapped in Suspense (useSearchParams prerender bailout).
- TabBar settings icon is the mockup gear (sliders icon belongs to the greeting
  button only).
- Parity pass at 390x720 vs /mock/index.html: home, library, review, notebook
  (overview/chat/cards), session, settings all structurally identical; remaining
  differences are data-driven (counts, order, per-notebook suggestion chips).
