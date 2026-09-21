import { artifactRepository } from '../artifacts/repository';
import { ARTIFACT_LIMITS } from '../artifacts/limits';
import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../autonomy/cloud/pairing';
import { validateClickUpToolArguments, type ClickUpToolArguments } from './tool-schema';

const CLICKUP_ATTACHMENT_PATH = '/clickup/attachment';
const UPLOAD_TIMEOUT_MS = 60_000;

export class ClickUpAttachmentUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

function activePairing(): AutonomyPairing {
  if (typeof window === 'undefined') throw new ClickUpAttachmentUploadError('pairing', 'ClickUp artifact upload requires a paired Worker.');
  const pairing = loadPairing();
  if (!pairing) throw new ClickUpAttachmentUploadError('pairing', 'Pair this Elara installation with its Worker before attaching files to ClickUp.');
  return pairing;
}

function workerBaseUrl(pairing: AutonomyPairing): string {
  let url: URL;
  try {
    url = new URL(pairing.workerUrl.trim());
  } catch {
    throw new ClickUpAttachmentUploadError('worker-url', 'The paired Worker URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ClickUpAttachmentUploadError('worker-url', 'The paired Worker URL must be an HTTPS URL without credentials, query, or fragment.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function installationToken(pairing: AutonomyPairing): Promise<string> {
  const token = (await resolvePairingToken(pairing)).trim();
  if (!token) throw new ClickUpAttachmentUploadError('credential', 'The paired Worker installation credential is unavailable.');
  return token;
}

async function artifactBlob(artifactId: string): Promise<{ blob: Blob; name: string; mimeType: string }> {
  const artifact = await artifactRepository.get(artifactId);
  if (artifact.status !== 'ready') {
    throw new ClickUpAttachmentUploadError('artifact-not-ready', 'Only ready Elara artifacts can be attached to ClickUp.');
  }

  let blob: Blob | undefined;
  if (artifact.artifactType === 'attachment') blob = artifact.data;
  else blob = artifact.outputBlob;

  if (!blob && artifact.artifactType !== 'attachment' && artifact.sourceCode?.content !== undefined) {
    blob = new Blob([artifact.sourceCode.content], { type: artifact.mimeType });
  }
  if (!blob) throw new ClickUpAttachmentUploadError('artifact-payload', 'The selected Elara artifact has no attachable payload.');
  if (blob.size > ARTIFACT_LIMITS.maxAttachmentBytes) {
    throw new ClickUpAttachmentUploadError('artifact-too-large', `Elara attachments are limited to ${ARTIFACT_LIMITS.maxAttachmentBytes} bytes.`);
  }

  return {
    blob,
    name: artifact.name,
    mimeType: artifact.mimeType,
  };
}

async function responseError(response: Response): Promise<ClickUpAttachmentUploadError> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return new ClickUpAttachmentUploadError(
    typeof payload?.code === 'string' ? payload.code : `http-${response.status}`,
    typeof payload?.message === 'string' ? payload.message : `ClickUp attachment upload failed with HTTP ${response.status}.`,
    response.status,
  );
}

export async function uploadClickUpArtifact(
  rawArguments: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const args = validateClickUpToolArguments('clickup.attachArtifact', rawArguments) as ClickUpToolArguments<'clickup.attachArtifact'>;
  const pairing = activePairing();
  const token = await installationToken(pairing);
  const artifact = await artifactBlob(args.artifactId);

  const form = new FormData();
  form.set('taskId', args.taskId);
  form.set('artifactId', args.artifactId);
  form.set('filename', args.filename ?? artifact.name);
  form.set('file', artifact.blob, args.filename ?? artifact.name);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${workerBaseUrl(pairing)}${CLICKUP_ATTACHMENT_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || payload.ok !== true || !payload.result || typeof payload.result !== 'object') {
      throw new ClickUpAttachmentUploadError('protocol', 'The ClickUp attachment endpoint returned an invalid result.', response.status);
    }
    return payload.result;
  } catch (error) {
    if (error instanceof ClickUpAttachmentUploadError) throw error;
    if (controller.signal.aborted) {
      throw new ClickUpAttachmentUploadError(
        signal?.aborted ? 'cancelled' : 'timeout',
        signal?.aborted ? 'ClickUp attachment upload was cancelled.' : 'ClickUp attachment upload timed out.',
      );
    }
    throw new ClickUpAttachmentUploadError('network', 'The paired Worker could not receive the ClickUp attachment.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
