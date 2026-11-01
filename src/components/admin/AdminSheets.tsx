"use client";

import { useState } from "react";
import { SheetFrame, useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";

export function ConfirmSheet({
  title,
  sub,
  body,
  label,
  danger = true,
  onConfirm
}: {
  title: string;
  sub?: string;
  body: string;
  label: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const { close } = useSheet();
  return (
    <SheetFrame
      title={title}
      sub={sub}
      body={<p className="small text-pretty admin-sheet-text">{body}</p>}
      foot={
        <>
          <button
            className={`btn btn--block ${danger ? "btn--danger" : "btn--primary"}`}
            type="button"
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            {label}
          </button>
          <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={close}>
            Cancel
          </button>
        </>
      }
    />
  );
}

export function ResetResultSheet({ email, password }: { email: string; password: string }) {
  const { close } = useSheet();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast("Temporary password copied");
    } catch {
      toast("Select the password and copy it manually");
    }
  }

  return (
    <SheetFrame
      title="Password reset"
      sub={email}
      body={
        <div className="stack--8">
          <p className="small text-pretty admin-sheet-text">
            Share this temporary password securely. It works once until the user changes it, and
            all of their other sessions have been signed out.
          </p>
          <div className="admin-temp">
            <code>{password}</code>
            <button className="btn btn--secondary btn--sm" type="button" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      }
      foot={
        <button className="btn btn--primary btn--block" type="button" onClick={close}>
          Done
        </button>
      }
    />
  );
}

export function NewUserSheet({
  onCreate
}: {
  onCreate: (input: {
    email: string;
    password: string;
    role: "user" | "admin";
  }) => Promise<string | null>;
}) {
  const { close } = useSheet();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = "admin-new-user";

  async function submit(form: FormData) {
    if (busy) return;
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const role = form.get("role") === "admin" ? "admin" : "user";
    setBusy(true);
    setError(null);
    const message = await onCreate({ email, password, role });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    close();
    toast(`Created ${email}`);
  }

  return (
    <SheetFrame
      title="New user"
      sub="Create an account with a temporary password."
      formId={formId}
      onSubmit={(form) => void submit(form)}
      body={
        <div className="stack--16">
          <div className="field">
            <label className="label" htmlFor="admin-new-email">
              Email
            </label>
            <input
              className="input"
              id="admin-new-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              disabled={busy}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="admin-new-password">
              Password (min 12 chars)
            </label>
            <input
              className="input"
              id="admin-new-password"
              name="password"
              type="text"
              autoComplete="new-password"
              minLength={12}
              required
              disabled={busy}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="admin-new-role">
              Role
            </label>
            <select className="input" id="admin-new-role" name="role" defaultValue="user" disabled={busy}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      }
      foot={
        <button className="btn btn--primary btn--block" type="submit" form={formId} disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <span className="spinner" /> Creating…
            </>
          ) : (
            "Create user"
          )}
        </button>
      }
    />
  );
}
