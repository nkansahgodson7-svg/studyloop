"use client";

import { Icon } from "@/components/ui/icons";
import {
  aiActionsOf,
  displayName,
  initialsOfEmail,
  relativeTime,
  shortDate,
  statusOf,
  type AdminUser
} from "./admin-data";

const WEEKLY_REVIEW_TARGET = 60;

function StatusChip({ user }: { user: AdminUser }) {
  const status = statusOf(user);
  if (status === "disabled") return <span className="chip chip--plain">Disabled</span>;
  if (status === "risk") return <span className="chip chip--accent">At risk</span>;
  return <span className="chip chip--brand">Active</span>;
}

export function UserDetailPanel({
  user,
  busy,
  onClose,
  onReset,
  onToggle,
  onDelete
}: {
  user: AdminUser;
  busy: boolean;
  onClose: () => void;
  onReset: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const status = statusOf(user);
  const weeklyPct = Math.min(100, Math.round((user.counts.reviews7d / WEEKLY_REVIEW_TARGET) * 100));

  return (
    <>
      <div className="admin-detail__head">
        <div className="admin-detail__id">
          <span className="avatar" aria-hidden="true">
            {initialsOfEmail(user.email)}
          </span>
          <div>
            <h2 className="h2">{displayName(user.email)}</h2>
            <p className="small muted">{user.email}</p>
          </div>
        </div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Close user details">
          <Icon name="close" />
        </button>
      </div>

      <div className="admin-detail__badges">
        <StatusChip user={user} />
        <span className="chip chip--plain">{user.role === "admin" ? "Admin" : "Member"}</span>
      </div>

      <div className="admin-detail__meta">
        <div>
          <span className="eyebrow">Joined</span>
          <strong>{shortDate(user.createdAt)}</strong>
        </div>
        <div>
          <span className="eyebrow">Last active</span>
          <strong>{relativeTime(user.lastActiveAt)}</strong>
        </div>
      </div>

      <div className="admin-detail__stats">
        <div className="admin-stat">
          <strong>{user.counts.notebooks}</strong>
          <span>notebooks</span>
        </div>
        <div className="admin-stat">
          <strong>{user.counts.sources}</strong>
          <span>sources</span>
        </div>
        <div className="admin-stat">
          <strong>{user.counts.cards}</strong>
          <span>cards</span>
        </div>
        <div className="admin-stat">
          <strong>{user.counts.reviews}</strong>
          <span>reviews all time</span>
        </div>
      </div>

      <div className="admin-detail__block">
        <div className="section-head">
          <h3 className="h3">This week</h3>
          <span className="small muted">
            {user.counts.reviews7d} reviews · {aiActionsOf(user)} AI
          </span>
        </div>
        <div
          className="admin-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={weeklyPct}
          aria-label="Weekly review progress"
        >
          <span style={{ width: `${weeklyPct}%` }} />
        </div>
        <p className="tiny muted">
          {user.counts.reviews7d
            ? `${weeklyPct}% of a ${WEEKLY_REVIEW_TARGET}-review week.`
            : "No reviews in the last 7 days."}
        </p>
      </div>

      <div className="admin-detail__block">
        <p className="eyebrow">Notebooks</p>
        {user.notebooks.length === 0 ? (
          <p className="small muted">No notebooks yet.</p>
        ) : (
          <ul className="admin-notebooks">
            {user.notebooks.slice(0, 5).map((notebook) => (
              <li key={notebook.id}>
                <span className="admin-notebooks__title">{notebook.title}</span>
                <span className="tiny muted">
                  {notebook.sources} sources · {notebook.cards} cards
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-detail__actions">
        <button className="btn btn--secondary btn--sm" type="button" onClick={onReset} disabled={busy}>
          <Icon name="key" size={15} /> Reset password
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onToggle} disabled={busy}>
          <Icon name={status === "disabled" ? "check" : "eye"} size={15} />
          {status === "disabled" ? "Enable account" : "Disable account"}
        </button>
        <button className="btn btn--danger btn--sm" type="button" onClick={onDelete} disabled={busy}>
          <Icon name="trash" size={15} /> Delete user
        </button>
      </div>
    </>
  );
}
