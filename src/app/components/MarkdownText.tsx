import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const allowedElements = ['p', 'em', 'strong', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr', 'br'] as const;

export function safeMarkdownUrl(url: string): string {
  return /^https:\/\//i.test(url.trim()) ? url.trim() : '';
}

/**
 * Memoised: `react-markdown` builds a fresh processor and re-parses its input
 * on every render, so re-rendering an unchanged message body is expensive.
 * Memoising keeps typing (and streaming) from re-parsing the whole transcript.
 */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    allowedElements={[...allowedElements]}
    urlTransform={safeMarkdownUrl}
    components={{
      a: ({ href, children }) => {
        const safeHref = href ? safeMarkdownUrl(href) : '';
        if (!safeHref) return <span>{children}</span>;
        return <a href={safeHref} target="_blank" rel="noreferrer noopener">{children}</a>;
      },
    }}
  >{text}</ReactMarkdown>;
});
