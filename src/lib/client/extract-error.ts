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

/**
 * Maps a failed add-source response to the message shown in the sheet. A 413
 * with no JSON body comes from the hosting layer, not the app, when a request
 * body is too large — say so instead of showing a bare status code.
 */
export function addSourceErrorMessage(status: number, apiError?: string | null): string {
  if (apiError) return apiError;
  if (status === 413) {
    return 'That upload is too large for the server. Legacy .ppt files must be under 4 MB — save the deck as .pptx and try again.';
  }
  return `Could not add source (${status})`;
}
