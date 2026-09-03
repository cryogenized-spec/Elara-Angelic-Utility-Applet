import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const allowedElements = ['p', 'em', 'strong', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr', 'br'] as const;

export function MarkdownText({ text }: { text: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    allowedElements={[...allowedElements]}
    components={{
      a: ({ href, children }) => {
        if (!href || !/^https:\/\//i.test(href)) return <span>{children}</span>;
        return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
      },
    }}
  >{text}</ReactMarkdown>;
}
