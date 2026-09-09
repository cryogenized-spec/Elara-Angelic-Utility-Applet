import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// THE JOIN TEST.
//
// Two modules jointly enforce the autonomy tool invariant:
//   routineToolSet()  — capability → registry(read, gemini) → tool names
//   streamGoogleToolLoop() — read-only admission (registry risk + declared set)
//
// Each was tested separately and both halves passed while their COMPOSITION
// was broken (Drive/Docs/Sheets tools were mapped by the registry but rejected
// by the loop's old handler-set oracle). This suite joins them: every tool
// surface any routine can produce must be admitted by the real default engine
// in read-only mode — the provider is the only mock, exactly as in the chat
// tool-loop tests.
// ---------------------------------------------------------------------------

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('../gemini/provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { routineEngine, routineToolSet } from './runner';
import { ROUTINE_GOOGLE_CAPABILITIES, type ElaraRoutine, type RoutineGoogleCapability } from './contracts';
import { googleToolRegistry } from '../google/tools/registry';

const NOW = 1_700_000_000_000;

function makeRoutine(google: RoutineGoogleCapability[]): ElaraRoutine {
  return {
    id: 'r-join',
    name: 'Join probe',
    enabled: true,
    instruction: 'Probe the tool surface.',
    schedule: { kind: 'daily', time: '09:00', days: 'every' },
    timezone: 'UTC',
    permissions: { memory: false, google },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function completedStream(): AsyncGenerator<never> {
  return (async function* () {
    yield { type: 'text-delta', index: 0, text: '{"outcome":"noop"}' } as never;
    yield { type: 'completed', interactionId: 'it-join', status: 'completed', durationMs: 3 } as never;
  })();
}

beforeEach(() => {
  streamReply.mockReset().mockImplementation(() => completedStream());
  streamToolResult.mockReset();
});

describe('routine tool surface × read-only loop composition', () => {
  it('every capability grantable to a routine produces a tool surface the real read-only engine admits', async () => {
    expect(ROUTINE_GOOGLE_CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of ROUTINE_GOOGLE_CAPABILITIES) {
      streamReply.mockClear();
      const tools = routineToolSet(makeRoutine([capability]));
      // Engine-level admission: the declaration check inside the read-only
      // loop throws on any non-read tool — under the old handler-set oracle
      // this threw for docs/drive/sheets and the run ALWAYS failed.
      const events = [];
      for await (const event of routineEngine({ model: 'test-model', input: 'Run.', systemInstruction: 'Instruction.', tools, maxToolCalls: 8 })) {
        events.push(event);
      }
      expect(events.at(-1), `engine terminal for ${capability}`).toMatchObject({ type: 'completed' });
      if (tools.length > 0) {
        // The provider received EXACTLY the mapped read tools.
        expect(streamReply, `provider called for ${capability}`).toHaveBeenCalledTimes(1);
        const request = streamReply.mock.calls[0][0] as { tools?: string[] };
        expect(request.tools, `declared tools for ${capability}`).toEqual(tools);
      }
    }
  });

  it('every tool routineToolSet can ever emit is registry-classified read-risk and Gemini-exposed', () => {
    const allTools = new Set<string>();
    for (const capability of ROUTINE_GOOGLE_CAPABILITIES) {
      for (const tool of routineToolSet(makeRoutine([capability]))) allTools.add(tool);
    }
    expect(allTools.size).toBeGreaterThan(0);
    for (const tool of allTools) {
      const descriptor = googleToolRegistry.find((entry) => entry.name === tool);
      expect(descriptor, `${tool} must exist in the registry`).toBeDefined();
      expect(descriptor?.risk, `${tool} must be risk 'read'`).toBe('read');
      expect(descriptor?.exposure, `${tool} must be Gemini-exposed`).toBe('gemini');
      expect(allTools, `${tool} must never be a write/destructive/send tool`).toContain(tool);
    }
    // The surfaces the bug hid: Drive, Docs, and Sheets reads must be reachable.
    for (const expected of ['docs.inspectDocument', 'drive.searchFiles', 'drive.searchLibrary', 'drive.getFile', 'sheets.readRange']) {
      expect(allTools, `${expected} must be grantable through some capability`).toContain(expected);
    }
  });

  it('specific capability → tool-surface mappings (docs, drive, sheets, tasks)', () => {
    expect(routineToolSet(makeRoutine(['docs.read']))).toEqual(['docs.inspectDocument']);
    expect(routineToolSet(makeRoutine(['drive.files.app.read']))).toEqual(expect.arrayContaining(['drive.searchFiles', 'drive.getFile', 'drive.downloadFile']));
    expect(routineToolSet(makeRoutine(['drive.library.read']))).toEqual(['drive.searchLibrary']);
    expect(routineToolSet(makeRoutine(['sheets.read']))).toEqual(expect.arrayContaining(['sheets.getSpreadsheet', 'sheets.readRange']));
    expect(routineToolSet(makeRoutine(['tasks.read']))).toEqual(expect.arrayContaining(['tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask']));
  });
});
