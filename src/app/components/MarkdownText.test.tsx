import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownText } from './MarkdownText';

describe('MarkdownText security boundary', () => {
  it('does not render raw HTML as active DOM', () => {
    const html = renderToStaticMarkup(
      <MarkdownText text={'<script>alert(1)</script><img src="x" onerror="alert(2)">Safe text'} />,
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('Safe text');
  });

  it('keeps safe HTTPS links and rejects unsafe schemes', () => {
    const html = renderToStaticMarkup(
      <MarkdownText text={'[Safe](https://example.com) [Unsafe](javascript:alert(1))'} />,
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).toContain('Unsafe');
  });
});
