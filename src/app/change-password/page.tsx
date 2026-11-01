"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { useToast } from "@/components/ui/Toast";
import { clearSessionCaches } from "@/lib/client/cache";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { role?: string } | null;
        clearSessionCaches();
        toast("Password updated");
        router.replace(body?.role === "admin" ? "/admin" : "/");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null;
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.status === 403 && body?.code === "account_disabled") {
        router.replace("/account-disabled");
        return;
      }
      setError(body?.error ?? `Could not update password (${res.status})`);
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
          <p className="eyebrow">Account security</p>
          <h1 className="auth__mark">
            New <em>password</em>
          </h1>
          <p className="muted text-pretty">
            Choose a new password for your account. If you signed in with a temporary password,
            this is required before you continue.
          </p>
        </div>
        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="current-password">
              Current password
            </label>
            <input
              className="input"
              id="current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="new-password">
              New password (min {MIN_PASSWORD_LENGTH} chars)
            </label>
            <input
              className="input"
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="confirm-password">
              Confirm new password
            </label>
            <input
              className="input"
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          <p className="form-error" role="alert" hidden={error === null}>
            {error ?? ""}
          </p>
          <button
            className="btn btn--primary btn--block"
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <span className="spinner" /> Updating…
              </>
            ) : (
              "Update password"
            )}
          </button>
        </form>
        <p className="auth__switch">
          <Link href="/">Back to StudyLoop</Link>
        </p>
      </div>
    </ScreenSection>
  );
}
