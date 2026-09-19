import type { Attachment } from '../../domain/artifact';
import { ArtifactError, type ArtifactErrorCode } from '../../artifacts/errors';
import { artifactRepository } from '../../artifacts/repository';
import { kindForMime } from '../../artifacts/validation';
import { googleOAuthAuthority } from '../oauth/authority';
import { DriveTransferError } from './errors';
import { GoogleDriveService } from './service';

const drive = new GoogleDriveService(googleOAuthAuthority);

export interface DriveDownloadArtifactInput {
  fileId: string;
  /**
   * The conversation the downloaded file becomes an artifact of. A download
   * exists to put a file into a conversation, so an unattended (headless) run
   * without one is refused instead of leaving an orphaned local artifact behind.
   */
  conversationId?: string;
  maxBytes?: number;
  signal?: AbortSignal;
  generationId?: string;
  isGenerationActive?: () => boolean;
}

/**
 * What `drive.downloadFile` returns to the model.
 *
 * A ready download reports artifact identity and bounded metadata only. File
 * bytes never cross this boundary: they are persisted locally through the
 * artifact repository, and the shape `{artifactId, status, mimeType}` is the same
 * projection `document.create_pdf` uses, so the tool loop surfaces a card
 * instead of a payload.
 */
export type DriveDownloadArtifactResult =
  | {
    readonly status: 'ready';
    readonly artifactId: string;
    readonly operationId: string;
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
    readonly webViewLink?: string;
  }
  | {
    readonly status: 'failed';
    readonly artifactId?: string;
    readonly operationId?: string;
    readonly name?: string;
    readonly mimeType?: string;
    readonly errorCode: ArtifactErrorCode;
    readonly error: string;
  };

function asArtifactError(cause: unknown): ArtifactError {
  if (cause instanceof ArtifactError) return cause;
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Drive download was cancelled.', cause);
  }
  if (cause instanceof DriveTransferError) {
    if (cause.code === 'DRIVE_FILE_TOO_LARGE') return new ArtifactError('FILE_TOO_LARGE', cause.message, cause);
    if (cause.code === 'DRIVE_FILE_UNSUPPORTED') return new ArtifactError('UNSUPPORTED_FILE', cause.message, cause);
    return new ArtifactError('DRIVE_DOWNLOAD_FAILED', cause.message, cause);
  }
  return new ArtifactError('DRIVE_DOWNLOAD_FAILED', 'The Drive file could not be downloaded.', cause);
}

function boundedName(metadataName: string, fileId: string): string {
  const trimmed = metadataName.trim();
  if (trimmed) return trimmed;
  return `drive-download-${fileId.slice(0, 8)}`;
}

/**
 * Download one Drive file into the local artifact repository and return bounded
 * metadata.
 *
 * The provider read is bounded before it starts (declared size, MIME type,
 * application transfer ceiling) and the artifact's lifecycle commit is guarded by
 * the live generation, so a superseded or cancelled turn cannot publish a
 * `ready` artifact for bytes it no longer owns.
 */
export async function downloadDriveFileArtifact(input: DriveDownloadArtifactInput): Promise<DriveDownloadArtifactResult> {
  if (!input.conversationId) {
    return {
      status: 'failed',
      name: boundedName('', input.fileId),
      mimeType: 'application/octet-stream',
      errorCode: 'DRIVE_DOWNLOAD_FAILED',
      error: 'Drive downloads need an open conversation; an unattended run cannot create a conversation artifact.',
    };
  }
  const isCurrent = () => !input.signal?.aborted && input.isGenerationActive?.() !== false;
  const operationId = `${input.generationId ?? crypto.randomUUID()}:drive-download:${crypto.randomUUID()}`;

  let name = boundedName('', input.fileId);
  let mimeType = 'application/octet-stream';
  let webViewLink: string | undefined;
  let artifact: Attachment | undefined;

  try {
    if (!isCurrent()) throw new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Drive download was superseded before it started.');
    const download = await drive.downloadFile(input.fileId, {
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!download.bytes.byteLength) throw new ArtifactError('UNSUPPORTED_FILE', 'The Drive file is empty, so there is nothing to download.');
    if (!isCurrent()) throw new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Drive download was superseded before it was saved.');

    name = boundedName(download.metadata.name, input.fileId);
    // The metadata MIME type is authority when the media response is generic;
    // classification (and therefore the artifact kind) follows MIME, never a name.
    mimeType = download.mimeType && download.mimeType !== 'application/octet-stream' ? download.mimeType : download.metadata.mimeType;
    webViewLink = download.metadata.webViewLink;

    artifact = await artifactRepository.create({
      artifactType: 'attachment',
      name,
      mimeType,
      kind: kindForMime(mimeType),
      data: new Blob([download.bytes.slice()], { type: mimeType }),
      provenance: 'derived_transformation',
      status: 'processing',
    }) as Attachment;
    await artifactRepository.beginOperation(artifact.id, operationId, 'processing');
    if (!isCurrent()) throw new ArtifactError('ARTIFACT_OPERATION_STALE', 'The Drive download was superseded while it was being saved.');
    await artifactRepository.setStatus(artifact.id, 'ready', undefined, { operationId, expectedStatus: 'processing', isValid: isCurrent });
    return {
      status: 'ready',
      artifactId: artifact.id,
      operationId,
      name: artifact.name,
      mimeType: artifact.mimeType,
      size: artifact.size,
      ...(webViewLink ? { webViewLink } : {}),
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
      name,
      mimeType,
      errorCode: error.code,
      error: error.userMessage,
    };
  }
}
