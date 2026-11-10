import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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

  it('never injects raw HTML', () => {
    const { container } = render(
      <Markdown text={'<img src="x" onerror="alert(1)"> and <script>bad()</script>'} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img');
  });
});
