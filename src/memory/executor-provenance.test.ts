import { describe, expect, it, vi } from 'vitest';
import { executeGoogleTool } from '../google/tools/executor';
import type { GoogleToolExecutionContext } from '../google/tools/executor';

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

describe('memory tool executor provenance', () => {
  it('forwards provider call id and app-owned turn ids outside model arguments', async () => {
    const handler = vi.fn(async (_context: GoogleToolExecutionContext) => ({ saved: true }));
    const result = await executeGoogleTool(
      {
        tool: 'memory.save',
        callId: 'call_9',
        arguments: { title: 'Preference', body: 'Remember this preference.' },
      },
      {
        oauth,
        handlers: { 'memory.save': handler },
        confirm: async () => true,
        conversationId: 'thread_9',
        messageId: 'message_9',
        generationId: 'generation_9',
        isGenerationActive: () => true,
      },
    );

    expect(result.ok).toBe(true);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'call_9',
      conversationId: 'thread_9',
      messageId: 'message_9',
      generationId: 'generation_9',
      arguments: { title: 'Preference', body: 'Remember this preference.' },
    }));
    expect(handler.mock.calls[0][0].arguments).not.toHaveProperty('callId');
    expect(handler.mock.calls[0][0].arguments).not.toHaveProperty('conversationId');
  });
});
