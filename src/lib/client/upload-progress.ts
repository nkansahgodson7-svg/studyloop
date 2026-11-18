export type Phase =
  | { kind: 'reading'; unit: 'page' | 'slide'; done: number; total: number }
  | { kind: 'uploading'; label: string }
  | { kind: 'indexing'; unit: 'pages' | 'slides'; total: number };

/**
 * What the add-source sheet reports while a file is being read, sent and
 * indexed. `uploadPercent` is UploadThing's 0-100 progress, which stays at 0
 * for uploads that do not go through storage.
 */
export function describePhase(phase: Phase | null, uploadPercent = 0): string {
  if (!phase) return '';
  if (phase.kind === 'reading') {
    // The total is unknown until the document header has been parsed.
    if (phase.total <= 0) return `Reading ${phase.unit === 'page' ? 'pages' : 'slides'}`;
    return `Reading ${phase.unit} ${phase.done} of ${phase.total}`;
  }
  if (phase.kind === 'uploading') {
    return uploadPercent > 0 && uploadPercent < 100
      ? `${phase.label}… ${Math.round(uploadPercent)}%`
      : `${phase.label}…`;
  }
  return `Indexing ${phase.total} ${phase.unit}`;
}
