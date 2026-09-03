import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownText } from './MarkdownText';

describe('MarkdownText security boundary', () => {
  it('does not render raw HTML as active DOM while preserving ordinary text', () => {
    const html = renderToStaticMarkup(
      <MarkdownText text={'Safe text\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">'} />,
    );

    expect(html).toContain('Safe text');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=');
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
