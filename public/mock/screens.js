window.SL = window.SL || {};
SL.ui = SL.ui || {};

(function (SL) {
  "use strict";

  const esc = SL.esc;
  const icon = SL.icon;
  const ui = SL.ui;

  function notebookRow(notebook) {
    const app = SL.app;
    const sources = app.sourcesOf(notebook.id).length;
    const cards = app.cardsOf(notebook.id).length;
    const due = app.dueCards(notebook.id).length;
    return `<a class="row" href="#/notebook/${notebook.id}">
      <span class="row__tile ${notebook.tone}" aria-hidden="true">${esc(notebook.title.slice(0, 1))}</span>
      <span class="row__main">
        <span class="row__title">${esc(notebook.title)}</span>
        <span class="row__meta">${SL.plural(sources, "source")} · ${SL.plural(cards, "card")}${due ? ` · ${due} due` : ""}</span>
      </span>
      <span class="row__trail">
        ${due ? `<span class="badge" aria-label="${due} cards due">${due}</span>` : ""}
        ${icon("chevron", 18)}
      </span>
    </a>`;
  }

  function emptyNotebooks() {
    return `<div class="empty">
      ${icon("layers", 26)}
      <p class="h3">No notebooks yet</p>
      <p class="small">Create one per course, then add a PDF, a paste, or a lecture link.</p>
      <button class="btn btn--primary btn--sm" type="button" data-action="new-notebook">${icon("plus", 15)} New notebook</button>
    </div>`;
  }

  ui.login = function loginScreen() {
    return `<section class="screen">
      <div class="auth">
        <div class="auth__brand">
          <span class="auth__orb" aria-hidden="true"></span>
          <p class="eyebrow">AI study workspace</p>
          <h1 class="auth__mark">Study<em>Loop</em></h1>
          <p class="muted text-pretty">Turn your own notes into grounded answers, flashcards, and a daily review loop.</p>
        </div>
        <form class="auth__form" id="loginForm" novalidate>
          <div class="field">
            <label class="label" for="email">Email</label>
            <input class="input" id="email" name="email" type="email" autocomplete="username" placeholder="you@university.edu" required />
          </div>
          <div class="field">
            <label class="label" for="password">Password</label>
            <input class="input" id="password" name="password" type="password" autocomplete="current-password" placeholder="At least 6 characters" required minlength="6" />
          </div>
          <p class="form-error" id="loginError" role="alert" hidden></p>
          <button class="btn btn--primary btn--block" type="submit" id="loginBtn">Sign in</button>
          <button class="btn btn--ghost btn--sm btn--block" type="button" data-action="demo-login">Use demo account</button>
        </form>
        <p class="auth__hint"><b>Demo:</b> any email works with a password of 6 or more characters. Data stays in this browser.</p>
      </div>
    </section>`;
  };

  ui.home = function homeScreen() {
    const app = SL.app;
    const state = app.state;
    const due = app.dueCards().length;
    const pct = app.mastery();
    const name = state.user ? state.user.name : "learner";
    const rows = state.notebooks.map(notebookRow).join("");
    return `<section class="screen has-tabbar">
      <header class="greet">
        <div class="greet__text">
          <p class="eyebrow">${app.todayLabel()}</p>
          <h1 class="h1">${app.greeting()},<br />${esc(name.split(" ")[0])}</h1>
        </div>
        <div class="greet__actions">
          <button class="icon-btn icon-btn--outline" type="button" data-nav="#/settings" aria-label="Settings">${icon("sliders")}</button>
          <span class="avatar" aria-hidden="true">${esc(app.initialsOf(name))}</span>
        </div>
      </header>

      <div class="px stack--20" style="margin-top:16px">
        <section class="hero" aria-label="Today's review loop">
          <div class="hero__row">
            <div>
              <p class="eyebrow">Today's loop</p>
              <h2 class="hero__title">Keep the<br />loop unbroken.</h2>
              <p class="hero__stat">${icon("flame", 15)} ${SL.plural(state.streak, "day")} streak</p>
            </div>
            ${app.ring(pct / 100, { size: 96, label: "mastery" })}
          </div>
          <div class="hero__foot">
            <span class="small" style="color:rgba(247,243,231,.76)">${due ? `${SL.plural(due, "card")} due today` : "All caught up"}</span>
            <a class="btn btn--sm" href="${due ? "#/review" : "#/library"}">${due ? "Review" : "Add material"} ${icon("arrow", 16)}</a>
          </div>
        </section>

        <section>
          <div class="section-head">
            <h2>Your notebooks</h2>
            <button class="btn btn--ghost btn--sm" type="button" data-action="new-notebook">${icon("plus", 15)} New</button>
          </div>
          <div class="rows">${rows || emptyNotebooks()}</div>
        </section>
      </div>
    </section>`;
  };

  ui.review = function reviewScreen() {
    const app = SL.app;
    const state = app.state;
    const due = app.dueCards();
    const total = app.allCards().length;
    const scheduled = total - due.length;
    const rows = state.notebooks
      .map((notebook) => {
        const count = app.dueCards(notebook.id).length;
        if (!count) return "";
        return `<button class="row" type="button" data-action="start-review" data-key="${notebook.id}">
          <span class="row__tile ${notebook.tone}" aria-hidden="true">${esc(notebook.title.slice(0, 1))}</span>
          <span class="row__main">
            <span class="row__title">${esc(notebook.title)}</span>
            <span class="row__meta">${SL.plural(app.cardsOf(notebook.id).length, "card")} · ${SL.plural(count, "card")} due</span>
          </span>
          <span class="row__trail"><span class="badge">${count}</span>${icon("chevron", 18)}</span>
        </button>`;
      })
      .join("");

    const body = due.length
      ? `<div class="card--dark card" style="padding:22px">
          <p class="eyebrow">Due right now</p>
          <div class="hstack" style="align-items:flex-end;gap:10px;margin:6px 0 18px">
            <span style="font-family:var(--font-display);font-size:58px;line-height:.86;font-variant-numeric:tabular-nums">${due.length}</span>
            <span class="small" style="color:rgba(247,243,231,.7);padding-bottom:6px">cards ready<br />to review</span>
          </div>
          <p class="tiny muted">Review one notebook at a time — mixed subjects break the loop.</p>
        </div>
        <div class="section-head" style="margin-top:26px"><h2>By notebook</h2></div>
        <div class="rows">${rows}</div>`
      : `<div class="empty" style="border-style:solid;background:var(--surface)">
          <span class="row__tile tone-sage">${icon("check", 22)}</span>
          <p class="h3">All caught up</p>
          <p class="small">No cards are due right now. You can still practice ahead of schedule.</p>
          <button class="btn btn--secondary btn--sm" type="button" data-action="practice" data-key="all" style="display:none">Practice all cards</button>
        </div>`;

    return `<section class="screen has-tabbar">
      <div class="greet">
        <div class="greet__text">
          <p class="eyebrow">Spaced repetition</p>
          <h1 class="h1">Review</h1>
        </div>
      </div>
      <div class="px stack--16" style="margin-top:14px">
        ${body}
        <p class="tiny muted" style="margin-top:6px">${scheduled ? `${scheduled} cards are scheduled ahead. Grades follow Again 10m, Hard 1d, Good 3d, Easy 7d.` : "Grades follow Again 10m, Hard 1d, Good 3d, Easy 7d."}</p>
      </div>
    </section>`;
  };

  ui.library = function libraryScreen() {
    const app = SL.app;
    const state = app.state;
    const rows = state.notebooks.map(notebookRow).join("");
    return `<section class="screen has-tabbar">
      <div class="greet">
        <div class="greet__text">
          <p class="eyebrow">${state.notebooks.length} notebooks</p>
          <h1 class="h1">Library</h1>
        </div>
        <div class="greet__actions">
          <button class="icon-btn icon-btn--outline" type="button" data-action="new-notebook" aria-label="New notebook">${icon("plus")}</button>
        </div>
      </div>
      <div class="px stack--16" style="margin-top:14px">
        <p class="muted small text-pretty">Every notebook holds its own sources, chat, and card loop. Keep one per course.</p>
        <div class="rows">${rows || emptyNotebooks()}</div>
      </div>
    </section>`;
  };

  ui.settings = function settingsScreen() {
    const app = SL.app;
    const state = app.state;
    const name = state.user ? state.user.name : "Learner";
    const email = state.user ? state.user.email : "demo@studyloop.app";
    return `<section class="screen has-tabbar">
      <div class="greet">
        <div class="greet__text">
          <p class="eyebrow">Account</p>
          <h1 class="h1">Settings</h1>
        </div>
      </div>
      <div class="px stack--20" style="margin-top:14px">
        <div class="profile">
          <span class="avatar" aria-hidden="true">${esc(app.initialsOf(name))}</span>
          <div class="grow">
            <p class="profile__name">${esc(name)}</p>
            <p class="profile__mail">${esc(email)}</p>
          </div>
          <span class="chip chip--brand">${icon("flame", 13)} ${state.streak} day</span>
        </div>

        <section class="stack--8">
          <div class="section-head" style="margin-bottom:2px"><h2>AI</h2></div>
          <button class="setting-row" type="button" data-action="ai-key">
            <span class="setting-row__icon">${icon("key", 18)}</span>
            <span class="setting-row__main">
              <span class="setting-row__title">AI key</span>
              <span class="setting-row__sub">${state.settings.personalKey ? "Personal key active" : "Using the workspace key"}</span>
            </span>
            <span class="setting-row__trail">${state.settings.personalKey ? `<span class="chip chip--brand">On</span>` : ""}${icon("chevron", 18)}</span>
          </button>
        </section>

        <section class="stack--8">
          <div class="section-head" style="margin-bottom:2px"><h2>Data</h2></div>
          <button class="setting-row" type="button" data-action="reset-demo">
            <span class="setting-row__icon">${icon("rotate", 18)}</span>
            <span class="setting-row__main">
              <span class="setting-row__title">Reset demo data</span>
              <span class="setting-row__sub">Restore the three seeded notebooks</span>
            </span>
            <span class="setting-row__trail">${icon("chevron", 18)}</span>
          </button>
        </section>

        <button class="btn btn--danger btn--block" type="button" data-action="logout">${icon("logout", 17)} Sign out</button>
        <p class="tiny muted center">StudyLoop mockup · v1.0 · Local storage only</p>
      </div>
    </section>`;
  };

  function notFoundScreen() {
    return `<section class="screen">
      <div class="topbar">
        <button class="icon-btn" type="button" data-back aria-label="Back">${icon("back")}</button>
      </div>
      <div class="px">
        <div class="empty">
          <p class="h3">Notebook not found</p>
          <p class="small">It may have been deleted. Head back to your library.</p>
          <a class="btn btn--primary btn--sm" href="#/library">Open library</a>
        </div>
      </div>
    </section>`;
  }

  function sourceRow(source) {
    const kind = source.kind === "pdf" ? "pdf" : source.kind === "youtube" ? "youtube" : "text";
    const tone = kind === "pdf" ? "tone-butter" : kind === "youtube" ? "tone-sky" : "tone-sage";
    const glyph = kind === "pdf" ? "file" : kind === "youtube" ? "play" : "text";
    const label = kind === "pdf" ? "PDF" : kind === "youtube" ? "YouTube" : "Note";
    return `<div class="row source-row">
      <span class="row__tile ${tone}">${icon(glyph, 21)}</span>
      <span class="row__main">
        <span class="row__title">${esc(source.title)}</span>
        <span class="row__meta"><span class="source-row__sub">${label}<span class="dot"></span>${esc(source.meta)}</span></span>
      </span>
    </div>`;
  }

  function cardRow(card) {
    const state = SL.app.dueLabel(card);
    return `<div class="card-row">
      <div class="card-row__body">
        <p class="card-row__front">${esc(card.front)}</p>
        <p class="card-row__back">${esc(card.back)}</p>
      </div>
      <span class="card-row__state badge ${state.cls}">${state.text}</span>
    </div>`;
  }

  function messageBubble(message) {
    if (message.role === "user") {
      return `<div class="msg msg--user"><p>${esc(message.text)}</p></div>`;
    }
    const paras = message.text
      .split("\n\n")
      .map((part) => `<p>${esc(part)}</p>`)
      .join("");
    const cites = (message.cites || [])
      .map((title, index) => `<span class="cite"><b>[${index + 1}]</b> ${esc(title)}</span>`)
      .join("");
    return `<div class="msg msg--ai">
      <div class="msg__label">${icon("sparkle", 12, "i-sparkle")} StudyLoop</div>
      ${paras}
      ${cites ? `<div class="cites">${cites}</div>` : ""}
    </div>`;
  }

  function overviewPanel(notebook) {
    const app = SL.app;
    const sources = app.sourcesOf(notebook.id);
    const cards = app.cardsOf(notebook.id);
    const due = app.dueCards(notebook.id).length;
    const sourceRows = sources.map(sourceRow).join("");
    return `<div class="stack--16">
      <div class="card card--flat spread">
        <div>
          <p class="h3">${due ? `${SL.plural(due, "card")} due` : "No cards due"}</p>
          <p class="small muted">${SL.plural(cards.length, "card")} in this notebook · ${SL.plural(sources.length, "source")}</p>
        </div>
        <button class="btn btn--sm ${due ? "btn--primary" : "btn--secondary"}" type="button" data-action="start-review" data-key="${notebook.id}">${due ? "Review" : "Practice"}</button>
      </div>

      <section>
        <div class="section-head">
          <h2>Sources</h2>
          <button class="btn btn--sm btn--secondary" type="button" data-action="add-source" data-id="${notebook.id}">${icon("plus", 15)} Add</button>
        </div>
        ${sourceRows ? `<div class="rows">${sourceRows}</div>` : `<div class="empty"><p class="h3">No sources yet</p><p class="small">Add a PDF, paste your notes, or link a lecture.</p><button class="btn btn--secondary btn--sm" type="button" data-action="add-source" data-id="${notebook.id}">Add a source</button></div>`}
      </section>

      <div class="ai-note">${icon("sparkle", 16, "i-sparkle")} Open Chat to ask across all ${SL.plural(sources.length, "source")} — every answer cites its segment.</div>
    </div>`;
  }

  function chatPanel(notebook) {
    const app = SL.app;
    const sources = app.sourcesOf(notebook.id);
    const messages = app.chatOf(notebook.id);
    const suggestions = SL.SUGGESTIONS[notebook.title] || SL.GENERIC_SUGGESTIONS;
    const log = messages.length
      ? messages.map(messageBubble).join("")
      : `<div class="empty" style="border-style:solid;background:var(--surface)">
          <span class="row__tile tone-lilac">${icon("sparkle", 20, "i-sparkle")}</span>
          <p class="h3">Ask your notebook</p>
          <p class="small">Grounded in ${SL.plural(sources.length, "source")}. Answers cite the exact segment.</p>
        </div>`;
    const chips = messages.length
      ? ""
      : `<div class="suggest">${suggestions
          .map((question) => `<button type="button" data-action="suggest" data-q="${esc(question)}">${esc(question)}</button>`)
          .join("")}</div>`;
    return `<div class="stack--8">
      <div class="chat" id="chatLog" aria-live="polite">${log}</div>
      ${chips}
      <form class="composer" id="chatForm">
        <div class="composer__inner">
          <input id="chatQ" type="text" autocomplete="off" maxlength="500" placeholder="Ask about your sources…" aria-label="Ask a question" />
          <button class="icon-btn" type="submit" aria-label="Send question">${icon("send", 18)}</button>
        </div>
      </form>
    </div>`;
  }

  function cardsPanel(notebook) {
    const app = SL.app;
    const cards = app.cardsOf(notebook.id);
    const due = app.dueCards(notebook.id).length;
    const generating = app.generatingId() === notebook.id;
    const study = cards.filter(c => !c.generatedAt);
    const gen = cards.filter(c => c.generatedAt);
    const groupRows = (group) => group.map(cardRow).join("");
    const skeleton = `<div class="skeleton" style="height:68px"></div><div class="skeleton" style="height:68px"></div><div class="skeleton" style="height:68px"></div>`;
    const groups = [];
    if (study.length) groups.push({ label: `Study cards · ${study.length}`, items: study });
    if (gen.length) groups.push({ label: `Generated · ${gen.length}`, items: gen });
    const rendered = (gs) => gs.map(g => `<div class="stack--8"><h3 class="h4" style="margin-top:6px">${esc(g.label)}</h3>${groupRows(g.items)}</div>`).join("");
    return `<div class="stack--16">
      <div class="section-head" style="margin-bottom:0">
        <h2>Flashcards</h2>
        <span class="badge badge--neutral">${SL.plural(cards.length, "card")}</span>
      </div>
      <button class="btn btn--ai btn--block" type="button" data-action="generate-cards" data-id="${notebook.id}" ${generating ? "disabled" : ""}>
        ${icon("sparkle", 17, "i-sparkle")} ${generating ? "Reading sources…" : "Generate from sources"}
      </button>
      ${generating ? `<div class="processing"><div class="processing__row"><span class="spinner"></span> Scanning ${SL.plural(app.sourcesOf(notebook.id).length, "source")} and drafting cards…</div>${skeleton}</div>` : ""}
      ${!generating && !cards.length ? `<div class="empty"><p class="h3">No cards yet</p><p class="small">Generate a first set from your sources, then review them daily.</p></div>` : ""}
      ${!generating && cards.length ? `<div class="stack--8">${rendered(groups)}</div>` : ""}
      <div style="position:sticky;bottom:calc(12px + env(safe-area-inset-bottom));padding-top:6px">
        <button class="btn btn--primary btn--block" type="button" data-action="${due ? "start-review" : "practice"}" data-key="${notebook.id}">${due ? `Review ${SL.plural(due, "card")}` : "Practice all cards"}</button>
      </div>
    </div>`;
  }

  ui.notebookPanel = function notebookPanel(notebook, tab) {
    if (tab === "chat") return chatPanel(notebook);
    if (tab === "cards") return cardsPanel(notebook);
    return overviewPanel(notebook);
  };

  ui.notebook = function notebookScreen(id) {
    const app = SL.app;
    const notebook = app.notebookById(id);
    if (!notebook) return notFoundScreen();
    const tab = app.tabOf(notebook.id);
    const due = app.dueCards(notebook.id).length;
    const tabs = [
      ["overview", "Overview"],
      ["chat", "Chat"],
      ["cards", "Cards"],
    ];
    return `<section class="screen">
      <div class="topbar">
        <button class="icon-btn" type="button" data-back aria-label="Back">${icon("back")}</button>
        <span class="topbar__title grow">${esc(notebook.title)}</span>
        <button class="icon-btn" type="button" data-action="notebook-menu" data-id="${notebook.id}" aria-label="Notebook options">${icon("dots", 20, "i-dots")}</button>
      </div>

      <div class="nb-hero">
        <span class="nb-hero__badge ${notebook.tone}" aria-hidden="true">${esc(notebook.title.slice(0, 1))}</span>
        <div class="nb-hero__main">
          <h1 class="nb-hero__title">${esc(notebook.title)}</h1>
          <p class="nb-hero__meta">${SL.plural(app.sourcesOf(notebook.id).length, "source")} · ${SL.plural(app.cardsOf(notebook.id).length, "card")}${due ? ` · ${due} due` : ""}</p>
        </div>
      </div>

      <div class="px">
        <div class="segmented" role="tablist" aria-label="Notebook sections">
          ${tabs
            .map(
              ([value, label]) =>
                `<button type="button" role="tab" aria-selected="${tab === value}" class="${tab === value ? "is-active" : ""}" data-tab="${value}">${label}</button>`
            )
            .join("")}
        </div>
      </div>

      <div class="tabpanel px" id="tabpanel">${ui.notebookPanel(notebook, tab)}</div>
    </section>`;
  };
})(window.SL);
