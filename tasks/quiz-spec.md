# Spec: Mock exams (quiz generation + AI grading)

Decisions confirmed with the owner on 2026-11-16. This replaces the one-line
"Phase 6" sketch in `tasks/plan.md` and the unused `quiz_items` / `quiz_attempts`
tables from the original spec.

## Product summary

Each notebook gets a **Quiz** tab. A user configures a mock exam (sources,
chapters/pages, question types, length, optional timer, focus), the server writes
it in small batches, and the saved exam can be taken, retaken and resumed. Exams
are exam-mode: no feedback until submit, then a full review with per-question
explanations, AI feedback on open answers, a topic breakdown, and a one-tap
"add missed questions to flashcards".

Confirmed choices:

| Decision | Choice |
|---|---|
| Exam model | Saved exam, unlimited retakes, attempt history |
| Entry point | 4th notebook tab: Overview · Chat · Cards · **Quiz** |
| Question types | MCQ (one correct), multi-select, true/false, fill-in, short answer — chosen with checkboxes, AI balances across the checked types |
| Length / timer | 5 / 10 / 20 / 40 questions; timer off by default, toggle with 15/30/60 min |
| Time up | Auto-submit; unanswered items score 0 |
| Feedback | Exam mode — nothing until submit, then full review |
| Open grading | AI scores 0–1 with rubric and partial credit |
| Explanations | Written with each question during generation |
| Breakdown | AI tags every item; results break down by tag |
| Take screen | One question per screen, progress, Back/Next, submit at the end |
| Retakes | Same question order, shuffle answer options only |
| Resume | Server-side, one active attempt per exam, resume on any device |
| Missed → cards | One tap on the results screen |
| Score surface | Latest exam % per notebook on Home and Review |
| Schema | New tables: exams, exam items, exam attempts |
| Budget | ≤20 questions, ≤6 per LLM call, 20 exams/hour per user |

## Non-goals (v1)

- Editing individual generated questions (delete/regenerate the exam instead).
- Question banks shared across notebooks, exam templates, certificates, proctoring.
- Per-question timers, adaptive difficulty, spaced repetition of exam items.
- Manual grading of short answers by the user.
- Seeding demo exams (the mockup has no quiz screen; demo stays unchanged).

## Data model

New tables (added to `SCHEMA` in `src/lib/db.ts`; existing DBs get them via
`applySchema`, which is idempotent):

```sql
CREATE TABLE IF NOT EXISTS quiz_exams (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',          -- focus instruction, if any
  config TEXT NOT NULL DEFAULT '{}',       -- JSON: types, requestedCount, timerMinutes, sourceSummary
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS quiz_exam_items (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES quiz_exams(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mcq','multi','truefalse','fillin','short')),
  topic TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',      -- JSON string[]; [] for fillin/short
  correct TEXT NOT NULL,                   -- JSON: {"index":2} | {"indexes":[0,2]} | {"value":true} | {"accepted":["..."]} | {"rubric":"...","modelAnswer":"..."}
  explanation TEXT NOT NULL DEFAULT '',
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quiz_exam_attempts (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES quiz_exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','submitted','grading','graded','grading_failed')),
  answers TEXT NOT NULL DEFAULT '{}',      -- JSON map: itemId -> value (index | index[] | boolean | string)
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  graded_at TEXT,
  duration_ms INTEGER,
  score REAL,                              -- 0..1, null until graded
  feedback TEXT,                           -- JSON map: itemId -> {score, comment} (open answers)
  breakdown TEXT,                          -- JSON: { byTopic: [...], byKind: [...] }
  graded_by TEXT NOT NULL DEFAULT 'auto'
);

CREATE INDEX IF NOT EXISTS idx_quiz_exams_notebook ON quiz_exams(notebook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_exam_items_exam ON quiz_exam_items(exam_id, ord);
CREATE INDEX IF NOT EXISTS idx_quiz_exam_attempts_exam ON quiz_exam_attempts(exam_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_exam_attempts_user ON quiz_exam_attempts(user_id, started_at DESC);
```

Legacy `quiz_items` / `quiz_attempts` are never written by this feature. Admin
stats and `reset-demo` move to the new tables; the legacy ones are left in place
for now (empty) and can be dropped in a separate, explicitly approved migration.

`options` + `correct` stay server-side until submit: the take payload sends
`{ id, kind, prompt, topic, options: string[] }` only. Option ids are the
canonical indices, so the client may shuffle display order without breaking
grading.

## Generation

`POST /api/notebooks/:id/quizzes/generate`

Body (validated like cards, manual checks + typed fields):

```ts
{
  sources: Array<{ sourceId: number; from?: number; to?: number }>, // required, ≥1
  types: Array<'mcq'|'multi'|'truefalse'|'fillin'|'short'>,        // required, ≥1
  count: 5 | 10 | 20 | 40,                                        // default 10, clamp 1..20
  timerMinutes: 15 | 30 | 60 | null,                              // optional
  focus?: string                                                  // ≤1000 chars
}
```

Pipeline:

1. `requireUser` → `ownNotebook` → `rateLimitResponse('quiz-generate:<user>', 20/hr)`.
2. Resolve and load material exactly like flashcards: per-source chunk selection
   (page ranges), `stratifiedSample`, joined context under a 12k-character budget
   with a per-source share. **Refactor first:** extract
   `resolveGenerationSelections`, `buildGenerationContext` and `stratifiedSample`
   from `cards.ts` into `src/lib/server/generation-material.ts`; cards and quiz
   both import it. No behaviour change for cards.
3. Resolve the key through `resolveLlmKey` (BYO override → `GROQ_API_KEY`);
   no key → 503 with the existing copy.
4. Allocate a type mix from the checked types: round-robin over the selected
   kinds, so `count=10` with 3 types asks for 4/3/3. Each batch gets an explicit
   per-kind target in its prompt instead of hoping the model balances.
5. Write in batches of ≤6 items, sequentially, with:
   - 15 s timeout per LLM call, `temperature: 0.4`;
   - one retry per batch if the reply is not a usable JSON array;
   - a global `GENERATION_DEADLINE_MS = 40_000` budget; stop early and keep what
     is valid (`truncated: true` in the response) rather than time out at 60 s;
   - `GROQ_QUIZ_MODEL ?? GROQ_MODEL ?? 'openai/gpt-oss-20b'` (spec's 120b pin is
     obsolete — the llama deployments are gone; this stays an env-only choice).
6. Validate and normalise each item; drop unusable ones:

| kind | required shape | rules |
|---|---|---|
| `mcq` | 4 options, `index` | one correct; no "all of the above" |
| `multi` | 4–5 options, `indexes` | ≥2 correct, not all |
| `truefalse` | `value` boolean | — |
| `fillin` | `accepted` 1–3 strings | answer is a word/phrase, prompt has a blank |
| `short` | `rubric` + `modelAnswer` | prompt asks to explain/derive/compare |

Common: prompt ≤300 chars, options ≤120 chars, explanation 1–2 sentences,
topic 2–4 words, grounded only in the supplied material, no answer leakage in the
prompt or distractors, `source_id` set when only one source was selected.

7. Dedupe against existing items in the notebook by normalised prompt (reuse
   `normalizeFront`).
8. Persist in one transaction: `quiz_exams` + ordered `quiz_exam_items`.
9. Respond `201 { exam: {...}, requested, generated, truncated }`.

Title: `Mock exam · <focus | sourceSummary>` truncated to 80 chars.

If zero valid items survive → `502 GENERATION_INVALID` (same envelope as cards).
Every skipped/failed batch is reported in the response for the UI's
"generated 12 of 20" note.

## Attempt lifecycle

- `POST /api/quizzes/:examId/attempts` — ownership via notebook owner. Returns
  the existing `in_progress` attempt for this user or creates one
  (`started_at = now`). Response includes the items (no `correct`), `answers`,
  `startedAt`, `timerMinutes`, `remainingSeconds` (null when untimed).
- `PATCH /api/quiz-attempts/:attemptId` — `{ answers }`, partial merge, validates
  every key belongs to the exam and the value shape matches the kind. Debounced
  saves from the client (≈2 s after a change) and on navigation. Returns
  `{ saved: true, expired }`; `expired` is true when a timer exists and
  `started_at + timerMinutes` has passed, so the client submits immediately.
- `POST /api/quiz-attempts/:attemptId/submit` — idempotent: an already
  `submitted`/`graded` attempt returns its stored result. Computes:
  - `mcq`/`truefalse`: exact match, 1 or 0.
  - `multi`: `max(0, correctSelected - wrongSelected) / correctCount`, clamped
    to [0,1] (partial credit, penalises guessing).
  - `fillin`: deterministic; lower-case, strip punctuation/collapse whitespace,
    compare against `accepted`.
  - `short`: one batched LLM call with every short answer, its rubric, the model
    answer and the user's text → `[{itemId, score, comment}]`; `temperature: 0`,
    retry once on malformed JSON, clamp scores to [0,1], missing items = 0.
  - `score` = Σ(points × itemScore) / Σ(points); `duration_ms` from
    `submitted_at - started_at` (server clock, not client-supplied);
    `breakdown` = `{byTopic, byKind}` each `{label, earned, max}`.
  - Unanswered items score 0 (including auto-submit at time-up).
  - If the grading call fails after retry: status `grading_failed`, auto-graded
    items still scored, `score` covers only graded items, open feedback empty.
    The results screen offers "Grade again" (POST submit again).
- `POST /api/quiz-attempts/:attemptId/missed-cards` — creates flashcards for
  items scored <1 using the existing card batch/commit path: front = prompt,
  back = learned answer + explanation, `generated = true`, duplicates skipped by
  normalised front. Returns `{created, skipped}`.
- `GET /api/notebooks/:id/quizzes` — list with `questionCount`, `lastAttempt`
  `{score, at}`, `bestScore`, `activeAttempt` `{id, answered, remainingSeconds}`,
  `timerMinutes`.
- `GET /api/quizzes/:examId` — detail + attempts history.
- `DELETE /api/quizzes/:examId` — owner only, cascades attempts.

Ownership on every attempt route is `attempt → exam → notebook → user`; a foreign
attempt is 404, never 403-with-existence.

## Scoring presentation

- Score shown as a percentage (rounded) plus `x / y points`.
- Results groups: score ring (existing `Ring`), "12 of 20 correct", per-topic
  breakdown, per-kind breakdown, then a list of every item: your answer, correct
  answer, explanation (all kinds), AI comment (short answers only).
- Missed items are those with itemScore < 1; the CTA is enabled only when count > 0.

## UI

Notebook tab strip becomes Overview · Chat · Cards · Quiz (4 items; the segmented
control already supports N). `/notebooks/[id]?tab=quiz`.

**Quiz tab** (`ExamListPanel`)
- Header row: "Mock exams" + `New exam` (primary, sparkle icon).
- Rows: title, `10 questions · 30 min`, last score chip, best score, `Resume`
  badge when an active attempt exists. Tap → exam detail. Long-press/overflow →
  delete confirm sheet.
- Empty state: explains what a mock exam is, one CTA to generate.
- Loading: `RowSkeletonList`.

**Generate sheet** (`GenerateExamSheet`, mirrors `GenerateCardsSheet`)
- Sources with chapter/page ranges (reuses `/sources/:id/chapters`).
- Question types as checkboxes (all checked by default except `short`).
- Count: segmented 5 / 10 / 20 / 40 (40 is clamped to 20 by the server; the UI
  hides 40 unless we raise the cap — show 5/10/20 in v1, keep the API ready).
- Timer: switch + 15/30/60 chips (disabled until on).
- Focus textarea (optional).
- Processing state: "Writing questions…" with a soft note that this can take
  ~30 s; error state surfaces `GENERATION_INVALID`, 429 `retry-after`, 503 no key.
- Success closes the sheet, toasts, refreshes the list, and navigates to the exam
  detail (so a bad generation is one tap from delete).

**Exam detail** `/notebooks/[id]/quiz/[examId]`
- Topbar back → notebook Quiz tab (use `useSmartBack` with the notebook as the
  only acceptable origin, matching the chat fix).
- Meta: question count, types present, timer, created date.
- Primary CTA: `Start exam` / `Resume exam` / `Retake`. Secondary: attempts list
  (score, date, duration), delete.
- Note when `generated < requested`: "Generated 12 of 20 before the time limit."

**Take screen** `/notebooks/[id]/quiz/[examId]/take` (suspense wrapper like
review session; deep-linkable, resumes the attempt)
- Fixed screen: topbar with back (confirm "Leave? progress is saved"), title,
  timer countdown when timed.
- Progress bar + `3 / 10`.
- One question per screen: prompt via `Markdown` (KaTeX-safe); MCQ/multi as
  option buttons (`aria-pressed`), true/false as two buttons, fill-in/short as
  `input`/`textarea`.
- Back/Next; on the last item `Submit` opens a confirm sheet ("2 unanswered").
- Debounced `PATCH` after each answer; client timer reaching 0 submits
  immediately with the current answers.
- Shuffle option display order once per attempt on mount (ids preserved).

**Results** `/notebooks/[id]/quiz/[examId]/results/[attemptId]`
- Ring + score, breakdown tables, per-item review, "Add N missed to flashcards"
  toast, "Retake" / "Done".
- `grading_failed`: banner + "Grade again".

**Home / Review**
- Extend `GET /api/notebooks/views` rows with `lastQuiz: { examId, score, at }`
  (latest graded attempt in that notebook) and render e.g. `Last mock 78%` in the
  notebook row meta on Home and in the Review hub's per-notebook row. No new
  endpoint, no change to `UserSummary`.

## Server modules

```
src/lib/server/generation-material.ts   (new: shared selection/sampling/context)
src/lib/server/quiz.ts                  (repo: exams, items, attempts, breakdown)
src/lib/server/quiz-generate.ts         (batch loop, validation, dedupe, persist)
src/lib/server/quiz-grade.ts            (auto scoring, fill-in normalisation, AI grading)
src/lib/server/quiz-prompt.ts           (pure prompt builders, exported for tests)
src/lib/server/quiz.test.ts             (repo + lifecycle + ownership)
src/lib/server/quiz-generate.test.ts    (mocked model: shapes, mix, truncation, retries)
src/lib/server/quiz-grade.test.ts       (MCQ/multi/fill-in/short, partial credit, failure)
```

Routes (thin, validate → call → JSON):

```
POST   /api/notebooks/[id]/quizzes/generate
GET    /api/notebooks/[id]/quizzes
GET    /api/quizzes/[examId]
DELETE /api/quizzes/[examId]
POST   /api/quizzes/[examId]/attempts
GET    /api/quiz-attempts/[attemptId]
PATCH  /api/quiz-attempts/[attemptId]
POST   /api/quiz-attempts/[attemptId]/submit
POST   /api/quiz-attempts/[attemptId]/missed-cards
```

Client: `src/lib/client/quiz.ts` (types + fetchers), `src/components/quiz/{ExamListPanel,GenerateExamSheet,QuizTakeScreen,QuizResults}.tsx`, plus the three
page routes. New CSS only where the design system has no equivalent (result
score chips); prefer existing `.card`, `.row`, `.segmented`, `.btn`, `.empty`,
`.sheet`, `.bar`/`.ring` primitives. Add a `RouteSkeleton` ghost for the quiz
tab only if the tab switch turns out slow; the take/results routes get page-level
skeletons (one skeleton, per the notebook fix).

Rate limits (`ratelimit.ts`):
`QUIZ_GENERATE_LIMIT = { max: 20, windowMs: HOUR_MS }`,
`QUIZ_GRADE_LIMIT = { max: 60, windowMs: HOUR_MS }` (counts submits that call AI).

Admin + demo:
- `admin.ts` / `repo.ts` usage queries count `quiz_exam_attempts` (drop the dead
  `quiz_attempts` reference) and `reset-demo` deletes exams/attempts for the user.
- No seeded demo exams.

## Prompt contracts (pure functions)

Generation (system): "You write mock-exam questions strictly from the supplied
material… reply with ONLY a JSON array…". Per item fields by kind:
`kind, topic, prompt, options?, correctIndex?, correctIndexes?, answer?, accepted?, rubric?, modelAnswer?, explanation`.
Rules: one concept per item, plausible same-length distractors, no negations-only
stems, no "all of the above", never restate the answer, cover the whole material
evenly, omit unsupported items, exactly the requested per-kind counts.

Grading (system): "You grade short answers against a rubric… reply with ONLY a
JSON array `[{itemId, score, comment}]`… score 0–1, partial credit, comment ≤240
chars, no praise padding." User content is delimited and treated as untrusted.

Both live in `quiz-prompt.ts` and are unit-tested as strings (stable markers,
counts, escaping of material).

## Edge cases

- Empty notebook / no chunks for the selection → 400 "no source material".
- All selected types unsupported by the model's reply → 502, nothing saved.
- Timer 0 or expired while away → next `PATCH`/`GET` reports `expired`; UI submits.
- Double submit / retry after network error → idempotent response.
- Delete exam mid-attempt → attempt cascade; take screen 404 → back to Quiz tab.
- User opens the same exam in two tabs → both share the single active attempt;
  answers merge by item id (last write wins).
- Notebook deleted → everything cascades.
- Very long prompts/answers → truncate prompt at 300 chars on generation;
  short answers accepted up to 4000 chars, stored as-is.
- Math/science content → `Markdown` renders `\(…\)` and `\[…\]`; question text
  must not rely on HTML.

## Tests and verification

- Repo: create exam/items/attempt, ownership 404s, one-active-attempt rule,
  idempotent submit, cascade delete, breakdown maths.
- Generation (mocked LLM): mixed-type allocation, invalid items dropped, dedupe,
  truncated batch keeps partial exam, 502 when nothing valid, no key 503,
  rate limit 429, auth rejection.
- Grading: MCQ/TF/fill-in normalisation, multi partial credit, short-answer
  partial credit + malformed JSON retry + failure path (`grading_failed`),
  duration from server clock.
- UI: component tests for the take screen (answer → next, unanswered submit
  confirm, timer auto-submit) and results (breakdown, missed→cards CTA).
- Live check: generate a 10-question mixed exam from a real PDF, take it, submit,
  see a score and resave; resume mid-exam from another tab.
- Gate: `npm test && npm run typecheck && npm run lint && npm run build`.

## Implementation order

1. **Data layer** — `applySchema` tables, `quiz.ts` repo + tests, admin/reset
   updates.
2. **Shared material** — extract from `cards.ts`, cards tests stay green.
3. **Generation** — prompts, batching, validation, route + tests.
4. **Attempts + grading** — lifecycle routes, auto grading, AI grading, tests.
5. **Quiz tab + list + generate sheet** — reaches generation from the UI.
6. **Take screen** — timer, resume, autosave, submit confirm.
7. **Results** — ring, breakdown, per-item review, missed→cards, retake.
8. **Surface score** — notebook views, Home row, Review hub.
9. **Polish** — skeletons, empty/error states, mobile widths, a11y, gate.

Risks: (a) generation latency on the 60 s cap — mitigated by the 6-item batches,
per-call timeout, and the 40 s deadline with partial results; (b) AI grading
quality on short answers — mitigated by rubrics written at generation time,
temperature 0, one retry, and a `grading_failed` path that never loses the
attempt; (c) 4-tab segmented control on 320 px — verify label widths in phase 9.
