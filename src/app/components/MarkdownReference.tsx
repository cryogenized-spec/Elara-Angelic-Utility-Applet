import { useEffect } from 'react';
import './markdown-reference.css';

const rows = [
  ['Italic', '*text*', '*text*'],
  ['Bold', '**text**', '**text**'],
  ['Bold italic', '***text***', '***text***'],
  ['Strikethrough', '~~text~~', '~~text~~'],
  ['Inline code', '`code`', '`code`'],
  ['Code block', '```code```', '```code```'],
  ['Bullets', '- item', '- item'],
  ['Numbered list', '1. item', '1. item'],
  ['Quote', '> text', '> text'],
  ['Link', '[name](https://...)', '[name](https://...)'],
  ['Rule', '---', '---'],
  ['Roleplay action', '*action / narration*', '*action / narration*'],
];

export function MarkdownReference({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="markdown-reference__backdrop" role="presentation" onClick={onClose}>
    <section className="markdown-reference" role="dialog" aria-modal="true" aria-labelledby="markdown-reference-title" onClick={(event) => event.stopPropagation()}>
      <header><div><span className="panel-kicker">COMPOSER</span><h2 id="markdown-reference-title">Markdown</h2></div><button type="button" className="icon-button" aria-label="Close Markdown reference" onClick={onClose}>×</button></header>
      <p>Restricted Markdown is supported. Raw HTML, scripts, embeds, arbitrary CSS, and browser-active markup are not rendered.</p>
      <div className="markdown-reference__rows">{rows.map(([label, syntax]) => <div className="markdown-reference__row" key={label}><span>{label}</span><code>{syntax}</code></div>)}</div>
      <a className="markdown-reference__docs" href="https://github.com/cryogenized-spec/Elara-Angelic-Utility-Applet/blob/main/docs/MARKDOWN_FORMAT.md" target="_blank" rel="noreferrer noopener">Full Markdown format documentation ↗</a>
    </section>
  </div>;
}
