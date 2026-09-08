import type { Attachment } from '../domain/artifact';
import { artifactRepository } from './repository';
import { ArtifactError } from './errors';
import { validateFile, type ValidatedFile } from './validation';

export interface AttachmentIntakeResult {
  attachment?: Attachment;
  error?: ArtifactError;
}

export async function createAttachmentFromFile(file: File | null | undefined): Promise<AttachmentIntakeResult> {
  try {
    const validated = await validateFile(file);
    return { attachment: await persistValidatedAttachment(validated) };
  } catch (cause) {
    if (cause instanceof ArtifactError) return { error: cause };
    return { error: new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The file could not be read safely.', cause) };
  }
}

export async function persistValidatedAttachment(validated: ValidatedFile): Promise<Attachment> {
  const attachment = await artifactRepository.create({
    artifactType: 'attachment',
    name: validated.name,
    mimeType: validated.mimeType,
    kind: validated.kind,
    data: validated.file,
    status: 'processing',
  });
  try {
    return await artifactRepository.setStatus(attachment.id, 'ready') as Attachment;
  } catch (cause) {
    await artifactRepository.setStatus(attachment.id, 'failed', { code: 'ARTIFACT_STORAGE_FAILED', message: 'The attachment could not be finalized.' }).catch(() => undefined);
    throw cause;
  }
}
