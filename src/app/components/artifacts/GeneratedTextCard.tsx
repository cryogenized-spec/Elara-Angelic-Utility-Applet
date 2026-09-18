import { useEffect, useState } from 'react';
import type { DerivedArtifact, GeneratedArtifact } from '../../../domain/artifact';
import { MarkdownText } from '../MarkdownText';
import { ArtifactStatus } from './ArtifactStatus';

type LoadedBlobText = {
  blob: Blob;
  content: string;
};

export function GeneratedTextCard({ artifact }: { artifact: GeneratedArtifact | DerivedArtifact }) {
  const sourceContent = artifact.sourceCode?.content;
  const [loadedBlob, setLoadedBlob] = useState<LoadedBlobText | null>(null);
  const markdown = artifact.mimeType === 'text/markdown' || artifact.sourceCode?.language === 'markdown';

  useEffect(() => {
    const blob = artifact.outputBlob;
    if (sourceContent !== undefined || !blob) return undefined;
    let active = true;
    void readText(blob).then((text) => {
      if (active) setLoadedBlob({ blob, content: text });
    }).catch(() => {
      if (active) setLoadedBlob({ blob, content: '' });
    });
    return () => { active = false; };
  }, [artifact.outputBlob, sourceContent]);

  const content = sourceContent
    ?? (artifact.outputBlob && loadedBlob?.blob === artifact.outputBlob ? loadedBlob.content : '');

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
