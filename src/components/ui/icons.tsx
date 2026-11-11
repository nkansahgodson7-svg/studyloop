export const ICON_PATHS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  review:
    '<rect x="3.5" y="6.5" width="12" height="15" rx="2.5"/><path d="M8.5 3.5h9A2.5 2.5 0 0 1 20 6v11"/>',
  library:
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  sliders:
    '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sparkle:
    '<path d="M12 2.6l2.2 6.4 6.3 2.2-6.3 2.2L12 19.8l-2.2-6.4L3.5 11.2l6.3-2.2z"/><path d="M18.6 15.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>',
  file: '<path d="M7.5 3.5h6l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V8h4"/>',
  text: '<path d="M5 6.5h14M5 12h14M5 17.5h9"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10.4 9.1l4.8 2.9-4.8 2.9z"/>',
  mic: '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  check: '<path d="M5 12.4l4.2 4.2L19 7"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
  flame:
    '<path d="M12 21c-3.6 0-6-2.2-6-5.2 0-2.4 1.6-4 2.7-5.4C10 8.9 10.5 7.4 10.5 6c2 .8 3.4 2.2 3.9 3.9.3-.4.6-.9.8-1.4 1.7 1.2 2.8 3.2 2.8 5.3 0 3-2.4 5.2-6 5.2z"/>',
  key: '<circle cx="8.5" cy="12" r="4"/><path d="M12.5 12H21M18 12v3M15 12v2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  alert: '<path d="M12 4.5 21 20H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  logout:
    '<path d="M9 5H5.5A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H9"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  eye: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  rotate:
    '<path d="M4 9a8 8 0 0 1 13-3l2 2M20 4v4h-4M20 15a8 8 0 0 1-13 3l-2-2M4 20v-4h4"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  layers:
    '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  edit: '<path d="M5 19h4l9.5-9.5a2.1 2.1 0 0 0-3-3L6 16v3z"/><path d="M14 7l3 3"/>',
  history:
    '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>'
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const glyph = (ICON_PATHS as Record<string, string>)[name] ?? ICON_PATHS.file;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: glyph }}
    />
  );
}

export const TONES = ["tone-sage", "tone-butter", "tone-sky", "tone-rose", "tone-lilac"] as const;

export type Tone = (typeof TONES)[number];

export type Grade = "again" | "hard" | "good" | "easy";

export const GRADES: Record<Grade, { label: string; hint: string }> = {
  again: { label: "Again", hint: "10 min" },
  hard: { label: "Hard", hint: "1 day" },
  good: { label: "Good", hint: "3 days" },
  easy: { label: "Easy", hint: "7 days" }
};

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? `${one}s`}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function initialsOf(name: string): string {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function todayLabel(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  const month = now.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday}, ${now.getDate()} ${month}`;
}

export function dueLabel(due: string): { text: string; cls: string } {
  const diff = new Date(due).getTime() - Date.now();
  if (diff <= 0) return { text: "Due", cls: "" };
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return { text: `${minutes}m`, cls: "badge--neutral" };
  const hours = Math.round(diff / 3600000);
  if (hours < 24) return { text: `${hours}h`, cls: "badge--neutral" };
  return { text: `${Math.round(diff / 86400000)}d`, cls: "badge--neutral" };
}
