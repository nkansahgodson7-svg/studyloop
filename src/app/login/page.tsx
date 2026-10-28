"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { useToast } from "@/components/ui/Toast";
import { clearSessionCaches } from "@/lib/client/cache";

function nameFromEmail(email: string): string {
  const prefix = email.split("@")[0] || "learner";
  if (prefix.toLowerCase() === "demo") return "Ada Lovelace";
  return prefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(nextEmail: string, nextPassword: string) {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (nextPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password: nextPassword })
      });
      if (res.ok) {
        const name = nameFromEmail(nextEmail);
        toast(`Welcome back, ${name.split(" ")[0]}`);
        clearSessionCaches();
        router.replace("/");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Login failed (${res.status})`);
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signIn(email.trim(), password);
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
            Turn your own notes into grounded answers, flashcards, and a daily review loop.
          </p>
        </div>
        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="username"
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
              autoComplete="current-password"
              placeholder="Your password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="form-error" role="alert" hidden={error === null}>
            {error ?? ""}
          </p>
          <button className="btn btn--primary btn--block" type="submit" id="loginBtn" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth__switch">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </ScreenSection>
  );
}
