import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadFile } = vi.hoisted(() => ({ downloadFile: vi.fn() }));

vi.mock('./service', () => ({
  GoogleDriveService: class {
    downloadFile = downloadFile;
  },
}));

import { artifactRepository } from '../../artifacts/repository';
import { db } from '../../persistence/conversation';
import { DriveTransferError } from './errors';
import { downloadDriveFileArtifact } from './download';

function download(overrides: Partial<{ name: string; mimeType: string; bytes: Uint8Array; size?: number }> = {}) {
  const bytes = overrides.bytes ?? new Uint8Array([80, 68, 70]);
  return {
    metadata: { id: 'file-1', name: overrides.name ?? 'Quarterly report.pdf', mimeType: overrides.mimeType ?? 'application/pdf' },
    mimeType: overrides.mimeType ?? 'application/pdf',
    bytes,
    size: overrides.size ?? bytes.byteLength,
  };
}

describe('drive download artifact boundary', () => {
  beforeEach(async () => {
    downloadFile.mockReset();
    await db.artifactMetadata.clear();
    await db.artifactBlobs.clear();
  });

  it('stores the bytes as a ready artifact and returns bounded metadata only', async () => {
    downloadFile.mockResolvedValue(download());

    const result = await downloadDriveFileArtifact({ fileId: 'file-1', maxBytes: 1024, conversationId: 'conversation-1', generationId: 'generation-a' });

    expect(result).toMatchObject({
      status: 'ready',
      name: 'Quarterly report.pdf',
      mimeType: 'application/pdf',
      size: 3,
    });
    if (result.status !== 'ready') throw new Error('expected a ready download');
    expect(result.artifactId).toBeTruthy();
    expect(result.operationId).toContain('generation-a:drive-download:');
    // Bytes are never part of the model-facing projection.
    expect(JSON.stringify(result)).not.toContain('base64');
    expect(Object.keys(result)).not.toContain('bytes');

    const stored = await artifactRepository.get(result.artifactId);
    expect(stored).toMatchObject({ artifactType: 'attachment', status: 'ready', provenance: 'derived_transformation', size: 3 });
    if (stored.artifactType !== 'attachment') throw new Error('expected an attachment artifact');
    expect([...new Uint8Array(await stored.data.arrayBuffer())]).toEqual([80, 68, 70]);
    expect(downloadFile).toHaveBeenCalledWith('file-1', { maxBytes: 1024 });
  });

  it('publishes no ready artifact when the generation is superseded mid-download', async () => {
    let active = true;
    let release!: (value: ReturnType<typeof download>) => void;
    downloadFile.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const pending = downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1', generationId: 'generation-b', isGenerationActive: () => active });
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
    active = false;
    release(download({ name: 'late.pdf' }));

    const result = await pending;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'ARTIFACT_OPERATION_STALE' });
    expect(result).not.toHaveProperty('artifactId');
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('marks an artifact failed rather than ready when the turn is superseded between persistence and commit', async () => {
    let active = true;
    downloadFile.mockResolvedValue(download());
    const originalCreate = artifactRepository.create.bind(artifactRepository);
    const created: string[] = [];
    // The generation stays live for the transfer and the payload write, then is
    // superseded before the guarded lifecycle commit observes `isCurrent()`.
    const createSpy = vi.spyOn(artifactRepository, 'create').mockImplementation(async (input) => {
      const artifact = await originalCreate(input);
      created.push(artifact.id);
      active = false;
      return artifact;
    });

    const result = await downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1', generationId: 'generation-c', isGenerationActive: () => active });
    createSpy.mockRestore();

    expect(created).toHaveLength(1);
    expect(result).toMatchObject({ status: 'failed', artifactId: created[0], errorCode: 'ARTIFACT_OPERATION_STALE' });
    expect(await artifactRepository.list()).toEqual([expect.objectContaining({ id: created[0], status: 'failed' })]);
  });

  it('reports cancellation without leaving an artifact behind', async () => {
    const controller = new AbortController();
    downloadFile.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Google Drive download was cancelled.', 'AbortError');
    });

    const result = await downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1', signal: controller.signal });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'ARTIFACT_OPERATION_STALE' });
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('never starts a transfer for an already-cancelled turn', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1', signal: controller.signal });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'ARTIFACT_OPERATION_STALE' });
    expect(downloadFile).not.toHaveBeenCalled();
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('keeps the size ceiling and unsupported-file reasons distinguishable', async () => {
    downloadFile.mockRejectedValueOnce(new DriveTransferError('DRIVE_FILE_TOO_LARGE', 'Google Drive download exceeds the application transfer limit.'));
    const tooLarge = await downloadDriveFileArtifact({ fileId: 'file-1', maxBytes: 8, conversationId: 'conversation-1' });
    expect(tooLarge).toMatchObject({ status: 'failed', errorCode: 'FILE_TOO_LARGE' });
    if (tooLarge.status !== 'failed') throw new Error('expected a failed download');
    expect(tooLarge.error).toContain('transfer limit');

    downloadFile.mockRejectedValueOnce(new DriveTransferError('DRIVE_FILE_UNSUPPORTED', 'Google Docs editors files cannot be downloaded directly; they have to be exported.'));
    const unsupported = await downloadDriveFileArtifact({ fileId: 'doc-1', conversationId: 'conversation-1' });
    expect(unsupported).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_FILE' });

    downloadFile.mockRejectedValueOnce(new DriveTransferError('DRIVE_TRANSFER_FAILED', 'Google Drive download failed (500).'));
    const providerFailure = await downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1' });
    expect(providerFailure).toMatchObject({ status: 'failed', errorCode: 'DRIVE_DOWNLOAD_FAILED' });

    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('refuses an empty provider payload instead of publishing an empty artifact', async () => {
    downloadFile.mockResolvedValue(download({ bytes: new Uint8Array([]) }));
    const result = await downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1' });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_FILE' });
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('falls back to Drive metadata when the media response carries a generic MIME type and derives the kind from MIME', async () => {
    downloadFile.mockResolvedValue({ ...download({ mimeType: 'application/octet-stream', name: 'photo.png' }), metadata: { id: 'file-1', name: 'photo.png', mimeType: 'image/png' } });
    const result = await downloadDriveFileArtifact({ fileId: 'file-1', conversationId: 'conversation-1' });
    expect(result).toMatchObject({ status: 'ready', mimeType: 'image/png' });
    if (result.status !== 'ready') throw new Error('expected a ready download');
    expect(await artifactRepository.get(result.artifactId)).toMatchObject({ mimeType: 'image/png', kind: 'image' });
  });

  it('refuses to materialize an artifact for a headless run that has no conversation', async () => {
    const result = await downloadDriveFileArtifact({ fileId: 'file-1', generationId: 'generation-routine' });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'DRIVE_DOWNLOAD_FAILED' });
    if (result.status !== 'failed') throw new Error('expected a failed download');
    expect(result.error).toContain('open conversation');
    expect(downloadFile).not.toHaveBeenCalled();
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('names the artifact from the Drive file and falls back to the file id when Drive supplies no name', async () => {
    downloadFile.mockResolvedValue({ ...download(), metadata: { id: 'file-1', name: '   ', mimeType: 'application/pdf' } });
    const result = await downloadDriveFileArtifact({ fileId: 'file-abcdefgh', conversationId: 'conversation-1' });
    expect(result).toMatchObject({ status: 'ready', name: 'drive-download-file-abc' });
  });
});
