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

  function adminAgo(iso) {
    if (!iso) return "Never";
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.round(days / 30)}mo ago`;
  }

  function adminDaysSince(iso) {
    return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity;
  }

  function adminDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function adminStatusOf(user) {
    if (user.status === "disabled") return "disabled";
    return adminDaysSince(user.lastActive) > 7 ? "risk" : "active";
  }

  function adminStatusChip(user) {
    const status = adminStatusOf(user);
    if (status === "disabled") return `<span class="chip chip--plain">Disabled</span>`;
    if (status === "risk") return `<span class="chip chip--accent">At risk</span>`;
    return `<span class="chip chip--brand">Active</span>`;
  }

  function adminBars(series, options) {
    const opts = options || {};
    const max = Math.max(1, ...series);
    const width = 560;
    const height = opts.height || 132;
    const gap = 6;
    const barWidth = (width - gap * (series.length - 1)) / series.length;
    const bars = series.map((value, index) => {
      const barHeight = Math.max(2, (value / max) * (height - 8));
      const x = index * (barWidth + gap);
      const y = height - barHeight;
      const recent = index >= series.length - 7;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2.5" fill="${recent ? "var(--brand)" : "var(--line-strong)"}"></rect>`;
    }).join("");
    return `<svg class="admin-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.label || "Trend")}">${bars}</svg>`;
  }

  function adminMetric(label, value, note, variant) {
    return `<article class="admin-kpi ${variant || ""}">
      <p class="eyebrow">${label}</p>
      <p class="admin-kpi__value">${value}</p>
      <p class="admin-kpi__note">${note}</p>
    </article>`;
  }

  function adminInsight(tone, glyph, title, detail, action) {
    return `<div class="admin-insight">
      <span class="admin-insight__icon ${tone}" aria-hidden="true">${icon(glyph, 16)}</span>
      <div class="grow">
        <strong>${title}</strong>
        <span>${detail}</span>
      </div>
      ${action || ""}
    </div>`;
  }

  ui.admin = function adminScreen() {
    const app = SL.app;
    const admin = app.adminState();
    const users = admin.users;
    const series = admin.series;
    const active = users.filter((user) => adminStatusOf(user) === "active").length;
    const atRisk = users.filter((user) => adminStatusOf(user) === "risk").length;
    const disabled = users.filter((user) => user.status === "disabled").length;
    const newThisMonth = users.filter((user) => adminDaysSince(user.joined) <= 30).length;
    const reviews7 = series.reviews.slice(-7).reduce((sum, n) => sum + n, 0);
    const prior7 = series.reviews.slice(-14, -7).reduce((sum, n) => sum + n, 0);
    const reviewDelta = prior7 ? Math.round(((reviews7 - prior7) / prior7) * 100) : 0;
    const signups7 = series.signups.slice(-7).reduce((sum, n) => sum + n, 0);
    const priorSignups = series.signups.slice(-14, -7).reduce((sum, n) => sum + n, 0);
    const signupDelta = priorSignups ? Math.round(((signups7 - priorSignups) / priorSignups) * 100) : 0;
    const aiCalls = users.reduce((sum, user) => sum + user.aiCalls, 0);
    const aiPct = Math.min(100, Math.round((aiCalls / admin.aiCap) * 100));
    const activePct = users.length ? Math.round((active / users.length) * 100) : 0;
    const adminUi = app.adminUiState;
    const query = adminUi.query || "";
    const roleFilter = adminUi.role || "all";
    const statusFilter = adminUi.status || "all";
    const selected = adminUi.user ? users.find((user) => user.id === Number(adminUi.user)) : null;
    const option = (value, label, current) => `<option value="${value}"${current === value ? " selected" : ""}>${label}</option>`;

    const rows = users.map((user, index) => {
      const status = adminStatusOf(user);
      const tone = SL.TONES[index % SL.TONES.length];
      return `<tr class="admin-user" data-user-row data-action="admin-user" data-id="${user.id}" data-name="${esc(user.name.toLowerCase())}" data-email="${esc(user.email.toLowerCase())}" data-role="${user.role}" data-status="${user.status}" data-risk="${status === "risk" ? "1" : "0"}" data-courses="${esc(user.courses.join(" ").toLowerCase())}" tabindex="0" role="button" aria-label="View ${esc(user.name)}">
        <td>
          <span class="admin-user__person">
            <span class="avatar avatar--sm ${tone}" aria-hidden="true">${esc(app.initialsOf(user.name))}</span>
            <span>
              <span class="admin-user__name">${esc(user.name)}</span>
              <span class="admin-user__email">${esc(user.email)}</span>
            </span>
          </span>
        </td>
        <td class="admin-col-role">${user.role === "admin" ? "Admin" : "Member"}</td>
        <td>${adminStatusChip(user)}</td>
        <td class="admin-user__muted">${adminAgo(user.lastActive)}</td>
        <td class="admin-col-reviews admin-user__num">${user.reviews7d}</td>
        <td class="admin-col-ai admin-user__num">${user.aiCalls}</td>
      </tr>`;
    }).join("");

    const insights = [
      adminInsight(
        "tone-butter",
        "clock",
        `${SL.plural(atRisk, "learner")} idle 7+ days`,
        "Their loop has gone quiet. Check in or review access.",
        `<button class="btn btn--ghost btn--sm" type="button" data-action="admin-filter" data-filter="risk">View</button>`
      ),
      adminInsight(
        "tone-rose",
        "eye",
        `${SL.plural(disabled, "account")} disabled`,
        "Access stays blocked until re-enabled.",
        `<button class="btn btn--ghost btn--sm" type="button" data-action="admin-filter" data-filter="disabled">View</button>`
      ),
      adminInsight(
        "tone-sage",
        "plus",
        `${SL.plural(signups7, "signup")} this week`,
        `${signupDelta >= 0 ? "Up" : "Down"} ${Math.abs(signupDelta)}% from the prior week.`,
        ""
      ),
    ].join("");

    return `<section class="screen screen--admin">
      <div class="admin${selected ? " has-detail" : ""}">
        <aside class="admin__side">
          <div class="admin__brand">
            <span class="admin__mark" aria-hidden="true">${icon("layers", 18)}</span>
            <span class="admin__brand-text"><strong>StudyLoop</strong><span>Admin</span></span>
          </div>
          <nav class="admin__nav" aria-label="Admin sections">
            <button class="admin__nav-item is-active" type="button" data-action="admin-scroll" data-target="adminTop">${icon("home", 18)}<span>Overview</span></button>
            <button class="admin__nav-item" type="button" data-action="admin-scroll" data-target="adminUsers">${icon("library", 18)}<span>Users</span></button>
            <button class="admin__nav-item" type="button" data-action="admin-scroll" data-target="adminUsage">${icon("key", 18)}<span>Usage</span></button>
          </nav>
          <div class="admin__side-foot">
            <a class="admin__nav-item" href="#/home" data-nav="#/home">${icon("back", 18)}<span>Back to app</span></a>
            <button class="admin__nav-item" type="button" data-action="logout">${icon("logout", 18)}<span>Sign out</span></button>
            <p class="admin__side-user">${esc(app.state.user ? app.state.user.email : "demo@studyloop.app")}</p>
          </div>
        </aside>

        <div class="admin__main">
          <header class="admin__top" id="adminTop">
            <div>
              <p class="eyebrow">Admin workspace</p>
              <h1 class="h1">Dashboard</h1>
              <p class="small muted">${SL.plural(users.length, "learner")} · mock data, changes stay in this browser</p>
            </div>
            <div class="admin__top-actions">
              <span class="chip chip--plain">Mock data</span>
              <span class="avatar avatar--sm" aria-hidden="true">${esc(app.state.user ? app.initialsOf(app.state.user.name) : "AD")}</span>
            </div>
          </header>

          <div class="admin__scroll">
            <section class="admin-kpis" aria-label="Key metrics">
              ${adminMetric("Total users", users.length, `+${newThisMonth} this month`)}
              ${adminMetric("Active learners", active, `${activePct}% active in the last 7 days`)}
              ${adminMetric("Reviews · 7d", reviews7, `${reviewDelta >= 0 ? "+" : ""}${reviewDelta}% vs prior week`)}
              ${adminMetric("At risk", atRisk, "No activity in 7+ days", "admin-kpi--warn")}
            </section>

            <div class="admin-grid">
              <section class="admin-card" id="adminUsage">
                <div class="admin-card__head">
                  <div>
                    <p class="eyebrow">Engagement</p>
                    <h2 class="h3">Reviews per day</h2>
                  </div>
                  <div class="admin-legend">
                    <span><i></i>Last 7 days</span>
                    <span><i class="is-muted"></i>Prior</span>
                  </div>
                </div>
                ${adminBars(series.reviews, { label: "Reviews per day over the last 14 days" })}
                <div class="admin-chart__axis"><span>14 days ago</span><span>Today</span></div>
                <div class="admin-chart__foot">
                  <div><strong>${reviews7}</strong><span>reviews this week</span></div>
                  <div><strong>${reviewDelta >= 0 ? "+" : ""}${reviewDelta}%</strong><span>vs prior week</span></div>
                  <div><strong>${aiCalls}</strong><span>AI calls this month</span></div>
                </div>
              </section>

              <section class="admin-card admin-attention">
                <div class="admin-card__head">
                  <div>
                    <p class="eyebrow">Action queue</p>
                    <h2 class="h3">Needs attention</h2>
                  </div>
                  <span class="badge badge--neutral">${atRisk + disabled}</span>
                </div>
                <div class="admin-insights">${insights}</div>
                <div class="admin-usage">
                  <div class="admin-usage__row">
                    <span class="small"><strong>AI key usage</strong></span>
                    <span class="small num">${aiCalls} / ${admin.aiCap}</span>
                  </div>
                  <div class="admin-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${aiPct}" aria-label="AI key usage">
                    <span style="width:${aiPct}%"></span>
                  </div>
                  <p class="tiny muted">${aiPct}% of the monthly shared key budget.</p>
                </div>
              </section>
            </div>

            <section class="admin-card admin-users" id="adminUsers">
              <div class="admin-users__head">
                <div>
                  <p class="eyebrow">Directory</p>
                  <h2 class="h3">Users</h2>
                </div>
                <span class="admin-count" id="adminCount">${users.length} of ${users.length} users</span>
              </div>
              <div class="admin-toolbar">
                <label class="admin-search">
                  <span class="sr-only">Search users</span>
                  ${icon("search", 16)}
                  <input class="input" id="adminSearch" type="search" placeholder="Search name, email, or course" value="${esc(query)}" autocomplete="off" />
                </label>
                <label class="sr-only" for="adminRole">Filter by role</label>
                <select class="admin-select" id="adminRole">
                  ${option("all", "All roles", roleFilter)}
                  ${option("admin", "Admins", roleFilter)}
                  ${option("member", "Members", roleFilter)}
                </select>
                <label class="sr-only" for="adminStatus">Filter by status</label>
                <select class="admin-select" id="adminStatus">
                  ${option("all", "All statuses", statusFilter)}
                  ${option("active", "Active", statusFilter)}
                  ${option("risk", "At risk", statusFilter)}
                  ${option("disabled", "Disabled", statusFilter)}
                </select>
              </div>
              <div class="admin-table-wrap">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col" class="admin-col-role">Role</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last active</th>
                      <th scope="col" class="admin-col-reviews">Reviews 7d</th>
                      <th scope="col" class="admin-col-ai">AI calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                    <tr id="adminNoResults" hidden><td colspan="6" class="admin-empty">No users match those filters.</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>

        <aside class="admin-detail" id="adminDetail" aria-hidden="${selected ? "false" : "true"}" aria-label="User details">
          ${selected ? ui.adminDetail(selected.id) : ""}
        </aside>
      </div>
    </section>`;
  };

  ui.adminDetail = function adminDetail(id) {
    const app = SL.app;
    const user = app.adminUserById(id);
    if (!user) return "";
    const status = adminStatusOf(user);
    const courses = user.courses.map((course) => `<span class="chip">${esc(course)}</span>`).join("");
    const weeklyTarget = 60;
    const weeklyPct = Math.min(100, Math.round((user.reviews7d / weeklyTarget) * 100));
    return `<div class="admin-detail__head">
        <div class="admin-detail__id">
          <span class="avatar" aria-hidden="true">${esc(app.initialsOf(user.name))}</span>
          <div>
            <h2 class="h2">${esc(user.name)}</h2>
            <p class="small muted">${esc(user.email)}</p>
          </div>
        </div>
        <button class="icon-btn" type="button" data-action="admin-close-user" aria-label="Close user details">${icon("close")}</button>
      </div>
      <div class="admin-detail__badges">
        ${adminStatusChip(user)}
        <span class="chip chip--plain">${user.role === "admin" ? "Admin" : "Member"}</span>
        <span class="chip chip--plain">${user.plan === "pro" ? "Pro plan" : "Free plan"}</span>
      </div>
      <div class="admin-detail__meta">
        <div><span class="eyebrow">Joined</span><strong>${adminDate(user.joined)}</strong></div>
        <div><span class="eyebrow">Last active</span><strong>${adminAgo(user.lastActive)}</strong></div>
      </div>
      <div class="admin-detail__stats">
        <div class="admin-stat"><strong>${user.notebooks}</strong><span>notebooks</span></div>
        <div class="admin-stat"><strong>${user.sources}</strong><span>sources</span></div>
        <div class="admin-stat"><strong>${user.cards}</strong><span>cards</span></div>
        <div class="admin-stat"><strong>${user.reviews}</strong><span>reviews all time</span></div>
      </div>
      <div class="admin-detail__block">
        <div class="section-head"><h3 class="h3">This week</h3><span class="small muted">${user.reviews7d} reviews · ${user.aiCalls7d} AI</span></div>
        <div class="admin-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${weeklyPct}" aria-label="Weekly review progress">
          <span style="width:${weeklyPct}%"></span>
        </div>
        <p class="tiny muted">${user.reviews7d ? `${weeklyPct}% of a 60-review week.` : "No reviews in the last 7 days."}</p>
      </div>
      <div class="admin-detail__block">
        <p class="eyebrow">Courses</p>
        <div class="admin-chips">${courses || `<span class="small muted">No notebooks yet.</span>`}</div>
      </div>
      <div class="admin-detail__actions">
        <button class="btn btn--secondary btn--sm" type="button" data-action="admin-reset-password" data-id="${user.id}">${icon("key", 15)} Reset password</button>
        <button class="btn btn--ghost btn--sm" type="button" data-action="admin-toggle-status" data-id="${user.id}">
          ${status === "disabled" ? `${icon("check", 15)} Enable account` : `${icon("eye", 15)} Disable account`}
        </button>
        <button class="btn btn--danger btn--sm" type="button" data-action="admin-delete-user" data-id="${user.id}">${icon("trash", 15)} Delete user</button>
      </div>`;
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
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span class="small" style="color:rgba(247,243,231,.76)">${due ? `${SL.plural(due, "card")} due today` : "All caught up"}</span>
              <a class="btn btn--ai btn--sm" href="#/library" aria-label="Generate flashcards">${icon("sparkle", 14)} Generate flashcards</a>
            </div>
            <a class="btn btn--sm btn--outline" href="${due ? "#/review" : "#/library"}" style="margin-top:8px">${due ? "Review" : "Add material"} ${icon("arrow", 16)}</a>
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
