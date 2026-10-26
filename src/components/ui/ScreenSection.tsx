"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useNavDirection } from "@/components/AppShell";

export function ScreenSection({
  className = "",
  children,
  onAnimationEnd: onAnimationEndProp,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const direction = useNavDirection();
  const [entry, setEntry] = useState(() =>
    direction === "push" ? "screen--push-in" : direction === "fade" ? "screen--fade-in" : ""
  );

  return (
    <section
      className={`screen ${className} ${entry}`}
      style={{ zIndex: direction === "push" || direction === "fade" ? 2 : 1 }}
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
