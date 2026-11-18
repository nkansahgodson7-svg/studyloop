import { describe, expect, it } from 'vitest';
import { addSourceErrorMessage, extractErrorMessage } from './extract-error';

function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('extractErrorMessage', () => {
  it('surfaces the real page count when a PDF is over the limit', () => {
    const error = coded('This PDF has 240 pages — the limit is 100.', 'PDF_TOO_LARGE');
    expect(extractErrorMessage(error, 'pdf')).toBe('This PDF has 240 pages — the limit is 100.');
  });

  it('surfaces the real slide count when a deck is over the limit', () => {
    const error = coded('This deck has 163 slides — the limit is 100.', 'PPTX_TOO_LARGE');
    expect(extractErrorMessage(error, 'ppt')).toBe('This deck has 163 slides — the limit is 100.');
  });

  it('keeps the generic copy for unreadable files', () => {
    expect(extractErrorMessage(coded('not a readable PDF', 'BAD_PDF'), 'pdf')).toBe('Could not read that PDF.');
    expect(extractErrorMessage(coded('not a readable PPTX', 'BAD_PPTX'), 'ppt')).toBe(
      'Could not read that PowerPoint file.'
    );
  });

  it('ignores limit messages that belong to the other file type', () => {
    const error = coded('This deck has 163 slides — the limit is 100.', 'PPTX_TOO_LARGE');
    expect(extractErrorMessage(error, 'pdf')).toBe('Could not read that PDF.');
  });

  it('falls back for values that are not errors', () => {
    expect(extractErrorMessage(null, 'ppt')).toBe('Could not read that PowerPoint file.');
    expect(extractErrorMessage('boom', 'pdf')).toBe('Could not read that PDF.');
  });
});

describe('addSourceErrorMessage', () => {
  it('shows the API message when the server explains itself', () => {
    expect(addSourceErrorMessage(413, 'source text too large')).toBe('source text too large');
    expect(addSourceErrorMessage(409, 'a notebook can hold at most 100 sources')).toBe(
      'a notebook can hold at most 100 sources'
    );
  });

  it('explains a bodyless 413 as an upload that is too large', () => {
    expect(addSourceErrorMessage(413, null)).toContain('.ppt files must be under 4 MB');
    expect(addSourceErrorMessage(413)).toContain('save the deck as .pptx');
  });

  it('keeps the status code for other failures', () => {
    expect(addSourceErrorMessage(500, null)).toBe('Could not add source (500)');
    expect(addSourceErrorMessage(502)).toBe('Could not add source (502)');
  });
});
