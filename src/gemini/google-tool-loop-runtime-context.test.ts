import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { streamGoogleToolLoop } from './google-tool-loop';
import { RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY } from './runtime-context-activity';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

const systemInstruction = 'You are Elara, an angelic synthetic cybernetic woman and consort.';
const MINUTE = 60_000;

function seedActivity(entries: Record<string, number>): void {
  window.localStorage.setItem(RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY, JSON.stringify(entries));
}

function recordedActivity(threadId: string): number | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return typeof parsed[threadId] === 'number' ? (parsed[threadId] as number) : null;
  } catch {
    return null;
  }
}

async function runTurn(options: { threadId?: string; suppressRuntimeContext?: boolean }): Promise<string | undefined> {
  streamReply.mockReturnValueOnce(events(
    { type: 'interaction-created', interactionId: 'interaction-rtc', model: 'gemini-3.8-flash' },
    { type: 'completed', interactionId: 'interaction-rtc', status: 'completed', durationMs: 5 },
  ));
  for await (const _event of streamGoogleToolLoop(
    { model: 'gemini-3.8-flash', input: 'Hello.', systemInstruction, tools: ['calendar.listEvents'], ...(options.threadId ? { threadId: options.threadId } : {}) },
    { tools: ['calendar.listEvents'], suppressRuntimeContext: options.suppressRuntimeContext, executor: { oauth, handlers: {} } },
  )) {
    // Consume the turn; assertions inspect what the provider received.
  }
  return (streamReply.mock.calls.at(-1)?.[0] as { systemInstruction?: string } | undefined)?.systemInstruction;
}

describe('tool-loop runtime context freshness', () => {
  beforeEach(() => {
    streamReply.mockReset();
    streamToolResult.mockReset();
    window.localStorage.clear();
  });

  it('establishes a fresh clock on the first invocation of a new thread', async () => {
    const instruction = await runTurn({ threadId: 'thread-new' });
    expect(instruction).toContain('Current local time:');
    expect(instruction).toContain('Application runtime context:');
    expect(instruction).toContain('Persistent world mutations require user confirmation');
    expect(recordedActivity('thread-new')).toBeGreaterThan(0);
  });

  it('omits the clock on normal consecutive turns but keeps stable guidance', async () => {
    await runTurn({ threadId: 'thread-1' });
    const instruction = await runTurn({ threadId: 'thread-1' });
    expect(instruction).toContain(systemInstruction);
    expect(instruction).toContain('When Roleplay Mode is active:');
    expect(instruction).toContain('Persistent world mutations require user confirmation');
    expect(instruction).not.toContain('Application runtime context:');
    expect(instruction).not.toContain('Current local time:');
  });

  it('omits the clock when inactivity is under 30 minutes', async () => {
    seedActivity({ 'thread-idle': Date.now() - 29 * MINUTE });
    const instruction = await runTurn({ threadId: 'thread-idle' });
    expect(instruction).not.toContain('Current local time:');
    expect(instruction).toContain('Persistent world mutations require user confirmation');
  });

  it('refreshes the clock on the first invocation at or above 30 minutes of inactivity', async () => {
    seedActivity({ 'thread-exact': Date.now() - 30 * MINUTE });
    expect(await runTurn({ threadId: 'thread-exact' })).toContain('Current local time:');

    seedActivity({ 'thread-old': Date.now() - 95 * MINUTE });
    expect(await runTurn({ threadId: 'thread-old' })).toContain('Current local time:');
  });

  it('resumes existing-thread behaviour for turns after the refresh', async () => {
    seedActivity({ 'thread-1': Date.now() - 45 * MINUTE });
    expect(await runTurn({ threadId: 'thread-1' })).toContain('Current local time:');
    const next = await runTurn({ threadId: 'thread-1' });
    expect(next).not.toContain('Current local time:');
    expect(next).toContain('Persistent world mutations require user confirmation');
  });

  it('keeps the always-fresh behaviour for turns without thread identity', async () => {
    const instruction = await runTurn({});
    expect(instruction).toContain('Current local time:');
    expect(window.localStorage.getItem(RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY)).toBeNull();
  });

  it('never touches activity state for callers that suppress runtime context', async () => {
    const instruction = await runTurn({ threadId: 'thread-headless', suppressRuntimeContext: true });
    expect(instruction).toBe(systemInstruction);
    expect(window.localStorage.getItem(RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY)).toBeNull();
  });
});
