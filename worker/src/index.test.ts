import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ELARA_SYSTEM_INSTRUCTION } from '../../src/character/system-instruction';

const { createInteraction } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create: createInteraction };
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
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello' }),
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
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello' }),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: 'authz',
      message: 'Origin is not authorized.',
    });
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('rejects malformed requests before they reach Gemini', async () => {
    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: '', input: '' }),
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'validation',
      message: 'Request did not satisfy the approved Gemini contract.',
    });
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('passes the canonical Elara system instruction to Gemini when the client omits one', async () => {
    createInteraction.mockResolvedValue((async function* () {
      yield { event_type: 'interaction.created', interaction: { id: 'interaction-system', status: 'in_progress', model: 'gemini-3-flash-preview' } };
      yield { event_type: 'interaction.completed', interaction: { id: 'interaction-system', status: 'completed' } };
    })());

    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://cryogenized-spec.github.io' },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', input: 'hello' }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({ system_instruction: ELARA_SYSTEM_INSTRUCTION }));
  });

  it('returns only allow-listed streaming events and keeps the credential out of the response', async () => {
    createInteraction.mockResolvedValue((async function* () {
      yield {
        event_type: 'interaction.created',
        interaction: { id: 'interaction-1', status: 'in_progress', model: 'gemini-3-flash-preview' },
      };
      yield {
        event_type: 'step.delta',
        interaction_id: 'interaction-1',
        index: 0,
        delta: { type: 'text', text: 'Hello from Elara.' },
      };
      yield {
        event_type: 'step.delta',
        interaction_id: 'interaction-1',
        index: 0,
        delta: { type: 'unexpected', text: 'This must not cross the boundary.' },
      };
      yield {
        event_type: 'interaction.completed',
        interaction: {
          id: 'interaction-1',
          status: 'completed',
          usage: { input_tokens: 4, output_tokens: 5 },
        },
      };
    })());

    const request = new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://cryogenized-spec.github.io',
      },
      body: JSON.stringify({
        model: 'gemini-3-flash-preview',
        input: 'hello',
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/event-stream/);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://cryogenized-spec.github.io');
    expect(body).toContain('event: interaction.created');
    expect(body).toContain('event: step.delta');
    expect(body).toContain('Hello from Elara.');
    expect(body).toContain('event: interaction.completed');
    expect(body).not.toContain('This must not cross the boundary.');
    expect(body).not.toContain('test-secret-key');

    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3-flash-preview',
      input: 'hello',
      stream: true,
      store: true,
    }));
    const clientOptions = createInteraction.mock.calls[0]?.[0];
    expect(clientOptions).not.toHaveProperty('safety_settings');
  });

  it('answers preflight requests without touching Gemini', async () => {
    const request = new Request('https://worker.example/api/gemini', {
      method: 'OPTIONS',
      headers: { Origin: 'https://cryogenized-spec.github.io' },
    });

    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://cryogenized-spec.github.io');
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
