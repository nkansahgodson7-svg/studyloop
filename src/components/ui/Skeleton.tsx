import type { CSSProperties } from "react";

export function Skeleton({
  height = 14,
  width = "100%",
  radius = "var(--r-xs)",
  dark = false,
  style
}: {
  height?: number | string;
  width?: number | string;
  radius?: string;
  dark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`skeleton${dark ? " skeleton--dark" : ""}`}
      style={{ display: "block", height, width, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

export function GreetingSkeleton() {
  return (
    <div className="greet" role="status" aria-label="Loading your workspace">
      <div className="greet__text">
        <Skeleton height={10} width={92} />
        <Skeleton height={28} width={196} radius="var(--r-sm)" style={{ marginTop: 6 }} />
      </div>
      <Skeleton height={38} width={38} radius="var(--r-pill)" />
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <section className="hero" aria-hidden="true">
      <div className="hero__row">
        <div style={{ display: "grid", gap: 10, flex: 1 }}>
          <Skeleton height={10} width={84} dark />
          <Skeleton height={24} width="78%" dark />
          <Skeleton height={12} width={120} dark />
        </div>
        <Skeleton height={96} width={96} radius="var(--r-pill)" dark />
      </div>
      <div className="hero__foot" style={{ marginTop: 22 }}>
        <Skeleton height={12} width={110} dark />
        <Skeleton height={34} width={96} radius="var(--r-pill)" dark />
      </div>
    </section>
  );
}

export function RowSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="rows" role="status" aria-label="Loading notebooks">
      {Array.from({ length: count }, (_, index) => (
        <div className="row" key={index} aria-hidden="true">
          <span className="skeleton row__tile" />
          <span className="row__main" style={{ flex: 1, gap: 8 }}>
            <Skeleton height={13} width="62%" />
            <Skeleton height={11} width="40%" />
          </span>
        </div>
      ))}
    </div>
  );
}
