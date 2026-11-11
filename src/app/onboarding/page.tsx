"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";
import { meCache } from "@/lib/client/cache";
import { authRedirectFor, getJson, type Notebook } from "@/lib/client/api";
import { leftOnboardingHere, markOnboardingComplete } from "@/lib/client/history";

const GROQ_CONSOLE_URL = "https://console.groq.com/keys";
const MIN_KEY_LENGTH = 20;
const TITLE_STORAGE_KEY = "studyloop:onboarding:notebook";

type Stage = "welcome" | "notebook" | "key" | "done";

const STARTER_NOTEBOOKS = [
  "Biology 101",
  "Organic Chemistry",
  "World History",
  "Calculus II",
  "Psychology",
  "Computer Science"
];

const BENEFITS = [
  {
    icon: "sparkle",
    title: "Ask across every source",
    body: "Answers that cite the page, lecture, or note they came from."
  },
  {
    icon: "layers",
    title: "Flashcards from your material",
    body: "Cards drafted from what you actually have to learn — not a generic deck."
  },
  {
    icon: "clock",
    title: "Review that remembers",
    body: "A daily queue that adapts to what you are about to forget."
  }
];

function savedTitle(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TITLE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [checked, setChecked] = useState(false);
  const [hasNotebooks, setHasNotebooks] = useState(false);
  const [stage, setStage] = useState<Stage>("welcome");
  const [title, setTitle] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyConnected, setKeyConnected] = useState(false);
  const [created, setCreated] = useState<Notebook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The user already finished setup and pressed browser back into this
    // history entry. Send them to the app instead of showing setup again.
    if (leftOnboardingHere()) {
      router.replace("/");
      return;
    }

    let active = true;

    async function boot() {
      try {
        const user = await meCache.load({ force: true });
        if (!active) return;
        // Nothing to onboard if a key is already connected.
        if (user.hasPersonalKey) {
          router.replace("/");
          return;
        }
      } catch (cause) {
        if (!active) return;
        const redirect = authRedirectFor(cause);
        if (redirect) {
          router.replace(redirect);
          return;
        }
      }

      try {
        const notebooks = await getJson<Notebook[]>("/api/notebooks");
        if (!active) return;
        setHasNotebooks(notebooks.length > 0);
        if (notebooks.length === 0) {
          const draft = savedTitle();
          if (draft) setTitle(draft);
        }
      } catch {
        // If we cannot check, assume notebooks exist so we never create a duplicate.
        if (active) setHasNotebooks(true);
      } finally {
        if (active) setChecked(true);
      }
    }

    void boot();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!checked) return;
    try {
      if (title.trim()) window.localStorage.setItem(TITLE_STORAGE_KEY, title);
      else window.localStorage.removeItem(TITLE_STORAGE_KEY);
    } catch {
      // Storage is a convenience; the flow works without it.
    }
  }, [title, checked]);

  // Each stage is a fresh task. Move focus to its heading and return to the top
  // so keyboard and screen-reader users start from the same place.
  useEffect(() => {
    if (!checked) return;
    headingRef.current?.focus({ preventScroll: true });
    document.querySelector(".screen--onboarding")?.scrollTo({ top: 0 });
  }, [stage, checked]);

  const setupStages: Stage[] = hasNotebooks ? ["welcome", "key"] : ["welcome", "notebook", "key"];
  const stepNumber = stage === "done" ? setupStages.length : Math.max(1, setupStages.indexOf(stage) + 1);
  const stepLabel = stage === "welcome" ? "Welcome" : stage === "notebook" ? "Your notebook" : stage === "key" ? "AI key" : "Done";

  function goBack() {
    setError(null);
    if (stage === "key") {
      setStage(hasNotebooks ? "welcome" : "notebook");
    } else if (stage === "notebook") {
      setStage("welcome");
    }
  }

  function goNext() {
    setError(null);
    if (stage === "welcome") {
      setStage(hasNotebooks ? "key" : "notebook");
      return;
    }
    if (stage === "notebook") {
      if (!title.trim()) {
        setError("Give your notebook a name so you can find it later.");
        headingRef.current?.focus();
        return;
      }
      setStage("key");
    }
  }

  async function finish(withKey: boolean) {
    if (busy) return;
    const name = title.trim();

    if (!hasNotebooks && !name) {
      setStage("notebook");
      setError("Name your notebook before finishing setup.");
      return;
    }

    if (withKey && keyValue.trim().length < MIN_KEY_LENGTH) {
      setError("That key looks too short — paste the whole thing, starting with gsk_.");
      keyRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (withKey) {
        const res = await fetch("/api/me/key", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: keyValue.trim() })
        });
        if (res.status !== 201) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Could not save that key (${res.status})`);
        }
        setKeyConnected(true);
        await meCache.load({ force: true }).catch(() => undefined);
        toast("AI key connected");
      }

      let notebook = created;
      if (!hasNotebooks && !notebook) {
        const res = await fetch("/api/notebooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: name })
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Could not create your notebook (${res.status})`);
        }
        notebook = (await res.json()) as Notebook;
        setCreated(notebook);
      }

      try {
        window.localStorage.removeItem(TITLE_STORAGE_KEY);
      } catch {
        // Ignore unavailable storage.
      }
      setStage("done");
    } catch (cause) {
      setError(errorMessage(cause, "Something went wrong — try again."));
    } finally {
      setBusy(false);
    }
  }

  function handleNotebookSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goNext();
  }

  function handleKeySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void finish(true);
  }

  async function pasteKey() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Your clipboard is empty — copy the key from Groq first.");
        return;
      }
      setKeyValue(trimmed);
      setError(null);
    } catch {
      setError("Couldn’t read the clipboard. Paste with Ctrl/Cmd+V instead.");
    }
  }

  function leaveSetup(addSource: boolean) {
    markOnboardingComplete();
    if (!created) {
      router.replace("/");
      return;
    }
    router.push(`/notebooks/${created.id}${addSource ? "?addSource=1" : ""}`);
  }

  if (!checked) {
    return (
      <ScreenSection className="screen--onboarding">
        <div className="onboard onboard--loading">
          <span className="spinner" aria-hidden="true" />
          <p className="small muted">Setting up your study space…</p>
        </div>
      </ScreenSection>
    );
  }

  const keyTrimmed = keyValue.trim();
  const keyLooksComplete = keyTrimmed.length >= MIN_KEY_LENGTH;

  return (
    <ScreenSection className="screen--onboarding">
      <div className={`onboard onboard--${stage}`}>
        <aside className="onboard__aside">
          <div className="onboard__brand">
            <span className="onboard__logo" aria-hidden="true">
              <Icon name="layers" size={18} />
            </span>
            <span className="onboard__wordmark">StudyLoop</span>
          </div>

          <div className="onboard__pitch">
            <h1 className="onboard__headline">
              Turn your notes into a <em>study partner</em>.
            </h1>
            <p className="onboard__lede">
              Add a PDF, a lecture, or your own notes. StudyLoop turns them into a chat that knows your
              material — and flashcards made from it.
            </p>
          </div>

          <ul className="onboard__benefits">
            {BENEFITS.map((benefit) => (
              <li className="onboard__benefit" key={benefit.title}>
                <span className="onboard__benefit-icon" aria-hidden="true">
                  <Icon name={benefit.icon} size={17} />
                </span>
                <span>
                  <b>{benefit.title}</b>
                  <span>{benefit.body}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="onboard__trust">
            <Icon name="key" size={15} />
            Your material stays private. Your API key is encrypted at rest.
          </p>
        </aside>

        <div className="onboard__panel">
          <header className="onboard__head">
            <div className="onboard__stepcount">
              <p className="eyebrow">{stage === "done" ? "Setup complete" : `Step ${stepNumber} of ${setupStages.length}`}</p>
              <span className="onboard__stepname">{stepLabel}</span>
            </div>
            {stage !== "done" ? (
              <div
                className="onboard__bar"
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={1}
                aria-valuemax={setupStages.length}
                aria-valuenow={stepNumber}
              >
                <span style={{ width: `${(stepNumber / setupStages.length) * 100}%` }} />
              </div>
            ) : (
              <div className="onboard__bar onboard__bar--complete" aria-hidden="true">
                <span style={{ width: "100%" }} />
              </div>
            )}
          </header>

          <div className="onboard__body" key={stage}>
            {stage === "welcome" ? (
              <>
                <h2 className="onboard__title" ref={headingRef} tabIndex={-1}>
                  See what your notes can do.
                </h2>
                <p className="onboard__sub">
                  Two minutes to set up. Here is the kind of answer waiting on the other side.
                </p>

                <div className="demo" aria-label="Example StudyLoop answer">
                  <div className="demo__head">
                    <span className="chip chip--brand">
                      <Icon name="sparkle" size={13} /> Sample chat
                    </span>
                    <span className="tiny muted">Grounded in your sources</span>
                  </div>
                  <p className="demo__q">Explain the Krebs cycle like I have an exam tomorrow.</p>
                  <div className="demo__a">
                    <p>
                      It is the cell’s second stage of respiration: acetyl-CoA enters and the cycle
                      strips electrons to make <b>NADH and FADH₂</b>, which fuel the electron transport
                      chain. For the exam, remember <b>where</b> it happens (mitochondrial matrix) and{" "}
                      <b>what it produces</b> (2 ATP, 6 NADH, 2 FADH₂ per glucose).
                    </p>
                    <span className="demo__source">
                      <Icon name="file" size={13} /> Biology 101 · Lecture 7, p. 12
                    </span>
                  </div>
                </div>

                <div className="onboard__actions">
                  <button className="btn btn--primary btn--block" type="button" onClick={goNext}>
                    Get started <Icon name="arrow" size={17} />
                  </button>
                  <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={() => router.replace("/")}>
                    Skip setup for now
                  </button>
                </div>
              </>
            ) : null}

            {stage === "notebook" ? (
              <form className="onboard__form" onSubmit={handleNotebookSubmit} noValidate>
                <h2 className="onboard__title" ref={headingRef} tabIndex={-1}>
                  What are you studying?
                </h2>
                <p className="onboard__sub">
                  Name your first notebook. One per course works best — you can rename it later.
                </p>

                <div className="field">
                  <label className="label" htmlFor="onboardingNotebook">
                    Notebook name
                  </label>
                  <input
                    className="input"
                    id="onboardingNotebook"
                    name="notebook"
                    type="text"
                    maxLength={200}
                    placeholder="e.g. Biology 101"
                    autoComplete="off"
                    value={title}
                    disabled={busy}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setError(null);
                    }}
                  />
                </div>

                <div className="onboard__chips" role="group" aria-label="Notebook suggestions">
                  {STARTER_NOTEBOOKS.map((suggestion) => (
                    <button
                      className={`onboard-chip${title === suggestion ? " is-selected" : ""}`}
                      key={suggestion}
                      type="button"
                      disabled={busy}
                      aria-pressed={title === suggestion}
                      onClick={() => {
                        setTitle(suggestion);
                        setError(null);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                <p className="hint">Next: connect your AI key so chat and cards can run.</p>

                {error ? (
                  <p className="form-error" role="alert" aria-live="polite">
                    <Icon name="alert" size={15} /> {error}
                  </p>
                ) : null}

                <div className="onboard__actions">
                  <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
                    Continue <Icon name="arrow" size={17} />
                  </button>
                  <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={goBack} disabled={busy}>
                    Back
                  </button>
                </div>
              </form>
            ) : null}

            {stage === "key" ? (
              <form className="onboard__form" onSubmit={handleKeySubmit} noValidate>
                <h2 className="onboard__title" ref={headingRef} tabIndex={-1}>
                  Connect your AI.
                </h2>
                <p className="onboard__sub">
                  StudyLoop runs on your own Groq API key. It is free to create, takes about a minute,
                  and you only do this once.
                </p>

                <ol className="onboard-steps onboard-steps--compact">
                  <li className="onboard-step">
                    <span className="onboard-step__n" aria-hidden="true">
                      1
                    </span>
                    <span className="onboard-step__body">
                      <span className="onboard-step__title">
                        Open the{" "}
                        <a className="onboard__inline-link" href={GROQ_CONSOLE_URL} target="_blank" rel="noreferrer noopener">
                          Groq console <Icon name="arrow" size={13} />
                        </a>
                      </span>
                      <span className="onboard-step__sub">Sign up free with Google, GitHub, or email.</span>
                    </span>
                  </li>
                  <li className="onboard-step">
                    <span className="onboard-step__n" aria-hidden="true">
                      2
                    </span>
                    <span className="onboard-step__body">
                      <span className="onboard-step__title">Create an API key</span>
                      <span className="onboard-step__sub">
                        Name it “StudyLoop”. Groq shows the key once — keep the tab open.
                      </span>
                    </span>
                  </li>
                  <li className="onboard-step">
                    <span className="onboard-step__n" aria-hidden="true">
                      3
                    </span>
                    <span className="onboard-step__body">
                      <span className="onboard-step__title">Paste it here</span>
                      <span className="onboard-step__sub">No trip to Settings, no key copied twice.</span>
                    </span>
                  </li>
                </ol>

                <div className="field">
                  <div className="spread">
                    <label className="label" htmlFor="onboardingKey">
                      Groq API key
                    </label>
                    <a className="onboard__inline-link" href={GROQ_CONSOLE_URL} target="_blank" rel="noreferrer noopener">
                      Get a key <Icon name="arrow" size={13} />
                    </a>
                  </div>
                  <div className="keyfield">
                    <Icon name="key" size={17} />
                    <input
                      className="keyfield__input"
                      id="onboardingKey"
                      name="key"
                      ref={keyRef}
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="gsk_…"
                      value={keyValue}
                      disabled={busy}
                      aria-invalid={error ? true : undefined}
                      aria-describedby="onboardingKeyHelp"
                      onChange={(event) => {
                        setKeyValue(event.target.value);
                        setError(null);
                      }}
                    />
                    <button
                      className="keyfield__button"
                      type="button"
                      onClick={() => void pasteKey()}
                      disabled={busy}
                    >
                      Paste
                    </button>
                    <button
                      className="keyfield__button keyfield__button--icon"
                      type="button"
                      aria-pressed={showKey}
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                      disabled={busy}
                      onClick={() => setShowKey((value) => !value)}
                    >
                      <Icon name="eye" size={16} />
                    </button>
                  </div>
                </div>

                <p className="hint" id="onboardingKeyHelp">
                  {keyTrimmed.length === 0
                    ? "Stored encrypted on our server and never shown back to you. Remove it anytime in Settings."
                    : keyLooksComplete
                      ? "Looks complete. We will save it encrypted — you can replace it in Settings."
                      : "Keep pasting — Groq keys are longer than this and start with gsk_."}
                </p>

                {error ? (
                  <p className="form-error" role="alert" aria-live="polite">
                    <Icon name="alert" size={15} /> {error}
                  </p>
                ) : null}

                <div className="onboard__actions">
                  <button className="btn btn--primary btn--block" type="submit" disabled={busy} aria-busy={busy}>
                    {busy ? (
                      <>
                        <span className="spinner" /> Saving…
                      </>
                    ) : (
                      <>Save key & finish</>
                    )}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm btn--block"
                    type="button"
                    disabled={busy}
                    onClick={() => void finish(false)}
                  >
                    I’ll connect it later
                  </button>
                  <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={goBack} disabled={busy}>
                    Back
                  </button>
                </div>
              </form>
            ) : null}

            {stage === "done" ? (
              <div className="onboard__done">
                <span className="onboard__seal" aria-hidden="true">
                  <Icon name="check" size={27} />
                </span>
                <h2 className="onboard__title onboard__title--done" ref={headingRef} tabIndex={-1}>
                  Ready to study.
                </h2>
                <p className="onboard__sub">
                  {created
                    ? "Your notebook is ready. Add a source and StudyLoop will start building from it."
                    : "Everything is set. Open a notebook whenever you want to add material or start reviewing."}
                </p>

                <div className="onboard__summary">
                  <div className="onboard__summary-row">
                    <span className="onboard__summary-icon" aria-hidden="true">
                      <Icon name="layers" size={17} />
                    </span>
                    <span className="onboard__summary-text">
                      <span className="label">Notebook</span>
                      <b>{created ? created.title : "Your existing notebooks"}</b>
                    </span>
                  </div>
                  <div className="onboard__summary-row">
                    <span className="onboard__summary-icon" aria-hidden="true">
                      <Icon name="key" size={17} />
                    </span>
                    <span className="onboard__summary-text">
                      <span className="label">AI key</span>
                      <b>{keyConnected ? "Connected" : "Not connected yet"}</b>
                    </span>
                    <span className={`badge ${keyConnected ? "badge--brand" : "badge--neutral"}`}>
                      {keyConnected ? "On" : "Off"}
                    </span>
                  </div>
                </div>

                {!keyConnected ? (
                  <div className="ai-note">
                    <Icon name="alert" size={16} />
                    <span>
                      Chat and card generation stay off until you connect a key in{" "}
                      <a className="onboard__inline-link" href="/settings">
                        Settings
                      </a>
                      .
                    </span>
                  </div>
                ) : null}

                <div className="onboard__actions">
                  <button
                    className="btn btn--primary btn--block"
                    type="button"
                    onClick={() => leaveSetup(Boolean(created))}
                  >
                    {created ? (
                      <>
                        Add my first source <Icon name="plus" size={17} />
                      </>
                    ) : (
                      <>
                        Go to StudyLoop <Icon name="arrow" size={17} />
                      </>
                    )}
                  </button>
                  {created ? (
                    <button
                      className="btn btn--ghost btn--sm btn--block"
                      type="button"
                      onClick={() => leaveSetup(false)}
                    >
                      Not now — take me to the notebook
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ScreenSection>
  );
}
