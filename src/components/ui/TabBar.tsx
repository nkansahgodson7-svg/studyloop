"use client";

import { useRouter, usePathname } from "next/navigation";
import { tabVisibleFor } from "@/lib/navigation";

const TABS: Array<{ label: string; href: string }> = [
  { label: "Today", href: "/" },
  { label: "Review", href: "/review" },
  { label: "Library", href: "/library" },
  { label: "Settings", href: "/settings" }
];
export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const path = (pathname.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  const visible = tabVisibleFor(pathname);

  return (
    <nav className={`tabbar ${visible ? "is-visible" : ""}`} aria-label="Primary">
      {TABS.map((tab) => (
        <button
          key={tab.href}
          className={`tabbar__item ${path === tab.href ? "is-active" : ""}`}
          type="button"
          aria-current={path === tab.href ? "page" : undefined}
          onClick={() => router.push(tab.href)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {tab.href === "/" && <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />}
            {tab.href === "/review" && (
              <>
                <rect x="3.5" y="6.5" width="12" height="15" rx="2.5" />
                <path d="M8.5 3.5h9A2.5 2.5 0 0 1 20 6v11" />
              </>
            )}
            {tab.href === "/library" && (
              <>
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" />
                <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" />
              </>
            )}
            {tab.href === "/settings" && (
              <>
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
              </>
            )}
          </svg>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
