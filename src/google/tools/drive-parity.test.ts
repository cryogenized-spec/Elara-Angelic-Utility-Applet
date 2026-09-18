import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const driveMocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  searchLibrary: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
  updateFile: vi.fn(),
  createFile: vi.fn(),
  moveFile: vi.fn(),
}));

vi.mock('../drive/service', () => ({
  GoogleDriveService: class {
    listFiles = driveMocks.listFiles;
    searchLibrary = driveMocks.searchLibrary;
    getFile = driveMocks.getFile;
    downloadFile = driveMocks.downloadFile;
    updateFile = driveMocks.updateFile;
    createFile = driveMocks.createFile;
    moveFile = driveMocks.moveFile;
  },
}));

import { db } from '../../persistence/conversation';
import { artifactRepository } from '../../artifacts/repository';
import { DRIVE_LIMITS } from '../drive/limits';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionDeclarationsForPlane } from './gemini-declarations';
import { googleToolRegistry, googleToolsForPlane } from './registry';
import { validateDriveSheetsToolArguments } from './drive-sheets-schemas';
import { googleServiceToolHandlers } from './service-handlers';
import type { GoogleToolExecutionContext } from './executor';
import type { GoogleToolName } from './contracts';

function context(
  tool: GoogleToolName,
  arguments_: Record<string, unknown>,
  overrides: Partial<GoogleToolExecutionContext> = {},
): GoogleToolExecutionContext {
  const descriptor = googleToolRegistry.find((entry) => entry.name === tool);
  if (!descriptor) throw new Error(`Missing descriptor for ${tool}`);
  return {
    tool,
    descriptor,
    capability: descriptor.capability as GoogleToolExecutionContext['capability'],
    risk: descriptor.risk,
    arguments: arguments_,
    ...overrides,
  };
}

const DRIVE_TOOL_NAMES = [
  'drive.searchFiles',
  'drive.searchLibrary',
  'drive.getFile',
  'drive.downloadFile',
  'drive.createFile',
  'drive.updateFile',
  'drive.moveFile',
] as const;

function declaration(name: string) {
  const entry = googleGeminiFunctionDeclarations.find((tool) => tool.name === name);
  if (!entry) throw new Error(`Missing declaration for ${name}`);
  return entry;
}

describe('Drive read parity and safe download', () => {
  beforeEach(async () => {
    for (const mock of Object.values(driveMocks)) mock.mockReset();
    await db.artifactMetadata.clear();
    await db.artifactBlobs.clear();
  });

  it('runs every Drive tool on the browser plane and never advertises them to the worker', () => {
    const browserNames = googleToolsForPlane('browser').map((descriptor) => descriptor.name);
    const workerNames = googleToolsForPlane('worker').map((descriptor) => descriptor.name);
    const workerDeclarations = googleGeminiFunctionDeclarationsForPlane('worker').map((tool) => tool.name);
    const browserDeclarations = googleGeminiFunctionDeclarationsForPlane('browser').map((tool) => tool.name);

    for (const name of DRIVE_TOOL_NAMES) {
      const descriptor = googleToolRegistry.find((entry) => entry.name === name);
      expect(descriptor, `${name} must be registered`).toMatchObject({ exposure: 'gemini', executionPlane: 'browser' });
      // A declared tool with no worker-side service or handler must not be
      // advertised to a plane that cannot execute it.
      expect(workerNames).not.toContain(name);
      expect(workerDeclarations).not.toContain(name);
      expect(browserNames).toContain(name);
      expect(browserDeclarations).toContain(name);
    }
  });

  it('agrees on the download transfer bound across declaration, schema and service ceiling', () => {
    const downloadDeclaration = declaration('drive.downloadFile');
    expect(downloadDeclaration.parameters.properties.maxBytes).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: DRIVE_LIMITS.maxTransferBytes,
    });

    expect(validateDriveSheetsToolArguments('drive.downloadFile', { fileId: 'file-1', maxBytes: DRIVE_LIMITS.maxTransferBytes }))
      .toMatchObject({ maxBytes: DRIVE_LIMITS.maxTransferBytes });
    for (const invalid of [DRIVE_LIMITS.maxTransferBytes + 1, 0, 1.5, Number.NaN]) {
      expect(() => validateDriveSheetsToolArguments('drive.downloadFile', { fileId: 'file-1', maxBytes: invalid })).toThrow();
    }
  });

  it('agrees on search bounds across declaration and schema', () => {
    for (const name of ['drive.searchFiles', 'drive.searchLibrary'] as const) {
      expect(declaration(name).parameters.properties).toMatchObject({
        query: { type: 'string', maxLength: DRIVE_LIMITS.maxQueryLength },
        pageToken: { type: 'string' },
        pageSize: { type: 'integer', minimum: 1, maximum: DRIVE_LIMITS.maxPageSize },
        showTrashed: { type: 'boolean' },
      });

      expect(validateDriveSheetsToolArguments(name, { query: 'x'.repeat(DRIVE_LIMITS.maxQueryLength) }).query).toHaveLength(DRIVE_LIMITS.maxQueryLength);
      expect(() => validateDriveSheetsToolArguments(name, { query: 'x'.repeat(DRIVE_LIMITS.maxQueryLength + 1) })).toThrow();
      expect(validateDriveSheetsToolArguments(name, { pageSize: DRIVE_LIMITS.maxPageSize })).toMatchObject({ pageSize: DRIVE_LIMITS.maxPageSize });
      expect(() => validateDriveSheetsToolArguments(name, { pageSize: DRIVE_LIMITS.maxPageSize + 1 })).toThrow();
      expect(() => validateDriveSheetsToolArguments(name, { pageToken: 'x'.repeat(DRIVE_LIMITS.maxPageTokenLength + 1) })).toThrow();
      expect(() => validateDriveSheetsToolArguments(name, { pageToken: 'x'.repeat(DRIVE_LIMITS.maxPageTokenLength) })).not.toThrow();
    }
  });

  it('forwards the explicit trashed opt-in from validated model arguments to the service', async () => {
    driveMocks.listFiles.mockResolvedValue({ files: [] });
    driveMocks.searchLibrary.mockResolvedValue({ files: [] });

    await googleServiceToolHandlers['drive.searchFiles']!(context('drive.searchFiles', { query: "name contains 'Plan'", pageSize: 5, showTrashed: true }));
    await googleServiceToolHandlers['drive.searchLibrary']!(context('drive.searchLibrary', { query: 'fullText contains \'notes\'' }));

    expect(driveMocks.listFiles).toHaveBeenCalledWith({ query: "name contains 'Plan'", pageToken: undefined, pageSize: 5, showTrashed: true });
    expect(driveMocks.searchLibrary).toHaveBeenCalledWith({ query: "fullText contains 'notes'", pageToken: undefined, pageSize: undefined, showTrashed: undefined });
  });

  it('keeps file bytes out of the model-facing download result while the artifact holds them', async () => {
    const payload = new Uint8Array(1024 * 1024).fill(65);
    driveMocks.downloadFile.mockResolvedValue({
      metadata: { id: 'file-1', name: 'bulk.bin', mimeType: 'application/octet-stream', webViewLink: 'https://drive.google.com/file/d/file-1/view' },
      mimeType: 'application/octet-stream',
      bytes: payload,
      size: payload.byteLength,
    });

    const result = await googleServiceToolHandlers['drive.downloadFile']!(
      context('drive.downloadFile', { fileId: 'file-1', maxBytes: DRIVE_LIMITS.maxTransferBytes }, { generationId: 'generation-1', conversationId: 'conversation-1' }),
    ) as Record<string, unknown>;

    // The tool loop surfaces an artifact card from exactly this projection.
    expect(result).toMatchObject({
      status: 'ready',
      name: 'bulk.bin',
      mimeType: 'application/octet-stream',
      size: payload.byteLength,
      webViewLink: 'https://drive.google.com/file/d/file-1/view',
    });
    expect(Object.keys(result).sort()).toEqual(['artifactId', 'mimeType', 'name', 'operationId', 'size', 'status', 'webViewLink']);
    expect(JSON.stringify(result).length).toBeLessThan(512);

    const stored = await artifactRepository.get(result.artifactId as string);
    expect(stored).toMatchObject({ artifactType: 'attachment', status: 'ready', size: payload.byteLength });
    if (stored.artifactType !== 'attachment') throw new Error('expected an attachment artifact');
    expect(await stored.data.arrayBuffer()).toHaveProperty('byteLength', payload.byteLength);
    expect(driveMocks.downloadFile).toHaveBeenCalledWith('file-1', { maxBytes: DRIVE_LIMITS.maxTransferBytes });
  });

  it('never transfers when the turn was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await googleServiceToolHandlers['drive.downloadFile']!(
      context('drive.downloadFile', { fileId: 'file-1' }, { signal: controller.signal, generationId: 'generation-2', conversationId: 'conversation-1' }),
    );

    expect(result).toMatchObject({ status: 'failed', errorCode: 'ARTIFACT_OPERATION_STALE' });
    expect(driveMocks.downloadFile).not.toHaveBeenCalled();
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('refuses a headless run instead of leaving an orphaned artifact behind', async () => {
    const result = await googleServiceToolHandlers['drive.downloadFile']!(
      context('drive.downloadFile', { fileId: 'file-1' }, { generationId: 'generation-routine' }),
    );

    expect(result).toMatchObject({ status: 'failed', errorCode: 'DRIVE_DOWNLOAD_FAILED' });
    expect(driveMocks.downloadFile).not.toHaveBeenCalled();
    expect(await artifactRepository.list()).toHaveLength(0);
  });

  it('exposes provider identity needed for a later safe mutation on the read surface', () => {
    const descriptor = googleToolRegistry.find((entry) => entry.name === 'drive.getFile');
    expect(descriptor?.description).toMatch(/ETag/);
  });
});
