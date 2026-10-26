window.SL = window.SL || {};
SL.ui = SL.ui || {};

(function (SL) {
  "use strict";

  const esc = SL.esc;
  const icon = SL.icon;
  const ui = SL.ui;

  function header(session) {
    const total = session.queue.length;
    const done = session.finished ? total : Math.min(session.index, total);
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `<div class="session-top">
      <button class="icon-btn" type="button" data-action="end-session" aria-label="End review">${icon("close")}</button>
      <div class="session-top__mid">
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Review progress">
          <div class="progress__fill" style="width:${pct}%"></div>
        </div>
        <p class="session-top__count">${session.finished ? `${total} of ${total}` : `${Math.min(session.index + 1, total)} of ${total}`} · ${esc(session.label)}</p>
      </div>
      <span style="width:44px" aria-hidden="true"></span>
    </div>`;
  }

  function emptySession(session) {
    return `<section class="screen screen--fixed">
      ${header(session)}
      <div class="summary">
        <span class="row__tile tone-sage" style="width:56px;height:56px;border-radius:18px">${icon("check", 26)}</span>
        <h1 class="h1">Nothing due</h1>
        <p class="muted small text-pretty" style="max-width:280px">No cards are due in ${esc(session.label)} right now. Practice ahead to keep the loop warm.</p>
        <button class="btn btn--secondary" type="button" data-action="practice" data-key="${esc(session.key)}">Practice all cards</button>
        <button class="btn btn--ghost btn--sm" type="button" data-action="end-session">Back to review</button>
      </div>
    </section>`;
  }

  function summaryScreen(session) {
    const again = session.grades.again || 0;
    const solid = (session.grades.good || 0) + (session.grades.easy || 0);
    const accuracy = session.reviewed ? Math.round((solid / session.reviewed) * 100) : 0;
    return `<section class="screen screen--fixed">
      ${header(session)}
      <div class="summary">
        ${SL.app.ring(1, { size: 132, stroke: 8, light: true, value: String(session.reviewed), label: "reviewed" })}
        <h1 class="h1">Loop closed.</h1>
        <p class="muted small text-pretty" style="max-width:280px">Every card has a next due date. Come back tomorrow to keep the streak alive.</p>
        <div class="summary__stats">
          <div class="summary__stat"><strong>${session.reviewed}</strong><span>cards reviewed</span></div>
          <div class="summary__stat"><strong>${SL.app.state.streak}</strong><span>day streak</span></div>
          <div class="summary__stat"><strong>${accuracy}%</strong><span>good or easy</span></div>
        </div>
        ${again ? `<p class="tiny muted">${SL.plural(again, "card")} marked Again will return in 10 minutes.</p>` : ""}
        <button class="btn btn--primary btn--block" type="button" data-action="session-done">Back to today</button>
        <button class="btn btn--ghost btn--sm btn--block" type="button" data-action="end-session">Review hub</button>
      </div>
    </section>`;
  }

  function currentCard(session) {
    const entry = session.queue[session.index];
    if (!entry) return null;
    return SL.app.cardForEntry(entry);
  }

  function flashScreen(session) {
    const card = currentCard(session);
    if (!card) return emptySession(session);
    const notebook = SL.app.notebookById(card.notebookId);
    const revealed = session.revealed;
    const prompt = `<p class="eyebrow">Prompt</p>
      <p class="flash__prompt">${esc(card.front)}</p>
      <p class="flash__hint">${icon("eye", 14)} Tap to reveal</p>`;
    const answer = `<div class="flash__back">
        <p class="eyebrow">Answer</p>
        <p class="flash__answer">${esc(card.back)}</p>
        <p class="flash__source">From ${esc(card.source)} · ${esc(notebook ? notebook.title : "Notebook")}</p>
      </div>`;
    const cues = `<div class="swipe-cues" aria-hidden="true">
        <span class="swipe-cue swipe-cue--again" data-cue="again">Again</span>
        <span class="swipe-cue swipe-cue--good" data-cue="good">Good</span>
        <span class="swipe-cue swipe-cue--easy" data-cue="easy">Easy</span>
        <span class="swipe-cue swipe-cue--hard" data-cue="hard">Hard</span>
      </div>`;

    return `<section class="screen screen--fixed">
      ${header(session)}
      <div class="flash-wrap">
        ${revealed ? cues : ""}
        <button class="flash${revealed ? " flash--swipe" : ""}" type="button" data-action="${revealed ? "noop" : "reveal"}" aria-label="${revealed ? "Answer revealed" : "Reveal answer"}">
          ${revealed ? answer : prompt}
          ${revealed ? `<p class="flash__hint">${icon("rotate", 14)} Swipe or tap a grade</p>` : ""}
        </button>
      </div>
      ${
        revealed
          ? `<div class="grades" aria-label="Grade this card">
              <button class="grade grade--again" type="button" data-action="grade" data-grade="again"><span>Again</span><small>10 min</small></button>
              <button class="grade grade--hard" type="button" data-action="grade" data-grade="hard"><span>Hard</span><small>1 day</small></button>
              <button class="grade grade--good" type="button" data-action="grade" data-grade="good"><span>Good</span><small>3 days</small></button>
              <button class="grade grade--easy" type="button" data-action="grade" data-grade="easy"><span>Easy</span><small>7 days</small></button>
            </div>
            <p class="tiny muted center" style="padding-bottom:calc(10px + env(safe-area-inset-bottom))">Swipe card · tap a grade · 1–4</p>`
          : `<p class="tiny muted center" style="padding:0 20px calc(20px + env(safe-area-inset-bottom))">Tap card or press Space</p>`
      }
    </section>`;
  }

  ui.session = function sessionScreen(key) {
    const session = SL.app.ensureSession(key);
    if (session.finished) return summaryScreen(session);
    if (!session.queue.length) return emptySession(session);
    return flashScreen(session);
  };
})(window.SL);
