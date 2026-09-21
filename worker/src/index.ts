import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { googleToolNameSchema } from '../../src/google/tools/contracts';
import { googleGeminiFunctionDeclarationsForPlane } from '../../src/google/tools/gemini-declarations';
import { ELARA_INTERNAL_HEADER, deriveInstallationId, internalWakeMarker, verifyBearerToken } from '../../src/autonomy/protocol';
import { autonomyPreflight, handleAutonomyRoute } from './autonomy/routes';
import { GEMINI_STREAM_LIMITS } from '../../src/gemini/stream-limits';

// The autonomy engine Durable Object (one per installation). Re-exported
// so the AUTONOMY binding can construct it.
export { AutonomyEngine } from './autonomy/engine';
export { RoutineRunWorkflow } from './autonomy/workflow';

export interface Env {
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS?: string;
  /** Installation secret for the /autonomy/* boundary (wrangler secret). */
  ELARA_INSTALLATION_TOKEN?: string;
  /** The per-installation autonomy scheduler Durable Object. */
  AUTONOMY?: DurableObjectNamespace;
  /** Phase C0 routine-run Workflow binding. */
  ROUTINE_RUN?: Workflow;
  /** Test-only model stub. Must never appear in production wrangler.toml. */
  C1_MODEL_STUB?: string;
}

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
  systemInstruction: z.string().min(1).max(50_000),
  tools: z.array(googleToolNameSchema).max(40).optional(),
  toolResult: toolResultSchema.optional(),
  generationConfig: z.object({
    thinkingLevel: z.string().optional(),
    thinkingSummaries: z.enum(['auto', 'none']).optional(),
    maxOutputTokens: z.number().int().min(1).max(65_536).optional(),
    seed: z.number().int().min(0).optional(),
    stopSequences: z.array(z.string().min(1).max(128)).max(5).optional(),
  }).optional(),
}).refine((value) => Boolean(value.input || value.toolResult), 'Either input or toolResult is required.');

type SafeEvent = Record<string, unknown>;
type PendingFunctionCall = { callId: string; name: string; arguments: string; overflowed: boolean };

const GEMINI_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const GEMINI_MAX_RELAY_BYTES = 4 * 1024 * 1024;
const VTT_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const VTT_ALLOWED_MIME_TYPES = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus']);

type BoundedJsonRead =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean };

async function readBoundedJson(request: Request, maxBytes: number): Promise<BoundedJsonRead> {
  const lengthHeader = request.headers.get('Content-Length');
  if (lengthHeader) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
  }
  if (!request.body) return { ok: false, tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value?.byteLength) continue;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function configuredOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  return configuredOrigins(env).includes(origin ?? '') ? origin : null;
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  });
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

function jsonResponse(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function bearerOf(request: Request): string | null {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
}

async function requireProviderAdmission(request: Request, env: Env): Promise<Response | null> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token) return jsonResponse(request, env, { code: 'configuration', message: 'Worker installation admission is not configured.' }, 503);
  if (!(await verifyBearerToken(bearerOf(request), token))) {
    return jsonResponse(request, env, { code: 'auth', message: 'A valid installation token is required.' }, 401);
  }
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(request, env)) return jsonResponse(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);
  return null;
}

function healthResponse(request: Request, env: Env): Response {
  const hasCredential = Boolean(env.GEMINI_API_KEY);
  const hasOriginPolicy = configuredOrigins(env).length > 0;
  const hasAdmission = Boolean(env.ELARA_INSTALLATION_TOKEN?.trim());
  return jsonResponse(request, env, {
    service: 'elara-gemini',
    status: hasCredential && hasOriginPolicy && hasAdmission ? 'healthy' : 'degraded',
    api: true,
    credentialConfigured: hasCredential,
    originPolicyConfigured: hasOriginPolicy,
    admissionConfigured: hasAdmission,
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
  return stringValue(event, 'interaction_id') ?? stringValue(event, 'interactionId') ?? stringValue(asRecord(event.interaction), 'id');
}

function indexOf(event: Record<string, unknown>): number {
  return numberValue(event, 'index') ?? numberValue(asRecord(event.step), 'index') ?? 0;
}

function sse(eventName: string, data: SafeEvent): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The declarations this Worker is able to back. Computed once at module scope:
 * the registry is static, so there is nothing to recompute per request.
 */
const workerToolDeclarations = googleGeminiFunctionDeclarationsForPlane('worker');

function selectedTools(toolNames: readonly string[] | undefined) {
  if (!toolNames?.length) return undefined;
  const allowed = new Set(toolNames);
  // Plane-filtered: the Worker has no tool executor, so it must never advertise a
  // browser-only tool. See `executionPlane` in src/google/tools/contracts.ts.
  return workerToolDeclarations.filter((tool) => allowed.has(tool.name));
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
  const denied = await requireProviderAdmission(request, env);
  if (denied) return denied;
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return jsonResponse(request, env, { code: 'validation', message: 'Content-Type must be application/json.' }, 415);
  const payloadRead = await readBoundedJson(request, GEMINI_MAX_REQUEST_BYTES);
  if (!payloadRead.ok) {
    return payloadRead.tooLarge
      ? jsonResponse(request, env, { code: 'validation', message: 'Gemini request body is too large.' }, 413)
      : jsonResponse(request, env, { code: 'validation', message: 'Request body must be valid JSON.' }, 400);
  }
  const parsed = requestSchema.safeParse(payloadRead.value);
  if (!parsed.success) return jsonResponse(request, env, { code: 'validation', message: 'Request did not satisfy the approved Gemini contract.' }, 400);

  const requestedTools = parsed.data.tools;
  const tools = selectedTools(requestedTools);
  if (requestedTools?.length && (!tools || tools.length !== new Set(requestedTools).size)) return jsonResponse(request, env, { code: 'validation', message: 'Request referenced an unregistered Gemini tool.' }, 400);
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1' } });
  const systemInstruction = parsed.data.systemInstruction.trim();
  const input = parsed.data.toolResult
    ? [{ type: 'function_result' as const, name: parsed.data.toolResult.name, call_id: parsed.data.toolResult.callId, result: [{ type: 'text' as const, text: JSON.stringify(parsed.data.toolResult.result) }] }]
    : parsed.data.input!;
  const stream = await client.interactions.create({ model: parsed.data.model, input, system_instruction: systemInstruction, previous_interaction_id: parsed.data.previousInteractionId, generation_config: toGenerationConfig(parsed.data.generationConfig), tools, stream: true, store: true });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pendingFunctions = new Map<number, PendingFunctionCall>();
      let waitingForToolResult = false;
      let currentInteractionId: string | undefined = parsed.data.previousInteractionId;
      let streamEvents = 0;
      let relayedBytes = 0;
      let streamedTextChars = 0;
      let streamedThoughtChars = 0;
      const enqueue = (name: string, data: SafeEvent): boolean => {
        const encoded = encoder.encode(sse(name, data));
        if (relayedBytes + encoded.byteLength > GEMINI_MAX_RELAY_BYTES) return false;
        relayedBytes += encoded.byteLength;
        controller.enqueue(encoded);
        return true;
      };
      const failLimit = (message: string) => {
        const error = { event_type: 'error', error: { message } };
        if (!enqueue('error', error)) {
          // The relay budget is already exhausted; close without allocating
          // another oversized payload. Browser callers treat missing terminal
          // completion as protocol failure.
        }
      };
      try {
        for await (const rawEvent of stream) {
          streamEvents += 1;
          if (streamEvents > GEMINI_STREAM_LIMITS.maxEvents) {
            failLimit('Gemini stream exceeded the event safety limit.');
            break;
          }
          const raw = asRecord(rawEvent);
          const eventInteractionId = interactionId(raw);
          if (eventInteractionId) currentInteractionId = eventInteractionId;
          const eventType = stringValue(raw, 'event_type') ?? stringValue(raw, 'type') ?? '';
          const step = asRecord(raw.step);
          const stepIndex = indexOf(raw);
          if (eventType === 'step.start' && stringValue(step, 'type') === 'function_call') {
            const callId = stringValue(step, 'id');
            const name = stringValue(step, 'name');
            if (callId && name) pendingFunctions.set(stepIndex, { callId, name, arguments: '', overflowed: false });
          } else if (eventType === 'step.delta') {
            const delta = asRecord(raw.delta);
            if (stringValue(delta, 'type') === 'arguments_delta') {
              const pending = pendingFunctions.get(stepIndex);
              const fragment = stringValue(delta, 'arguments');
              if (pending && fragment && !pending.overflowed) {
                if (pending.arguments.length + fragment.length > GEMINI_STREAM_LIMITS.maxFunctionArgumentChars) {
                  pending.arguments = '';
                  pending.overflowed = true;
                } else {
                  pending.arguments += fragment;
                }
              }
            }
          }

          const safe = toSafeEvent(rawEvent);
          if (safe) {
            if (safe.name === 'step.delta') {
              const safeDelta = asRecord((safe.data as Record<string, unknown>).delta);
              const safeType = stringValue(safeDelta, 'type');
              const safeText = stringValue(safeDelta, 'text') ?? '';
              if (safeType === 'text') {
                streamedTextChars += safeText.length;
                if (streamedTextChars > GEMINI_STREAM_LIMITS.maxTextChars) {
                  failLimit('Gemini response exceeded the live text safety limit.');
                  break;
                }
              } else if (safeType === 'thought_summary') {
                streamedThoughtChars += safeText.length;
                if (streamedThoughtChars > GEMINI_STREAM_LIMITS.maxThoughtChars) {
                  failLimit('Gemini thought summary exceeded the live safety limit.');
                  break;
                }
              }
            }
            if (!enqueue(safe.name, safe.data)) {
              failLimit('Gemini stream exceeded the relay byte safety limit.');
              break;
            }
          }

          if (eventType === 'step.stop') {
            const pending = pendingFunctions.get(stepIndex);
            if (pending) {
              pendingFunctions.delete(stepIndex);
              if (pending.overflowed || !pending.arguments) {
                enqueue('error', { event_type: 'error', error: { message: 'Gemini produced an invalid or oversized function-call argument stream.' } });
                waitingForToolResult = false;
                break;
              }
              try {
                const args = JSON.parse(pending.arguments) as unknown;
                if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Function arguments must be an object.');
                const toolName = googleToolNameSchema.parse(pending.name);
                if (!currentInteractionId) throw new Error('Function call has no interaction identity.');
                if (!enqueue('tool-call', { event_type: 'tool-call', interaction_id: currentInteractionId, index: stepIndex, call_id: pending.callId, name: toolName, arguments: args })) { failLimit('Gemini stream exceeded the relay byte safety limit.'); break; }
                waitingForToolResult = true;
              } catch {
                enqueue('error', { event_type: 'error', error: { message: 'Gemini produced invalid registered function arguments.' } });
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
        enqueue('error', { event_type: 'error', error: { message: 'Gemini streaming failed.' } });
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

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) return jsonResponse(request, env, { code: 'configuration', message: 'Gemini Worker credential is not configured.' }, 503);
  const denied = await requireProviderAdmission(request, env);
  if (denied) return denied;
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (!VTT_ALLOWED_MIME_TYPES.has(contentType)) return jsonResponse(request, env, { code: 'validation', message: 'Unsupported VTT audio type.' }, 415);
  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > VTT_MAX_AUDIO_BYTES) return jsonResponse(request, env, { code: 'validation', message: 'VTT audio capture is too large.' }, 413);
  if (!request.body) return jsonResponse(request, env, { code: 'validation', message: 'VTT audio body is required.' }, 400);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength < 2048) return jsonResponse(request, env, { code: 'empty', message: 'No speech was detected.' }, 422);
  if (bytes.byteLength > VTT_MAX_AUDIO_BYTES) return jsonResponse(request, env, { code: 'validation', message: 'VTT audio capture is too large.' }, 413);

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1' } });
  let audioFile: { name?: string; uri?: string; mimeType?: string } | undefined;
  try {
    audioFile = await client.files.upload({
      file: new Blob([bytes], { type: contentType }),
      config: { mimeType: contentType },
    });
    if (!audioFile.uri || !audioFile.mimeType) return jsonResponse(request, env, { code: 'provider', message: 'Gemini did not return a usable uploaded audio file.' }, 502);

    const interaction = await client.interactions.create({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: audioFile.uri, mime_type: audioFile.mimeType }],
      generation_config: { transcription_config: { mode: 'smart', language_codes: [] } },
      store: false,
    });
    const transcript = typeof interaction.output_text === 'string' ? interaction.output_text.trim() : '';
    if (!transcript) return jsonResponse(request, env, { code: 'empty', message: 'No speech was detected.' }, 422);
    return jsonResponse(request, env, { transcript });
  } finally {
    if (audioFile?.name) await client.files.delete({ name: audioFile.name }).catch(() => undefined);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health') return healthResponse(request, env);
    if (request.method === 'OPTIONS') {
      if (pathname.startsWith('/autonomy/')) return autonomyPreflight(allowedOrigin(request, env));
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (pathname.startsWith('/autonomy/')) {
      // The autonomy boundary handles its own methods (GET reads, POST writes).
      try {
        const response = await handleAutonomyRoute(pathname, request, env, allowedOrigin(request, env));
        if (response) return response;
      } catch {
        return jsonResponse(request, env, { code: 'internal', message: 'The autonomy worker could not complete the request.' }, 500);
      }
      return jsonResponse(request, env, { code: 'not_found', message: 'Not found.' }, 404);
    }
    if (request.method !== 'POST') return jsonResponse(request, env, { code: 'not_found', message: 'Not found.' }, 404);
    try {
      if (pathname === '/api/gemini') return await handleGemini(request, env);
      if (pathname === '/api/transcribe') return await handleTranscribe(request, env);
      return jsonResponse(request, env, { code: 'not_found', message: 'Not found.' }, 404);
    } catch {
      return jsonResponse(request, env, { code: 'provider', message: 'The Gemini Worker could not complete the request.' }, 502);
    }
  },

  // -------------------------------------------------------------------
  // The cron heartbeat (design §7.1): the clock, nothing else. It resolves
  // the installation, signals the Durable Object's repair sweep through the
  // Worker→DO binding, and returns. No agent reasoning, no routine
  // execution, no long-running work happens here — the DO owns scheduling.
  // -------------------------------------------------------------------
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    void controller;
    if (!env.AUTONOMY || !env.ELARA_INSTALLATION_TOKEN) return; // autonomy not configured — nothing to wake
    const installationId = await deriveInstallationId(env.ELARA_INSTALLATION_TOKEN);
    const stub = env.AUTONOMY.get(env.AUTONOMY.idFromName(installationId));
    ctx.waitUntil(stub.fetch('https://autonomy-engine/heartbeat', {
      method: 'POST',
      headers: { [ELARA_INTERNAL_HEADER]: await internalWakeMarker(env.ELARA_INSTALLATION_TOKEN) },
    }));
  },
};
