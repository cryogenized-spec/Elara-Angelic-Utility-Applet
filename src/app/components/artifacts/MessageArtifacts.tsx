import { useEffect, useRef, useState } from 'react';
import type { Artifact, Attachment } from '../../../domain/artifact';
import { artifactRepository } from '../../../artifacts/repository';
import { artifactErrorMessage } from '../../../artifacts/errors';
import { createOcrTextArtifact } from '../../../artifacts/transformations';
import { ocrService } from '../../../ocr/service';
import { ImageAttachmentPreview } from './ImageAttachmentPreview';
import { DocumentAttachmentCard } from './DocumentAttachmentCard';
import { GeneratedPdfCard } from './GeneratedPdfCard';
import { GeneratedTextCard } from './GeneratedTextCard';
import './artifact-preview.css';

const EMPTY_IDS: string[] = [];

export function MessageArtifacts({ attachmentIds = EMPTY_IDS, artifactIds = EMPTY_IDS, messageId, conversationId }: { attachmentIds?: string[]; artifactIds?: string[]; messageId?: string; conversationId?: string }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [ocrBusy, setOcrBusy] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const ocrOperationRef = useRef(0);
  const ocrControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([...attachmentIds, ...artifactIds].map((id) => artifactRepository.get(id).catch(() => null))).then((loaded) => {
      if (active) setArtifacts(loaded.filter((artifact): artifact is Artifact => artifact !== null));
    });
    return () => {
      active = false;
      ocrControllerRef.current?.abort();
      ocrControllerRef.current = null;
      ocrOperationRef.current += 1;
    };
  }, [attachmentIds, artifactIds]);

  async function extractText(attachment: Attachment): Promise<void> {
    if (ocrBusy) return;
    const operationNumber = ocrOperationRef.current + 1;
    ocrOperationRef.current = operationNumber;
    const controller = new AbortController();
    ocrControllerRef.current = controller;
    const isCurrent = () => ocrOperationRef.current === operationNumber && ocrControllerRef.current === controller && !controller.signal.aborted;
    setOcrBusy(attachment.id);
    setOcrError(null);
    try {
      const result = await ocrService.recognize(attachment.data, { sourceArtifactId: attachment.id, signal: controller.signal });
      if (!isCurrent()) return;
      const derived = await createOcrTextArtifact({ sourceArtifactId: attachment.id, result, sourceMessageId: messageId, messageId, conversationId, operationId: `ocr:${operationNumber}:${attachment.id}`, name: `${attachment.name.replace(/\.[^.]+$/, '')}-ocr.txt` });
      if (!isCurrent()) return;
      setArtifacts((current) => [...current, derived]);
    } catch (cause) {
      if (isCurrent() && !(cause instanceof DOMException && cause.name === 'AbortError')) setOcrError(artifactErrorMessage(cause, 'Local OCR failed.'));
    } finally {
      if (ocrControllerRef.current === controller) {
        ocrControllerRef.current = null;
        if (ocrOperationRef.current === operationNumber) setOcrBusy(null);
      }
    }
  }

  if (!artifacts.length && !ocrError) return null;
  return <div className="artifact-list message-artifacts">
    {artifacts.map((artifact) => {
      if (artifact.artifactType === 'attachment' && artifact.kind === 'image') return <ImageAttachmentPreview key={artifact.id} attachment={artifact} onExtractText={() => void extractText(artifact)} compact />;
      if (artifact.artifactType === 'attachment') return <DocumentAttachmentCard key={artifact.id} attachment={artifact} />;
      if (artifact.artifactType === 'generated' && artifact.mimeType === 'application/pdf') return <GeneratedPdfCard key={artifact.id} artifact={artifact} />;
      if (artifact.artifactType === 'generated' || artifact.artifactType === 'derived') return <GeneratedTextCard key={artifact.id} artifact={artifact} />;
      return null;
    })}
    {ocrBusy && <div className="artifact-card__processing" role="status" aria-live="polite">Extracting text locally…</div>}
    {ocrError && <div className="artifact-card__error" role="alert">{ocrError}</div>}
  </div>;
}
