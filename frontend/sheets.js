window.SL = window.SL || {};
SL.ui = SL.ui || {};

(function (SL) {
  "use strict";

  const esc = SL.esc;
  const icon = SL.icon;
  const ui = SL.ui;

  function sheet(options) {
    const formId = options.formId || "";
    const body = formId ? `<form id="${formId}" class="sheet__body">${options.body}</form>` : `<div class="sheet__body">${options.body}</div>`;
    return `<div class="sheet-scrim" data-action="close-sheet"></div>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
        <div class="sheet__grab" aria-hidden="true"></div>
        <div class="sheet__head">
          <div>
            <h2 class="sheet__title" id="sheetTitle">${options.title}</h2>
            ${options.sub ? `<p class="sheet__sub">${options.sub}</p>` : ""}
          </div>
          <button class="icon-btn" type="button" data-action="close-sheet" aria-label="Close">${icon("close")}</button>
        </div>
        ${body}
        <div class="sheet__foot">${options.foot || ""}</div>
      </div>`;
  }

  ui.generateSourceSheet = function (notebookId, sources) {
    const checks = sources.map((s, i) =>
      `<label class="field"><input type="checkbox" class="check" data-source-id="${s.id}" checked /><span>${esc(s.title)}</span></label>`
    ).join("");
    return sheet({
      title: "Generate cards",
      sub: "Choose sources to draw from.",
      body: `<div class="stack gap-2">${checks}</div>`,
      foot: `<button class="btn btn--primary btn--block" type="button" data-action="generate-cards-confirm">Generate</button>`,
      formId: "generateSourceForm"
    });
  };

  ui.newNotebookSheet = function () {
    return sheet({
      title: "New notebook",
      sub: "One notebook per course works best.",
      formId: "newNotebookForm",
      body: `<div class="field">
          <label class="label" for="nbTitle">Notebook title</label>
          <input class="input" id="nbTitle" name="title" type="text" maxlength="120" placeholder="e.g. Organic Chemistry" required />
        </div>
        <p class="hint">You can add PDFs, pasted notes, and lecture links once it exists.</p>`,
      foot: `<button class="btn btn--primary btn--block" type="submit" form="newNotebookForm">Create notebook</button>`,
    });
  };

  function kindButton(kind, title, sub, glyph, tone, selected) {
    return `<button class="kind ${selected ? "is-selected" : ""}" type="button" data-action="pick-kind" data-kind="${kind}" aria-pressed="${selected}">
      <span class="kind__tile ${tone}">${icon(glyph, 19)}</span>
      <span class="grow">
        <span class="kind__title" style="display:block">${title}</span>
        <span class="kind__sub" style="display:block">${sub}</span>
      </span>
      ${selected ? icon("check", 18) : ""}
    </button>`;
  }

  function addSourceFields(state) {
    if (state.addKind === "text") {
      return `<div class="field">
          <label class="label" for="srcTitle">Title</label>
          <input class="input" id="srcTitle" name="title" type="text" maxlength="120" placeholder="Lecture notes" />
        </div>
        <div class="field">
          <label class="label" for="srcText">Paste text</label>
          <textarea class="textarea" id="srcText" name="text" placeholder="Paste any study material here" required></textarea>
        </div>`;
    }
    if (state.addKind === "youtube") {
      return `<div class="field">
          <label class="label" for="ytUrl">YouTube URL</label>
          <input class="input" id="ytUrl" name="url" type="url" placeholder="https://www.youtube.com/watch?v=…" required />
        </div>
        <p class="hint">The transcript is fetched server-side, then split into searchable chunks.</p>`;
    }
    return `<div class="field">
        <label class="label" for="pdfFile">PDF file</label>
        <input class="input" id="pdfFile" name="file" type="file" accept="application/pdf,.pdf" style="padding:10px" />
      </div>
      <p class="hint" id="fileName">${state.addFile ? esc(state.addFile) : "No file selected · up to 100 pages, 40 MB"}</p>`;
  }

  ui.addSourceSheet = function () {
    const app = SL.app;
    const state = app.sheetState();
    const notebook = app.notebookById(state.sheetNotebook);
    const busy = state.addBusy;
    const kinds = [
      kindButton("pdf", "PDF", "Lecture slides, textbook chapters", "file", "tone-butter", state.addKind === "pdf"),
      kindButton("text", "Paste text", "Notes, summaries, transcripts", "text", "tone-sage", state.addKind === "text"),
      kindButton("youtube", "YouTube", "Transcript from a lecture link", "play", "tone-sky", state.addKind === "youtube"),
    ].join("");

    const processing = busy
      ? `<div class="processing">
          <div class="processing__row"><span class="spinner"></span> ${state.addKind === "pdf" ? "Extracting pages and indexing" : state.addKind === "youtube" ? "Fetching transcript" : "Chunking and indexing"}</div>
          <div class="processing__row">${icon("check", 15)} Chunks will be searchable from Chat</div>
        </div>`
      : "";

    const actionLabel = state.addKind === "pdf" ? "Add PDF" : state.addKind === "youtube" ? "Add transcript" : "Save source";
    const canSubmit = state.addKind === "pdf" ? Boolean(state.addFile) : true;

    return sheet({
      title: "Add a source",
      sub: notebook ? esc(notebook.title) : "",
      formId: "addSourceForm",
      body: `<div class="kind-list">${kinds}</div>
        <div class="stack--8" style="margin-top:4px">${addSourceFields(state)}</div>
        ${state.addError ? `<p class="form-error" role="alert">${esc(state.addError)}</p>` : ""}
        ${processing}`,
      foot: `<button class="btn btn--primary btn--block" type="submit" form="addSourceForm" ${busy || !canSubmit ? "disabled" : ""}>${busy ? "Working…" : actionLabel}</button>
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-action="close-sheet">Cancel</button>`,
    });
  };

  ui.notebookMenuSheet = function (notebookId) {
    const notebook = SL.app.notebookById(notebookId);
    if (!notebook) return "";
    return sheet({
      title: esc(notebook.title),
      sub: "Notebook actions",
      body: `<div class="stack--8">
          <button class="setting-row" type="button" data-action="add-source" data-id="${notebook.id}">
            <span class="setting-row__icon">${icon("plus", 18)}</span>
            <span class="setting-row__main"><span class="setting-row__title">Add a source</span><span class="setting-row__sub">PDF, paste, or YouTube</span></span>
            <span class="setting-row__trail">${icon("chevron", 18)}</span>
          </button>
          <button class="setting-row" type="button" data-action="generate-cards" data-id="${notebook.id}">
            <span class="setting-row__icon">${icon("sparkle", 18, "i-sparkle")}</span>
            <span class="setting-row__main"><span class="setting-row__title">Generate flashcards</span><span class="setting-row__sub">From every indexed source</span></span>
            <span class="setting-row__trail">${icon("chevron", 18)}</span>
          </button>
          <button class="setting-row" type="button" data-action="start-review" data-key="${notebook.id}">
            <span class="setting-row__icon">${icon("review", 18)}</span>
            <span class="setting-row__main"><span class="setting-row__title">Start review</span><span class="setting-row__sub">${SL.plural(SL.app.dueCards(notebook.id).length, "card")} due now</span></span>
            <span class="setting-row__trail">${icon("chevron", 18)}</span>
          </button>
          <button class="setting-row" type="button" data-action="delete-notebook" data-id="${notebook.id}" style="color:#a63a17">
            <span class="setting-row__icon" style="background:var(--accent-soft);color:#a63a17">${icon("trash", 18)}</span>
            <span class="setting-row__main"><span class="setting-row__title">Delete notebook</span><span class="setting-row__sub">Removes sources, chat, and cards</span></span>
          </button>
        </div>`,
      foot: `<button class="btn btn--ghost btn--sm btn--block" type="button" data-action="close-sheet">Close</button>`,
    });
  };

  ui.keySheet = function () {
    const state = SL.app.state;
    return sheet({
      title: "AI key",
      sub: state.settings.personalKey ? "A personal key is active" : "Using the workspace key",
      formId: "keyForm",
      body: `<div class="field">
          <label class="label" for="groqKey">Groq API key</label>
          <input class="input" id="groqKey" name="key" type="password" autocomplete="off" placeholder="gsk_…" required />
        </div>
        <p class="hint">The real app encrypts this server-side with AES-GCM. This mockup only stores a flag locally.</p>`,
      foot: `<button class="btn btn--primary btn--block" type="submit" form="keyForm">Save key</button>
        ${state.settings.personalKey ? `<button class="btn btn--danger btn--block" type="button" data-action="clear-key">Remove personal key</button>` : ""}
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-action="close-sheet">Cancel</button>`,
    });
  };

  ui.confirmSheet = function (options) {
    return sheet({
      title: esc(options.title),
      sub: options.sub ? esc(options.sub) : "",
      body: `<p class="small text-pretty" style="color:var(--ink-2)">${esc(options.body)}</p>`,
      foot: `<button class="btn ${options.danger === false ? "btn--primary" : "btn--danger"} btn--block" type="button" data-action="confirm">${esc(options.label)}</button>
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-action="close-sheet">Cancel</button>`,
    });
  };
})(window.SL);
