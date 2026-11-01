(function (SL) {
  "use strict";

  const STORAGE_KEY = "studyloop.mock.v1";
  const view = document.getElementById("view");
  const tabbar = document.getElementById("tabbar");
  const sheetRoot = document.getElementById("sheetRoot");
  const toasts = document.getElementById("toasts");

  let state = loadState();
  let currentRoute = null;
  let lastRoute = null;
  let sessionState = null;
  let practiceKey = null;
  let confirmCallback = null;
  let sheetOpen = false;
  let lastFocused = null;
  let renderToken = 0;
  let swapChain = Promise.resolve();
  let toastTimer = null;

  const ui = {
    tabs: {},
    generating: null,
    addKind: "pdf",
    addFile: null,
    addBusy: false,
    addError: null,
    sheetNotebook: null,
    adminQuery: "",
    adminRole: "all",
    adminStatus: "all",
    adminUser: null,
  };

  const app = (SL.app = {});

  Object.defineProperty(app, "state", { get: () => state });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.notebooks)) {
          parsed.sources = parsed.sources || {};
          parsed.cards = parsed.cards || {};
          parsed.chats = parsed.chats || {};
          parsed.generated = parsed.generated || {};
          parsed.settings = parsed.settings || { personalKey: false };
          parsed.streak = parsed.streak || 0;
          parsed.reviewedToday = parsed.reviewedToday || 0;
          parsed.admin = parsed.admin && Array.isArray(parsed.admin.users) ? parsed.admin : SL.adminSeed();
          return parsed;
        }
      }
    } catch {}
    return SL.seed();
  }

  async function syncStateFromDB() {
    try {
      const res = await fetch("http://localhost:3000/api/notebooks");
      if (!res.ok) return;
      const notebooks = await res.json();
      const cards = {};
      const sources = {};
      for (const nb of notebooks) {
        const srcRes = await fetch(`http://localhost:3000/api/notebooks/${nb.id}/sources`);
        if (srcRes.ok) sources[nb.id] = await srcRes.json();
        const cardRes = await fetch(`http://localhost:3000/api/notebooks/${nb.id}/cards`);
        if (cardRes.ok) cards[nb.id] = await cardRes.json();
      }
      state = {
        user: state.user || { email: "demo@studyloop.app", name: "Ada Lovelace" },
        streak: state.streak || 0,
        reviewedToday: state.reviewedToday || 0,
        notebooks,
        sources,
        cards,
        chats: state.chats || {},
        generated: state.generated || {},
        settings: state.settings || { personalKey: false },
        admin: state.admin || SL.adminSeed(),
      };
      save();
      render({ instant: false });
    } catch (e) {
      console.warn("DB sync skipped", e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast("Could not save locally");
    }
  }

  function notebookById(id) {
    return state.notebooks.find((notebook) => notebook.id === Number(id)) || null;
  }

  function adminState() {
    if (!state.admin || !Array.isArray(state.admin.users)) state.admin = SL.adminSeed();
    return state.admin;
  }

  function adminUserById(id) {
    return adminState().users.find((user) => user.id === Number(id)) || null;
  }

  const sourcesOf = (id) => state.sources[id] || [];
  const cardsOf = (id) => state.cards[id] || [];
  const chatOf = (id) => state.chats[id] || [];

  function allCards() {
    return state.notebooks.flatMap((notebook) =>
      cardsOf(notebook.id).map((card) => ({ notebookId: notebook.id, card }))
    );
  }

  function dueCards(notebookId) {
    const now = Date.now();
    const pool =
      notebookId == null
        ? allCards()
        : cardsOf(notebookId).map((card) => ({ notebookId: Number(notebookId), card }));
    return pool.filter((entry) => new Date(entry.card.due).getTime() <= now);
  }

  function cardForEntry(entry) {
    const card = cardsOf(entry.notebookId).find((item) => item.id === entry.cardId);
    return card ? { ...card, notebookId: entry.notebookId } : null;
  }

  function mastery() {
    const cards = allCards().map((entry) => entry.card);
    if (!cards.length) return 0;
    const score = cards.reduce((sum, card) => sum + SL.clamp(card.state || 0, 0, 3) / 3, 0);
    return Math.round((score / cards.length) * 100);
  }

  function initialsOf(name) {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function todayLabel() {
    const now = new Date();
    const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
    const month = now.toLocaleDateString("en-GB", { month: "long" });
    return `${weekday}, ${now.getDate()} ${month}`;
  }

  function dueLabel(card) {
    const diff = new Date(card.due).getTime() - Date.now();
    if (diff <= 0) return { text: "Due", cls: "" };
    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return { text: `${minutes}m`, cls: "badge--neutral" };
    const hours = Math.round(diff / 3600000);
    if (hours < 24) return { text: `${hours}h`, cls: "badge--neutral" };
    return { text: `${Math.round(diff / 86400000)}d`, cls: "badge--neutral" };
  }

  function ring(pct, options) {
    const opts = options || {};
    const size = opts.size || 88;
    const stroke = opts.stroke || 7;
    const light = Boolean(opts.light);
    const value = opts.value != null ? opts.value : `${Math.round(SL.clamp(pct, 0, 1) * 100)}%`;
    const label = opts.label || "complete";
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - SL.clamp(pct, 0, 1));
    return `<div class="ring ${light ? "ring--light" : ""}" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${stroke}"/>
        <circle class="ring__bar" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${stroke}" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
      </svg>
      <span class="ring__value"><strong>${value}</strong><span>${label}</span></span>
    </div>`;
  }

  const tabOf = (id) => ui.tabs[id] || "overview";
  const generatingId = () => ui.generating;
  const sheetState = () => ui;

  function parseRoute() {
    const raw = location.hash.replace(/^#/, "") || "/home";
    const path = raw.split("?")[0];
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "login") return { name: "login", depth: 0, routeKey: "login" };
    if (parts[0] === "notebook" && parts[1]) {
      return { name: "notebook", id: Number(parts[1]), depth: 2, routeKey: `notebook:${parts[1]}` };
    }
    if (parts[0] === "session" && parts[1]) {
      return { name: "session", sessionKey: parts[1], depth: 3, routeKey: `session:${parts[1]}` };
    }
    if (parts[0] === "review") return { name: "review", depth: 1, routeKey: "review" };
    if (parts[0] === "library") return { name: "library", depth: 1, routeKey: "library" };
    if (parts[0] === "admin") return { name: "admin", depth: 1, routeKey: "admin" };
    if (parts[0] === "settings") return { name: "settings", depth: 1, routeKey: "settings" };
    return { name: "home", depth: 1, routeKey: "home" };
  }

  function go(path) {
    const target = path.startsWith("#") ? path : `#${path}`;
    if (location.hash === target) {
      render();
      return;
    }
    location.hash = target;
  }

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else go("#/home");
  }

  function directionFor(route) {
    if (!lastRoute) return "fade";
    if (route.routeKey === lastRoute.routeKey) return "none";
    if (route.depth > lastRoute.depth) return "push";
    if (route.depth < lastRoute.depth) return "pop";
    return "fade";
  }

  function animateOnce(el, timeout) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("animationend", onEnd);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target === el) finish();
      };
      el.addEventListener("animationend", onEnd);
      setTimeout(finish, timeout || 600);
    });
  }

  function swap(markup, dir) {
    const oldScreen = view.querySelector(".screen");
    const next = SL.htmlToEl(markup);
    if (!oldScreen || dir === "none") {
      view.replaceChildren(next);
      return Promise.resolve();
    }
    if (dir === "push") {
      oldScreen.style.zIndex = "1";
      oldScreen.style.pointerEvents = "none";
      next.style.zIndex = "2";
      next.classList.add("screen--push-in");
      view.append(next);
      return animateOnce(next).then(() => {
        oldScreen.remove();
        next.classList.remove("screen--push-in");
        next.style.zIndex = "";
      });
    }
    if (dir === "pop") {
      oldScreen.style.zIndex = "2";
      oldScreen.style.pointerEvents = "none";
      next.style.zIndex = "1";
      oldScreen.classList.add("screen--pop-out");
      view.prepend(next);
      return animateOnce(oldScreen).then(() => {
        oldScreen.remove();
        oldScreen.classList.remove("screen--pop-out");
        next.style.zIndex = "";
      });
    }
    oldScreen.style.zIndex = "1";
    oldScreen.style.pointerEvents = "none";
    next.style.zIndex = "2";
    next.classList.add("screen--fade-in");
    view.append(next);
    return animateOnce(next, 350).then(() => {
      oldScreen.remove();
      next.classList.remove("screen--fade-in");
      next.style.zIndex = "";
    });
  }

  async function render(options) {
    const opts = options || {};
    const token = ++renderToken;
    const route = parseRoute();

    if (!state.user && route.name !== "login") {
      window.history.replaceState(null, "", "#/login");
      return render({ instant: true });
    }
    if (state.user && route.name === "login") {
      window.history.replaceState(null, "", "#/home");
      return render({ instant: true });
    }
    if (currentRoute && currentRoute.name === "session" && route.name !== "session") {
      sessionState = null;
    }

    const dir = opts.instant ? "none" : directionFor(route);
    const markup = screenFor(route);

    swapChain = swapChain.then(() => {
      if (token !== renderToken) return null;
      return swap(markup, dir);
    });

    await swapChain;
    if (token !== renderToken) return;

    lastRoute = route;
    currentRoute = route;
    updateChrome(route);
    afterRender(route);
  }

  function refresh() {
    if (!currentRoute) return;
    const oldScreen = view.querySelector(".screen");
    const top = oldScreen ? oldScreen.scrollTop : 0;
    const next = SL.htmlToEl(screenFor(currentRoute));
    view.replaceChildren(next);
    next.scrollTop = top;
    updateChrome(currentRoute);
    afterRender(currentRoute);
  }

  function screenFor(route) {
    if (route.name === "login") return SL.ui.login();
    if (route.name === "notebook") return SL.ui.notebook(route.id);
    if (route.name === "session") return SL.ui.session(route.sessionKey);
    if (route.name === "review") return SL.ui.review();
    if (route.name === "library") return SL.ui.library();
    if (route.name === "admin") return SL.ui.admin();
    if (route.name === "settings") return SL.ui.settings();
    return SL.ui.home();
  }

  function updateChrome(route) {
    const showTabs = ["home", "review", "library", "settings"].includes(route.name);
    tabbar.classList.toggle("is-visible", showTabs);
    document.body.classList.toggle("is-admin", route.name === "admin");
    for (const button of tabbar.children) {
      button.classList.toggle("is-active", button.dataset.nav === `#/${route.name}`);
    }
    const titles = {
      login: "Sign in",
      home: "Today",
      review: "Review",
      library: "Library",
      settings: "Settings",
      notebook: "Notebook",
      session: "Review session",
      admin: "Admin",
    };
    document.title = `${titles[route.name] || "StudyLoop"} — StudyLoop`;
  }

  function afterRender(route) {
    if (route.name === "notebook" && tabOf(route.id) === "chat" && chatOf(route.id).length) {
      requestAnimationFrame(scrollChat);
    }
    if (route.name === "session") setupSwipe();
    if (route.name === "admin") setupAdmin();
  }

  function adminFilterRows() {
    const search = document.getElementById("adminSearch");
    const role = document.getElementById("adminRole");
    const status = document.getElementById("adminStatus");
    if (!search || !role || !status) return;
    ui.adminQuery = search.value;
    ui.adminRole = role.value;
    ui.adminStatus = status.value;
    const query = search.value.trim().toLowerCase();
    const rows = Array.from(view.querySelectorAll("[data-user-row]"));
    let shown = 0;
    for (const row of rows) {
      const matchesQuery =
        !query ||
        row.dataset.name.includes(query) ||
        row.dataset.email.includes(query) ||
        row.dataset.courses.includes(query);
      const matchesRole = role.value === "all" || row.dataset.role === role.value;
      let matchesStatus = status.value === "all";
      if (status.value === "active") matchesStatus = row.dataset.status === "active" && row.dataset.risk !== "1";
      if (status.value === "risk") matchesStatus = row.dataset.risk === "1";
      if (status.value === "disabled") matchesStatus = row.dataset.status === "disabled";
      const visible = matchesQuery && matchesRole && matchesStatus;
      row.hidden = !visible;
      if (visible) shown += 1;
    }
    const count = document.getElementById("adminCount");
    if (count) count.textContent = `${shown} of ${rows.length} users`;
    const empty = document.getElementById("adminNoResults");
    if (empty) empty.hidden = shown !== 0;
    if (ui.adminUser) {
      const selectedRow = rows.find((row) => Number(row.dataset.id) === Number(ui.adminUser));
      if (selectedRow && selectedRow.hidden) closeAdminUser();
    }
  }

  function setupAdmin() {
    const search = document.getElementById("adminSearch");
    const role = document.getElementById("adminRole");
    const status = document.getElementById("adminStatus");
    if (!search || !role || !status) return;
    search.addEventListener("input", adminFilterRows);
    role.addEventListener("change", adminFilterRows);
    status.addEventListener("change", adminFilterRows);
    adminFilterRows();
    for (const row of view.querySelectorAll("[data-user-row]")) {
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openAdminUser(Number(row.dataset.id));
      });
    }
    if (ui.adminUser) {
      const active = view.querySelector(`[data-user-row][data-id="${ui.adminUser}"]`);
      if (active) active.classList.add("is-selected");
    }
  }

  function openAdminUser(id) {
    const user = adminUserById(id);
    const root = view.querySelector(".admin");
    const panel = document.getElementById("adminDetail");
    if (!user || !root || !panel) return;
    ui.adminUser = user.id;
    for (const row of view.querySelectorAll("[data-user-row]")) {
      row.classList.toggle("is-selected", Number(row.dataset.id) === user.id);
    }
    panel.innerHTML = SL.ui.adminDetail(user.id);
    panel.setAttribute("aria-hidden", "false");
    root.classList.add("has-detail");
  }

  function closeAdminUser() {
    ui.adminUser = null;
    const root = view.querySelector(".admin");
    const panel = document.getElementById("adminDetail");
    if (root) root.classList.remove("has-detail");
    if (panel) {
      panel.setAttribute("aria-hidden", "true");
      panel.innerHTML = "";
    }
    for (const row of view.querySelectorAll("[data-user-row].is-selected")) {
      row.classList.remove("is-selected");
    }
  }

  function adminScrollTo(id) {
    const scroller = view.querySelector(".admin__scroll");
    const target = document.getElementById(id);
    if (!scroller || !target) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function applyAdminFilter(filter) {
    const status = document.getElementById("adminStatus");
    if (!status) return;
    status.value = filter;
    adminFilterRows();
    adminScrollTo("adminUsers");
  }

  function setupSwipe() {
    const card = view.querySelector(".flash--swipe");
    if (!card || card.dataset.swipeBound === "1") return;
    card.dataset.swipeBound = "1";

    const THRESHOLD_X = 72;
    const THRESHOLD_Y = 86;
    const cues = {};
    for (const cue of view.querySelectorAll(".swipe-cue[data-cue]")) cues[cue.dataset.cue] = cue;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let rawX = 0;
    let rawY = 0;
    let committed = false;

    const clearCues = () => {
      for (const cue of Object.values(cues)) {
        cue.style.opacity = "0";
        cue.classList.remove("is-hot");
      }
    };

    const axisOf = () => (Math.abs(rawX) >= Math.abs(rawY) ? "x" : "y");

    const gradeForOffset = () => {
      if (axisOf() === "x") {
        if (rawX <= -THRESHOLD_X) return "again";
        if (rawX >= THRESHOLD_X) return "good";
        return null;
      }
      if (rawY <= -THRESHOLD_Y) return "easy";
      if (rawY >= THRESHOLD_Y) return "hard";
      return null;
    };

    const paintCues = () => {
      clearCues();
      const horizontal = axisOf() === "x";
      const progress = horizontal
        ? Math.abs(rawX) / THRESHOLD_X
        : Math.abs(rawY) / THRESHOLD_Y;
      if (progress < 0.08) return;
      const grade = gradeForOffset() ||
        (horizontal ? (rawX < 0 ? "again" : "good") : rawY < 0 ? "easy" : "hard");
      const cue = cues[grade];
      if (cue) {
        cue.style.opacity = String(SL.clamp(progress * 1.2, 0, 1));
        cue.classList.toggle("is-hot", progress >= 1);
      }
      card.style.borderColor = grade === "again" ? "#e8c5b6" : grade === "good" ? "#b8d2b0" : grade === "easy" ? "#b2cdb9" : grade === "hard" ? "#e0cd8f" : "";
    };

    const resetCard = () => {
      card.style.transition = "transform 0.2s var(--ease-out), opacity 0.16s ease";
      card.style.transform = "";
      card.style.opacity = "";
      card.style.borderColor = "";
      clearCues();
      pointerId = null;
      rawX = 0;
      rawY = 0;
    };

    const commit = (grade) => {
      if (committed) return;
      committed = true;
      const vector =
        grade === "again" ? { x: -1, y: 0 } :
        grade === "good" ? { x: 1, y: 0 } :
        grade === "easy" ? { x: 0, y: -1 } : { x: 0, y: 1 };
      const distance = Math.max(window.innerWidth, window.innerHeight) * 1.15;
      const rotate = vector.x ? vector.x * 14 : rawX * 0.03;
      clearCues();
      if (cues[grade]) {
        cues[grade].style.opacity = "1";
        cues[grade].classList.add("is-hot");
      }
      card.style.transition = "transform 0.26s var(--ease-out), opacity 0.22s ease";
      card.style.transform = `translate(${vector.x * distance}px, ${vector.y * distance}px) rotate(${rotate}deg)`;
      card.style.opacity = "0";
      window.setTimeout(() => app.grade(grade), 200);
    };

    card.addEventListener("pointerdown", (event) => {
      if (committed) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      rawX = 0;
      rawY = 0;
      card.style.transition = "none";
      try {
        card.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointers have no capture target */
      }
    });

    card.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId || committed) return;
      rawX = event.clientX - startX;
      rawY = event.clientY - startY;
      const horizontal = axisOf() === "x";
      const dragX = horizontal ? rawX : rawX * 0.2;
      const dragY = horizontal ? rawY * 0.2 : rawY;
      card.style.transform = `translate(${dragX}px, ${dragY}px) rotate(${SL.clamp(rawX * 0.035, -9, 9)}deg)`;
      paintCues();
    });

    const finish = (event) => {
      if (pointerId !== event.pointerId || committed) return;
      const grade = gradeForOffset();
      if (grade) {
        commit(grade);
        return;
      }
      resetCard();
    };

    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
  }

  function toast(message) {
    if (!toasts) return;
    toasts.innerHTML = `<div class="toast">${SL.esc(message)}</div>`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toasts.innerHTML = "";
    }, 2600);
  }

  function scrollChat() {
    if (!document.getElementById("chatLog")) return;
    const screen = view.querySelector(".screen");
    if (screen) screen.scrollTop = screen.scrollHeight;
  }

  function openSheet(markup, options) {
    const opts = options || {};
    if (!markup) return;
    const wasOpen = sheetOpen;
    if (!wasOpen) lastFocused = document.activeElement;
    sheetRoot.innerHTML = markup;
    if (!wasOpen) {
      void sheetRoot.offsetWidth;
      sheetRoot.classList.add("is-open");
    }
    sheetOpen = true;
    if (opts.focus !== false) {
      requestAnimationFrame(() => {
        const panel = sheetRoot.querySelector(".sheet-panel");
        if (!panel) return;
        const target = panel.querySelector(
          'input:not([type="file"]):not([type="hidden"]), textarea, .kind, button'
        );
        if (target) target.focus({ preventScroll: true });
      });
    }
  }

  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    confirmCallback = null;
    sheetRoot.classList.remove("is-open");
    window.setTimeout(() => {
      if (!sheetOpen) sheetRoot.innerHTML = "";
    }, 320);
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
  }

  function openConfirm(options) {
    confirmCallback = options.onConfirm;
    openSheet(SL.ui.confirmSheet(options));
  }

  function trapFocus(event) {
    const panel = sheetRoot.querySelector(".sheet-panel");
    if (!panel) return;
    const nodes = Array.from(
      panel.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]')
    ).filter((el) => el.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setTab(tab) {
    if (!currentRoute || currentRoute.name !== "notebook") return;
    const notebook = notebookById(currentRoute.id);
    if (!notebook) return;
    ui.tabs[notebook.id] = tab;
    const panel = document.getElementById("tabpanel");
    if (!panel) return;
    panel.innerHTML = SL.ui.notebookPanel(notebook, tab);
    panel.classList.remove("tabpanel--enter");
    void panel.offsetWidth;
    panel.classList.add("tabpanel--enter");
    for (const button of view.querySelectorAll("[data-tab]")) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    if (tab === "chat") requestAnimationFrame(scrollChat);
  }

  function openAddSource(notebookId) {
    ui.sheetNotebook = Number(notebookId);
    ui.addKind = "pdf";
    ui.addFile = null;
    ui.addBusy = false;
    ui.addError = null;
    openSheet(SL.ui.addSourceSheet());
  }

  async function handleAddSource(form) {
    const kind = ui.addKind;
    const notebookId = ui.sheetNotebook;
    if (!notebookId || ui.addBusy) return;

    let title = "";
    let meta = "";

    if (kind === "pdf") {
      if (!ui.addFile) {
        ui.addError = "Choose a PDF first.";
        openSheet(SL.ui.addSourceSheet(), { focus: false });
        return;
      }
      title = ui.addFile;
      meta = `${SL.randInt(8, 42)} pages · ${SL.randInt(18, 90)} chunks`;
    } else if (kind === "text") {
      const text = form.querySelector("#srcText").value.trim();
      const entered = form.querySelector("#srcTitle").value.trim();
      if (text.length < 20) {
        ui.addError = "Paste at least a paragraph (20+ characters).";
        openSheet(SL.ui.addSourceSheet(), { focus: false });
        return;
      }
      title = entered || "Pasted notes";
      meta = `${SL.randInt(6, 24)} chunks`;
    } else {
      const url = form.querySelector("#ytUrl").value.trim();
      if (!/youtu\.?be/.test(url)) {
        ui.addError = "Paste a valid YouTube link.";
        openSheet(SL.ui.addSourceSheet(), { focus: false });
        return;
      }
      const match = url.match(/(?:v=|youtu\.be\/)([\w-]{6,})/);
      title = `YouTube lecture — ${match ? match[1].slice(0, 6) : "transcript"}`;
      meta = `${SL.randInt(8, 26)} min · ${SL.randInt(20, 60)} chunks`;
    }

    ui.addBusy = true;
    ui.addError = null;
    openSheet(SL.ui.addSourceSheet(), { focus: false });
    await SL.delay(1200);

    sourcesOf(notebookId).unshift({
      id: Date.now(),
      kind,
      title,
      meta,
      createdAt: new Date().toISOString(),
    });
    save();
    ui.addBusy = false;
    closeSheet();
    if (currentRoute && currentRoute.name === "notebook" && currentRoute.id === Number(notebookId)) {
      refresh();
    }
    toast(`${kind === "pdf" ? "PDF" : kind === "youtube" ? "Transcript" : "Source"} added · ${meta}`);
  }

  function createNotebook(title) {
    const nextId = state.notebooks.reduce((max, notebook) => Math.max(max, notebook.id), 0) + 1;
    const tone = SL.TONES[state.notebooks.length % SL.TONES.length];
    state.notebooks.push({
      id: nextId,
      title,
      tone,
      createdAt: new Date().toISOString(),
    });
    state.sources[nextId] = [];
    state.cards[nextId] = [];
    state.chats[nextId] = [];
    state.generated[nextId] = 0;
    ui.tabs[nextId] = "overview";
    save();
    closeSheet();
    toast("Notebook created");
    go(`#/notebook/${nextId}`);
  }

  function deleteNotebook(id) {
    state.notebooks = state.notebooks.filter((notebook) => notebook.id !== Number(id));
    delete state.sources[id];
    delete state.cards[id];
    delete state.chats[id];
    delete state.generated[id];
    delete ui.tabs[id];
    save();
    closeSheet();
    toast("Notebook deleted");
    if (currentRoute && currentRoute.name === "notebook" && currentRoute.id === Number(id)) {
      go("#/library");
    } else {
      refresh();
    }
  }

  async function generateCards(notebookId) {
    const notebook = notebookById(notebookId);
    if (!notebook || ui.generating) return;
    const pool = SL.GENERATED_CARDS[notebook.title] || SL.GENERIC_CARDS;
    const used = state.generated[notebook.id] || 0;
    if (used >= pool.length) {
      closeSheet();
      toast("No new cards in these sources");
      return;
    }

    ui.tabs[notebook.id] = "cards";
    ui.generating = notebook.id;
    closeSheet();
    if (currentRoute && currentRoute.name === "notebook" && currentRoute.id === notebook.id) {
      refresh();
    }

    await SL.delay(1400);

    const batch = pool.slice(used, used + 2);
    const filterIds = ui.selectedSources ? new Set(ui.selectedSources) : null;
    const filteredPool = filterIds ? batch.filter(b => filterIds.has(b.sourceId || (sourcesOf(notebook.id).find(s => s.title === b.source)?.id))) : batch;
    let nextId = allCards().reduce((max, entry) => Math.max(max, entry.card.id), 0) + 1;
    const sources = sourcesOf(notebook.id);
    for (const item of batch) {
        cardsOf(notebook.id).unshift({
        id: nextId++,
        front: item.front,
        back: item.back,
        source: item.source || (sources[0] ? sources[0].title : "Sources"),
        state: 0,
        lapses: 0,
        due: new Date().toISOString(),
        generatedAt: new Date().toISOString()
      });
    }
    state.generated[notebook.id] = used + batch.length;
    ui.generating = null;
  ui.selectedSources = [];
    save();

    if (currentRoute && currentRoute.name === "notebook" && currentRoute.id === notebook.id) {
      refresh();
    }
    toast(`${SL.plural(batch.length, "flashcard")} generated`);
  }

  function answerFor(notebook, question) {
    const lower = question.toLowerCase();
    const library = SL.CHAT_LIBRARY[notebook.title];
    const sources = sourcesOf(notebook.id);
    const hit = library ? library.find((item) => item.terms.some((term) => lower.includes(term))) : null;
    if (hit) {
      const cites = hit.cites.map((index) => sources[index] && sources[index].title).filter(Boolean);
      return { text: hit.text, cites };
    }
    const fallback = sources.length
      ? `Here is what I can ground from ${SL.plural(sources.length, "source")} in ${notebook.title}. The strongest candidate is “${sources[0].title}”.\n\nAsk about a specific concept, term, or page from your material and I will pull the matching segment with a citation.`
      : `This notebook has no indexed sources yet. Add a PDF, a pasted note, or a lecture transcript and I will answer only from that material.`;
    return { text: fallback, cites: sources.slice(0, 1).map((source) => source.title) };
  }

  function persistAnswer(notebookId, text, cites) {
    chatOf(notebookId).push({ role: "ai", text, cites });
    if (chatOf(notebookId).length > 40) state.chats[notebookId] = chatOf(notebookId).slice(-40);
    save();
  }

  async function streamAnswer(notebook, question) {
    const pending = document.getElementById("chatPending");
    const body = pending ? pending.querySelector(".msg__body") : null;
    const answer = answerFor(notebook, question);

    await SL.delay(520);
    if (!pending || !pending.isConnected) {
      persistAnswer(notebook.id, answer.text, answer.cites);
      return;
    }

    const words = answer.text.split(" ");
    let shown = "";
    for (let index = 0; index < words.length; index += 1) {
      shown += (index ? " " : "") + words[index];
      if (!pending.isConnected) {
        persistAnswer(notebook.id, answer.text, answer.cites);
        return;
      }
      body.innerHTML = `<p style="white-space:pre-line">${SL.esc(shown)}</p>`;
      if (index % 4 === 0) scrollChat();
      await SL.delay(16 + (words[index].length > 8 ? 16 : 0));
    }

    if (!pending.isConnected) {
      persistAnswer(notebook.id, answer.text, answer.cites);
      return;
    }

    body.innerHTML = answer.text
      .split("\n\n")
      .map((part) => `<p>${SL.esc(part)}</p>`)
      .join("");
    if (answer.cites.length) {
      const wrap = document.createElement("div");
      wrap.className = "cites";
      wrap.innerHTML = answer.cites
        .map((title, index) => `<span class="cite"><b>[${index + 1}]</b> ${SL.esc(title)}</span>`)
        .join("");
      body.append(wrap);
    }
    pending.removeAttribute("id");
    pending.removeAttribute("aria-busy");
    persistAnswer(notebook.id, answer.text, answer.cites);
    scrollChat();
  }

  function sendChat(text) {
    if (!currentRoute || currentRoute.name !== "notebook") return;
    const notebook = notebookById(currentRoute.id);
    if (!notebook) return;
    const question = text.trim();
    if (!question) return;

    chatOf(notebook.id).push({ role: "user", text: question, cites: [] });
    save();

    const log = document.getElementById("chatLog");
    if (!log) return;
    const empty = log.querySelector(".empty");
    if (empty) log.replaceChildren();
    const chips = document.querySelector(".suggest");
    if (chips) chips.remove();

    const userEl = document.createElement("div");
    userEl.className = "msg msg--user";
    userEl.innerHTML = `<p>${SL.esc(question)}</p>`;
    log.append(userEl);

    const aiEl = document.createElement("div");
    aiEl.className = "msg msg--ai";
    aiEl.id = "chatPending";
    aiEl.setAttribute("aria-busy", "true");
    aiEl.innerHTML = `<div class="msg__label">${SL.icon("sparkle", 12, "i-sparkle")} StudyLoop</div>
      <div class="msg__body"><span class="typing" aria-label="Thinking"><span></span><span></span><span></span></span></div>`;
    log.append(aiEl);
    scrollChat();

    streamAnswer(notebook, question);
  }

  function ensureSession(key) {
    if (sessionState && sessionState.routeKey === key) return sessionState;
    const forced = practiceKey === key;
    practiceKey = null;
    const notebookId = key === "all" ? null : Number(key);
    let pool;
    if (notebookId == null) {
      pool = forced ? allCards() : dueCards();
    } else {
      pool = forced
        ? cardsOf(notebookId).map((card) => ({ notebookId, card }))
        : dueCards(notebookId);
    }
    const notebook = notebookId == null ? null : notebookById(notebookId);
    sessionState = {
      routeKey: key,
      key,
      label: notebook ? notebook.title : "All notebooks",
      queue: pool.map((entry) => ({ notebookId: entry.notebookId, cardId: entry.card.id })),
      index: 0,
      revealed: false,
      finished: false,
      reviewed: 0,
      grades: { again: 0, hard: 0, good: 0, easy: 0 },
    };
    return sessionState;
  }

  function revealCard() {
    if (!sessionState || sessionState.finished) return;
    sessionState.revealed = true;
    refresh();
  }

  function gradeCard(grade) {
    const session = sessionState;
    if (!session || session.finished || !session.revealed) return;
    const entry = session.queue[session.index];
    const card = entry ? cardsOf(entry.notebookId).find((item) => item.id === entry.cardId) : null;
    const info = SL.GRADES[grade];
    if (!card || !info) return;

    const reps = card.state || 0;
    const minutes = grade === "again" ? info.minutes : Math.round(info.minutes * (1 + reps * 0.35));
    card.due = new Date(Date.now() + minutes * 60000).toISOString();
    card.state = grade === "again" ? 0 : Math.min(5, reps + 1);
    if (grade === "again") card.lapses = (card.lapses || 0) + 1;
    if (state.reviewedToday === 0) state.streak += 1;
    state.reviewedToday += 1;

    session.grades[grade] += 1;
    session.reviewed += 1;
    session.index += 1;
    session.revealed = false;
    if (session.index >= session.queue.length) session.finished = true;
    save();
    try {
      fetch(`/api/cards/${entry.cardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grade })
      }).catch(() => {});
    } catch {}
    refresh();
    if (!session.finished) toast(`Next review in ${info.hint}`);
  }

  function startPractice(key) {
    practiceKey = key;
    sessionState = null;
    const target = `#/session/${key}`;
    if (location.hash === target) render();
    else location.hash = target;
  }

  function endSession() {
    sessionState = null;
    if (currentRoute && currentRoute.name === "session") goBack();
  }

  function sessionDone() {
    sessionState = null;
    go("#/home");
  }

  function nameFromEmail(email) {
    const prefix = email.split("@")[0] || "learner";
    if (prefix.toLowerCase() === "demo") return "Ada Lovelace";
    return prefix
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  async function handleLogin(form, demo) {
    const errorEl = document.getElementById("loginError");
    const button = document.getElementById("loginBtn");
    const emailInput = form.querySelector("#email");
    const passwordInput = form.querySelector("#password");
    const email = demo ? "demo@studyloop.app" : emailInput.value.trim();
    const password = demo ? "studyloop" : passwordInput.value;

    errorEl.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = "Enter a valid email address.";
      errorEl.hidden = false;
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters.";
      errorEl.hidden = false;
      return;
    }

    button.disabled = true;
    button.textContent = "Signing in…";
    await SL.delay(700);
    state.user = { email, name: nameFromEmail(email) };
    save();
    toast(`Welcome back, ${state.user.name.split(" ")[0]}`);
    go("#/home");
  }

  function handleSubmit(event) {
    const form = event.target;
    if (form.id === "loginForm") {
      event.preventDefault();
      handleLogin(form, false);
      return;
    }
    if (form.id === "newNotebookForm") {
      event.preventDefault();
      const title = form.querySelector("#nbTitle").value.trim();
      if (title.length < 2) {
        toast("Give the notebook a name");
        return;
      }
      createNotebook(title);
      return;
    }
    if (form.id === "addSourceForm") {
      event.preventDefault();
      handleAddSource(form);
      return;
    }
    if (form.id === "chatForm") {
      event.preventDefault();
      const input = form.querySelector("#chatQ");
      const value = input.value;
      input.value = "";
      sendChat(value);
      return;
    }
    if (form.id === "keyForm") {
      event.preventDefault();
      const key = form.querySelector("#groqKey").value.trim();
      if (key.length < 8) {
        toast("That key looks too short");
        return;
      }
      state.settings.personalKey = true;
      save();
      closeSheet();
      refresh();
      toast("Personal AI key saved");
    }
  }

  function handleAction(action, element) {
    switch (action) {
      case "close-sheet":
        closeSheet();
        break;
      case "confirm": {
        const callback = confirmCallback;
        closeSheet();
        if (callback) callback();
        break;
      }
      case "demo-login": {
        const form = document.getElementById("loginForm");
        if (form) handleLogin(form, true);
        break;
      }
      case "new-notebook":
        openSheet(SL.ui.newNotebookSheet());
        break;
      case "pick-kind":
        ui.addKind = element.dataset.kind;
        ui.addFile = null;
        ui.addError = null;
        openSheet(SL.ui.addSourceSheet(), { focus: false });
        break;
      case "add-source":
        openAddSource(element.dataset.id);
        break;
      case "notebook-menu":
        openSheet(SL.ui.notebookMenuSheet(Number(element.dataset.id)));
        break;
      case "delete-notebook": {
        const id = Number(element.dataset.id);
        const notebook = notebookById(id);
        if (!notebook) break;
        openConfirm({
          title: "Delete notebook",
          sub: notebook.title,
          body: "This removes its sources, chat history, and flashcards. It cannot be undone in this mockup.",
          label: "Delete notebook",
          onConfirm: () => deleteNotebook(id),
        });
        break;
      }
      case "generate-cards-confirm":
        {
          const ids = Array.from(document.querySelectorAll('#generateSourceForm input[data-source-id]:checked')).map(el => Number(el.dataset.sourceId));
          ui.selectedSources = ids.length ? ids : null;
          closeSheet();
          const nbId = ui.sheetNotebook || currentRoute.id;
          generateCards(Number(nbId));
        }
        break;
      case "generate-cards":
        {
          const nbId = Number(element.dataset.id);
          const srcs = sourcesOf(nbId);
          if (srcs.length) openSheet(SL.ui.generateSourceSheet(nbId, srcs));
          else generateCards(nbId);
        }
        break;
      case "start-review":
        go(`#/session/${element.dataset.key}`);
        break;
      case "practice":
        startPractice(element.dataset.key);
        break;
      case "reveal":
        revealCard();
        break;
      case "grade":
        gradeCard(element.dataset.grade);
        break;
      case "end-session":
        endSession();
        break;
      case "session-done":
        sessionDone();
        break;
      case "suggest":
        sendChat(element.dataset.q || "");
        break;
      case "ai-key":
        openSheet(SL.ui.keySheet());
        break;
      case "clear-key":
        state.settings.personalKey = false;
        save();
        closeSheet();
        refresh();
        toast("Personal key removed");
        break;
      case "admin-user":
        openAdminUser(Number(element.dataset.id));
        break;
      case "admin-close-user":
        closeAdminUser();
        break;
      case "admin-scroll": {
        for (const item of view.querySelectorAll('.admin__nav-item[data-action="admin-scroll"]')) {
          item.classList.toggle("is-active", item === element);
        }
        adminScrollTo(element.dataset.target);
        break;
      }
      case "admin-filter":
        applyAdminFilter(element.dataset.filter);
        break;
      case "admin-reset-password": {
        const user = adminUserById(element.dataset.id);
        if (!user) break;
        openConfirm({
          title: "Reset password",
          sub: user.email,
          body: `Send ${user.name} a password reset link? In this prototype no email is sent.`,
          label: "Send reset link",
          danger: false,
          onConfirm: () => toast(`Reset link sent to ${user.email}`),
        });
        break;
      }
      case "admin-toggle-status": {
        const user = adminUserById(element.dataset.id);
        if (!user) break;
        const disabling = user.status !== "disabled";
        openConfirm({
          title: disabling ? "Disable account" : "Enable account",
          sub: user.email,
          body: disabling
            ? `${user.name} will be signed out and blocked from signing in until re-enabled.`
            : `${user.name} will be able to sign in again immediately.`,
          label: disabling ? "Disable account" : "Enable account",
          danger: disabling,
          onConfirm: () => {
            user.status = disabling ? "disabled" : "active";
            if (!disabling) user.lastActive = new Date().toISOString();
            save();
            refresh();
            toast(disabling ? "Account disabled" : "Account enabled");
          },
        });
        break;
      }
      case "admin-delete-user": {
        const user = adminUserById(element.dataset.id);
        if (!user) break;
        openConfirm({
          title: "Delete user",
          sub: user.email,
          body: `This permanently removes ${user.name}, their notebooks, and review history. This cannot be undone.`,
          label: "Delete user",
          onConfirm: () => {
            state.admin.users = state.admin.users.filter((item) => item.id !== user.id);
            ui.adminUser = null;
            save();
            refresh();
            toast("User deleted");
          },
        });
        break;
      }
      case "reset-demo": {
        openConfirm({
          title: "Reset demo data",
          body: "Restores the three seeded notebooks and every seeded card. Your sign-in stays active.",
          label: "Reset demo data",
          onConfirm: () => {
            const user = state.user;
            state = SL.seed();
            state.user = user;
            sessionState = null;
            ui.tabs = {};
            save();
            go("#/home");
            toast("Demo data restored");
          },
        });
        break;
      }
      case "logout":
        state.user = null;
        sessionState = null;
        save();
        go("#/login");
        toast("Signed out");
        break;
      case "noop":
      default:
        break;
    }
  }

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      go(nav.dataset.nav);
      return;
    }
    const back = event.target.closest("[data-back]");
    if (back) {
      event.preventDefault();
      goBack();
      return;
    }
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      setTab(tab.dataset.tab);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action) handleAction(action.dataset.action, action);
  });

  document.addEventListener("change", (event) => {
    if (event.target.id !== "pdfFile") return;
    ui.addFile = event.target.files && event.target.files[0] ? event.target.files[0].name : null;
    ui.addError = null;
    const label = document.getElementById("fileName");
    if (label) label.textContent = ui.addFile || "No file selected · up to 100 pages, 40 MB";
    const submit = sheetRoot.querySelector('button[type="submit"][form="addSourceForm"]');
    if (submit) submit.disabled = !ui.addFile;
  });

  document.addEventListener("keydown", (event) => {
    if (sheetOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
      } else if (event.key === "Tab") {
        trapFocus(event);
      }
      return;
    }
    if (!currentRoute || currentRoute.name !== "session") return;
    if (event.key === "Escape") {
      event.preventDefault();
      endSession();
      return;
    }
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!sessionState || sessionState.finished) return;
    if (event.code === "Space" && !sessionState.revealed) {
      event.preventDefault();
      revealCard();
      return;
    }
    if (sessionState.revealed && ["1", "2", "3", "4"].includes(event.key)) {
      gradeCard(["again", "hard", "good", "easy"][Number(event.key) - 1]);
    }
  });

  document.addEventListener("submit", handleSubmit);
  window.addEventListener("hashchange", () => render());

  Object.assign(app, {
    notebookById,
    sourcesOf,
    cardsOf,
    chatOf,
    allCards,
    dueCards,
    cardForEntry,
    mastery,
    initialsOf,
    greeting,
    todayLabel,
    dueLabel,
    ring,
    tabOf,
    generatingId,
    sheetState,
    ensureSession,
    adminState,
    adminUserById,
    adminUiState: ui,
    grade: gradeCard,
  });

  if (!location.hash) {
    window.history.replaceState(null, "", state.user ? "#/home" : "#/login");
  }
  render({ instant: true });
  syncStateFromDB();
})(window.SL);
