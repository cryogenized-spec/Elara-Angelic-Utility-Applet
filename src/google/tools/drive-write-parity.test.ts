import { beforeEach, describe, expect, it, vi } from 'vitest';

const driveMocks = vi.hoisted(() => ({
  createFile: vi.fn(),
  updateFile: vi.fn(),
  moveFile: vi.fn(),
  trashFile: vi.fn(),
}));

vi.mock('../drive/service', () => ({
  GoogleDriveService: class {
    createFile = driveMocks.createFile;
    updateFile = driveMocks.updateFile;
    moveFile = driveMocks.moveFile;
    trashFile = driveMocks.trashFile;
  },
}));

import { resetDriveCreateReplayForTests } from '../drive/create-replay';
import { DRIVE_LIMITS } from '../drive/limits';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionDeclarationsForPlane } from './gemini-declarations';
import { googleToolRegistry, googleToolsForPlane } from './registry';
import { validateDriveSheetsToolArguments } from './drive-sheets-schemas';
import { googleServiceToolHandlers } from './service-handlers';
import { confirmationRequestForCall, type GoogleToolExecutionContext } from './executor';
import type { GoogleToolName } from './contracts';

const STRONG_ETAG = '"etag-1"';

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

function declaration(name: string) {
  const entry = googleGeminiFunctionDeclarations.find((tool) => tool.name === name);
  if (!entry) throw new Error(`Missing declaration for ${name}`);
  return entry;
}

const CONDITIONAL_WRITE_TOOLS = ['drive.updateFile', 'drive.moveFile', 'drive.trashFile'] as const;

describe('Drive conditional-write parity', () => {
  beforeEach(() => {
    resetDriveCreateReplayForTests();
    for (const mock of Object.values(driveMocks)) mock.mockReset();
  });

  it('requires one concrete ETag on every conditional write, across schema and declaration', () => {
    const files = {
      'drive.updateFile': { fileId: 'file-1', etag: STRONG_ETAG, patch: { name: 'Renamed' } },
      'drive.moveFile': { fileId: 'file-1', etag: STRONG_ETAG, parentId: 'folder-2' },
      'drive.trashFile': { fileId: 'file-1', etag: STRONG_ETAG },
    } as const;

    for (const tool of CONDITIONAL_WRITE_TOOLS) {
      expect(validateDriveSheetsToolArguments(tool, files[tool])).toMatchObject({ etag: STRONG_ETAG });

      // Missing or oversized ETags never reach the service.
      const { etag: _etag, ...withoutEtag } = files[tool];
      expect(() => validateDriveSheetsToolArguments(tool, withoutEtag)).toThrow();
      expect(() => validateDriveSheetsToolArguments(tool, { ...files[tool], etag: '' })).toThrow();
      expect(() => validateDriveSheetsToolArguments(tool, { ...files[tool], etag: 'x'.repeat(DRIVE_LIMITS.maxEtagLength + 1) })).toThrow();

      expect(declaration(tool).parameters.required).toContain('etag');
      expect(declaration(tool).parameters.properties.etag).toMatchObject({ type: 'string' });
    }
  });

  it('keeps trashing out of the ordinary metadata patch and behind its own destructive tool', () => {
    expect(() => validateDriveSheetsToolArguments('drive.updateFile', {
      fileId: 'file-1', etag: STRONG_ETAG, patch: { trashed: true },
    })).toThrow();

    const trash = googleToolRegistry.find((entry) => entry.name === 'drive.trashFile');
    expect(trash).toMatchObject({
      risk: 'destructive',
      capability: 'drive.files.app.write',
      exposure: 'gemini',
      executionPlane: 'browser',
    });

    // Trash is the model-visible end state; permanent deletion is never exposed.
    expect(googleToolRegistry.some((entry) => /delete/i.test(entry.name) && entry.name.startsWith('drive.'))).toBe(false);
  });

  it('runs the trash tool on the browser plane only', () => {
    expect(googleToolsForPlane('browser').map((entry) => entry.name)).toContain('drive.trashFile');
    expect(googleToolsForPlane('worker').map((entry) => entry.name)).not.toContain('drive.trashFile');
    expect(googleGeminiFunctionDeclarationsForPlane('browser').map((tool) => tool.name)).toContain('drive.trashFile');
    expect(googleGeminiFunctionDeclarationsForPlane('worker').map((tool) => tool.name)).not.toContain('drive.trashFile');
  });

  it('forwards the caller ETag and the add/remove parent semantics to the service', async () => {
    driveMocks.updateFile.mockResolvedValue({ id: 'file-1', name: 'Renamed' });
    driveMocks.moveFile.mockResolvedValue({ id: 'file-1', parents: ['folder-2'] });
    driveMocks.trashFile.mockResolvedValue({ id: 'file-1', trashed: true });

    await googleServiceToolHandlers['drive.updateFile']!(context('drive.updateFile', {
      fileId: 'file-1', etag: STRONG_ETAG, patch: { name: 'Renamed', starred: true },
    }));
    await googleServiceToolHandlers['drive.moveFile']!(context('drive.moveFile', {
      fileId: 'file-1', etag: STRONG_ETAG, parentId: 'folder-2', previousParentId: 'folder-1',
    }));
    await googleServiceToolHandlers['drive.moveFile']!(context('drive.moveFile', {
      fileId: 'file-1', etag: STRONG_ETAG, parentId: 'folder-3',
    }));
    await googleServiceToolHandlers['drive.trashFile']!(context('drive.trashFile', {
      fileId: 'file-1', etag: STRONG_ETAG,
    }));

    expect(driveMocks.updateFile).toHaveBeenCalledWith('file-1', STRONG_ETAG, { name: 'Renamed', starred: true });
    expect(driveMocks.moveFile).toHaveBeenNthCalledWith(1, 'file-1', STRONG_ETAG, 'folder-2', 'folder-1');
    expect(driveMocks.moveFile).toHaveBeenNthCalledWith(2, 'file-1', STRONG_ETAG, 'folder-3', undefined);
    expect(driveMocks.trashFile).toHaveBeenCalledWith('file-1', STRONG_ETAG);
  });

  it('states the ETag precondition, the parent consequence and the recoverable trash outcome before approval', () => {
    const update = confirmationRequestForCall({ tool: 'drive.updateFile', arguments: { fileId: 'file-1', etag: STRONG_ETAG, patch: { name: 'Renamed' } } });
    const move = confirmationRequestForCall({ tool: 'drive.moveFile', arguments: { fileId: 'file-1', etag: STRONG_ETAG, parentId: 'folder-2', previousParentId: 'folder-1' } });
    const addOnly = confirmationRequestForCall({ tool: 'drive.moveFile', arguments: { fileId: 'file-1', etag: STRONG_ETAG, parentId: 'folder-2' } });
    const trash = confirmationRequestForCall({ tool: 'drive.trashFile', arguments: { fileId: 'file-1', etag: STRONG_ETAG } });

    expect(update?.resourceSummary).toContain('ETag');
    expect(move?.resourceSummary).toContain('folder-1');
    expect(move?.resourceSummary).toContain('folder-2');
    // Without a previous parent this is an add: Drive files can have several.
    expect(addOnly?.resourceSummary).toContain('several parents');
    expect(addOnly?.resourceSummary).toContain('current folder');
    expect(trash?.risk).toBe('destructive');
    expect(trash?.resourceSummary).toContain('trash');
    expect(trash?.resourceSummary).toContain('never permanently deletes');
  });

  it('replays an identical create call instead of creating a second file', async () => {
    driveMocks.createFile.mockResolvedValue({ id: 'file-1', name: 'Plan' });
    const turn = { callId: 'call-1', conversationId: 'conversation-1', messageId: 'message-1', generationId: 'generation-1' };
    const call = context('drive.createFile', { name: 'Plan', mimeType: 'text/plain', parents: ['folder-1'] }, turn);

    const first = await googleServiceToolHandlers['drive.createFile']!(call);
    const replay = await googleServiceToolHandlers['drive.createFile']!(call);

    expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
    expect(replay).toEqual(first);

    // A different call id in the same turn is a genuinely different create.
    await googleServiceToolHandlers['drive.createFile']!(context('drive.createFile', { name: 'Plan', mimeType: 'text/plain', parents: ['folder-1'] }, { ...turn, callId: 'call-2' }));
    expect(driveMocks.createFile).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a replayed call id changes its arguments', async () => {
    driveMocks.createFile.mockResolvedValue({ id: 'file-1', name: 'Plan' });
    await googleServiceToolHandlers['drive.createFile']!(context('drive.createFile', { name: 'Plan' }, { callId: 'call-1', conversationId: 'conversation-1', messageId: 'message-1', generationId: 'generation-1' }));

    await expect(googleServiceToolHandlers['drive.createFile']!(context('drive.createFile', { name: 'Different' }, { callId: 'call-1', conversationId: 'conversation-1', messageId: 'message-1', generationId: 'generation-1' })))
      .rejects.toThrow(/changed arguments/);
    expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh replay window for a newly elected turn', async () => {
    driveMocks.createFile.mockResolvedValue({ id: 'file-1', name: 'Plan' });
    const create = (generationId: string) => googleServiceToolHandlers['drive.createFile']!(context('drive.createFile', { name: 'Plan' }, { callId: 'call-1', conversationId: 'conversation-1', messageId: 'message-1', generationId }));

    await create('generation-1');
    await create('generation-2');

    expect(driveMocks.createFile).toHaveBeenCalledTimes(2);
  });
});
