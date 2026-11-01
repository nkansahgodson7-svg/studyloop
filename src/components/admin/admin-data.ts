export interface DayCount {
  date: string;
  count: number;
}

export interface AdminNotebook {
  id: number;
  title: string;
  createdAt: string;
  sources: number;
  cards: number;
}

export interface AdminUser {
  id: number;
  email: string;
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  counts: {
    notebooks: number;
    sources: number;
    cards: number;
    reviews: number;
    reviews7d: number;
    chats: number;
    generatedCards: number;
  };
  notebooks: AdminNotebook[];
}

export interface AdminStats {
  users: {
    total: number;
    admins: number;
    disabled: number;
    newLast7d: number;
    atRisk: number;
  };
  content: { notebooks: number; sources: number; cards: number };
  activity: {
    reviews: number;
    dueNow: number;
    chatPrompts: number;
    activeUsers7d: number;
  };
  series: { signups: DayCount[]; reviews: DayCount[] };
}

export type UserStatus = "active" | "risk" | "disabled";

export function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initialsOfEmail(email: string): string {
  const name = displayName(email);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || (email.charAt(0) || "U").toUpperCase();
}

export function daysSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function statusOf(user: AdminUser): UserStatus {
  if (user.disabled) return "disabled";
  if (daysSince(user.lastActiveAt) <= 7) return "active";
  if (!user.lastActiveAt && daysSince(user.createdAt) <= 7) return "active";
  return "risk";
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function aiActionsOf(user: AdminUser): number {
  return user.counts.chats + user.counts.generatedCards;
}

export function sumCounts(days: DayCount[]): number {
  return days.reduce((sum, day) => sum + day.count, 0);
}
