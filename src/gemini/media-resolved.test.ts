import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, getGeminiApiKey, getGeminiLockboxStatus, GoogleGenAI, searchMedia } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getGeminiLockboxStatus: vi.fn(),
  GoogleGenAI: vi.fn(),
  searchMedia: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey, getGeminiLockboxStatus }));
// Mock the orchestrator only. The real tool handler, the real executor, the real
// Zod argument schema, and the real event derivation all run beneath the loop.
vi.mock('../media/search', () => ({ searchMedia, resetMediaProvider: () => undefined }));

import { streamGoogleToolLoop } from './google-tool-loop';
import type { GeminiStreamEvent } from './contracts';
import type { MediaItem } from '../domain/media';

async function* events(...items: unknown[]) {
  for (const item of items) yield item;
}

function mediaItem(id: string, title: string): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title,
    channel: 'Ambient Channel',
    webUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
  };
}

function scriptToolCall(callId: string, queries: unknown) {
  return events(
    { event_type: 'interaction.created', interaction: { id: 'interaction-media', model: 'gemini-3.8-flash' } },
    { event_type: 'step.start', index: 0, step: { type: 'function_call', id: callId, name: 'youtube.search', arguments: { queries } } },
    { event_type: 'step.stop', index: 0 },
    { event_type: 'interaction.requires_action', interaction_id: 'interaction-media', status: 'requires_action' },
  );
}

const scriptReply = () => events(
  { event_type: 'interaction.created', interaction: { id: 'interaction-media-done', model: 'gemini-3.8-flash' } },
  { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Here is something to listen to.' } },
  { event_type: 'interaction.completed', interaction: { id: 'interaction-media-done', status: 'completed' } },
);

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

async function run(queries: unknown): Promise<GeminiStreamEvent[]> {
  const collected: GeminiStreamEvent[] = [];
  for await (const event of streamGoogleToolLoop(
    { model: 'gemini-3.8-flash', input: 'Play some dark ambient music.', systemInstruction: 'You are Elara.', tools: ['youtube.search'] },
    { tools: ['youtube.search'], executor: { oauth } },
  )) collected.push(event);
  return collected;
}

beforeEach(() => {
  createInteraction.mockReset();
  searchMedia.mockReset();
  GoogleGenAI.mockReset();
  GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction } }) {
    this.interactions = { create: createInteraction };
  });
  getGeminiLockboxStatus.mockResolvedValue('unlocked');
  getGeminiApiKey.mockResolvedValue('test-gemini-key');
});

describe('media-resolved stream event', () => {
  it('emits structured media from a youtube.search call', async () => {
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', ['dark ambient']))
      .mockResolvedValueOnce(scriptReply());
    searchMedia.mockResolvedValue({
      outcomes: [{ query: 'dark ambient', normalizedQuery: 'dark ambient', items: [mediaItem('abc', 'Dark Ambient Mix')], source: 'network', truncated: false }],
      failures: [],
      networkCalls: 1,
    });

    const collected = await run(['dark ambient']);

    // The card is driven by this event, never by parsing the assistant's prose.
    const media = collected.find((event) => event.type === 'media-resolved');
    expect(media).toMatchObject({
      type: 'media-resolved',
      provider: 'youtube',
      queries: ['dark ambient'],
      items: [expect.objectContaining({ id: 'abc', title: 'Dark Ambient Mix' })],
    });
    expect(collected.some((event) => event.type === 'failed')).toBe(false);
  });

  it('passes the model arguments through the real Zod schema into the orchestrator', async () => {
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', ['dark ambient', 'lofi beats']))
      .mockResolvedValueOnce(scriptReply());
    searchMedia.mockResolvedValue({ outcomes: [], failures: [], networkCalls: 0 });

    await run(['dark ambient', 'lofi beats']);

    expect(searchMedia).toHaveBeenCalledWith(expect.objectContaining({ queries: ['dark ambient', 'lofi beats'] }));
  });

  it('rejects more than the documented batch size before any search runs', async () => {
    const tooMany = Array.from({ length: 9 }, (_, index) => `query ${index}`);
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', tooMany))
      .mockResolvedValueOnce(scriptReply());

    const collected = await run(tooMany);

    expect(searchMedia).not.toHaveBeenCalled();
    expect(collected.some((event) => event.type === 'media-resolved')).toBe(false);
  });

  it('emits no card when the search resolved nothing', async () => {
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', ['zzzz']))
      .mockResolvedValueOnce(scriptReply());
    searchMedia.mockResolvedValue({
      outcomes: [{ query: 'zzzz', normalizedQuery: 'zzzz', items: [], source: 'network', truncated: false }],
      failures: [],
      networkCalls: 1,
    });

    const collected = await run(['zzzz']);

    // An empty search is not a card, and certainly not a fallback search link
    // dressed up as a resolved video.
    expect(collected.some((event) => event.type === 'media-resolved')).toBe(false);
  });

  it('drops malformed items rather than emitting a half-built card', async () => {
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', ['x']))
      .mockResolvedValueOnce(scriptReply());
    const good = mediaItem('good', 'Good');
    searchMedia.mockResolvedValue({
      outcomes: [{
        query: 'x',
        normalizedQuery: 'x',
        items: [good, { ...good, id: '', title: 'No id' }, { ...good, id: 'no-url', webUrl: '' }],
        source: 'network',
        truncated: false,
      }],
      failures: [],
      networkCalls: 1,
    });

    const collected = await run(['x']);

    const media = collected.find((event) => event.type === 'media-resolved');
    expect(media && media.type === 'media-resolved' ? media.items.map((item) => item.id) : []).toEqual(['good']);
  });

  it('sends the model a result with no credential-shaped fields', async () => {
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', ['dark ambient']))
      .mockResolvedValueOnce(scriptReply());
    searchMedia.mockResolvedValue({
      outcomes: [{ query: 'dark ambient', normalizedQuery: 'dark ambient', items: [mediaItem('abc', 'Dark Ambient Mix')], source: 'network', truncated: false }],
      failures: [],
      networkCalls: 1,
    });

    await run(['dark ambient']);

    // Whatever is returned to the model becomes prompt context and can end up in
    // logs, so it must carry rendered media only.
    const continuation = createInteraction.mock.calls[1][0] as {
      input: { type: string; result: { type: string; text: string }[] }[];
    };
    const sent = JSON.stringify(continuation.input);
    expect(sent).toContain('Dark Ambient Mix');
    expect(sent).not.toMatch(/AIza/);
    expect(sent).not.toMatch(/apiKey|api_key|x-goog|authorization/i);
  });

  it('still completes the turn when a search fails outright', async () => {
    createInteraction
      .mockResolvedValueOnce(scriptToolCall('call-media', ['x']))
      .mockResolvedValueOnce(scriptReply());
    searchMedia.mockResolvedValue({
      outcomes: [],
      failures: [{ query: 'x', normalizedQuery: 'x', reason: 'no-api-key', message: 'No YouTube API key is configured.' }],
      networkCalls: 0,
    });

    const collected = await run(['x']);

    expect(collected.some((event) => event.type === 'media-resolved')).toBe(false);
    expect(collected.some((event) => event.type === 'completed')).toBe(true);
  });
});
