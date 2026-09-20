import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiStreamEvent, GeminiTurnRequest } from './contracts';

const { streamReply } = vi.hoisted(() => ({ streamReply: vi.fn() }));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply },
}));

import { geminiSemanticSynthesisExtractor, SEMANTIC_SYNTHESIS_INSTRUCTION } from './semantic-synthesis';

const SYNTHESIS_JSON = '{"summary":"Zuhayr is the owner of the project.","recentObservations":["Zuhayr is the owner of the project."],"openConflicts":[],"aliases":[]}';

async function* events(...items: GeminiStreamEvent[]) {
  for (const item of items) yield item;
}

describe('Gemini semantic synthesis extractor boundary', () => {
  beforeEach(() => streamReply.mockReset());

  it('uses the canonical provider with no tools and no durable-memory context', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: SYNTHESIS_JSON },
      { type: 'completed', interactionId: 'synthesis-1', status: 'completed', durationMs: 1 },
    ));

    const extractor = geminiSemanticSynthesisExtractor('gemini-3.8-flash');
    const result = await extractor('CONCEPT: kind=person title=Zuhayr');

    expect(result).toEqual({
      summary: 'Zuhayr is the owner of the project.',
      recentObservations: ['Zuhayr is the owner of the project.'],
      openConflicts: [],
      aliases: [],
    });
    expect(streamReply).toHaveBeenCalledTimes(1);
    const request = streamReply.mock.calls[0][0] as GeminiTurnRequest;
    expect(request.model).toBe('gemini-3.8-flash');
    expect(request.tools).toEqual([]);
    expect(request.memoryContext).toBe('none');
    expect(request.systemInstruction).toBe(SEMANTIC_SYNTHESIS_INSTRUCTION);
    expect(request.input).toBe('CONCEPT: kind=person title=Zuhayr');
  });

  it('tolerates a fenced JSON response', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: '```json\n' + SYNTHESIS_JSON + '\n```' },
      { type: 'completed', interactionId: 'synthesis-2', status: 'completed', durationMs: 1 },
    ));

    const result = await geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input');
    expect(result).toMatchObject({ summary: 'Zuhayr is the owner of the project.' });
  });

  it('rejects output that exceeds the synthesis bound', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: 'x'.repeat(1_700) },
    ));

    await expect(geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input')).rejects.toThrow('exceeded its bound');
  });

  it('rejects a stream that ends without a completion event', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: SYNTHESIS_JSON },
    ));

    await expect(geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input')).rejects.toThrow('ended without completion');
  });

  it('rejects failed, errored or cancelled streams', async () => {
    const hostile: GeminiStreamEvent[] = [
      { type: 'failed', error: { category: 'provider', code: 'GEMINI_PROVIDER', message: 'Nope', retryable: true, cancelled: false, debug: {} } },
      { type: 'error', message: 'stream broke' },
      { type: 'cancelled', interactionId: 'synthesis-cancelled' },
    ];
    for (const event of hostile) {
      streamReply.mockReturnValueOnce(events(event));
      await expect(geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input')).rejects.toThrow('did not complete successfully');
    }
  });

  it('rejects non-JSON synthesis output', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'text-delta', index: 0, text: 'certainly, here is your summary:' },
      { type: 'completed', interactionId: 'synthesis-3', status: 'completed', durationMs: 1 },
    ));

    await expect(geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input')).rejects.toThrow();
  });

  it('honors a pre-aborted parent signal', async () => {
    const controller = new AbortController();
    controller.abort();
    streamReply.mockImplementationOnce((_request: GeminiTurnRequest, signal: AbortSignal) => {
      expect(signal.aborted).toBe(true);
      return events({ type: 'cancelled', interactionId: 'synthesis-4' });
    });

    await expect(geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input', controller.signal)).rejects.toThrow('did not complete successfully');
  });

  it('relays a late parent abort to the provider signal', async () => {
    const parent = new AbortController();
    let observed: AbortSignal | undefined;
    streamReply.mockImplementationOnce((_request: GeminiTurnRequest, signal: AbortSignal) => {
      observed = signal;
      expect(signal.aborted).toBe(false);
      parent.abort(); // aborted mid-stream: the relay must forward it
      return events();
    });

    await expect(geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input', parent.signal)).rejects.toThrow('ended without completion');

    expect(observed?.aborted).toBe(true);
  });
});

describe('synthesis deadline', () => {
  it('aborts a stalled provider at twelve seconds and clears its timer', async () => {
    vi.useFakeTimers();
    try {
      streamReply.mockImplementationOnce(async function* (_request: GeminiTurnRequest, signal: AbortSignal) {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        yield { type: 'cancelled', interactionId: 'deadline' } as GeminiStreamEvent;
      });
      const result = geminiSemanticSynthesisExtractor('gemini-3.8-flash')('input');
      const assertion = expect(result).rejects.toThrow('did not complete successfully');
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
