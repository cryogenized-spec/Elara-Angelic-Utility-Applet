import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../autonomy/cloud/pairing';
import { validateClickUpToolArguments, type ClickUpToolArguments } from './tool-schema';
import { clickUpPairingAuthorityBinding } from './oauth/authority';
import { CLICKUP_GRANT_REVISION_HEADER } from './mcp-protocol';
import type { ClickUpAdmittedGrant } from './mcp-client';
import {
  assertClickUpArtifactSnapshotCurrent,
  ClickUpArtifactApprovalError,
  type ClickUpArtifactApprovalSnapshot,
} from './attachment-authority';

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
  admittedGrant?: ClickUpAdmittedGrant,
  approvedArtifact?: ClickUpArtifactApprovalSnapshot,
): Promise<unknown> {
  const args = validateClickUpToolArguments('clickup.attachArtifact', rawArguments) as ClickUpToolArguments<'clickup.attachArtifact'>;
  if (!admittedGrant || !Number.isSafeInteger(admittedGrant.revision) || admittedGrant.revision <= 0) {
    throw new ClickUpAttachmentUploadError('grant_required', 'ClickUp artifact upload requires an admitted provider grant.', 409);
  }
  if (!approvedArtifact || approvedArtifact.artifactId !== args.artifactId) {
    throw new ClickUpAttachmentUploadError('artifact-approval-required', 'ClickUp artifact upload requires the exact artifact snapshot approved by the user.', 409);
  }
  if ((args.filename ?? approvedArtifact.artifactName) !== approvedArtifact.uploadName) {
    throw new ClickUpAttachmentUploadError('artifact-changed', 'The approved upload filename no longer matches this attachment request.', 409);
  }

  const pairing = activePairing();
  if (clickUpPairingAuthorityBinding(pairing) !== admittedGrant.authorityBinding) {
    throw new ClickUpAttachmentUploadError('grant_changed', 'The paired Worker changed after ClickUp authorization was admitted.', 409);
  }
  const token = await installationToken(pairing);

  // Re-read and hash the mutable repository entry immediately before multipart
  // construction. If it changed, fail closed. The bytes sent below are the
  // immutable Blob captured before confirmation, not a newly-resolved payload.
  try {
    await assertClickUpArtifactSnapshotCurrent(approvedArtifact);
  } catch (error) {
    if (error instanceof ClickUpArtifactApprovalError) {
      throw new ClickUpAttachmentUploadError(error.code, error.message, 409);
    }
    throw error;
  }

  // Artifact revalidation is asynchronous. Re-read pairing authority after it
  // completes so a re-pair during hashing/materialization cannot send the
  // approved bytes to a previously paired Worker.
  const currentPairing = loadPairing();
  if (!currentPairing || clickUpPairingAuthorityBinding(currentPairing) !== admittedGrant.authorityBinding) {
    throw new ClickUpAttachmentUploadError('grant_changed', 'The paired Worker changed before ClickUp attachment egress.', 409);
  }

  const form = new FormData();
  form.set('workspaceId', args.workspaceId);
  form.set('taskId', args.taskId);
  form.set('artifactId', args.artifactId);
  form.set('filename', approvedArtifact.uploadName);
  form.set('file', approvedArtifact.blob, approvedArtifact.uploadName);

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
        ...(admittedGrant ? {
          [CLICKUP_GRANT_REVISION_HEADER]: String(admittedGrant.revision),
        } : {}),
      },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || payload.ok !== true || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
      throw new ClickUpAttachmentUploadError('protocol', 'The ClickUp attachment endpoint returned an invalid result.', response.status);
    }
    return {
      ...(payload.result as Record<string, unknown>),
      provider: 'clickup',
      workspaceId: args.workspaceId,
      taskId: args.taskId,
      artifactId: args.artifactId,
    };
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
