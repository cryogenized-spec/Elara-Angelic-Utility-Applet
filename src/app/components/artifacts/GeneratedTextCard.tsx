import { useEffect, useState } from 'react';
import type { DerivedArtifact, GeneratedArtifact } from '../../../domain/artifact';
import { MarkdownText } from '../MarkdownText';
import { ArtifactStatus } from './ArtifactStatus';

export function GeneratedTextCard({ artifact }: { artifact: GeneratedArtifact | DerivedArtifact }) {
  const sourceContent = artifact.sourceCode?.content;
  const [content, setContent] = useState(sourceContent ?? '');
  const markdown = artifact.mimeType === 'text/markdown' || artifact.sourceCode?.language === 'markdown';

  useEffect(() => {
    let active = true;
    if (sourceContent !== undefined) {
      setContent(sourceContent);
      return () => { active = false; };
    }
    if (!artifact.outputBlob) {
      setContent('');
      return () => { active = false; };
    }
    void readText(artifact.outputBlob).then((text) => {
      if (active) setContent(text);
    }).catch(() => {
      if (active) setContent('');
    });
    return () => { active = false; };
  }, [artifact.outputBlob, sourceContent]);

  return <article className="artifact-card artifact-card--text" aria-label={`Generated artifact ${artifact.name}`}>
    <div className="artifact-card__meta">
      <strong>{artifact.name}</strong>
      <span>{artifact.mimeType} · {formatBytes(artifact.size)}</span>
      <ArtifactStatus status={artifact.status} errorMessage={artifact.errorMessage} />
    </div>
    {content && (markdown ? <div className="artifact-card__content"><MarkdownText text={content} /></div> : <pre className="artifact-card__code">{content}</pre>)}
  </article>;
}

async function readText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Response(blob).text();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
