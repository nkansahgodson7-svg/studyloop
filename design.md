# StudyLoop — Design System

Version 1.0 · October 2026 · Covers the mobile companion mockup in `frontend/`

---

## 1. Direction

**Positioning:** an AI study workspace that turns your own material into answers, flashcards, and a daily review loop. The product's core idea is the *loop*: capture → understand → recall → repeat.

**Visual thesis:** *warm editorial, not AI gradient.* Paper-toned canvas, near-black ink, an evergreen brand with a single ember accent for AI moments. Serif headings give the product a studious, authored feel; a clean grotesque keeps dense UI legible. Contrast through typography and one dark surface, never through purple gradients or glassmorphism.

**References studied (Dribbble, Oct 2026):**

| Shot | What we took | What we rejected |
|---|---|---|
| [Otto — AI notetaker study app](https://dribbble.com/shots/27637592-Otto-an-AI-notetaker-study-app) | Source → notes/flashcards/quiz pipeline; one black pill CTA with a sparkle; tinted source tiles; per-deck mastery | Lilac canvas, heavy rounding, sticker aesthetic |
| [Studia — AI Study Companion](https://dribbble.com/shots/27637923-Studia-AI-Study-Companion-App-UI-Design) | Big serif display type; progress ring as hero; cream/peach warmth; notes/folders hierarchy | Decorative gradients across every surface |
| [FocusFlow — AI Study App](https://dribbble.com/shots/27658388-FocusFlow-AI-Powered-Study-App) | Airy cards, indigo-tinted focus chips, calm onboarding | Thin hierarchy, too little density for real data |
| [AI Study Notes Redesign](https://dribbble.com/shots/27352488-AI-Study-Notes-App-Redesign-Smart-Revision-Learning-UI) | Mastery % per subject; explicit "AI Bot" entry point; learning-path metaphor | Purple/orange saturation, mascot, gamified noise |
| [AI Study Notes — Nixtio](https://dribbble.com/shots/27621778-AI-Study-Notes-Mobile-App) | Import affordances (PDF/photo), upload progress, Smart Chat | Red gradient panels, brand-as-background |
| [AI Study App UI — Learning & Quiz](https://dribbble.com/shots/27693377-AI-Study-App-UI-AI-Learning-Quiz) | Quiz-first information architecture | Generic dashboard grid |

**Five principles**

1. **The loop is visible.** A ring, a due count, a streak. Progress is the product.
2. **One loud action per screen.** Everything else is quiet, bordered, and secondary.
3. **AI looks like an action, not a theme.** Sparkle glyph + ember accent on the *verb*; no gradient soup.
4. **Density is honest.** Real titles, real counts, real source names. No lorem ipsum.
5. **Mobile is the product.** Built at 390 px, scaled up as a courtesy.

---

## 2. Color

All colors are semantic tokens exposed as CSS custom properties in `frontend/styles.css`.

### Surfaces & ink

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F5F1E8` | App canvas |
| `--paper-2` | `#EDE7DA` | Recessed areas, input wells |
| `--surface` | `#FFFDF8` | Cards, sheets, bars |
| `--surface-2` | `#FAF5EA` | Nested cards, hover |
| `--ink` | `#15160F` | Primary text, primary buttons |
| `--ink-2` | `#3B3C32` | Secondary text |
| `--muted` | `#6E6B5D` | Metadata, helper copy |
| `--line` | `#E3DCCC` | Default 1 px border |
| `--line-strong` | `#CFC6B1` | Emphasis dividers |

### Brand & accent

| Token | Hex | Use |
|---|---|---|
| `--brand` | `#14563E` | Evergreen: rings, active states, links |
| `--brand-2` | `#0B3527` | Dark hero card, pressed brand |
| `--brand-soft` | `#E1EDE4` | Brand tint fills |
| `--accent` | `#D9552A` | Ember: AI verbs, streaks, citation chips |
| `--accent-soft` | `#FBE3D6` | Accent tint fills |

### Tints (source tiles, notebook covers)

| Token | Hex | Typical assignment |
|---|---|---|
| `--butter` | `#F6E7B9` | PDF |
| `--sage` | `#DDEAD8` | Text note |
| `--sky` | `#DBE7F0` | YouTube |
| `--rose` | `#F4DCD2` | Recording |
| `--lilac` | `#E6E2F2` | Generated / AI |

Tints are **fill-only**. Text on tints is always `--ink`, never a matching saturated hue.

### Rules

- Body text on `--paper` must reach **4.5:1**; `--ink` on `--paper` = 15.8:1, `--muted` = 4.9:1.
- `--accent` is reserved for AI verbs, streaks, and destructive emphasis. Never for navigation.
- On `--brand-2`, text is `#F7F3E7`; the ring track uses `rgba(247,243,231,.18)`.
- No pure white, no pure black, no purple-dominant palettes.

---

## 3. Typography

**Display:** Fraunces (variable, `opsz` 9–144, `wght` 400–600, `SOFT` 0).
**UI:** Inter (`wght` 400–650).

Fallbacks: `Georgia, "Times New Roman", serif` and `system-ui, -apple-system, "Segoe UI", sans-serif`.

### Scale (mobile)

| Token | Size / line | Weight | Family | Use |
|---|---|---|---|---|
| `display` | 38 / 1.02 | 500 | Fraunces | Login wordmark, review prompt |
| `h1` | 30 / 1.08 | 500 | Fraunces | Screen titles, greeting |
| `h2` | 20 / 1.2 | 550 | Inter | Section headings |
| `h3` | 16 / 1.3 | 600 | Inter | Card titles |
| `body` | 15 / 1.55 | 400 | Inter | Default |
| `body-strong` | 15 / 1.55 | 560 | Inter | Emphasis inside body |
| `small` | 13 / 1.45 | 400 | Inter | Metadata |
| `micro` | 11 / 1.2 | 600 | Inter, `+0.08em`, uppercase | Eyebrows, section labels |

**Rules**

- Headings use `text-wrap: balance`; body uses `text-wrap: pretty`.
- Numerals in stats and rings use `font-variant-numeric: tabular-nums`.
- Sentence case everywhere except the micro eyebrow.
- Maximum two families. No all-caps body copy.

---

## 4. Space, radius, elevation

**Spacing scale (4 px base):** 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64. No ad-hoc values.

**Radius hierarchy**

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 10 px | Inputs inside sheets, tiny chips |
| `--r-sm` | 14 px | Source tiles, list rows |
| `--r-md` | 20 px | Nested cards, message bubbles |
| `--r-lg` | 28 px | Screen cards, hero |
| `--r-pill` | 999 px | Buttons, chips, tab bar items |

Never round everything to the same value; the hierarchy is what keeps the UI from reading as AI-generated.

**Elevation**

- Default: `1px solid var(--line)`, no shadow.
- Floating: `0 10px 30px -18px rgba(21,22,15,.35)` (sheets, tab bar only).
- Hero dark card: inner 1 px highlight `inset 0 1px 0 rgba(255,255,255,.08)`.
- No layered multi-shadow cards.

---

## 5. Layout

- **Viewport:** 360–430 px content width; page gutter 20 px (24 px on ≥ 414).
- **App shell:** max-width 460 px, centered. ≥ 720 px shows a 460 × min(900, 100dvh − 48) device frame on a `#E8E2D4` backdrop with a 1 px border.
- **Vertical rhythm:** header 20 px top, 16 px to first block, 28 px between sections.
- **Tab bar:** 68 px + safe area; content bottom padding `calc(96px + env(safe-area-inset-bottom))`.
- **Safe areas:** all fixed edges respect `env(safe-area-inset-*)`.
- **Breakpoints:** 360 (min), 390 (design), 430 (large phone), 720 (framed desktop).

---

## 6. Components

### Buttons

| Variant | Spec |
|---|---|
| Primary | Ink fill, cream text, pill, height 48, 15/560, pressed → `translateY(1px)`, disabled 40% |
| AI | Ink fill + `✦` accent glyph, pill, height 48. Used once per screen |
| Brand | Evergreen fill, cream text. Used inside dark hero only |
| Secondary | Surface fill, 1 px `--line-strong`, ink text |
| Ghost | Transparent, ink text, hover `--surface-2` |
| Danger | `--accent-soft` fill, `--accent` text, no border |

Minimum hit target **44 × 44 px** for every icon-only control. Focus ring: `0 0 0 3px var(--paper), 0 0 0 5px var(--brand)`.

### Chips

Pill, 28 px tall, `13/500`. Variants: neutral (`--surface-2` + line), brand (`--brand-soft` + brand text), accent (`--accent-soft` + accent text), tinted (source tiles).

### Cards

- **Screen card:** `--surface`, `--r-lg`, 1 px line, 18 px padding.
- **List row:** 64 px min-height, 14 px radius, leading 44 px tinted tile, title + meta, trailing chevron or badge.
- **Dark hero:** `--brand-2`, cream text, 28 px radius, 22 px padding, ring on the right.

### Bottom tab bar

Four items: Home, Review, Notebooks (Library), Settings. Icon 22 px + `micro` label. Inactive `--muted`, active `--ink` with a 4 px brand dot beneath. Bar: `--surface` at 94% opacity, `backdrop-filter: blur(18px)`, top hairline.

### Sheets

Bottom sheet: `--surface`, top radius 28, grabber 36 × 4, title row, content, sticky footer action. Scrim `rgba(15,16,10,.42)` with 8 px blur. Enter 320 ms `--ease-out`, exit 220 ms. ESC and scrim click close; focus moves to the first control and returns on close.

### Toasts

Bottom-anchored above the tab bar, ink fill, cream text, 13/500, pill, 1 line max, auto-dismiss 2.6 s, `role="status"`. One at a time.

### Progress ring

SVG, track `rgba` 12–18%, stroke 6–8, round caps, `-90deg` start. Animated with `stroke-dashoffset` over 600 ms `--ease-out`. Always paired with a numeric label. Never the sole carrier of meaning.

### Flashcard

Full-width surface card, min-height 340, prompt `h1` serif centered, muted "Tap to reveal". Back: answer body + hairline + source chip. Grade row appears only after reveal: Again / Hard / Good / Easy, each with an interval hint. Once revealed the card is draggable: left Again, right Good, up Easy, down Hard, with directional cue chips that tint and scale as the threshold approaches. A 72 px horizontal / 86 px vertical throw commits the grade; anything shorter springs back. Buttons remain for taps and accessibility. Keyboard: Space reveal, 1–4 grade.

---

## 7. Motion

| Event | Spec |
|---|---|
| Push (open detail) | Incoming `translateX(100%) → 0`, outgoing `→ -22%`, 280 ms `--ease-out` |
| Pop (back) | Mirror of push, 240 ms |
| Tab switch | Cross-fade + 6 px rise, 180 ms |
| Sheet | Up 100% → 0 with scrim fade, 320 ms |
| Card reveal | Cross-fade + 1.5% scale, 220 ms |
| Card swipe | Live 1:1 drag with 3.5% tilt and cue fade; release past threshold flies out 260 ms then grades; below threshold springs back 200 ms |
| Ring / progress | `stroke-dashoffset` 600 ms |
| Toast | 8 px rise + fade, 180 ms |

**Reduced motion:** `@media (prefers-reduced-motion: reduce)` removes transforms and reduces durations to ≤ 1 ms; state changes remain instant and visible. Never rely on animation alone to confirm an action.

**Motion budget:** one primary transition per interaction. No parallax, no looping decorative animation.

---

## 8. Iconography

- 24 px grid, 1.7 px stroke, round caps/joins, no fills except the sparkle and status dots.
- Set: home, notebook, cards, settings, plus, back, chevron, close, sparkle, pdf, text, youtube, play, check, trash, flame, key, logout, clock, search, arrow-right.
- The **sparkle (`✦`)** is the single AI marker. It appears only on AI-initiated actions and generated content.
- Icons always pair with a text label in navigation; icon-only controls require `aria-label`.

---

## 9. Content & voice

- Sentence case, active voice, second person: "Add a source", "Generate flashcards", "Review 8 cards".
- Verbs for AI: **generate, explain, summarize, quiz me**. Never "magic", "supercharge", "unleash".
- Empty states name the next action: "No sources yet — add a PDF or paste your notes."
- Counts are spelled out with units: "12 cards · 8 due today".
- Errors say what happened and what to do: "PDF is larger than 40 MB. Try a smaller file."
- No exclamation marks outside toasts. No emoji in product UI.

---

## 10. Screen inventory

| Route | Screen | Key elements |
|---|---|---|
| `#/login` | Sign in | Wordmark, email/password, demo hint, error state |
| `#/home` | Today | Greeting, dark loop hero with ring + streak, notebook list, new-notebook sheet |
| `#/review` | Review hub | Due total, per-notebook due rows, start session |
| `#/notebook/:id` | Notebook | Hero, segmented tabs: Overview / Chat / Cards |
| | Overview | Source list, add-source sheet (PDF / text / YouTube), processing states |
| | Chat | Streamed answers, citation chips, suggested prompts, composer |
| | Cards | Generate (AI pill), card list, start review |
| `#/session/:id` | Review session | Card flip, grade 1–4, progress, completion summary |
| `#/settings` | Settings | Profile, BYO AI key status, reset demo data, sign out |

**Primary flow:** login → today → notebook → add source → generate cards → start review → grade → summary → today. Every screen has a back path and a visible next action.

---

## 11. Accessibility

- WCAG 2.1 AA: 4.5:1 text, 3:1 large text and UI boundaries, 44 px targets.
- Semantic landmarks: `main`, `nav`, `header`, one `h1` per screen, ordered headings.
- Live regions: chat log `aria-live="polite"`, toasts `role="status"`, errors `role="alert"`.
- Sheets are `role="dialog"` + `aria-modal`, labelled by their title, with focus in/out handling.
- Flashcard reveal and grading are reachable by keyboard; grade buttons expose their interval in text. Swipe grading is an accelerator only — every swipe outcome also has a labeled button.
- Color is never the only signal: due states pair color with labels ("Due", "Scheduled").
- Visible focus ring on every interactive element; no `outline: none` without replacement.
- Support 200% zoom; no horizontal scroll at 320 px.

---

## 12. Implementation map

| Concern | Location |
|---|---|
| Tokens, components, motion, responsive frame | `frontend/styles.css` |
| Shell, font loading, tab bar, toast/sheet roots | `frontend/index.html` |
| Router, mock state (localStorage), simulated AI, FSRS-lite grading | `frontend/app.js` |

**Demo data:** three notebooks (Organic Chemistry, World History, Calculus II) with sources, generated cards, and due dates seeded relative to now. Grades schedule with Again 10 m / Hard 1 d / Good 3 d / Easy 7 d scaled by repetition count. State persists in `localStorage` under `studyloop.mock.v1`; Settings → "Reset demo data" restores the seed.

**Non-goals for the mockup:** real PDF extraction, real LLM calls, auth, server persistence. Interactions, transitions, empty/loading/error states, and keyboard behavior are all simulated faithfully.
