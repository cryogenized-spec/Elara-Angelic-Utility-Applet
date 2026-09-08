import type { DerivedArtifact } from '../domain/artifact';
import type { OCRResult } from '../ocr/contracts';
import { artifactRepository } from './repository';

export async function createOcrTextArtifact(input: {
  sourceArtifactId: string;
  result: OCRResult;
  sourceMessageId?: string;
  name?: string;
}): Promise<DerivedArtifact> {
  const text = input.result.text.trim();
  return artifactRepository.create({
    artifactType: 'derived',
    name: input.name ?? 'ocr-result.txt',
    mimeType: 'text/plain',
    sourceCode: { language: 'markdown', content: text },
    outputBlob: new Blob([text], { type: 'text/plain' }),
    parentArtifactIds: [input.sourceArtifactId],
    transformation: 'image-to-ocr-text',
    sourceMessageId: input.sourceMessageId,
    status: 'ready',
  }) as Promise<DerivedArtifact>;
}
