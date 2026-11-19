"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useNavEntry } from "@/components/AppShell";

export function ScreenSection({
  className = "",
  children,
  onAnimationEnd: onAnimationEndProp,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();
  const claimEntry = useNavEntry();
  // The destination route does not necessarily commit in the same render as the
  // pathname change (server components and data still have to arrive), so a
  // screen claims the pending direction whenever it finally mounts.
  const [entry, setEntry] = useState(() => {
    const direction = claimEntry(pathname);
    return direction === "push" ? "screen--push-in" : direction === "fade" ? "screen--fade-in" : "";
  });

  return (
    <section
      className={`screen ${className} ${entry}`}
      style={{ zIndex: entry ? 2 : 1 }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntry("");
        onAnimationEndProp?.(event);
      }}
      {...rest}
    >
      {children}
    </section>
  );
}
