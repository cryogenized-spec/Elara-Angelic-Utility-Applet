import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiStreamEvent, GeminiTurnRequest } from './contracts';

const { streamReply } = vi.hoisted(() => ({ streamReply: vi.fn() }));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply },
}));

import { geminiOrganicMemoryExtractor, ORGANIC_MEMORY_OBSERVER_INSTRUCTION } from './memory-observer';

async function* events(...items: GeminiStreamEvent[]) {
  for (const item of items) yield item;
}

describe('Gemini organic memory classifier boundary', () => {
  beforeEach(() => streamReply.mockReset());

  it('uses the canonical provider with no tools or durable-memory context', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: '{"candidates":[{"domain":"preference","category":"likes_dislikes","salience":"medium","evidence":"I prefer compact layouts"}]}' },
      { type: 'completed', interactionId: 'observer-1', status: 'completed', durationMs: 1 },
    ));

    const extractor = geminiOrganicMemoryExtractor('gemini-3.8-flash');
    const result = await extractor('I prefer compact layouts for this project.');

    expect(result).toEqual({ candidates: [{ domain: 'preference', category: 'likes_dislikes', salience: 'medium', evidence: 'I prefer compact layouts' }] });
    expect(streamReply).toHaveBeenCalledTimes(1);
    const request = streamReply.mock.calls[0][0] as GeminiTurnRequest;
    expect(request).toMatchObject({
      model: 'gemini-3.8-flash',
      memoryContext: 'none',
      tools: [],
      systemInstruction: ORGANIC_MEMORY_OBSERVER_INSTRUCTION,
    });
    expect(request.input).toContain('I prefer compact layouts for this project.');
    expect(request.input).not.toMatch(/assistant_response/i);
    expect(ORGANIC_MEMORY_OBSERVER_INSTRUCTION).toContain('category');
    expect(ORGANIC_MEMORY_OBSERVER_INSTRUCTION).toContain('salience');
    expect(ORGANIC_MEMORY_OBSERVER_INSTRUCTION).toContain('NEVER relabel');
    expect(ORGANIC_MEMORY_OBSERVER_INSTRUCTION).toContain('health_wellbeing');
  });

  it('accepts an otherwise exact whole-response JSON fence', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: '```json\n{"candidates":[]}\n```' },
      { type: 'completed', interactionId: 'observer-2', status: 'completed', durationMs: 1 },
    ));

    await expect(geminiOrganicMemoryExtractor('gemini-3.8-flash')('Nothing durable here.')).resolves.toEqual({ candidates: [] });
  });

  it('rejects prose wrapped around JSON instead of salvaging ambiguous output', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: 'Here you go: {"candidates":[]}' },
      { type: 'completed', interactionId: 'observer-3', status: 'completed', durationMs: 1 },
    ));

    await expect(geminiOrganicMemoryExtractor('gemini-3.8-flash')('A durable-looking sentence.')).rejects.toThrow();
  });

  it('rejects provider failure rather than converting it into candidate data', async () => {
    streamReply.mockReturnValueOnce(events({
      type: 'failed',
      error: {
        category: 'provider',
        code: 'GEMINI_PROVIDER',
        message: 'Nope',
        retryable: true,
        cancelled: false,
        debug: {},
      },
    }));

    await expect(geminiOrganicMemoryExtractor('gemini-3.8-flash')('I prefer compact layouts.')).rejects.toThrow(/did not complete/i);
  });

  it('requires an explicit completion event', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: '{"candidates":[]}' },
    ));

    await expect(geminiOrganicMemoryExtractor('gemini-3.8-flash')('I prefer compact layouts.')).rejects.toThrow(/without completion/i);
  });

  it('rejects unbounded classifier output', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: 'x'.repeat(4_001) },
      { type: 'completed', interactionId: 'observer-4', status: 'completed', durationMs: 1 },
    ));

    await expect(geminiOrganicMemoryExtractor('gemini-3.8-flash')('I prefer compact layouts.')).rejects.toThrow(/exceeded its bound/i);
  });

  it('passes a pre-aborted parent cancellation into the canonical provider signal', async () => {
    const parent = new AbortController();
    parent.abort();
    streamReply.mockImplementationOnce((_request: GeminiTurnRequest, signal: AbortSignal) => {
      expect(signal.aborted).toBe(true);
      return events({ type: 'cancelled', interactionId: 'observer-aborted-before-start' });
    });

    await expect(
      geminiOrganicMemoryExtractor('gemini-3.8-flash')('I prefer compact layouts.', parent.signal),
    ).rejects.toThrow(/did not complete/i);
  });

  it('relays a parent cancellation that arrives while classification is in flight', async () => {
    const parent = new AbortController();
    let providerSignal: AbortSignal | undefined;
    streamReply.mockImplementationOnce((_request: GeminiTurnRequest, signal: AbortSignal) => {
      providerSignal = signal;
      return (async function* waitForAbort(): AsyncGenerator<GeminiStreamEvent> {
        if (!signal.aborted) {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }
        yield { type: 'cancelled', interactionId: 'observer-aborted-in-flight' };
      })();
    });

    const pending = geminiOrganicMemoryExtractor('gemini-3.8-flash')('I prefer compact layouts.', parent.signal);
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    expect(providerSignal?.aborted).toBe(false);

    parent.abort();

    await expect(pending).rejects.toThrow(/did not complete/i);
    expect(providerSignal?.aborted).toBe(true);
  });
});
