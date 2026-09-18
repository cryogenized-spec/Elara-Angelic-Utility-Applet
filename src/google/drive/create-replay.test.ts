import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDriveCreateReplayForTests, runDriveCreateOnce } from './create-replay';

const baseContext = {
  tool: 'drive.createFile' as const,
  callId: 'call-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  generationId: 'generation-1',
};

describe('Google Drive create replay fence', () => {
  beforeEach(() => resetDriveCreateReplayForTests());

  it('executes the same call id and payload only once in the same elected turn', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'file-1' });
    const payload = { name: 'Plan', mimeType: 'text/plain', parents: ['folder-1'] };

    const first = await runDriveCreateOnce(baseContext, payload, operation, 1000);
    const second = await runDriveCreateOnce(baseContext, payload, operation, 1001);

    expect(first).toEqual({ id: 'file-1' });
    expect(second).toEqual({ id: 'file-1' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('collapses two concurrent copies of the same call into one create', async () => {
    const operation = vi.fn(async () => ({ id: 'file-1' }));
    const payload = { name: 'Plan', parents: ['folder-1'] };

    const [first, second] = await Promise.all([
      runDriveCreateOnce(baseContext, payload, operation, 1000),
      runDriveCreateOnce(baseContext, payload, operation, 1000),
    ]);

    expect(first).toEqual({ id: 'file-1' });
    expect(second).toEqual({ id: 'file-1' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a concurrent copy of the same call id changes its arguments', async () => {
    const operation = vi.fn(async () => ({ id: 'file-1' }));

    const first = runDriveCreateOnce(baseContext, { name: 'Plan' }, operation, 1000);
    const secondAssertion = expect(runDriveCreateOnce(baseContext, { name: 'Other' }, operation, 1000)).rejects.toThrow(/changed arguments/i);

    await expect(first).resolves.toEqual({ id: 'file-1' });
    await secondAssertion;
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the same call id is replayed with changed arguments', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'file-1' });
    await runDriveCreateOnce(baseContext, { name: 'Plan' }, operation, 1000);

    await expect(runDriveCreateOnce(baseContext, { name: 'Other' }, operation, 1001)).rejects.toThrow(/changed arguments/i);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate two distinct calls that intentionally create identical files', async () => {
    const firstOperation = vi.fn().mockResolvedValue({ id: 'file-1' });
    const secondOperation = vi.fn().mockResolvedValue({ id: 'file-2' });
    const payload = { name: 'Same name' };

    await runDriveCreateOnce(baseContext, payload, firstOperation, 1000);
    await runDriveCreateOnce({ ...baseContext, callId: 'call-2' }, payload, secondOperation, 1001);

    expect(firstOperation).toHaveBeenCalledOnce();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('keeps replay state isolated across simultaneously live elected turns', async () => {
    const firstOperation = vi.fn().mockResolvedValue({ id: 'file-1' });
    const secondOperation = vi.fn().mockResolvedValue({ id: 'file-2' });
    const firstContext = { ...baseContext, isGenerationActive: () => true };
    const secondContext = { ...baseContext, generationId: 'generation-2', isGenerationActive: () => true };

    await runDriveCreateOnce(firstContext, { name: 'Plan' }, firstOperation, 1000);
    await runDriveCreateOnce(secondContext, { name: 'Plan' }, secondOperation, 1001);
    await runDriveCreateOnce(firstContext, { name: 'Plan' }, firstOperation, 1002);
    await runDriveCreateOnce(secondContext, { name: 'Plan' }, secondOperation, 1003);

    expect(firstOperation).toHaveBeenCalledOnce();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('does not let a stale turn clear a newer turn ambiguous-create fence', async () => {
    let oldActive = true;
    const oldOperation = vi.fn().mockResolvedValue({ id: 'old-file' });
    const newFailure = new Error('network response lost');
    const newOperation = vi.fn().mockRejectedValue(newFailure);
    const oldContext = { ...baseContext, generationId: 'generation-old', isGenerationActive: () => oldActive };
    const newContext = { ...baseContext, generationId: 'generation-new', isGenerationActive: () => true };

    await expect(runDriveCreateOnce(newContext, { name: 'Plan' }, newOperation, 1000)).rejects.toThrow('network response lost');
    oldActive = false;
    await expect(runDriveCreateOnce(oldContext, { name: 'Old plan' }, oldOperation, 1001)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runDriveCreateOnce(newContext, { name: 'Plan' }, newOperation, 1002)).rejects.toThrow('network response lost');

    expect(oldOperation).not.toHaveBeenCalled();
    expect(newOperation).toHaveBeenCalledOnce();
  });

  it('does not claim replay safety when elected-turn provenance is unavailable', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'file-1' });
    const context = { tool: 'drive.createFile' as const, callId: 'call-1' };

    await runDriveCreateOnce(context, { name: 'Plan' }, operation, 1000);
    await runDriveCreateOnce(context, { name: 'Plan' }, operation, 1001);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retains an ambiguous rejection for the same call instead of issuing a second POST', async () => {
    const failure = new Error('network response lost');
    const operation = vi.fn().mockRejectedValue(failure);
    const payload = { name: 'Plan' };

    await expect(runDriveCreateOnce(baseContext, payload, operation, 1000)).rejects.toThrow('network response lost');
    await expect(runDriveCreateOnce(baseContext, payload, operation, 1000 + 24 * 60 * 60 * 1000)).rejects.toThrow('network response lost');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
