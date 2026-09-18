import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetGmailSendReplayForTests, runGmailSendOnce } from './send-replay';

const baseContext = {
  tool: 'gmail.sendMessage' as const,
  callId: 'call-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  generationId: 'generation-1',
};

describe('Gmail send replay fence', () => {
  beforeEach(() => resetGmailSendReplayForTests());

  it('executes the same send call and payload only once in one elected turn', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'sent-1' });
    const payload = { to: ['person@example.com'], subject: 'Hello', body: 'Body' };

    await expect(runGmailSendOnce(baseContext, payload, operation)).resolves.toEqual({ id: 'sent-1' });
    await expect(runGmailSendOnce(baseContext, payload, operation)).resolves.toEqual({ id: 'sent-1' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retains ambiguous send failures instead of blindly issuing another POST', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('network response lost'));
    const payload = { to: ['person@example.com'], subject: 'Hello', body: 'Body' };

    await expect(runGmailSendOnce(baseContext, payload, operation)).rejects.toThrow('network response lost');
    await expect(runGmailSendOnce(baseContext, payload, operation)).rejects.toThrow('network response lost');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('fails closed if the same call id is replayed with changed arguments', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'sent-1' });
    await runGmailSendOnce(baseContext, { subject: 'First' }, operation);

    await expect(runGmailSendOnce(baseContext, { subject: 'Changed' }, operation))
      .rejects.toThrow(/changed arguments/i);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('allows two distinct call ids to intentionally send identical content', async () => {
    const firstOperation = vi.fn().mockResolvedValue({ id: 'sent-1' });
    const secondOperation = vi.fn().mockResolvedValue({ id: 'sent-2' });
    const payload = { to: ['person@example.com'], subject: 'Same', body: 'Same' };

    await runGmailSendOnce(baseContext, payload, firstOperation);
    await runGmailSendOnce({ ...baseContext, callId: 'call-2' }, payload, secondOperation);

    expect(firstOperation).toHaveBeenCalledOnce();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('clears replay state when a genuinely new elected turn starts', async () => {
    const firstOperation = vi.fn().mockResolvedValue({ id: 'sent-1' });
    const secondOperation = vi.fn().mockResolvedValue({ id: 'sent-2' });
    const payload = { to: ['person@example.com'], subject: 'Hello', body: 'Body' };

    await runGmailSendOnce(baseContext, payload, firstOperation);
    await runGmailSendOnce({ ...baseContext, generationId: 'generation-2' }, payload, secondOperation);

    expect(firstOperation).toHaveBeenCalledOnce();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('does not let a stale older turn clear a newer ambiguous-send replay fence', async () => {
    const activeGeneration = 'generation-2';
    const newerContext = {
      ...baseContext,
      generationId: 'generation-2',
      isGenerationActive: () => activeGeneration === 'generation-2',
    };
    const staleOlderContext = {
      ...baseContext,
      generationId: 'generation-1',
      isGenerationActive: () => activeGeneration === 'generation-1',
    };
    const payload = { to: ['person@example.com'], subject: 'Hello', body: 'Body' };
    const newerOperation = vi.fn().mockRejectedValue(new Error('network response lost'));
    const staleOperation = vi.fn().mockResolvedValue({ id: 'stale-send' });

    await expect(runGmailSendOnce(newerContext, payload, newerOperation)).rejects.toThrow('network response lost');
    await expect(runGmailSendOnce(staleOlderContext, payload, staleOperation)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runGmailSendOnce(newerContext, payload, newerOperation)).rejects.toThrow('network response lost');

    expect(staleOperation).not.toHaveBeenCalled();
    expect(newerOperation).toHaveBeenCalledTimes(1);
  });

  it('does not claim replay safety without elected-turn provenance', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'sent-1' });
    const context = { tool: 'gmail.sendMessage' as const, callId: 'call-1' };

    await runGmailSendOnce(context, { subject: 'Hello' }, operation);
    await runGmailSendOnce(context, { subject: 'Hello' }, operation);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
