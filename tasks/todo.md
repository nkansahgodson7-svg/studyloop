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

- [ ] Task 3: Login/logout + guards + `seed:admin` script
  - Acceptance: seeded admin can log in; wrong password 401; disabled 403; guards reject unauthenticated API calls (tests)
  - Files: src/app/login/page.tsx, src/app/api/auth/*, src/lib/server/seed-admin.ts
  - Deps: Task 2
- [ ] Task 4: Admin user management (create/disable)
  - Acceptance: admin-only route returns 403 for non-admin; disabled user's sessions purged, login blocked
  - Files: src/app/admin/page.tsx, src/app/api/admin/users/* + tests
  - Deps: Task 3
- [ ] Task 5: BYO-key settings (save/clear, encrypted)
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
- [ ] Task 9: YouTube source (youtubei.js)
  - Acceptance: URL → transcript source ≤ 60s (mocked test + one live smoke)

## Phase 4: Grounded Chat

- [ ] Task 10: Retrieval + streaming chat route with citations + refusal contract
  - Acceptance: cited answer for supported Q; explicit refusal when no chunks (mocked tests); rate-limit → readable error
- [ ] Task 11: Chat UI (streaming list, citation chips, persistence)

## Phase 5: Review Loop

- [ ] Task 12: FSRS wrapper + cards/reviews repo + card generation (≤10/call) + manual CRUD
  - Acceptance: fixture tests for due dates; generation produces editable cards
- [ ] Task 13: Review UI — Today queue, 4-button grading, streak, card editor
  - Acceptance: grading schedules next due; queue exact per user; streak increments

## Phase 6: Quiz

- [ ] Task 14: Quiz generation (topic-scoped, streamed batches ≤ 6)
- [ ] Task 15: Quiz play + AI grading (scores persisted)

## Phase 7: Ship

- [ ] Task 16: Turso push script + Vercel env docs + CSP/security polish + final gate + deploy walkthrough
  - Acceptance: spec success criteria #1–#11 check off; `git push` deploys; admin + friend accounts work on live URL

## Checkpoints

After each phase's tasks: full gate green + checkpoint list in plan.md reviewed before next phase.
