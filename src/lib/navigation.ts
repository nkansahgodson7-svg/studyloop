// Route depth map mirrors frontend/app.js parseRoute depths:
// login 0 · tabs 1 · notebook 2 · session 3. Direction is depth compare.

export type NavDirection = "push" | "pop" | "fade" | "none";

export function rootPath(pathname: string): string {
  return (pathname.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
}

export function routeDepth(pathname: string): number {
  const path = rootPath(pathname);
  if (path === "/login" || path === "/signup") return 0;
  if (path.startsWith("/notebooks/") && path !== "/notebooks/") return 2;
  if (path.startsWith("/review/session")) return 3;
  if (path === "/" || path === "/review" || path === "/library" || path === "/settings") return 1;
  if (path === "/notebooks") return 1;
  return 1;
}

export function routeKey(pathname: string): string {
  const path = rootPath(pathname);
  if (path.startsWith("/notebooks/") && path !== "/notebooks/") return `notebook:${path}`;
  if (path.startsWith("/review/session")) return "review:session";
  return path;
}

export function directionFor(prev: string, next: string): NavDirection {
  if (!prev) return "none";
  if (routeKey(prev) === routeKey(next)) return "none";
  const prevDepth = routeDepth(prev);
  const nextDepth = routeDepth(next);
  if (nextDepth > prevDepth) return "push";
  if (nextDepth < prevDepth) return "pop";
  return "fade";
}

const TITLES: Array<[RegExp, string]> = [
  [/\/login$/, "Sign in"],
  [/\/signup$/, "Create account"],
  [/\/onboarding$/, "Set up your AI key"],
  [/\/review\/session/, "Review session"],
  [/\/notebooks\/[^/]+$/, "Notebook"],
  [/\/review$/, "Review"],
  [/\/library$/, "Library"],
  [/\/notebooks$/, "Library"],
  [/\/settings$/, "Settings"],
  [/^\/$/, "Today"]
];

export function titleFor(pathname: string): string {
  const path = rootPath(pathname);
  for (const [pattern, title] of TITLES) {
    if (pattern.test(path)) return title;
  }
  return "StudyLoop";
}

const TAB_ROOTS = ["/", "/review", "/library", "/settings"];

export function tabVisibleFor(pathname: string): boolean {
  return TAB_ROOTS.includes(rootPath(pathname));
}
