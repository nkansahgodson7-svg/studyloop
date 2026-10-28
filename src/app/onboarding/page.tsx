"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";
import { meCache } from "@/lib/client/cache";

const GROQ_CONSOLE_URL = "https://console.groq.com/keys";
const MIN_KEY_LENGTH = 20;

interface StepCopy {
  mark: ReactNode;
  lede: string;
  cta: string;
}

const STEP_ZERO: StepCopy = {
  mark: (
    <>
      Turn notes into <em>answers</em>.
    </>
  ),
  lede: "Chat, flashcards, and summaries are written by an AI model. Connect a Groq key once and it powers all of them.",
  cta: "Show me how"
};

const STEP_ONE: StepCopy = {
  mark: (
    <>
      Get a <em>Groq key</em>.
    </>
  ),
  lede: "Free account, about a minute. You will copy one string and bring it straight back here.",
  cta: "I have my key"
};

const STEP_TWO: StepCopy = {
  mark: (
    <>
      Paste it <em>here</em>.
    </>
  ),
  lede: "Drop in the key you just copied to finish setup — no trip to Settings required.",
  cta: "Save and finish"
};

const STEP_COPY: StepCopy[] = [STEP_ZERO, STEP_ONE, STEP_TWO];

const WHAT_IT_POWERS = [
  ["Chat", "Answers across your sources, with a citation for every claim."],
  ["Flashcards", "Drafted from the material you have added, ready to review."]
];

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [me, setMe] = useState(() => meCache.get());
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState(0);
  const [keyValue, setKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = meCache.subscribe((user) => {
      if (active) setMe(user);
    });
    void meCache
      .load({ force: true })
      .then((user) => {
        if (!active) return;
        setChecked(true);
        // Nothing to onboard if a key is already connected.
        if (user.hasPersonalKey) router.replace("/");
      })
      .catch((cause) => {
        if (!active) return;
        setChecked(true);
        if ((cause as { status?: number }).status === 401) router.replace("/login");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  async function saveKey() {
    const trimmed = keyValue.trim();
    if (trimmed.length < MIN_KEY_LENGTH) {
      setError("That looks too short — paste the whole key, starting with gsk_.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: trimmed })
      });
      if (res.status === 201) {
        toast("AI key saved");
        await meCache.load({ force: true }).catch(() => undefined);
        router.replace("/");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Could not save that key (${res.status})`);
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (step < STEP_COPY.length - 1) {
      setStep(step + 1);
      return;
    }
    void saveKey();
  }

  if (me === null && !checked) {
    return (
      <ScreenSection>
        <div className="auth">
          <div className="empty">
            <span className="spinner" />
            <p className="small">Checking your account…</p>
          </div>
        </div>
      </ScreenSection>
    );
  }

  const copy = STEP_COPY[step] ?? STEP_ZERO;

  return (
    <ScreenSection>
      <div className="auth" style={{ justifyContent: "flex-start" }}>
        <div className="auth__brand">
          <span className="auth__orb" aria-hidden="true" />
          <p className="eyebrow">
            Setup · Step {step + 1} of {STEP_COPY.length}
          </p>
          <h1 className="auth__mark">{copy.mark}</h1>
          <p className="muted text-pretty">{copy.lede}</p>
        </div>

        <div
          className="progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={STEP_COPY.length}
          aria-valuenow={step + 1}
          style={{ marginTop: 18 }}
        >
          <div className="progress__fill" style={{ width: `${((step + 1) / STEP_COPY.length) * 100}%` }} />
        </div>

        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          {step === 0 ? (
            <div className="stack--16">
              <div className="card card--flat stack--8">
                <p className="h3">What it powers</p>
                <div className="stack--6">
                  {WHAT_IT_POWERS.map(([title, sub]) => (
                    <p className="small muted text-pretty" key={title}>
                      <b>{title}</b> — {sub}
                    </p>
                  ))}
                </div>
              </div>
              <div className="ai-note">
                <Icon name="key" size={16} /> Until a key is connected, Chat and Generate return an error.
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="stack--16">
              <ol className="onboard-steps">
                <li className="onboard-step">
                  <span className="onboard-step__n" aria-hidden="true">
                    1
                  </span>
                  <span className="onboard-step__body">
                    <span className="onboard-step__title">Open the Groq console</span>
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
                      Go to <b>API Keys</b>, click <b>Create API key</b>, and name it anything — “StudyLoop” works.
                    </span>
                  </span>
                </li>
                <li className="onboard-step">
                  <span className="onboard-step__n" aria-hidden="true">
                    3
                  </span>
                  <span className="onboard-step__body">
                    <span className="onboard-step__title">Copy it and come back</span>
                    <span className="onboard-step__sub">
                      The key looks like <b>gsk_…</b> and is shown only once. Paste it on the next step.
                    </span>
                  </span>
                </li>
              </ol>
              <a
                className="btn btn--secondary btn--block"
                href={GROQ_CONSOLE_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open console.groq.com <Icon name="arrow" size={16} />
              </a>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="stack--16">
              <div className="field">
                <label className="label" htmlFor="onboardingKey">
                  Groq API key
                </label>
                <input
                  className="input"
                  id="onboardingKey"
                  name="key"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="gsk_…"
                  value={keyValue}
                  disabled={saving}
                  onChange={(event) => {
                    setKeyValue(event.target.value);
                    setError(null);
                  }}
                />
              </div>
              <p className="hint">
                Stored encrypted on the server, never shown back to you. Replace or remove it later in Settings.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="stack--8" style={{ marginTop: 6 }}>
            <button className="btn btn--primary btn--block" type="submit" disabled={saving} aria-busy={saving}>
              {saving ? (
                <>
                  <span className="spinner" /> Saving…
                </>
              ) : (
                copy.cta
              )}
            </button>
            {step > 0 ? (
              <button
                className="btn btn--secondary btn--block"
                type="button"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}
              >
                Back
              </button>
            ) : null}
            <button
              className="btn btn--ghost btn--sm btn--block"
              type="button"
              disabled={saving}
              onClick={() => router.replace("/")}
            >
              {step === STEP_COPY.length - 1 ? "Do this later" : "Skip for now"}
            </button>
          </div>
        </form>
      </div>
    </ScreenSection>
  );
}