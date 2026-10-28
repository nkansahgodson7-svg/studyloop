"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";

interface AdminUserRow {
  id: number;
  email: string;
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
}

interface DayCount {
  date: string;
  count: number;
}

interface AdminStats {
  users: { total: number; admins: number; disabled: number; newLast7d: number };
  content: { notebooks: number; sources: number; cards: number };
  activity: { reviews: number; dueNow: number; chatPrompts: number; activeUsers7d: number };
  series: { signups: DayCount[]; reviews: DayCount[] };
}

function StatTile({ value, label, hint }: { value: number; label: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}

function BarChart({ title, data }: { title: string; data: DayCount[] }) {
  const max = Math.max(1, ...data.map((day) => day.count));
  const total = data.reduce((sum, day) => sum + day.count, 0);
  const first = data[0]?.date ?? "";
  const last = data[data.length - 1]?.date ?? "";

  return (
    <div className="stack--8">
      <div className="spread">
        <p className="small">
          <b>{title}</b>
        </p>
        <span className="badge badge--neutral">{total}</span>
      </div>
      <div
        className="bars"
        role="img"
        aria-label={`${title}: ${total} across the last ${data.length} days, by day`}
      >
        {data.map((day) => (
          <div className="bars__col" key={day.date} title={`${day.date}: ${day.count}`}>
            <div
              className="bars__bar"
              style={{
                height: `${Math.max(4, Math.round((day.count / max) * 100))}%`,
                background: day.count === 0 ? "var(--line)" : undefined
              }}
            />
          </div>
        ))}
      </div>
      <div className="spread tiny muted">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<"none" | "signed-out" | "forbidden">("none");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [creatingUser, setCreatingUser] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/users")
      ]);
      if (statsRes.status === 401 || usersRes.status === 401) {
        setBlocked("signed-out");
        return;
      }
      if (statsRes.status === 403 || usersRes.status === 403) {
        setBlocked("forbidden");
        return;
      }
      if (!statsRes.ok || !usersRes.ok) {
        setError(`Could not load the dashboard (${statsRes.status || usersRes.status})`);
        return;
      }
      const [nextStats, nextUsers] = (await Promise.all([
        statsRes.json(),
        usersRes.json()
      ])) as [AdminStats, AdminUserRow[]];
      setStats(nextStats);
      setUsers(nextUsers);
      setError(null);
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingUser) return;
    setError(null);
    setNotice(null);
    setCreatingUser(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, role })
      });
      if (res.status === 201) {
        setNotice(`Created ${email.trim().toLowerCase()}`);
        setEmail("");
        setPassword("");
        await load();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Create failed (${res.status})`);
    } catch {
      setError("Network error — try again");
    } finally {
      setCreatingUser(false);
    }
  }

  async function toggleDisabled(user: AdminUserRow) {
    if (togglingId !== null) return;
    setError(null);
    setNotice(null);
    setTogglingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: !user.disabled })
      });
      if (res.ok) {
        setNotice(`${user.email} ${user.disabled ? "enabled" : "disabled"}`);
        await load();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Update failed (${res.status})`);
    } catch {
      setError("Network error — try again");
    } finally {
      setTogglingId(null);
    }
  }

  if (blocked === "signed-out") {
    return (
      <ScreenSection>
        <div className="px" style={{ paddingTop: 48 }}>
          <div className="empty">
            <p className="h3">Signed out</p>
            <p className="small">Your session has ended. Sign in again to open the dashboard.</p>
            <a className="btn btn--primary btn--sm" href="/login">
              Back to login
            </a>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (blocked === "forbidden") {
    return (
      <ScreenSection>
        <div className="px" style={{ paddingTop: 48 }}>
          <div className="empty">
            <p className="h3">Admins only</p>
            <p className="small">This account does not have admin access.</p>
            <a className="btn btn--primary btn--sm" href="/">
              Back to StudyLoop
            </a>
          </div>
        </div>
      </ScreenSection>
    );
  }

  return (
    <ScreenSection>
      <div className="greet">
        <div className="greet__text">
          <p className="eyebrow">Admin</p>
          <h1 className="h1">Dashboard</h1>
        </div>
        <div className="greet__actions">
          <Link className="icon-btn icon-btn--outline" href="/" aria-label="Back to StudyLoop">
            <Icon name="home" />
          </Link>
        </div>
      </div>

      <div className="px stack--20" style={{ marginTop: 14 }}>
        {loading && !stats ? (
          <div className="stat-grid" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="stat" key={index}>
                <Skeleton height={26} width={64} />
                <Skeleton height={10} width={92} />
              </div>
            ))}
          </div>
        ) : stats ? (
          <>
            <section className="stat-grid" aria-label="Headline numbers">
              <StatTile value={stats.users.total} label="Users" hint={`${stats.users.newLast7d} new this week`} />
              <StatTile
                value={stats.activity.activeUsers7d}
                label="Active · 7 days"
                hint={`${stats.users.admins} admin${stats.users.admins === 1 ? "" : "s"}`}
              />
              <StatTile
                value={stats.content.notebooks}
                label="Notebooks"
                hint={`${stats.content.sources} sources`}
              />
              <StatTile
                value={stats.content.cards}
                label="Cards"
                hint={`${stats.activity.dueNow} due now`}
              />
              <StatTile value={stats.activity.reviews} label="Reviews graded" hint="all time" />
              <StatTile value={stats.activity.chatPrompts} label="Chat prompts" hint="questions asked" />
            </section>

            <section className="stack--8">
              <div className="section-head" style={{ marginBottom: 2 }}>
                <h2>Last 14 days</h2>
              </div>
              <div className="card stack--16">
                <BarChart title="New accounts" data={stats.series.signups} />
                <hr className="divider" />
                <BarChart title="Reviews graded" data={stats.series.reviews} />
              </div>
            </section>
          </>
        ) : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="hint" role="status">
            {notice}
          </p>
        ) : null}

        <section className="stack--8">
          <div className="section-head" style={{ marginBottom: 2 }}>
            <h2>Create user</h2>
          </div>
          <form className="stack--16" onSubmit={handleCreate} aria-label="Create user" noValidate>
            <div className="field">
              <label className="label" htmlFor="admin-email">
                Email
              </label>
              <input
                className="input"
                id="admin-email"
                type="email"
                required
                value={email}
                disabled={creatingUser}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="admin-password">
                Password (min 12 chars)
              </label>
              <input
                className="input"
                id="admin-password"
                type="text"
                required
                autoComplete="new-password"
                value={password}
                disabled={creatingUser}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="admin-role">
                Role
              </label>
              <select
                className="input"
                id="admin-role"
                value={role}
                disabled={creatingUser}
                onChange={(event) => setRole(event.target.value as "user" | "admin")}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button
              className="btn btn--primary btn--block"
              type="submit"
              disabled={creatingUser}
              aria-busy={creatingUser}
            >
              {creatingUser ? (
                <>
                  <span className="spinner" /> Creating…
                </>
              ) : (
                "Create user"
              )}
            </button>
          </form>
        </section>

        <section className="stack--8">
          <div className="section-head" style={{ marginBottom: 2 }}>
            <h2>Users</h2>
            <span className="badge badge--neutral">{users.length}</span>
          </div>
          <div className="rows">
            {users.map((user) => (
              <div className="row" key={user.id}>
                <span
                  className={`row__tile ${user.role === "admin" ? "tone-lilac" : "tone-sage"}`}
                  aria-hidden="true"
                >
                  {(user.email.charAt(0) || "U").toUpperCase()}
                </span>
                <span className="row__main">
                  <span className="row__title">{user.email}</span>
                  <span className="row__meta">
                    {user.role} · {user.disabled ? "disabled" : "active"} · joined{" "}
                    {user.createdAt.slice(0, 10)}
                  </span>
                </span>
                <span className="row__trail">
                  <button
                    className="btn btn--sm btn--secondary"
                    type="button"
                    disabled={togglingId === user.id}
                    aria-busy={togglingId === user.id}
                    onClick={() => void toggleDisabled(user)}
                  >
                    {togglingId === user.id ? "…" : user.disabled ? "Enable" : "Disable"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ScreenSection>
  );
}
