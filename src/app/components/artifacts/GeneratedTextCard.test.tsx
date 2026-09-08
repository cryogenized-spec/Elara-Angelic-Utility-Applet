import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneratedTextCard } from './GeneratedTextCard';

describe('GeneratedTextCard', () => {
  it('renders generated Markdown through the restricted Markdown renderer', () => {
    const html = renderToStaticMarkup(<GeneratedTextCard artifact={{
      id: 'markdown-1', artifactType: 'derived', provenance: 'derived_transformation', name: 'notes.md', mimeType: 'text/markdown', size: 12, createdAt: 1, status: 'ready', parentArtifactIds: ['source-1'], transformation: 'test', sourceCode: { language: 'markdown', content: '# Notes\n\nSafe text' },
    }} />);
    expect(html).toContain('Safe text');
  });

  it('renders generated source code in a bounded code block', () => {
    const html = renderToStaticMarkup(<GeneratedTextCard artifact={{
      id: 'code-1', artifactType: 'generated', provenance: 'generated_tool', name: 'snippet.py', mimeType: 'text/x-python', size: 13, createdAt: 1, status: 'ready', sourceCode: { language: 'python', content: 'print("hello")' },
    }} />);
    expect(html).toContain('<pre');
    expect(html).toContain('print(&quot;hello&quot;)');
  });
});
