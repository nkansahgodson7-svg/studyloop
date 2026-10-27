"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useSheet } from "@/components/ui/Sheet";
import { SheetFrame } from "@/components/ui/Sheet";
import { Icon, initialsOf } from "@/components/ui/icons";
import { clearSessionCaches, meCache, summaryCache, notebookViewsCache } from "@/lib/client/cache";

export default function SettingsPage() {
  const { toast } = useToast();
  const { open, close } = useSheet();
  const router = useRouter();
  const [me, setMe] = useState(() => meCache.get());
  const [summary, setSummary] = useState(() => summaryCache.get());
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribeMe = meCache.subscribe((user) => {
      if (active) setMe(user);
    });
    const unsubscribeSummary = summaryCache.subscribe((stats) => {
      if (active) setSummary(stats);
    });

    void Promise.all([meCache.load(), summaryCache.load()]).catch((error) => {
      if (!active) return;
      if ((error as { status?: number }).status === 401) {
        setUnauthorized(true);
        return;
      }
      toast("Could not load your account");
    });

    return () => {
      active = false;
      unsubscribeMe();
      unsubscribeSummary();
    };
  }, [toast]);

  async function reloadMe() {
    try {
      await meCache.load({ force: true });
    } catch {
      toast("Could not refresh your account");
    }
  }

  async function reloadAll() {
    try {
      await Promise.all([meCache.load({ force: true }), summaryCache.load({ force: true })]);
    } catch {
      toast("Could not refresh your account");
    }
  }

  if (unauthorized) {
    return (
      <ScreenSection>
        <div className="px">
          <div className="empty">
            <p className="h3">Signed out</p>
            <p className="small">Your session has ended. Sign in again to continue.</p>
            <a className="btn btn--primary btn--sm" href="/login">
              Back to login
            </a>
          </div>
        </div>
      </ScreenSection>
    );
  }

  const name = me?.email?.split("@")[0] || "Learner";
  const hasKey = Boolean(me?.hasPersonalKey);

  function openKeySheet() {
    open(
      <SheetFrame
        title="AI key"
        sub={hasKey ? "A personal key is active" : "Using the workspace key"}
        formId="keyForm"
        onSubmit={async (data: FormData) => {
          const key = String(data.get("key") ?? "").trim();
          if (!key) return;
          const res = await fetch("/api/me/key", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key })
          });
          if (res.status === 201) {
            close();
            toast("Personal key saved");
            void reloadMe();
            return;
          }
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          toast(body?.error ?? "Could not save key");
        }}
        body={
          <>
            <div className="field">
              <label className="label" htmlFor="groqKey">
                Groq API key
              </label>
              <input
                className="input"
                id="groqKey"
                name="key"
                type="password"
                autoComplete="off"
                placeholder="gsk_…"
                required
              />
            </div>
            <p className="hint">The real app encrypts this server-side with AES-GCM. This mockup only stores a flag locally.</p>
          </>
        }
        foot={
          <>
            <button className="btn btn--primary btn--block" type="submit" form="keyForm">
              Save key
            </button>
            {hasKey ? (
              <button
                className="btn btn--danger btn--block"
                type="button"
                onClick={async () => {
                  const res = await fetch("/api/me/key", { method: "DELETE" });
                  if (res.ok) {
                    close();
                    toast("Personal key removed");
                    void reloadMe();
                    return;
                  }
                  toast("Could not remove key");
                }}
              >
                Remove personal key
              </button>
            ) : null}
            <button className="btn btn--ghost btn--sm btn--block" type="button" onClick={close}>
              Cancel
            </button>
          </>
        }
      />
    );
  }

  return (
    <ScreenSection className="has-tabbar">
      <div className="greet">
        <div className="greet__text">
          <p className="eyebrow">Account</p>
          <h1 className="h1">Settings</h1>
        </div>
      </div>
      <div className="px stack--20" style={{ marginTop: 14 }}>
        <div className="profile">
          <span className="avatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="grow">
            <p className="profile__name">{me ? name : <Skeleton height={14} width={120} />}</p>
            <p className="profile__mail">{me?.email ?? "…"}</p>
          </div>
          <span className="chip chip--brand">
            <Icon name="flame" size={13} /> {summary?.streak ?? 0} day
          </span>
        </div>

        <section className="stack--8">
          <div className="section-head" style={{ marginBottom: 2 }}>
            <h2>AI</h2>
          </div>
          <button className="setting-row" type="button" onClick={openKeySheet}>
            <span className="setting-row__icon">
              <Icon name="key" size={18} />
            </span>
            <span className="setting-row__main">
              <span className="setting-row__title">AI key</span>
              <span className="setting-row__sub">{hasKey ? "Personal key active" : "Using the workspace key"}</span>
            </span>
            <span className="setting-row__trail">
              {hasKey ? <span className="chip chip--brand">On</span> : ""}
              <Icon name="chevron" size={18} />
            </span>
          </button>
        </section>

        <section className="stack--8">
          <div className="section-head" style={{ marginBottom: 2 }}>
            <h2>Data</h2>
          </div>
          <button
            className="setting-row"
            type="button"
            onClick={async () => {
              const res = await fetch("/api/me/reset-demo", { method: "POST" });
              if (res.ok) {
                toast("Demo data restored");
                clearSessionCaches();
                notebookViewsCache.invalidate();
                void reloadAll();
              } else {
                toast("Could not reset demo data");
              }
            }}
          >
            <span className="setting-row__icon">
              <Icon name="rotate" size={18} />
            </span>
            <span className="setting-row__main">
              <span className="setting-row__title">Reset demo data</span>
              <span className="setting-row__sub">Restore the three seeded notebooks</span>
            </span>
            <span className="setting-row__trail">
              <Icon name="chevron" size={18} />
            </span>
          </button>
        </section>

        <button
          className="btn btn--danger btn--block"
          type="button"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
            clearSessionCaches();
            router.push("/login");
          }}
        >
          <Icon name="logout" size={17} /> Sign out
        </button>
        <p className="tiny muted center">StudyLoop mockup · v1.0 · Local storage only</p>
      </div>
    </ScreenSection>
  );
}
