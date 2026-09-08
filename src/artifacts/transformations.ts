import type { DerivedArtifact } from '../domain/artifact';
import type { OCRResult } from '../ocr/contracts';
import { artifactRepository } from './repository';

export async function createOcrTextArtifact(input: {
  sourceArtifactId: string;
  result: OCRResult;
  sourceMessageId?: string;
  name?: string;
  messageId?: string;
  conversationId?: string;
  operationId?: string;
}): Promise<DerivedArtifact> {
  const text = input.result.text.trim();
  const artifactInput = {
    artifactType: 'derived' as const,
    name: input.name ?? 'ocr-result.txt',
    mimeType: 'text/plain',
    sourceCode: { language: 'markdown' as const, content: text },
    outputBlob: new Blob([text], { type: 'text/plain' }),
    parentArtifactIds: [input.sourceArtifactId],
    transformation: 'image-to-ocr-text',
    sourceMessageId: input.sourceMessageId,
    status: 'ready' as const,
    operationId: input.operationId,
  };
  if (input.messageId && input.conversationId) return artifactRepository.createAndAttach(artifactInput, input.messageId, input.conversationId) as Promise<DerivedArtifact>;
  return artifactRepository.create(artifactInput) as Promise<DerivedArtifact>;
}
