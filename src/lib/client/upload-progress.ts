export type Phase =
  | { kind: 'reading'; unit: 'page' | 'slide'; done: number; total: number }
  | { kind: 'uploading'; label: string }
  | { kind: 'indexing'; unit: 'pages' | 'slides'; total: number }
  | { kind: 'working'; label: string };

/** What the add-source sheet says is happening right now. */
export function describePhase(phase: Phase | null): string {
  if (!phase) return '';
  if (phase.kind === 'reading') {
    // The total is unknown until the document header has been parsed.
    if (phase.total <= 0) return `Reading ${phase.unit === 'page' ? 'pages' : 'slides'}`;
    return `Reading ${phase.unit} ${phase.done} of ${phase.total}`;
  }
  if (phase.kind === 'indexing') return `Indexing ${phase.total} ${phase.unit}`;
  return phase.label;
}

/**
 * Fraction of the current step that is done, or null when the step cannot be
 * measured (chunking on the server, or an upload that has not reported yet).
 * `uploadPercent` is UploadThing's 0-100 progress.
 */
export function phaseProgress(phase: Phase | null, uploadPercent = 0): number | null {
  if (!phase) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  if (phase.kind === 'reading') {
    return phase.total > 0 ? clamp(phase.done / phase.total) : null;
  }
  if (phase.kind === 'uploading') {
    return uploadPercent > 0 ? clamp(uploadPercent / 100) : null;
  }
  return null;
}
