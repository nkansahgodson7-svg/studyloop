import { clamp } from "./icons";

export function Ring({
  pct,
  size = 88,
  stroke = 7,
  light = false,
  value,
  label = "complete"
}: {
  pct: number;
  size?: number;
  stroke?: number;
  light?: boolean;
  value?: string;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp(pct, 0, 1));
  return (
    <div className={`ring ${light ? "ring--light" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference.toFixed(1)}
          strokeDashoffset={offset.toFixed(1)}
        />
      </svg>
      <span className="ring__value">
        <strong>{value ?? `${Math.round(clamp(pct, 0, 1) * 100)}%`}</strong>
        <span>{label}</span>
      </span>
    </div>
  );
}
