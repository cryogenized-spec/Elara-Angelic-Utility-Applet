import { afterEach, describe, expect, it, vi } from 'vitest';

const { streamReply } = vi.hoisted(() => ({ streamReply: vi.fn() }));

vi.mock('../gemini/provider', () => ({
  geminiTurnPort: { streamReply },
}));

import { transformVttTranscript } from './transformation';

afterEach(() => {
  streamReply.mockReset();
});

describe('VTT transformation', () => {
  it('keeps raw mode local and does not call Gemini', async () => {
    await expect(transformVttTranscript('  hello there  ', 'raw')).resolves.toBe('hello there');
    expect(streamReply).not.toHaveBeenCalled();
  });

  it('sends the exact Character Master System Instruction and keeps transformation instructions in user input', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'text-delta', index: 0, text: 'A clear message.' };
      yield { type: 'completed', interactionId: 'int-1', status: 'completed', durationMs: 1 };
    })());

    const masterPrompt = 'PERSONA PROTOCOL: ELARA\nBe in character and perceive the user as yourself.';
    await expect(transformVttTranscript('  um I mean this message, basically  ', 'polish', { model: 'gemini-test', systemInstruction: masterPrompt })).resolves.toBe('A clear message.');
    expect(streamReply).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-test',
      input: expect.stringContaining('VOICE INPUT TRANSFORMATION TASK'),
      systemInstruction: masterPrompt,
      generationConfig: { maxOutputTokens: 500 },
    }), undefined);
    expect(streamReply.mock.calls[0][0].input).toContain('um I mean this message, basically');
  });

  it('allows VTT to run without a Character Master System Instruction', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'text-delta', index: 0, text: 'Hello.' };
      yield { type: 'completed', interactionId: 'int-empty-master', status: 'completed', durationMs: 1 };
    })());

    await expect(transformVttTranscript('hello', 'polish')).resolves.toBe('Hello.');
    expect(streamReply).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining('VOICE INPUT TRANSFORMATION TASK'),
      systemInstruction: undefined,
    }), undefined);
  });

  it('supports roleplay transformation through the same protected provider port', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'text-delta', index: 0, text: '*walks up to you and smiles*' };
      yield { type: 'completed', interactionId: 'int-2', status: 'completed', durationMs: 1 };
    })());

    await expect(transformVttTranscript('I walk up to you and smile', 'roleplay', { systemInstruction: 'PERSONA PROTOCOL: ELARA' })).resolves.toBe('*walks up to you and smiles*');
    expect(streamReply).toHaveBeenCalledTimes(1);
  });

  it('surfaces provider failures', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'failed', error: { message: 'provider unavailable' } };
    })());

    await expect(transformVttTranscript('hello', 'polish', { systemInstruction: 'PERSONA PROTOCOL: ELARA' })).rejects.toThrow('provider unavailable');
  });

  it('rejects empty transformed output', async () => {
    streamReply.mockReturnValue((async function* () {
      yield { type: 'completed', interactionId: 'int-3', status: 'completed', durationMs: 1 };
    })());

    await expect(transformVttTranscript('hello', 'roleplay', { systemInstruction: 'PERSONA PROTOCOL: ELARA' })).rejects.toThrow('returned no text');
  });
});
