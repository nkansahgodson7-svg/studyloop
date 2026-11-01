"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ScreenSection } from "@/components/ui/ScreenSection";
import { Icon, TONES } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { ConfirmSheet, NewUserSheet, ResetResultSheet } from "@/components/admin/AdminSheets";
import { TrendBlock } from "@/components/admin/TrendChart";
import { UserDetailPanel } from "@/components/admin/UserDetailPanel";
import {
  aiActionsOf,
  displayName,
  initialsOfEmail,
  relativeTime,
  statusOf,
  sumCounts,
  type AdminStats,
  type AdminUser,
  type UserStatus
} from "@/components/admin/admin-data";

type Blocked = "none" | "signed-out" | "forbidden";
type RoleFilter = "all" | "admin" | "user";
type StatusFilter = "all" | UserStatus;

interface Me {
  id: number;
  email: string;
  role: "admin" | "user";
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (${res.status})`;
}

function AdminBrand() {
  return (
    <div className="admin__brand">
      <span className="admin__mark" aria-hidden="true">
        <Icon name="layers" size={18} />
      </span>
      <span className="admin__brand-text">
        <strong>StudyLoop</strong>
        <span>Admin</span>
      </span>
    </div>
  );
}

function StatusChip({ user }: { user: AdminUser }) {
  const status = statusOf(user);
  if (status === "disabled") return <span className="chip chip--plain">Disabled</span>;
  if (status === "risk") return <span className="chip chip--accent">At risk</span>;
  return <span className="chip chip--brand">Active</span>;
}

function Insight({
  tone,
  icon,
  title,
  detail,
  action
}: {
  tone: string;
  icon: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-insight">
      <span className={`admin-insight__icon ${tone}`} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="grow">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action}
    </div>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blocked, setBlocked] = useState<Blocked>("none");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState("overview");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const detailOpen = useRef(false);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const { open } = useSheet();
  const { toast } = useToast();

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    try {
      const [statsRes, usersRes, meRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/users"),
        fetch("/api/auth/me")
      ]);
      if (statsRes.status === 401 || usersRes.status === 401 || meRes.status === 401) {
        setBlocked("signed-out");
        return;
      }
      if (statsRes.status === 403 || usersRes.status === 403 || meRes.status === 403) {
        setBlocked("forbidden");
        return;
      }
      if (!statsRes.ok || !usersRes.ok || !meRes.ok) {
        setError(`Could not load the dashboard (${statsRes.status || usersRes.status || meRes.status})`);
        return;
      }
      const [nextStats, nextUsers, nextMe] = (await Promise.all([
        statsRes.json(),
        usersRes.json(),
        meRes.json()
      ])) as [AdminStats, AdminUser[], Me];
      setStats(nextStats);
      setUsers(nextUsers);
      setMe(nextMe);
      setBlocked("none");
      setError(null);
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const activeCount = users.filter((user) => statusOf(user) === "active").length;
  const atRiskUsers = useMemo(
    () => users.filter((user) => statusOf(user) === "risk"),
    [users]
  );
  const disabledCount = users.filter((user) => user.disabled).length;
  const reviews7 = stats ? sumCounts(stats.series.reviews.slice(-7)) : 0;
  const priorReviews7 = stats ? sumCounts(stats.series.reviews.slice(-14, -7)) : 0;
  const reviewDelta =
    priorReviews7 === 0 ? (reviews7 > 0 ? 100 : 0) : Math.round(((reviews7 - priorReviews7) / priorReviews7) * 100);
  const signups7 = stats ? sumCounts(stats.series.signups.slice(-7)) : 0;
  const priorSignups7 = stats ? sumCounts(stats.series.signups.slice(-14, -7)) : 0;
  const signupDelta =
    priorSignups7 === 0
      ? signups7 > 0
        ? 100
        : 0
      : Math.round(((signups7 - priorSignups7) / priorSignups7) * 100);
  const chatTotal = users.reduce((sum, user) => sum + user.counts.chats, 0);
  const generatedTotal = users.reduce((sum, user) => sum + user.counts.generatedCards, 0);
  const aiTotal = chatTotal + generatedTotal;
  const activePct = users.length ? Math.round((activeCount / users.length) * 100) : 0;

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (statusFilter !== "all" && statusOf(user) !== statusFilter) return false;
      if (!q) return true;
      if (user.email.toLowerCase().includes(q)) return true;
      if (displayName(user.email).toLowerCase().includes(q)) return true;
      return user.notebooks.some((notebook) => notebook.title.toLowerCase().includes(q));
    });
  }, [users, query, roleFilter, statusFilter]);

  const selected = users.find((user) => user.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId !== null && !filteredUsers.some((user) => user.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredUsers, selectedId]);

  useEffect(() => {
    if (selectedId !== null) {
      if (detailOpen.current) return;
      detailOpen.current = true;
      const frame = requestAnimationFrame(() => {
        detailRef.current
          ?.querySelector<HTMLButtonElement>(".admin-detail__head button")
          ?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (detailOpen.current) {
      detailOpen.current = false;
      lastTrigger.current?.focus({ preventScroll: true });
      lastTrigger.current = null;
    }
  }, [selectedId]);

  function selectUser(id: number, trigger: HTMLElement) {
    lastTrigger.current = trigger;
    setSelectedId(id);
  }

  function scrollTo(section: "overview" | "usage" | "users") {
    setActiveSection(section);
    const scroller = scrollRef.current;
    const target = document.getElementById(`admin-${section}`);
    if (!scroller || !target) return;
    const top =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function filterByStatus(status: StatusFilter) {
    setStatusFilter(status);
    setRoleFilter("all");
    setQuery("");
    scrollTo("users");
  }

  async function toggleDisabled(user: AdminUser) {
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: !user.disabled })
      });
      if (res.ok) {
        toast(user.disabled ? "Account enabled" : "Account disabled");
        await load("refresh");
        return;
      }
      toast(await errorMessage(res, "Update failed"));
    } catch {
      toast("Network error — try again");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: AdminUser) {
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { temporaryPassword?: string; expiresAt?: string; error?: string }
        | null;
      if (res.ok && body?.temporaryPassword && body.expiresAt) {
        open(
          <ResetResultSheet
            email={user.email}
            password={body.temporaryPassword}
            expiresAt={body.expiresAt}
          />
        );
        await load("refresh");
        return;
      }
      toast(body?.error ?? `Reset failed (${res.status})`);
    } catch {
      toast("Network error — try again");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(user: AdminUser) {
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedId(null);
        toast("User deleted");
        await load("refresh");
        return;
      }
      toast(await errorMessage(res, "Delete failed"));
    } catch {
      toast("Network error — try again");
    } finally {
      setBusyId(null);
    }
  }

  function requestToggle(user: AdminUser) {
    const disabling = !user.disabled;
    open(
      <ConfirmSheet
        title={disabling ? "Disable account" : "Enable account"}
        sub={user.email}
        body={
          disabling
            ? `${displayName(user.email)} will be signed out and blocked from signing in until re-enabled.`
            : `${displayName(user.email)} will be able to sign in again immediately.`
        }
        label={disabling ? "Disable account" : "Enable account"}
        danger={disabling}
        onConfirm={() => void toggleDisabled(user)}
      />
    );
  }

  function requestReset(user: AdminUser) {
    if (me?.id === user.id) {
      toast("Use Change password to update your own password");
      return;
    }
    open(
      <ConfirmSheet
        title="Reset password"
        sub={user.email}
        body={`Generate a temporary password for ${displayName(user.email)}? Their existing sessions will be signed out, and they must choose a new password at their first sign-in.`}
        label="Generate password"
        danger={false}
        onConfirm={() => void resetPassword(user)}
      />
    );
  }

  function requestDelete(user: AdminUser) {
    open(
      <ConfirmSheet
        title="Delete user"
        sub={user.email}
        body={`This permanently removes ${displayName(user.email)}, their notebooks, sources, cards, and review history. This cannot be undone.`}
        label="Delete user"
        onConfirm={() => void deleteUser(user)}
      />
    );
  }

  function openCreateUser() {
    open(
      <NewUserSheet
        onCreate={async ({ email, password, role }) => {
          try {
            const res = await fetch("/api/admin/users", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, password, role })
            });
            if (res.status === 201) {
              await load("refresh");
              return null;
            }
            return await errorMessage(res, "Create failed");
          } catch {
            return "Network error — try again";
          }
        }}
      />
    );
  }

  if (blocked !== "none") {
    return (
      <ScreenSection className="screen--admin">
        <div className="admin-simple">
          <div className="admin-simple__card">
            <p className="h3">{blocked === "signed-out" ? "Signed out" : "Admins only"}</p>
            <p className="small muted">
              {blocked === "signed-out"
                ? "Your session has ended. Sign in again to open the dashboard."
                : "This account does not have admin access."}
            </p>
            <Link className="btn btn--primary btn--sm" href={blocked === "signed-out" ? "/login" : "/"}>
              {blocked === "signed-out" ? "Back to sign in" : "Back to StudyLoop"}
            </Link>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (loading && !stats) {
    return (
      <ScreenSection className="screen--admin">
        <div className="admin">
          <aside className="admin__side">
            <AdminBrand />
            <div className="admin__nav">
              <Skeleton height={38} />
              <Skeleton height={38} />
              <Skeleton height={38} />
            </div>
          </aside>
          <div className="admin__main">
            <header className="admin__top">
              <div>
                <p className="eyebrow">Admin workspace</p>
                <h1 className="h1">Dashboard</h1>
              </div>
            </header>
            <div className="admin__scroll">
              <div className="admin-kpis">
                {Array.from({ length: 4 }, (_, index) => (
                  <div className="admin-kpi" key={index}>
                    <Skeleton height={11} width={90} />
                    <Skeleton height={34} width={64} />
                    <Skeleton height={11} width={120} />
                  </div>
                ))}
              </div>
              <div className="admin-grid">
                <div className="admin-card">
                  <Skeleton height={190} />
                </div>
                <div className="admin-card">
                  <Skeleton height={190} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScreenSection>
    );
  }

  if (!stats) {
    return (
      <ScreenSection className="screen--admin">
        <div className="admin-simple">
          <div className="admin-simple__card">
            <p className="h3">Dashboard unavailable</p>
            <p className="small muted">{error ?? "Could not load the dashboard."}</p>
            <button className="btn btn--primary btn--sm" type="button" onClick={() => void load("initial")}>
              Try again
            </button>
          </div>
        </div>
      </ScreenSection>
    );
  }

  return (
    <ScreenSection className="screen--admin">
      <div className={`admin ${selected ? "has-detail" : ""}`}>
        <aside className="admin__side">
          <AdminBrand />
          <nav className="admin__nav" aria-label="Admin sections">
            <button
              className={`admin__nav-item ${activeSection === "overview" ? "is-active" : ""}`}
              type="button"
              onClick={() => scrollTo("overview")}
              aria-label="Overview"
              aria-current={activeSection === "overview" ? "true" : undefined}
            >
              <Icon name="home" size={18} />
              <span>Overview</span>
            </button>
            <button
              className={`admin__nav-item ${activeSection === "users" ? "is-active" : ""}`}
              type="button"
              onClick={() => scrollTo("users")}
              aria-label="Users"
              aria-current={activeSection === "users" ? "true" : undefined}
            >
              <Icon name="library" size={18} />
              <span>Users</span>
            </button>
            <button
              className={`admin__nav-item ${activeSection === "usage" ? "is-active" : ""}`}
              type="button"
              onClick={() => scrollTo("usage")}
              aria-label="Usage"
              aria-current={activeSection === "usage" ? "true" : undefined}
            >
              <Icon name="key" size={18} />
              <span>Usage</span>
            </button>
          </nav>
          <div className="admin__side-foot">
            <Link className="admin__nav-item" href="/" aria-label="Back to app">
              <Icon name="back" size={18} />
              <span>Back to app</span>
            </Link>
            <p className="admin__side-user">{me?.email ?? "admin"}</p>
          </div>
        </aside>

        <div className="admin__main">
          <header className="admin__top" id="admin-overview">
            <div>
              <p className="eyebrow">Admin workspace</p>
              <h1 className="h1">Dashboard</h1>
              <p className="small muted">
                {users.length} {users.length === 1 ? "learner" : "learners"} · live workspace data
              </p>
            </div>
            <div className="admin__top-actions">
              <button
                className="icon-btn icon-btn--outline"
                type="button"
                onClick={() => void load("refresh")}
                disabled={refreshing}
                aria-label="Refresh dashboard"
                aria-busy={refreshing}
              >
                <Icon name="rotate" className={refreshing ? "icon-spin" : undefined} />
              </button>
              <span className="avatar avatar--sm" aria-hidden="true" title={me?.email ?? ""}>
                {me ? initialsOfEmail(me.email) : "AD"}
              </span>
            </div>
          </header>

          <div className="admin__scroll" ref={scrollRef}>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <section className="admin-kpis" aria-label="Key metrics">
              <article className="admin-kpi">
                <p className="eyebrow">Total users</p>
                <p className="admin-kpi__value">{stats?.users.total ?? users.length}</p>
                <p className="admin-kpi__note">+{stats?.users.newLast7d ?? 0} this week</p>
              </article>
              <article className="admin-kpi">
                <p className="eyebrow">Active learners</p>
                <p className="admin-kpi__value">{activeCount}</p>
                <p className="admin-kpi__note">{activePct}% active in the last 7 days</p>
              </article>
              <article className="admin-kpi">
                <p className="eyebrow">Reviews · 7d</p>
                <p className="admin-kpi__value">{reviews7}</p>
                <p className="admin-kpi__note">
                  {reviewDelta >= 0 ? "+" : ""}
                  {reviewDelta}% vs prior week
                </p>
              </article>
              <article className="admin-kpi admin-kpi--warn">
                <p className="eyebrow">At risk</p>
                <p className="admin-kpi__value">{atRiskUsers.length}</p>
                <p className="admin-kpi__note">No activity in 7+ days</p>
              </article>
            </section>

            <div className="admin-grid">
              <section className="admin-card" id="admin-usage">
                <div className="admin-card__head">
                  <div>
                    <p className="eyebrow">Engagement</p>
                    <h2 className="h3">Last 14 days</h2>
                  </div>
                  <div className="admin-legend">
                    <span>
                      <i /> Last 7 days
                    </span>
                    <span>
                      <i className="is-muted" /> Prior
                    </span>
                  </div>
                </div>
                <div className="admin-trends">
                  <TrendBlock title="New accounts" data={stats?.series.signups ?? []} />
                  <TrendBlock title="Reviews graded" data={stats?.series.reviews ?? []} />
                </div>
                <div className="admin-chart__foot">
                  <div>
                    <strong>{stats?.content.notebooks ?? 0}</strong>
                    <span>notebooks</span>
                  </div>
                  <div>
                    <strong>{stats?.content.cards ?? 0}</strong>
                    <span>cards</span>
                  </div>
                  <div>
                    <strong>{stats?.activity.dueNow ?? 0}</strong>
                    <span>cards due now</span>
                  </div>
                </div>
              </section>

              <section className="admin-card admin-attention">
                <div className="admin-card__head">
                  <div>
                    <p className="eyebrow">Action queue</p>
                    <h2 className="h3">Needs attention</h2>
                  </div>
                  <span className="badge badge--neutral">{atRiskUsers.length + disabledCount}</span>
                </div>
                <div className="admin-insights">
                  <Insight
                    tone="tone-butter"
                    icon="clock"
                    title={
                      atRiskUsers.length
                        ? `${atRiskUsers.length} ${atRiskUsers.length === 1 ? "learner" : "learners"} idle 7+ days`
                        : "No learners idle 7+ days"
                    }
                    detail={
                      atRiskUsers.length
                        ? "Their review loop has gone quiet. Check in or review access."
                        : "Everyone has reviewed something in the last week."
                    }
                    action={
                      atRiskUsers.length ? (
                        <button
                          className="btn btn--ghost btn--sm"
                          type="button"
                          onClick={() => filterByStatus("risk")}
                        >
                          View
                        </button>
                      ) : undefined
                    }
                  />
                  <Insight
                    tone="tone-rose"
                    icon="eye"
                    title={disabledCount ? `${disabledCount} ${disabledCount === 1 ? "account" : "accounts"} disabled` : "No disabled accounts"}
                    detail={disabledCount ? "Access stays blocked until re-enabled." : "Everyone can sign in."}
                    action={
                      disabledCount ? (
                        <button
                          className="btn btn--ghost btn--sm"
                          type="button"
                          onClick={() => filterByStatus("disabled")}
                        >
                          View
                        </button>
                      ) : undefined
                    }
                  />
                  <Insight
                    tone="tone-sage"
                    icon="plus"
                    title={signups7 ? `${signups7} ${signups7 === 1 ? "signup" : "signups"} this week` : "No signups this week"}
                    detail={
                      signups7
                        ? `${signupDelta >= 0 ? "Up" : "Down"} ${Math.abs(signupDelta)}% from the prior week.`
                        : "No new accounts in the last 7 days."
                    }
                  />
                </div>
                <div className="admin-usage">
                  <div className="admin-usage__row">
                    <span className="small">
                      <strong>AI actions</strong>
                    </span>
                    <span className="small num">{aiTotal}</span>
                  </div>
                  <p className="tiny muted">
                    {chatTotal} chat prompts · {generatedTotal} generated cards across all learners.
                  </p>
                </div>
              </section>
            </div>

            <section className="admin-card admin-users" id="admin-users">
              <div className="admin-users__head">
                <div>
                  <p className="eyebrow">Directory</p>
                  <h2 className="h3">Users</h2>
                </div>
                <div className="admin-users__actions">
                  <span className="admin-count">
                    {filteredUsers.length} of {users.length} users
                  </span>
                  <button className="btn btn--primary btn--sm" type="button" onClick={openCreateUser}>
                    <Icon name="plus" size={15} /> New user
                  </button>
                </div>
              </div>

              <div className="admin-toolbar">
                <label className="admin-search">
                  <span className="sr-only">Search users</span>
                  <Icon name="search" size={16} />
                  <input
                    className="input"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search email or notebook"
                    autoComplete="off"
                  />
                </label>
                <label className="sr-only" htmlFor="admin-role-filter">
                  Filter by role
                </label>
                <select
                  className="admin-select"
                  id="admin-role-filter"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                >
                  <option value="all">All roles</option>
                  <option value="admin">Admins</option>
                  <option value="user">Members</option>
                </select>
                <label className="sr-only" htmlFor="admin-status-filter">
                  Filter by status
                </label>
                <select
                  className="admin-select"
                  id="admin-status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="risk">At risk</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <caption className="sr-only">Users with activity and account status</caption>
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col" className="admin-col-role">
                        Role
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col" className="admin-col-last">
                        Last active
                      </th>
                      <th scope="col" className="admin-col-reviews">
                        Reviews 7d
                      </th>
                      <th scope="col" className="admin-col-ai">
                        AI actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user, index) => (
                      <tr
                        className={`admin-user ${selectedId === user.id ? "is-selected" : ""}`}
                        key={user.id}
                        onClick={(event) => {
                          const trigger = event.currentTarget.querySelector<HTMLElement>(".admin-user__open");
                          if (trigger) selectUser(user.id, trigger);
                        }}
                      >
                        <td>
                          <button
                            className="admin-user__open"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectUser(user.id, event.currentTarget);
                            }}
                            aria-label={`View ${user.email}`}
                          >
                            <span
                              className={`avatar avatar--sm ${TONES[index % TONES.length]}`}
                              aria-hidden="true"
                            >
                              {initialsOfEmail(user.email)}
                            </span>
                            <span className="admin-user__person">
                              <span className="admin-user__name">{displayName(user.email)}</span>
                              <span className="admin-user__email">{user.email}</span>
                            </span>
                          </button>
                        </td>
                        <td className="admin-col-role">{user.role === "admin" ? "Admin" : "Member"}</td>
                        <td>
                          <StatusChip user={user} />
                        </td>
                        <td className="admin-col-last admin-user__muted">{relativeTime(user.lastActiveAt)}</td>
                        <td className="admin-col-reviews admin-user__num">{user.counts.reviews7d}</td>
                        <td className="admin-col-ai admin-user__num">{aiActionsOf(user)}</td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="admin-empty">
                          No users match those filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>

        <aside
          className="admin-detail"
          id="admin-detail"
          aria-hidden={selected ? "false" : "true"}
          aria-label="User details"
          ref={detailRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setSelectedId(null);
            }
          }}
        >
          {selected ? (
            <UserDetailPanel
              user={selected}
              busy={busyId === selected.id}
              onClose={() => setSelectedId(null)}
              onReset={() => requestReset(selected)}
              onToggle={() => requestToggle(selected)}
              onDelete={() => requestDelete(selected)}
            />
          ) : null}
        </aside>
      </div>
    </ScreenSection>
  );
}
