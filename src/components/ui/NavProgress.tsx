"use client";

/**
 * Indeterminate top bar for in-flight route changes. It is intentionally
 * non-determinate: client navigations do not know a real percentage, so faking
 * one would be dishonest. It only claims "a transition is happening".
 */
export function NavProgress({ active }: { active: boolean }) {
  return (
    <div
      className={`nav-progress${active ? " is-active" : ""}`}
      aria-hidden="true"
      data-optimistic-nav-pending={active ? "" : undefined}
    >
      <span className="nav-progress__bar" />
    </div>
  );
}
