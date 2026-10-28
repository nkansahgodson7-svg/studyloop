"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { useToast } from "@/components/ui/Toast";
import { clearSessionCaches } from "@/lib/client/cache";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) setInviteCode(code);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const nextEmail = email.trim();
    const nextInvite = inviteCode.trim();
    if (!nextInvite) {
      setError("Enter your invite code.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: nextEmail,
          password,
          inviteCode: nextInvite
        })
      });
      if (res.ok) {
        toast("Welcome to StudyLoop");
        clearSessionCaches();
        router.replace("/");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Signup failed (${res.status})`);
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenSection>
      <div className="auth">
        <div className="auth__brand">
          <span className="auth__orb" aria-hidden="true" />
          <p className="eyebrow">AI study workspace</p>
          <h1 className="auth__mark">
            Study<em>Loop</em>
          </h1>
          <p className="muted text-pretty">
            Create your account and turn your own notes into answers, flashcards, and a daily review loop.
          </p>
        </div>
        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="invite-code">
              Invite code
            </label>
            <input
              className="input"
              id="invite-code"
              name="inviteCode"
              type="text"
              autoComplete="off"
              placeholder="Your invite code"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@university.edu"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="form-error" role="alert" hidden={error === null}>
            {error ?? ""}
          </p>
          <button className="btn btn--primary btn--block" type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              <>
                <span className="spinner" /> Creating account…
              </>
            ) : (
              "Create account"
            )}
          </button>
        </form>
        <p className="auth__switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </ScreenSection>
  );
}
