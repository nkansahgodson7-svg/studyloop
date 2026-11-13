import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import Markdown from './Markdown';

describe('Markdown', () => {
  it('renders emphasis, lists, and code blocks', () => {
    const { container } = render(
      <Markdown
        text={[
          'A **bold** word and `inline`.',
          '',
          '- first',
          '- second',
          '',
          '1. one',
          '2. two',
          '',
          '```js',
          'const x = 1;',
          '```'
        ].join('\n')}
      />
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('inline');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('pre')?.textContent).toContain('const x = 1;');
  });

  it('keeps a partially streamed code fence readable', () => {
    const { container } = render(<Markdown text={'```py\nprint(1)'} />);
    expect(container.querySelector('pre')?.textContent).toBe('print(1)');
  });

  it('renders LaTeX maths in both delimiter styles', async () => {
    const { container } = render(
      <Markdown
        text={[
          'A point in \\(\\mathbb{R}^n\\) and \\(e_1\\).',
          '',
          '\\[',
          '\\|a\\cdot b\\| \\le \\|a\\|\\|b\\|',
          '\\]'
        ].join('\n')}
      />
    );
    const inlineMath = container.querySelectorAll('.md-math:not(.md-math--display)');
    expect(inlineMath.length).toBe(2);
    // KaTeX is loaded on demand, then display maths gets its own block and is
    // not left as raw TeX.
    await waitFor(() => {
      expect(container.querySelector('.md-math-block .katex-display')).not.toBeNull();
    });
    expect(container.textContent).not.toContain('\\mathbb');
    expect(container.textContent).not.toContain('\\|a');
  });

  it('renders pipe tables and drops leaked control markers', () => {
    const { container } = render(
      <Markdown
        text={[
          '[[grounding:sources]] [[used:1,3]]',
          'Intro line.',
          '',
          '| Idea | Use |',
          '| --- | :--: |',
          '| Dot product | Shading |',
          '[[used:1,3,4,5]]'
        ].join('\n')}
      />
    );
    expect(container.querySelectorAll('table th')).toHaveLength(2);
    expect(container.querySelectorAll('table td')).toHaveLength(2);
    expect(container.textContent).toContain('Dot product');
    expect(container.textContent).not.toContain('[[used');
    expect(container.textContent).not.toContain('[[grounding');
  });

  it('keeps unescaped pipes inside maths from splitting table cells', async () => {
    const { container } = render(
      <Markdown text={'| Idea | Formula |\n| --- | --- |\n| Norm | \\(||v|| = \\sqrt{v\\cdot v}\\) |'} />
    );
    expect(container.querySelectorAll('table td')).toHaveLength(2);
    await waitFor(() => {
      expect(container.querySelectorAll('table td')[1]?.querySelector('.katex')).not.toBeNull();
    });
  });

  it('never injects raw HTML', () => {
    const { container } = render(
      <Markdown text={'<img src="x" onerror="alert(1)"> and <script>bad()</script>'} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img');
  });
});
