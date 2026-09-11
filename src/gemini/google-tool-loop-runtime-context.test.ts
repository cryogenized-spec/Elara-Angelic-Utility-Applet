import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { streamGoogleToolLoop } from './google-tool-loop';
import { RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY } from './runtime-context-freshness';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: ['calendar.events.read' as const], enabledCapabilities: ['calendar.events.read' as const], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

const systemInstruction = 'You are Elara, an angelic synthetic cybernetic woman and consort.';
const MINUTE = 60_000;

function seedRefresh(lastRefreshAt: number): void {
  window.localStorage.setItem(RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY, JSON.stringify({ lastRefreshAt }));
}

function recordedRefresh(): number | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return typeof parsed.lastRefreshAt === 'number' ? parsed.lastRefreshAt : null;
  } catch {
    return null;
  }
}

function rawStoredState(): string | null {
  return window.localStorage.getItem(RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY);
}

async function runTurn(options: { suppressRuntimeContext?: boolean } = {}): Promise<string | undefined> {
  streamReply.mockReturnValueOnce(events(
    { type: 'interaction-created', interactionId: 'interaction-rtc', model: 'gemini-3.8-flash' },
    { type: 'completed', interactionId: 'interaction-rtc', status: 'completed', durationMs: 5 },
  ));
  for await (const _event of streamGoogleToolLoop(
    { model: 'gemini-3.8-flash', input: 'Hello.', systemInstruction, tools: ['calendar.listEvents'] },
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

  it('establishes a fresh clock on initial runtime establishment and records it', async () => {
    const before = Date.now();
    const instruction = await runTurn();
    const after = Date.now();
    expect(instruction).toContain('Current local time:');
    expect(instruction).toContain('Application runtime context:');
    expect(instruction).toContain('Persistent world mutations require user confirmation');
    const recorded = recordedRefresh();
    expect(recorded).not.toBeNull();
    expect(recorded!).toBeGreaterThanOrEqual(before);
    expect(recorded!).toBeLessThanOrEqual(after);
  });

  it('omits the clock on normal turns but keeps stable guidance, without moving the timestamp', async () => {
    await runTurn();
    const storedAfterRefresh = rawStoredState();
    const instruction = await runTurn();
    expect(instruction).toContain(systemInstruction);
    expect(instruction).toContain('When Roleplay Mode is active:');
    expect(instruction).toContain('Persistent world mutations require user confirmation');
    expect(instruction).not.toContain('Application runtime context:');
    expect(instruction).not.toContain('Current local time:');
    // The normal invocation left the freshness window byte-identical.
    expect(rawStoredState()).toBe(storedAfterRefresh);
  });

  it('omits the clock when the established clock is still fresh', async () => {
    seedRefresh(Date.now() - 29 * MINUTE);
    const storedBefore = rawStoredState();
    const instruction = await runTurn();
    expect(instruction).not.toContain('Current local time:');
    expect(instruction).toContain('Persistent world mutations require user confirmation');
    expect(rawStoredState()).toBe(storedBefore);
  });

  it('refreshes the clock on the first invocation at or past the 30-minute boundary', async () => {
    seedRefresh(Date.now() - 30 * MINUTE);
    const before = Date.now();
    expect(await runTurn()).toContain('Current local time:');
    expect(recordedRefresh()).toBeGreaterThanOrEqual(before);

    window.localStorage.clear();
    streamReply.mockReset();
    streamToolResult.mockReset();
    seedRefresh(Date.now() - 95 * MINUTE);
    expect(await runTurn()).toContain('Current local time:');
  });

  it('resumes clock-free turns after a refresh until the next boundary', async () => {
    seedRefresh(Date.now() - 45 * MINUTE);
    expect(await runTurn()).toContain('Current local time:');
    const next = await runTurn();
    expect(next).not.toContain('Current local time:');
    expect(next).toContain('Persistent world mutations require user confirmation');
  });

  it('shares one freshness window across callers regardless of thread', async () => {
    // Freshness takes no thread identity: a turn from any thread establishes
    // the window, and turns from other threads observe it.
    await runTurn();
    const fromAnotherThread = await runTurn();
    expect(fromAnotherThread).not.toContain('Current local time:');
    expect(fromAnotherThread).toContain('Persistent world mutations require user confirmation');
  });

  it('reuses the identical instruction for continuations within one turn', async () => {
    // Seed stale so this turn refreshes, then force a tool continuation.
    seedRefresh(Date.now() - 60 * MINUTE);
    const handler = vi.fn(async () => ({ events: [{ summary: 'Design review' }] }));
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-rtc-tool', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-rtc-tool', index: 0, callId: 'call-rtc-1', name: 'calendar.listEvents', arguments: { calendarId: 'primary' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-rtc-tool-2', status: 'completed', durationMs: 5 },
    ));
    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Show my calendar.', systemInstruction, tools: ['calendar.listEvents'] },
      { tools: ['calendar.listEvents'], executor: { oauth, handlers: { 'calendar.listEvents': handler } } },
    )) {
      // Consume the multi-step turn.
    }
    expect(handler).toHaveBeenCalledOnce();
    const initialInstruction = (streamReply.mock.calls[0][0] as { systemInstruction?: string }).systemInstruction;
    const continuationInstruction = (streamToolResult.mock.calls[0][0] as { systemInstruction?: string }).systemInstruction;
    // One freshness decision at turn entry: the clock is never regenerated
    // halfway through a multi-step tool execution.
    expect(initialInstruction).toContain('Current local time:');
    expect(continuationInstruction).toBe(initialInstruction);
  });

  it('never touches freshness state for callers that suppress runtime context', async () => {
    const instruction = await runTurn({ suppressRuntimeContext: true });
    expect(instruction).toBe(systemInstruction);
    expect(rawStoredState()).toBeNull();
  });
});
