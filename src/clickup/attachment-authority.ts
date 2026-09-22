import { artifactRepository } from '../artifacts/repository';
import { ARTIFACT_LIMITS } from '../artifacts/limits';
import type { Artifact } from '../domain/artifact';
import { validateClickUpToolArguments, type ClickUpToolArguments } from './tool-schema';

const CLICKUP_ARTIFACT_PREVIEW_BYTES = 64 * 1024;
const CLICKUP_ARTIFACT_PREVIEW_CHARS = 20_000;

export interface ClickUpArtifactApprovalSnapshot {
  readonly artifactId: string;
  readonly artifactName: string;
  readonly uploadName: string;
  readonly mimeType: string;
  readonly metadataSize: number;
  readonly payloadSize: number;
  readonly sha256: string;
  /** Optional bounded preview derived from the exact approved Blob. */
  readonly previewText?: string;
  readonly previewTruncated?: boolean;
  /** Immutable Blob captured before confirmation; never model-visible. */
  readonly blob: Blob;
}

export class ClickUpArtifactApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blobBytes(blob));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function artifactPayload(artifact: Artifact): Blob | undefined {
  if (artifact.artifactType === 'attachment') return artifact.data;
  if (artifact.outputBlob) return artifact.outputBlob;
  if (artifact.sourceCode?.content !== undefined) {
    return new Blob([artifact.sourceCode.content], { type: artifact.mimeType });
  }
  return undefined;
}

function previewableTextMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return normalized.startsWith('text/')
    || normalized === 'application/json'
    || normalized === 'application/xml'
    || normalized === 'application/yaml'
    || normalized === 'application/x-yaml'
    || normalized === 'application/javascript'
    || normalized === 'application/typescript'
    || normalized === 'image/svg+xml';
}

async function artifactPreview(blob: Blob, mimeType: string): Promise<{ previewText?: string; previewTruncated?: boolean }> {
  if (!previewableTextMime(mimeType) || blob.size === 0) return {};
  const previewBlob = blob.slice(0, CLICKUP_ARTIFACT_PREVIEW_BYTES);
  const decoded = new TextDecoder().decode(await blobBytes(previewBlob));
  const previewText = decoded.slice(0, CLICKUP_ARTIFACT_PREVIEW_CHARS);
  if (!previewText) return {};
  const previewTruncated = blob.size > previewBlob.size || decoded.length > previewText.length;
  return {
    previewText,
    ...(previewTruncated ? { previewTruncated: true } : {}),
  };
}

async function readyArtifact(artifactId: string): Promise<{ artifact: Artifact; blob: Blob }> {
  const artifact = await artifactRepository.get(artifactId);
  if (artifact.status !== 'ready') {
    throw new ClickUpArtifactApprovalError('artifact-not-ready', 'Only ready Elara artifacts can be attached to ClickUp.');
  }
  const blob = artifactPayload(artifact);
  if (!blob) throw new ClickUpArtifactApprovalError('artifact-payload', 'The selected Elara artifact has no attachable payload.');
  if (blob.size > ARTIFACT_LIMITS.maxAttachmentBytes) {
    throw new ClickUpArtifactApprovalError('artifact-too-large', `Elara attachments are limited to ${ARTIFACT_LIMITS.maxAttachmentBytes} bytes.`);
  }
  return { artifact, blob };
}

export async function captureClickUpArtifactApprovalSnapshot(
  rawArguments: unknown,
): Promise<ClickUpArtifactApprovalSnapshot> {
  const args = validateClickUpToolArguments('clickup.attachArtifact', rawArguments) as ClickUpToolArguments<'clickup.attachArtifact'>;
  const { artifact, blob } = await readyArtifact(args.artifactId);
  const preview = await artifactPreview(blob, artifact.mimeType);
  return Object.freeze({
    artifactId: args.artifactId,
    artifactName: artifact.name,
    uploadName: args.filename ?? artifact.name,
    mimeType: artifact.mimeType,
    metadataSize: artifact.size,
    payloadSize: blob.size,
    sha256: await sha256Hex(blob),
    ...preview,
    blob,
  });
}

export async function assertClickUpArtifactSnapshotCurrent(
  snapshot: ClickUpArtifactApprovalSnapshot,
): Promise<void> {
  let current: { artifact: Artifact; blob: Blob };
  try {
    current = await readyArtifact(snapshot.artifactId);
  } catch (error) {
    if (error instanceof ClickUpArtifactApprovalError) throw error;
    throw new ClickUpArtifactApprovalError('artifact-changed', 'The approved Elara artifact is no longer available.');
  }

  const { artifact, blob } = current;
  if (
    artifact.name !== snapshot.artifactName
    || artifact.mimeType !== snapshot.mimeType
    || artifact.size !== snapshot.metadataSize
    || blob.size !== snapshot.payloadSize
  ) {
    throw new ClickUpArtifactApprovalError(
      'artifact-changed',
      'The Elara artifact changed after approval. Review the attachment again before uploading.',
    );
  }

  const digest = await sha256Hex(blob);
  if (digest !== snapshot.sha256) {
    throw new ClickUpArtifactApprovalError(
      'artifact-changed',
      'The Elara artifact bytes changed after approval. Review the attachment again before uploading.',
    );
  }
}
