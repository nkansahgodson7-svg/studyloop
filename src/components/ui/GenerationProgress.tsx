import { Icon } from "@/components/ui/icons";

export type GenerationStepState = "done" | "active" | "waiting";

export interface GenerationStep {
  label: string;
  state: GenerationStepState;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The wait for a model-written artifact: elapsed clock, a meter, and steps that
 * only advance when the server reports real work. Pass `indeterminate` when
 * there is no honest fraction to show yet.
 */
export function GenerationProgress({
  title,
  unit,
  written,
  total,
  elapsedSeconds,
  steps,
  hint,
  indeterminate = false
}: {
  title: string;
  unit: "questions" | "cards";
  written: number;
  total: number;
  elapsedSeconds: number;
  steps: GenerationStep[];
  hint: string;
  indeterminate?: boolean;
}) {
  return (
    <div className="gen">
      <div className="gen__head">
        <p className="gen__title">{title}</p>
        <div className="gen__meta">
          <span>
            {written} of {total} {unit}
          </span>
          <span className="gen__clock">{clock(elapsedSeconds)}</span>
        </div>
      </div>
      <div
        className={`gen__meter${indeterminate ? " is-indeterminate" : ""}`}
        role="progressbar"
        aria-label={`${unit === "cards" ? "Cards" : "Questions"} written`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={indeterminate ? undefined : written}
      >
        <span className="gen__fill" style={indeterminate ? undefined : { width: `${total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0}%` }} />
      </div>
      <p className="sr-only" role="status">
        {written} of {total} {unit} written
      </p>
      <ol className="gen__steps">
        {steps.map((step) => (
          <li
            key={step.label}
            className={`gen__step is-${step.state}`}
            aria-current={step.state === "active" ? "step" : undefined}
          >
            <span className="gen__dot" aria-hidden="true">
              {step.state === "done" ? <Icon name="check" size={11} /> : null}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <p className="hint">{hint}</p>
    </div>
  );
}
