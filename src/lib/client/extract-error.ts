type ExtractKind = 'pdf' | 'ppt';

const GENERIC: Record<ExtractKind, string> = {
  pdf: 'Could not read that PDF.',
  ppt: 'Could not read that PowerPoint file.'
};

/**
 * Client-side extractors tag failures with a `code`. Hitting a size limit is
 * actionable, so show the real numbers instead of claiming the file is
 * unreadable; anything else falls back to the generic copy.
 */
export function extractErrorMessage(error: unknown, kind: ExtractKind): string {
  const code = (error as { code?: unknown } | null)?.code;
  const tooLarge = kind === 'pdf' ? 'PDF_TOO_LARGE' : 'PPTX_TOO_LARGE';
  const message = error instanceof Error ? error.message : '';
  if (code === tooLarge && message.length > 0) return message;
  return GENERIC[kind];
}
