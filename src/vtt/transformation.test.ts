import { afterEach, describe, expect, it, vi } from 'vitest';

const { streamReply } = vi.hoisted(() => ({ streamReply: vi.fn() }));

vi.mock('../gemini/provider', () => ({
  geminiTurnPort: { streamReply },
}));

import { buildVttTransformInput, transformVttTranscript, VTT_TRANSFORM_SYSTEM_INSTRUCTION } from './transformation';

afterEach(() => {
  streamReply.mockReset();
});

describe('VTT transformation', () => {
  it('keeps raw mode local and does not call Gemini', async () => {
    await expect(transformVttTranscript('  hello there  ', 'raw')).resolves.toBe('hello there');
    expect(streamReply).not.toHaveBeenCalled();
  });

  it('builds explicit mode input', () => {
    expect(buildVttTransformInput('walk up to her', 'roleplay')).toBe('Mode: ROLEPLAY\n\nTranscript:\nwalk up to her');
  });

  it('sends polish mode through the canonical Gemini turn port and accumulates deltas', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'text-delta', index: 0, text: 'A clear ' };
      yield { type: 'text-delta', index: 0, text: 'message.' };
      yield { type: 'completed', interactionId: 'int-1', status: 'completed', durationMs: 1 };
    })());

    await expect(transformVttTranscript('  um I mean this message, basically  ', 'polish', { model: 'gemini-test' })).resolves.toBe('A clear message.');
    expect(streamReply).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-test',
      input: 'Mode: POLISH\n\nTranscript:\num I mean this message, basically',
      systemInstruction: VTT_TRANSFORM_SYSTEM_INSTRUCTION,
      generationConfig: { maxOutputTokens: 500 },
    }), undefined);
  });

  it('supports roleplay transformation with the same protected provider port', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'text-delta', index: 0, text: '*walks up to you and smiles*' };
      yield { type: 'completed', interactionId: 'int-2', status: 'completed', durationMs: 1 };
    })());

    await expect(transformVttTranscript('I walk up to you and smile', 'roleplay')).resolves.toBe('*walks up to you and smiles*');
    expect(streamReply).toHaveBeenCalledTimes(1);
  });

  it('surfaces provider failures', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'failed', error: { message: 'provider unavailable' } };
    })());

    await expect(transformVttTranscript('hello', 'polish')).rejects.toThrow('provider unavailable');
  });

  it('rejects empty transformed output', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'completed', interactionId: 'int-3', status: 'completed', durationMs: 1 };
    })());

    await expect(transformVttTranscript('hello', 'roleplay')).rejects.toThrow('returned no text');
  });
});
