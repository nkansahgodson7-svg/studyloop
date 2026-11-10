# Spec: StudyLoop — Personal AI Study Studio

## Objective

A hosted web app where a small trusted group (owner + ~3 friends) uploads PDFs and
YouTube videos into private notebooks, chats with the sources through grounded
answers with citations, auto-generates quizzes and flashcards from the material,
and reviews due flashcards on a spaced-repetition schedule — keeping everyone in a
daily learning loop.

Fills the gap between NotebookLM (grounding, no review loop) and the abandoned
local-only `ai-study-partner-react` (quizzes, but single-user, BYO-key, loopback).

**Users:** closed group. Every user logs in with email + password. Self-service
signup is gated by a shared invite code (`SIGNUP_INVITE_CODE`); the first account
is seeded by script, and admins can still create and manage accounts directly.

**Success:** the group is still reviewing due cards most days weeks after launch.

## Scope (v1)

- Notebooks: own workspace per user, each notebook has sources, chat, and a deck
- Sources: PDF upload (client-side text extraction), YouTube URL → server-side
  transcript fetch, plain text/markdown paste
- Chat: multiple conversations per notebook, grounded in notebook sources via
  FTS5 keyword retrieval when they help; every answer carries a grounding label
  ("From your sources", "General knowledge", or "Sources + general") and an
  optional list of the source segments it used
- Quiz: MCQ + fill-in generation from selected topics, AI grading of answers
  (carried over conceptually from `ai-study-partner-react`)
- Flashcards: auto-generation from a source/topic selection, manual creation and
  editing, per-notebook deck
- Review loop: FSRS scheduling (via `ts-fsrs`), 4-button grading, "Today" due
  queue, simple streak counter
- Auth: invite-code signup with auto-login, plus login/logout; signup is closed
  when no invite code is configured
- Admin: create/disable users, view usage basics
- Settings: optional personal API key (BYO) per user; nothing else beyond account
- Key strategy: hybrid — owner's key from env (`GROQ_API_KEY`) is the default for
  all AI calls; a user who saves their own Groq key gets their calls routed
  through it instead (own quota). Stored keys are AES-GCM encrypted with
  `ENCRYPTION_SECRET`, never returned to clients, never logged

## Out of scope (v1)

- Open public signup (registration requires an invite code), billing, usage
  metering/metered quotas
- Native/mobile apps, PWA push
- Audio/video playback, video download, OCR of scanned PDFs
- Vector embeddings / semantic search (FTS5 first; revisit only if retrieval is bad)
- Chat personas (the old app's feature), gamified grind modes, leaderboards
- Multi-LLM provider switching; one provider, server-held key

## Tech Stack

- **Frontend:** Next.js (App Router) + React 19 + TypeScript (strict) · Zustand · `pdfjs-dist` (client-side)
- **Backend:** Next.js route handlers on Vercel (Node runtime) · `@libsql/client` (async) over **Turso** free tier — libSQL is SQLite, FTS5 included
- **Auth:** cookie sessions (httpOnly), scrypt hashes (`node:crypto`), session
  table in DB; invite-code signup (`SIGNUP_INVITE_CODE`, closed when unset)
- **LLM:** Groq OpenAI-compatible API, called server-side only; default key from
  env (`GROQ_API_KEY`), per-user BYO key override stored AES-GCM-encrypted in
  `users.llm_key_encrypted`; quiz generation pinned to the 120b model, other
  calls to 20b; quiz batches sized ≤ 6 items to stay under Hobby's ~60s cap
- **YouTube:** `youtubei.js` (pure-JS transcript fetch) inside a single route handler — no binaries, no yt-dlp
- **Deployment:** Vercel Hobby — push-to-deploy, zero-ops, $0; local dev uses the same libSQL client against a local file DB (`data/studyloop.db`, gitignored)
- **Testing:** Vitest · Testing Library · jsdom

## Commands

```bash
npm run dev         # next dev (http://localhost:3000); proxies nothing — routes serve /api and UI together
npm test            # Vitest — all suites
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # oxlint
npm run build       # next build — must pass before deploy
```

Deploy = `git push` (Vercel picks it up). A change is complete only when
`npm test && npm run typecheck && npm run lint && npm run build` is green
locally.

## Project Structure

```
src/                → Next.js app
  app/              → routes: (auth) login, notebooks, admin
  app/api/          → route handlers: auth, notebooks, sources, chat,
                      cards, review, quiz, admin
  components/       → AuthShell, NotebookList, NotebookView,
                      Sources, Chat, Quiz, Review, Admin
  store/            → single Zustand store; all state + async actions
  lib/              → pure helpers (pdf extraction client-side, formatters)
  lib/server/       → ai/ (groq client, prompts, JSON repair, grading),
                      ingest/ (pdf passthrough, youtube transcript, chunking),
                      auth/ (scrypt, sessions), fsrs.ts
  db.ts             → schema DDL + lazily-opened libSQL client (env-driven:
                      Turso in prod, local file in dev/tests)
  repo.ts           → all SQL lives here (parameterized only, async)
docs/               → this spec + ADRs for decisions that outlive it
tasks/              → plan.md, todo.md (per /plan convention)
src/**/*.test.ts    → colocated tests (repo tests run against a temp local file)
```

## Data Model (SQLite)

```
users(id pk, email unique, pw_hash, llm_key_encrypted text NULL, role: 'admin'|'user', disabled int, created_at)
sessions(token pk, user_id fk, expires_at)
notebooks(id pk, user_id fk→users, title, created_at)
sources(id pk, notebook_id fk, kind: 'pdf'|'youtube'|'text', title, url?, text, meta json, created_at)
source_chunks(id pk, source_id fk, ord int, text)            -- indexed by FTS5
chat_conversations(id pk, notebook_id fk, title, title_source, created_at, updated_at)
chat_messages(id pk, conversation_id fk, role, content, grounding, sources json, status, created_at)
cards(id pk, notebook_id fk, source_id fk?, front, back, created_at)
reviews(card_id, due, stability, difficulty, ... FSRS state)
quiz_items(id pk, notebook_id fk, kind: 'mcq'|'fillin', topic, payload json, created_at)
quiz_attempts(id pk, item_id fk, user_id fk, answer, score, graded_by, created_at)
```

Cascade deletes from `notebooks` down. All queries via `repo.ts` with `?` placeholders.

## Code Style

Strict TypeScript everywhere; no `any` without a comment saying why. React is
function components + hooks only. Prompts live in `src/lib/server/ai/prompts.ts`
as pure functions taking data, returning strings — never inline in route
handlers. SQL always through `repo.ts` (async because libSQL is async). Example
of the house style:

```ts
// src/lib/server/repo.ts
export async function createNotebook(userId: number, title: string): Promise<NotebookRow> {
  const result = await client.execute({
    sql: "INSERT INTO notebooks (user_id, title, created_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    args: [userId, title],
  });
  return getNotebook(result.lastInsertRowid as number);
}
```

- Route handlers stay thin: validate (arktype) → call repo/ai layer → return JSON
- Errors: single error envelope `{ error: string }` with correct status codes
- User/AI content rendered as JSX text only — never `dangerouslySetInnerHTML`
- AI responses are bare JSON, parsed leniently (`stripFences` + repair), with one
  retry on malformed/truncated output

## Testing Strategy

- **Levels:** pure-logic unit tests (scheduling math, chunking, JSON repair,
  prompt builders) → data-layer tests against a temp local file DB via
  `@libsql/client` (same SQL runs in prod) → handler tests for validation/auth
  rejection paths (handlers as pure functions called directly) → component tests
  (RTL + jsdom) for AuthShell, Review queue, and Quiz grading UI
- **Location:** colocated `*.test.ts` next to the code under test
- **Expectations:** every route has a happy-path and an auth-rejection test;
  every AI-call path has a mocked-provider test including malformed-response retry;
  FSRS wrapper tested against known due-date fixtures
- **CI gate:** the four-command gate above, run before any commit

## Boundaries

**Always**
- Run the full four-command gate before calling any change done
- Parameterize every SQL statement; secrets only from env, never logged
- Capture IDs before `await` in async store flows and abort if the active
  notebook/user changed (carried-over concurrency discipline)
- Validate request bodies with arktype before touching the DB or AI layer

**Ask first**
- Schema changes, new dependencies, new AI provider or model swap
- Changing auth/session shape, CSP, or security headers
- Dropping or weakening an existing test

**Never**
- Commit secrets; send any API key anywhere but the LLM provider endpoint;
  return a stored key to the client in any response; log request content or keys
- String-interpolate user input into SQL; log request content at INFO
- Ship a route without an auth-rejection test

## Success Criteria (testable)

1. Admin logs in, creates a user, disables a user; disabled user cannot log in
2. A user's notebooks are invisible to another user's session (403/404, tested)
3. PDF ≤ 100 pages → source with extractable text stored; structure extracted ≤ 30s
4. YouTube URL → transcript source created ≤ 60s with chunked, searchable text
5. Chat answer to a source-supported question is labelled "From your sources"
   and lists ≥ 1 used source; an unsupportable question is labelled "General
   knowledge" with a verify note and no sources (tested with mocked model)
6. "Generate flashcards" on a selection yields ≥ 8 editable cards ≤ 60s
7. Rating a card (Again/Hard/Good/Easy) produces a FSRS-computed next due date;
   the Today queue lists exactly the cards due for the logged-in user
8. Quiz flow: generate ≥ 8 items from a topic, answer them, receive AI grades
9. All AI endpoints stream and degrade with a readable error on rate-limit
10. A user with a saved personal key has their AI calls routed through it; a
    user without one degrades to the owner's key (mocked-provider test). Keys
    never appear in API responses or logs
11. The four-command gate passes; no route lacks a rejection test
12. Invite-gated signup creates a user, auto-issues a session, and rejects a
    wrong invite (403) or a missing invite configuration (503)

## Open Questions

None.

**Resolved:** hosting = Vercel Hobby + Turso free tier, push-to-deploy (owner wants zero-ops; VM/Docker ruled out). Duration cap on Hobby mitigated by small quiz batches. Keys = hybrid: owner's env key as default, per-user encrypted BYO override.
