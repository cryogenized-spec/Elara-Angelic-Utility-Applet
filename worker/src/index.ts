import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { ELARA_SYSTEM_INSTRUCTION } from '../../src/gemini/creative-context';

export interface Env {
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS?: string;
}

const requestSchema = z.object({
  model: z.string().min(1).max(128),
  input: z.string().min(1).max(200_000),
  previousInteractionId: z.string().min(1).max(256).optional(),
  generationConfig: z.object({
    thinkingLevel: z.string().optional(),
    thinkingSummaries: z.enum(['auto', 'none']).optional(),
    maxOutputTokens: z.number().int().min(1).optional(),
    seed: z.number().int().min(0).optional(),
    stopSequences: z.array(z.string().min(1).max(128)).max(5).optional(),
  }).optional(),
});

type SafeEvent = Record<string, unknown>;

function configuredOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return configuredOrigins(env).includes(origin) ? origin : null;
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  });
  const origin = allowedOrigin(request, env);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function jsonResponse(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function healthResponse(request: Request, env: Env): Response {
  const hasCredential = Boolean(env.GEMINI_API_KEY);
  const hasOriginPolicy = configuredOrigins(env).length > 0;
  const status = hasCredential && hasOriginPolicy ? 'healthy' : 'degraded';
  return jsonResponse(request, env, {
    service: 'elara-gemini',
    status,
    api: true,
    credentialConfigured: hasCredential,
    originPolicyConfigured: hasOriginPolicy,
  }, 200);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function interactionId(event: Record<string, unknown>): string | undefined {
  return stringValue(event, 'interaction_id')
    ?? stringValue(event, 'interactionId')
    ?? stringValue(asRecord(event.interaction), 'id');
}

function indexOf(event: Record<string, unknown>): number {
  return numberValue(event, 'index') ?? numberValue(asRecord(event.step), 'index') ?? 0;
}

function sse(eventName: string, data: SafeEvent): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toSafeEvent(raw: unknown): { name: string; data: SafeEvent } | null {
  const event = asRecord(raw);
  const eventType = stringValue(event, 'event_type') ?? stringValue(event, 'type') ?? '';
  const id = interactionId(event);

  if (eventType === 'interaction.created') {
    const interaction = asRecord(event.interaction);
    return { name: 'interaction.created', data: { event_type: eventType, interaction: { id: stringValue(interaction, 'id') ?? id, status: stringValue(interaction, 'status'), model: stringValue(interaction, 'model') } } };
  }

  if (eventType === 'interaction.in_progress' || eventType === 'interaction.status_update' || eventType === 'interaction.status' || eventType === 'interaction.updated' || eventType === 'interaction.requires_action') {
    return { name: eventType, data: { event_type: eventType, interaction_id: id, status: stringValue(event, 'status') ?? stringValue(asRecord(event.interaction), 'status') } };
  }

  if (eventType === 'step.start') {
    const step = asRecord(event.step);
    const summary = Array.isArray(step.summary)
      ? step.summary.map((item) => ({ text: stringValue(asRecord(item), 'text') })).filter((item) => item.text)
      : [];
    return { name: 'step.start', data: { event_type: eventType, interaction_id: id, index: indexOf(event), step: { index: numberValue(step, 'index') ?? indexOf(event), type: stringValue(step, 'type') ?? 'other', summary, signature: stringValue(step, 'signature') } } };
  }

  if (eventType === 'step.delta') {
    const delta = asRecord(event.delta);
    const deltaType = stringValue(delta, 'type');
    if (deltaType === 'text' || deltaType === 'thought_summary' || deltaType === 'thought_signature') {
      return { name: 'step.delta', data: { event_type: eventType, interaction_id: id, index: indexOf(event), delta: { type: deltaType, text: stringValue(delta, 'text'), signature: stringValue(delta, 'signature') } } };
    }
    return null;
  }

  if (eventType === 'step.stop') return { name: 'step.stop', data: { event_type: eventType, interaction_id: id, index: indexOf(event) } };

  if (eventType === 'interaction.completed') {
    const interaction = asRecord(event.interaction);
    const usage = asRecord(interaction.usage);
    return { name: 'interaction.completed', data: { event_type: eventType, interaction: { id: stringValue(interaction, 'id') ?? id, status: stringValue(interaction, 'status') ?? 'completed', usage: Object.keys(usage).length > 0 ? usage : undefined } } };
  }

  if (eventType === 'error') {
    const error = asRecord(event.error);
    return { name: 'error', data: { event_type: eventType, error: { message: stringValue(error, 'message') ?? 'Gemini returned a streaming error.' } } };
  }

  return null;
}

function toGenerationConfig(config: z.infer<typeof requestSchema>['generationConfig']) {
  if (!config) return undefined;
  const generationConfig: Record<string, unknown> = {};
  if (config.thinkingLevel) generationConfig.thinking_level = config.thinkingLevel;
  if (config.thinkingSummaries) generationConfig.thinking_summaries = config.thinkingSummaries;
  if (config.maxOutputTokens !== undefined) generationConfig.max_output_tokens = config.maxOutputTokens;
  if (config.seed !== undefined) generationConfig.seed = config.seed;
  if (config.stopSequences?.length) generationConfig.stop_sequences = config.stopSequences;
  return Object.keys(generationConfig).length > 0 ? generationConfig : undefined;
}

async function handleGemini(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return jsonResponse(request, env, { code: 'configuration', message: 'Gemini Worker credential is not configured.' }, 503);

  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(request, env)) return jsonResponse(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return jsonResponse(request, env, { code: 'validation', message: 'Content-Type must be application/json.' }, 415);

  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) return jsonResponse(request, env, { code: 'validation', message: 'Request did not satisfy the approved Gemini contract.' }, 400);

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, apiVersion: 'v1' });
  const stream = await client.interactions.create({
    model: parsed.data.model,
    input: parsed.data.input,
    system_instruction: ELARA_SYSTEM_INSTRUCTION,
    previous_interaction_id: parsed.data.previousInteractionId,
    generation_config: toGenerationConfig(parsed.data.generationConfig),
    stream: true,
    store: true,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const rawEvent of stream) {
          const safe = toSafeEvent(rawEvent);
          if (safe) controller.enqueue(encoder.encode(sse(safe.name, safe.data)));
          if (safe?.name === 'interaction.completed' || safe?.name === 'error') break;
        }
        controller.close();
      } catch {
        controller.enqueue(encoder.encode(sse('error', { event_type: 'error', error: { message: 'Gemini streaming failed.' } })));
        controller.close();
      }
    },
  });

  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Connection', 'keep-alive');
  return new Response(body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health') return healthResponse(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== 'POST' || pathname !== '/api/gemini') return jsonResponse(request, env, { code: 'not_found', message: 'Not found.' }, 404);

    try {
      return await handleGemini(request, env);
    } catch {
      return jsonResponse(request, env, { code: 'provider', message: 'The Gemini Worker could not complete the request.' }, 502);
    }
  },
};
