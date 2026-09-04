import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { ELARA_SYSTEM_INSTRUCTION } from '../../src/gemini/creative-context';
import { googleToolNameSchema } from '../../src/google/tools/contracts';
import { googleGeminiFunctionDeclarations } from '../../src/google/tools/gemini-declarations';
import { handleGoogleOAuthRequest, type GoogleOAuthEnv } from './google-oauth';

export interface Env extends GoogleOAuthEnv { GEMINI_API_KEY: string; ALLOWED_ORIGINS?: string; }

const toolResultSchema = z.object({
  callId: z.string().min(1).max(256),
  name: googleToolNameSchema,
  result: z.unknown().refine((value) => {
    try { return JSON.stringify(value).length <= 100_000; } catch { return false; }
  }, 'Tool result is too large or not JSON serializable.'),
});

const requestSchema = z.object({
  model: z.string().min(1).max(128),
  input: z.string().min(1).max(200_000).optional(),
  previousInteractionId: z.string().min(1).max(256).optional(),
  systemInstruction: z.string().min(1).max(50_000).optional(),
  tools: z.array(googleToolNameSchema).max(40).optional(),
  toolResult: toolResultSchema.optional(),
  generationConfig: z.object({ thinkingLevel: z.string().optional(), thinkingSummaries: z.enum(['auto', 'none']).optional(), maxOutputTokens: z.number().int().min(1).optional(), seed: z.number().int().min(0).optional(), stopSequences: z.array(z.string().min(1).max(128)).max(5).optional() }).optional(),
}).refine((value) => Boolean(value.input || value.toolResult), 'Either input or toolResult is required.');

type SafeEvent = Record<string, unknown>;
type PendingFunctionCall = { callId: string; name: string; arguments: string };

function configuredOrigins(env: Env): string[] { return (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean); }
function allowedOrigin(request: Request, env: Env): string | null { const origin = request.headers.get('Origin'); if (!origin) return null; return configuredOrigins(env).includes(origin) ? origin : null; }
function corsHeaders(request: Request, env: Env): Headers { const headers = new Headers({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Elara-Google-Capability, X-Elara-Google-Target', Vary: 'Origin' }); const origin = allowedOrigin(request, env); if (origin) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Credentials', 'true'); } return headers; }
function jsonResponse(request: Request, env: Env, body: unknown, status = 200): Response { const headers = corsHeaders(request, env); headers.set('Content-Type', 'application/json; charset=utf-8'); headers.set('Cache-Control', 'no-store'); return new Response(JSON.stringify(body), { status, headers }); }
function healthResponse(request: Request, env: Env): Response { const hasCredential = Boolean(env.GEMINI_API_KEY); const hasOriginPolicy = configuredOrigins(env).length > 0; return jsonResponse(request, env, { service: 'elara-gemini', status: hasCredential && hasOriginPolicy ? 'healthy' : 'degraded', api: true, credentialConfigured: hasCredential, originPolicyConfigured: hasOriginPolicy }, 200); }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function stringValue(record: Record<string, unknown>, key: string): string | undefined { const value = record[key]; return typeof value === 'string' && value.length > 0 ? value : undefined; }
function numberValue(record: Record<string, unknown>, key: string): number | undefined { const value = record[key]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function interactionId(event: Record<string, unknown>): string | undefined { return stringValue(event, 'interaction_id') ?? stringValue(event, 'interactionId') ?? stringValue(asRecord(event.interaction), 'id'); }
function indexOf(event: Record<string, unknown>): number { return numberValue(event, 'index') ?? numberValue(asRecord(event.step), 'index') ?? 0; }
function sse(eventName: string, data: SafeEvent): string { return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`; }
function selectedTools(toolNames: readonly string[] | undefined) { if (!toolNames?.length) return undefined; const allowed = new Set(toolNames); return googleGeminiFunctionDeclarations.filter((tool) => allowed.has(tool.name)); }

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

function toSafeEvent(raw: unknown): { name: string; data: SafeEvent } | null {
  const event = asRecord(raw);
  const eventType = stringValue(event, 'event_type') ?? stringValue(event, 'type') ?? '';
  const id = interactionId(event);
  if (eventType === 'interaction.created') {
    const interaction = asRecord(event.interaction);
    return { name: 'interaction.created', data: { event_type: eventType, interaction: { id: stringValue(interaction, 'id') ?? id, status: stringValue(interaction, 'status'), model: stringValue(interaction, 'model') } } };
  }
  if (['interaction.in_progress', 'interaction.status_update', 'interaction.status', 'interaction.updated', 'interaction.requires_action'].includes(eventType)) {
    const interaction = asRecord(event.interaction);
    return { name: eventType, data: { event_type: eventType, interaction_id: id, status: stringValue(event, 'status') ?? stringValue(interaction, 'status') } };
  }
  if (eventType === 'step.start') {
    const step = asRecord(event.step);
    const summary = Array.isArray(step.summary) ? step.summary.map((item) => ({ text: stringValue(asRecord(item), 'text') })).filter((item) => item.text) : [];
    return { name: 'step.start', data: { event_type: eventType, interaction_id: id, index: indexOf(event), step: { index: numberValue(step, 'index') ?? indexOf(event), id: stringValue(step, 'id'), name: stringValue(step, 'name'), type: stringValue(step, 'type') ?? 'other', summary, signature: stringValue(step, 'signature') } } };
  }
  if (eventType === 'step.delta') {
    const delta = asRecord(event.delta);
    const deltaType = stringValue(delta, 'type');
    if (deltaType === 'text' || deltaType === 'thought_summary' || deltaType === 'thought_signature') return { name: 'step.delta', data: { event_type: eventType, interaction_id: id, index: indexOf(event), delta: { type: deltaType, text: stringValue(delta, 'text'), signature: stringValue(delta, 'signature') } } };
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

async function handleGemini(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return jsonResponse(request, env, { code: 'configuration', message: 'Gemini Worker credential is not configured.' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(request, env)) return jsonResponse(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return jsonResponse(request, env, { code: 'validation', message: 'Content-Type must be application/json.' }, 415);
  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) return jsonResponse(request, env, { code: 'validation', message: 'Request did not satisfy the approved Gemini contract.' }, 400);

  const requestedTools = parsed.data.tools;
  const tools = selectedTools(requestedTools);
  if (requestedTools?.length && (!tools || tools.length !== new Set(requestedTools).size)) return jsonResponse(request, env, { code: 'validation', message: 'Request referenced an unregistered Gemini tool.' }, 400);
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, apiVersion: 'v1' });
  const systemInstruction = parsed.data.systemInstruction?.trim() || ELARA_SYSTEM_INSTRUCTION;
  const input = parsed.data.toolResult
    ? [{ type: 'function_result' as const, name: parsed.data.toolResult.name, call_id: parsed.data.toolResult.callId, result: [{ type: 'text' as const, text: JSON.stringify(parsed.data.toolResult.result) }] }]
    : parsed.data.input!;
  const stream = await client.interactions.create({ model: parsed.data.model, input, system_instruction: systemInstruction, previous_interaction_id: parsed.data.previousInteractionId, generation_config: toGenerationConfig(parsed.data.generationConfig), tools, stream: true, store: true });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pendingFunctions = new Map<number, PendingFunctionCall>();
      let waitingForToolResult = false;
      try {
        for await (const rawEvent of stream) {
          const raw = asRecord(rawEvent);
          const eventType = stringValue(raw, 'event_type') ?? stringValue(raw, 'type') ?? '';
          const step = asRecord(raw.step);
          const stepIndex = indexOf(raw);
          if (eventType === 'step.start' && stringValue(step, 'type') === 'function_call') {
            const callId = stringValue(step, 'id');
            const name = stringValue(step, 'name');
            if (callId && name) pendingFunctions.set(stepIndex, { callId, name, arguments: '' });
          } else if (eventType === 'step.delta') {
            const delta = asRecord(raw.delta);
            if (stringValue(delta, 'type') === 'arguments_delta') {
              const pending = pendingFunctions.get(stepIndex);
              const fragment = stringValue(delta, 'arguments');
              if (pending && fragment) pending.arguments += fragment;
              if (pending && pending.arguments.length > 100_000) pending.arguments = '';
            }
          }

          const safe = toSafeEvent(rawEvent);
          if (safe) controller.enqueue(encoder.encode(sse(safe.name, safe.data)));

          if (eventType === 'step.stop') {
            const pending = pendingFunctions.get(stepIndex);
            if (pending) {
              pendingFunctions.delete(stepIndex);
              if (!pending.arguments) {
                controller.enqueue(encoder.encode(sse('error', { event_type: 'error', error: { message: 'Gemini produced an invalid or oversized function-call argument stream.' } })));
                waitingForToolResult = false;
                break;
              }
              try {
                const args = JSON.parse(pending.arguments) as unknown;
                if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Function arguments must be an object.');
                const toolName = googleToolNameSchema.parse(pending.name);
                controller.enqueue(encoder.encode(sse('tool-call', { event_type: 'tool-call', interaction_id: interactionId(raw), index: stepIndex, call_id: pending.callId, name: toolName, arguments: args }))); 
                waitingForToolResult = true;
              } catch {
                controller.enqueue(encoder.encode(sse('error', { event_type: 'error', error: { message: 'Gemini produced invalid registered function arguments.' } })));
                waitingForToolResult = false;
                break;
              }
            }
          }
          if (eventType === 'interaction.requires_action') {
            waitingForToolResult = true;
            break;
          }
          if (eventType === 'interaction.completed' || eventType === 'error') break;
        }
        controller.close();
        void waitingForToolResult;
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

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const googleOAuthResponse = await handleGoogleOAuthRequest(request, env);
  if (googleOAuthResponse) return googleOAuthResponse;
  const pathname = new URL(request.url).pathname;
  if (pathname === '/health') return healthResponse(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST' || pathname !== '/api/gemini') return jsonResponse(request, env, { code: 'not_found', message: 'Not found.' }, 404);
  try { return await handleGemini(request, env); } catch { return jsonResponse(request, env, { code: 'provider', message: 'The Gemini Worker could not complete the request.' }, 502); }
} };
