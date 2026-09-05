import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, uploadFile, deleteFile } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create: createInteraction };
    files = { upload: uploadFile, delete: deleteFile };
  },
}));

import worker from './index';

describe('Gemini Worker boundary', () => {
  const baseEnv = {
    GEMINI_API_KEY: 'test-secret-key',
    ALLOWED_ORIGINS: 'https://cryogenized-spec.github.io',
  };

  beforeEach(() => {
    createInteraction.mockReset();
    uploadFile.mockReset();
    deleteFile.mockReset();
    deleteFile.mockResolvedValue(undefined);
  });

  it('reports a healthy service without exposing protected values', async () => {
    const request = new Request('https://worker.example/health', {
      headers: { Origin: 'https://cryogenized-spec.github.io' },
    });

    const response = await worker.fetch(request, baseEnv);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://cryogenized-spec.github.io');
    expect(body).toEqual({
      service: 'elara-gemini',
      status: 'healthy',
      api: true,
      credentialConfigured: true,
      originPolicyConfigured: true,
    });
    expect(JSON.stringify(body)).not.toContain('test-secret-key');
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('reports a degraded health state when protected configuration is incomplete', async () => {
    const request = new Request('https://worker.example/health');

    const response = await worker.fetch(request, { ...baseEnv, ALLOWED_ORIGINS: '' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      service: 'elara-gemini',
      status: 'degraded',
      api: true,
      credentialConfigured: true,
      originPolicyConfigured: false,
    });
  });

  it('rejects a missing Worker credential before invoking Gemini', async () => {
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello', systemInstruction: 'custom persona' }),
    });

    const response = await worker.fetch(request, { ...baseEnv, GEMINI_API_KEY: '' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'configuration',
      message: 'Gemini Worker credential is not configured.',
    });
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects an origin that is outside the configured allowlist', async () => {
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello', systemInstruction: 'custom persona' }),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: 'authz', message: 'Origin is not authorized.' });
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects malformed requests before they reach Gemini', async () => {
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3-flash-preview' }),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: 'validation', message: 'Request did not satisfy the approved Gemini contract.' });
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects a Gemini turn when the master instruction is missing', async () => {
    createInteraction.mockResolvedValue({});
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello' }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: 'validation', message: 'Request did not satisfy the approved Gemini contract.' });
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('passes the configured master instruction to Gemini unchanged', async () => {
    createInteraction.mockResolvedValue({});
    const customInstruction = 'PERSONA PROTOCOL: ELARA\nRemain in character and follow this exact instruction.';
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello', systemInstruction: customInstruction }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({ system_instruction: customInstruction }));
    await response.text();
  });

  it('returns only allow-listed streaming events and keeps the credential out of the response', async () => {
    const events = [
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', status: 'in_progress', model: 'gemini-3-flash-preview' } },
      { event_type: 'step.start', interaction_id: 'interaction-1', index: 0, step: { index: 0, id: 'step-1', name: 'answer', type: 'text' } },
      { event_type: 'step.delta', interaction_id: 'interaction-1', index: 0, delta: { type: 'text', text: 'Hello' } },
      { event_type: 'unknown.secret', secret: 'test-secret-key' },
      { event_type: 'step.stop', interaction_id: 'interaction-1', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed', usage: { total_tokens: 7 } } },
    ];
    createInteraction.mockResolvedValue((async function* () { for (const event of events) yield event; })());
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello', systemInstruction: 'custom persona' }),
    });

    const response = await worker.fetch(request, baseEnv);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('event: interaction.created');
    expect(text).toContain('event: step.delta');
    expect(text).not.toContain('unknown.secret');
    expect(text).not.toContain('test-secret-key');
  });

  it('answers preflight requests without touching Gemini', async () => {
    const request = new Request('https://worker.example/api/gemini', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://cryogenized-spec.github.io',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://cryogenized-spec.github.io');
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized origin at the VTT boundary', async () => {
    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Origin: 'https://attacker.example' },
      body: new Uint8Array(3_000),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: 'authz', message: 'Origin is not authorized.' });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects unsupported VTT MIME types before invoking Gemini', async () => {
    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mp4', Origin: 'https://cryogenized-spec.github.io' },
      body: new Uint8Array(3_000),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ code: 'validation', message: 'Unsupported VTT audio type.' });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects oversized VTT captures using the request header before reading the body', async () => {
    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'Content-Length': String((2 * 1024 * 1024) + 1),
        Origin: 'https://cryogenized-spec.github.io',
      },
      body: new Uint8Array(10),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: 'validation',
      message: 'VTT audio capture is too large.',
    });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects a tiny VTT capture without uploading audio to Gemini', async () => {
    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Origin: 'https://cryogenized-spec.github.io' },
      body: new Uint8Array(100),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ code: 'empty', message: 'No speech was detected.' });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('uses the transcription model and smart mode for accepted VTT audio', async () => {
    uploadFile.mockResolvedValue({ name: 'files/vtt-test', uri: 'https://example.invalid/vtt-test', mimeType: 'audio/webm' });
    createInteraction.mockResolvedValue({ output_text: 'hello from voice' });
    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Origin: 'https://cryogenized-spec.github.io' },
      body: new Uint8Array(3_000),
    });

    const response = await worker.fetch(request, baseEnv);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ transcript: 'hello from voice' });
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ config: { mimeType: 'audio/webm' } }));
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: 'https://example.invalid/vtt-test', mime_type: 'audio/webm' }],
      generation_config: { transcription_config: { mode: 'smart', language_codes: [] } },
      store: false,
    }));
    expect(deleteFile).toHaveBeenCalledWith({ name: 'files/vtt-test' });
    expect(JSON.stringify(body)).not.toContain('test-secret-key');
  });
});
