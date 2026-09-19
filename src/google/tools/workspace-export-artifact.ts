import type { Attachment } from '../../domain/artifact';
import { ArtifactError, type ArtifactErrorCode } from '../../artifacts/errors';
import { artifactRepository } from '../../artifacts/repository';
import { kindForMime } from '../../artifacts/validation';
import { DriveTransferError } from '../drive/errors';

export interface WorkspaceExportContent {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: string;
}

export interface WorkspaceExportArtifactInput {
  readonly fileId: string;
  readonly baseName: string;
  readonly conversationId?: string;
  readonly generationId?: string;
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
  readonly exportContent: () => Promise<WorkspaceExportContent>;
}

export type WorkspaceExportArtifactResult =
  | {
    readonly status: 'ready';
    readonly artifactId: string;
    readonly operationId: string;
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
  }
  | {
    readonly status: 'failed';
    readonly artifactId?: string;
    readonly operationId?: string;
    readonly errorCode: ArtifactErrorCode;
    readonly error: string;
  };

function asArtifactError(cause: unknown): ArtifactError {
  if (cause instanceof ArtifactError) return cause;
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Google Workspace export was cancelled.', cause);
  }
  if (cause instanceof DriveTransferError) {
    if (cause.code === 'DRIVE_FILE_TOO_LARGE') return new ArtifactError('FILE_TOO_LARGE', cause.message, cause);
    return new ArtifactError('DRIVE_DOWNLOAD_FAILED', cause.message, cause);
  }
  return new ArtifactError('DRIVE_DOWNLOAD_FAILED', 'The Google Workspace file could not be exported.', cause);
}

function exportName(baseName: string, fileId: string, extension: string): string {
  // eslint-disable-next-line no-control-regex -- exported filenames must not contain controls
  const cleaned = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/[\\/:*?"<>|]/g, '-');
  const stem = (cleaned || `google-export-${fileId.slice(0, 8)}`).slice(0, 160);
  return stem.toLowerCase().endsWith(extension.toLowerCase()) ? stem : `${stem}${extension}`;
}

export async function saveGoogleWorkspaceExportArtifact(input: WorkspaceExportArtifactInput): Promise<WorkspaceExportArtifactResult> {
  if (!input.conversationId) {
    return {
      status: 'failed',
      errorCode: 'DRIVE_DOWNLOAD_FAILED',
      error: 'Google Workspace exports need an open conversation; an unattended run cannot create a conversation artifact.',
    };
  }
  const isCurrent = () => !input.signal?.aborted && input.isGenerationActive?.() !== false;
  const operationId = `${input.generationId ?? crypto.randomUUID()}:workspace-export:${crypto.randomUUID()}`;
  let artifact: Attachment | undefined;

  try {
    if (!isCurrent()) throw new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Google Workspace export was superseded before it started.');
    const exported = await input.exportContent();
    if (!exported.bytes.byteLength) throw new ArtifactError('UNSUPPORTED_FILE', 'The exported Google Workspace file is empty.');
    if (!isCurrent()) throw new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Google Workspace export was superseded before it was saved.');
    const name = exportName(input.baseName, input.fileId, exported.extension);
    artifact = await artifactRepository.create({
      artifactType: 'attachment',
      name,
      mimeType: exported.mimeType,
      kind: kindForMime(exported.mimeType),
      data: new Blob([exported.bytes.slice()], { type: exported.mimeType }),
      provenance: 'derived_transformation',
      status: 'processing',
    }) as Attachment;
    await artifactRepository.beginOperation(artifact.id, operationId, 'processing');
    if (!isCurrent()) throw new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Google Workspace export was superseded while it was being saved.');
    await artifactRepository.setStatus(artifact.id, 'ready', undefined, {
      operationId,
      expectedStatus: 'processing',
      isValid: isCurrent,
    });
    return {
      status: 'ready',
      artifactId: artifact.id,
      operationId,
      name: artifact.name,
      mimeType: artifact.mimeType,
      size: artifact.size,
    };
  } catch (cause) {
    const error = asArtifactError(cause);
    if (artifact) {
      await artifactRepository
        .setStatus(artifact.id, 'failed', { code: error.code, message: error.userMessage }, { operationId, expectedStatus: 'processing' })
        .catch(() => undefined);
    }
    return {
      status: 'failed',
      ...(artifact ? { artifactId: artifact.id, operationId } : {}),
      errorCode: error.code,
      error: error.userMessage,
    };
  }
}
