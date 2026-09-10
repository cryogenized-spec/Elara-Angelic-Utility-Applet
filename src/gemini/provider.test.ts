import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, getGeminiApiKey, getGeminiLockboxStatus, GoogleGenAI } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getGeminiLockboxStatus: vi.fn(),
  GoogleGenAI: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey, getGeminiLockboxStatus }));

import { geminiTurnPort } from './provider';

async function* events(...items: unknown[]) {
  for (const item of items) yield item;
}

describe('Gemini provider credential preflight', () => {
  beforeEach(() => {
    createInteraction.mockReset();
    getGeminiApiKey.mockReset();
    getGeminiLockboxStatus.mockReset();
    GoogleGenAI.mockReset();
    GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction } }) {
      this.interactions = { create: createInteraction };
    });
  });

  it('fails before constructing the SDK when the Lockbox is empty', async () => {
    getGeminiLockboxStatus.mockResolvedValue('empty');

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello.' })) collected.push(event);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      type: 'failed',
      error: {
        category: 'configuration',
        code: 'GEMINI_CONFIGURATION',
        message: 'Gemini API key is not configured in the app Lockbox.',
        retryable: false,
      },
    });
    expect(getGeminiApiKey).not.toHaveBeenCalled();
    expect(GoogleGenAI).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('fails before constructing the SDK when the Lockbox is locked', async () => {
    getGeminiLockboxStatus.mockResolvedValue('locked');

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello while locked.' })) collected.push(event);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      type: 'failed',
      error: {
        category: 'configuration',
        code: 'GEMINI_LOCKBOX_LOCKED',
        message: 'Gemini API key is locked in the app Lockbox. Unlock the Lockbox before sending.',
        retryable: false,
      },
    });
    expect(getGeminiApiKey).not.toHaveBeenCalled();
    expect(GoogleGenAI).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('constructs the SDK and reaches interactions.create after an unlocked credential preflight', async () => {
    getGeminiLockboxStatus.mockResolvedValue('unlocked');
    getGeminiApiKey.mockResolvedValue('test-gemini-key');
    createInteraction.mockResolvedValue(events(
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hello from Gemini.' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed' } },
    ));

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello.' })) collected.push(event);

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-gemini-key',
      httpOptions: { apiVersion: 'v1', retryOptions: { attempts: 1 } },
    });
    expect(createInteraction).toHaveBeenCalledTimes(1);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.8-flash',
      input: 'Hello.',
      stream: true,
      store: true,
    }));
    expect(collected).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'interaction-created', interactionId: 'interaction-1' }),
      expect.objectContaining({ type: 'text-delta', text: 'Hello from Gemini.' }),
      expect.objectContaining({ type: 'completed', interactionId: 'interaction-1' }),
    ]));
  });
});

describe('Gemini provider stream fidelity', () => {
  beforeEach(() => {
    createInteraction.mockReset();
    getGeminiApiKey.mockReset();
    getGeminiLockboxStatus.mockReset();
    GoogleGenAI.mockReset();
    GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction } }) {
      this.interactions = { create: createInteraction };
    });
    getGeminiLockboxStatus.mockResolvedValue('unlocked');
    getGeminiApiKey.mockResolvedValue('test-gemini-key');
  });

  async function collect(items: unknown[]): Promise<unknown[]> {
    createInteraction.mockResolvedValue(events(...items));
    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello.' })) collected.push(event);
    return collected;
  }

  it('preserves provider status and code from streamed SSE error events', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'error', interaction_id: 'interaction-1', error: { message: 'Slow down.', status: 429, code: 'RESOURCE_EXHAUSTED' } },
    ]);

    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: {
        category: 'rate_limit',
        code: 'GEMINI_RATE_LIMIT',
        message: 'Slow down.',
        retryable: true,
        providerStatus: 429,
        providerCode: 'RESOURCE_EXHAUSTED',
        interactionId: 'interaction-1',
      },
    });
  });

  it('normalizes the documented ErrorEvent shape (code/message/event_id, no HTTP status)', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'error', event_id: 'evt-1', interaction_id: 'interaction-1', error: { code: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric.' } },
    ]);

    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: {
        category: 'rate_limit',
        code: 'GEMINI_RATE_LIMIT',
        message: 'Quota exceeded for quota metric.',
        retryable: true,
        providerStatus: undefined,
        providerCode: 'RESOURCE_EXHAUSTED',
        interactionId: 'interaction-1',
      },
    });
  });

  it('keeps unrecognized streamed error codes on an honest unknown failure', async () => {
    const collected = await collect([
      { event_type: 'error', event_id: 'evt-9', error: { code: 'SOME_FUTURE_CODE', message: 'Something new broke.' } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: {
        category: 'unknown',
        code: 'GEMINI_UNKNOWN',
        message: 'Something new broke.',
        providerCode: 'SOME_FUTURE_CODE',
        retryable: false,
      },
    });
  });

  it('classifies a streamed 503 error event as a retryable provider failure', async () => {
    const collected = await collect([
      { event_type: 'error', error: { message: 'Service unavailable.', code: 503 } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: { category: 'provider', code: 'GEMINI_PROVIDER', providerStatus: 503, retryable: true },
    });
  });

  it('treats requires_action completion as a status update, not a terminal event', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'requires_action' } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'interaction-status',
      interactionId: 'interaction-1',
      status: 'requires_action',
    });
    expect(collected.some((event) => (event as { type: string }).type === 'completed')).toBe(false);
  });

  it('fails explicitly when the stream ends without interaction.completed', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Partial…' } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: { message: 'Gemini stream ended without an explicit interaction.completed event.' },
    });
  });

  it('streams thought-summary deltas and reports them on completion usage', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'thought' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'thought_summary', text: 'First thought. ' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'thought_summary', text: 'Second thought.' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed', usage: { input_tokens: 12, output_tokens: 4 } } },
    ]);
    const deltas = collected.filter((event) => (event as { type: string }).type === 'thought-summary-delta');
    expect(deltas).toHaveLength(2);
    expect(collected.at(-1)).toMatchObject({
      type: 'completed',
      usage: { inputTokens: 12, outputTokens: 4, thoughtSummary: 'First thought. Second thought.' },
    });
  });

  it('emits an empty argument object for a zero-argument function call', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-zero', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-zero', name: 'gmail.listLabels' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-zero', status: 'completed' } },
    ]);

    expect(collected).toContainEqual(expect.objectContaining({ type: 'tool-call', interactionId: 'interaction-zero', callId: 'call-zero', name: 'gmail.listLabels', arguments: {} }));
    expect(collected.some((event) => (event as { type: string }).type === 'failed')).toBe(false);
  });

  it('preserves arguments supplied on function-call step.start', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-initial', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-initial', name: 'tasks.listTaskLists', arguments: { pageToken: 'next-page' } } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-initial', status: 'completed' } },
    ]);

    expect(collected).toContainEqual(expect.objectContaining({ type: 'tool-call', callId: 'call-initial', name: 'tasks.listTaskLists', arguments: { pageToken: 'next-page' } }));
  });

  it('continues to assemble incremental function-call argument deltas', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-streamed', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-streamed', name: 'calendar.listEvents' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"timeMin":"2026-09-04T00:00:00Z",' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '"timeMax":"2026-09-04T23:59:59Z"}' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-streamed', status: 'completed' } },
    ]);

    expect(collected).toContainEqual(expect.objectContaining({ type: 'tool-call', callId: 'call-streamed', name: 'calendar.listEvents', arguments: { timeMin: '2026-09-04T00:00:00Z', timeMax: '2026-09-04T23:59:59Z' } }));
  });

  it('regression: accepts a step.start placeholder arguments object followed by arguments_delta JSON (roleplay_setting.create)', async () => {
    // Observed production shape: the Interactions API emits `"arguments": {}`
    // on step.start and then streams the real arguments as arguments_delta.
    // Concatenating "{}" with the streamed JSON produced "{}{...}", which is
    // invalid JSON and surfaced as GEMINI_UNKNOWN "invalid function-call arguments".
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-rp', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-rp', name: 'roleplay_setting.create', arguments: {} } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"type":"building","name":"The Residence",' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '"description":"A quiet home above the city."}' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-rp', status: 'requires_action' } },
    ]);

    expect(collected.some((event) => (event as { type: string }).type === 'failed')).toBe(false);
    expect(collected).toContainEqual(expect.objectContaining({
      type: 'tool-call', interactionId: 'interaction-rp', callId: 'call-rp', name: 'roleplay_setting.create',
      arguments: { type: 'building', name: 'The Residence', description: 'A quiet home above the city.' },
    }));
  });

  it('regression: emits one tool-call per parallel function_call step when each step.start carries a placeholder object', async () => {
    // Multi-entity creation is expressed by the model as several independent
    // roleplay_setting.create calls in one turn, not as a batch payload.
    const entities = [
      { index: 0, id: 'call-a', args: { type: 'building', name: 'The Residence' } },
      { index: 1, id: 'call-b', args: { type: 'room', name: 'Master Suite', parentId: 'the_residence_01' } },
      { index: 2, id: 'call-c', args: { type: 'room', name: 'Steam Sauna & Walk-in Shower', parentId: 'master_suite_01' } },
      { index: 3, id: 'call-d', args: { type: 'outdoor', name: 'Sky Terrace', parentId: 'the_residence_01' } },
    ];
    const stream: unknown[] = [{ event_type: 'interaction.created', interaction: { id: 'interaction-multi', model: 'gemini-3.8-flash' } }];
    for (const entity of entities) {
      stream.push({ event_type: 'step.start', index: entity.index, step: { type: 'function_call', id: entity.id, name: 'roleplay_setting.create', arguments: {} } });
      stream.push({ event_type: 'step.delta', index: entity.index, delta: { type: 'arguments_delta', arguments: JSON.stringify(entity.args) } });
      stream.push({ event_type: 'step.stop', index: entity.index });
    }
    stream.push({ event_type: 'interaction.completed', interaction: { id: 'interaction-multi', status: 'requires_action' } });

    const collected = await collect(stream);
    const toolCalls = collected.filter((event) => (event as { type: string }).type === 'tool-call');
    expect(collected.some((event) => (event as { type: string }).type === 'failed')).toBe(false);
    expect(toolCalls).toHaveLength(4);
    for (const entity of entities) expect(toolCalls).toContainEqual(expect.objectContaining({ callId: entity.id, name: 'roleplay_setting.create', arguments: entity.args }));
  });

  it('uses structured step.start arguments only when no argument deltas arrive', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-unary', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-unary', name: 'roleplay_setting.create', arguments: { type: 'room', name: 'Master Suite' } } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-unary', status: 'requires_action' } },
    ]);

    expect(collected).toContainEqual(expect.objectContaining({ type: 'tool-call', callId: 'call-unary', name: 'roleplay_setting.create', arguments: { type: 'room', name: 'Master Suite' } }));
  });

  it('does not merge or fall back when streamed argument deltas are malformed even if step.start had a placeholder object', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-bad', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-bad', name: 'roleplay_setting.create', arguments: {} } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"type":"building","name":' } },
      { event_type: 'step.stop', index: 0 },
    ]);

    expect(collected.some((event) => (event as { type: string }).type === 'tool-call')).toBe(false);
    expect(collected.at(-1)).toMatchObject({ type: 'failed', error: { message: 'Gemini produced invalid function-call arguments.' } });
  });

  it('rejects non-object step.start arguments (array) when no deltas arrive', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-array', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-array', name: 'roleplay_setting.create', arguments: [{ type: 'building', name: 'The Residence' }] } },
      { event_type: 'step.stop', index: 0 },
    ]);

    expect(collected.some((event) => (event as { type: string }).type === 'tool-call')).toBe(false);
    expect(collected.at(-1)).toMatchObject({ type: 'failed', error: { message: 'Gemini produced invalid function-call arguments.' } });
  });

  it('preserves structured failure for malformed function-call arguments', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-invalid', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-invalid', name: 'calendar.listEvents' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"timeMin":' } },
      { event_type: 'step.stop', index: 0 },
    ]);

    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: { message: 'Gemini produced invalid function-call arguments.' },
    });
  });
});
