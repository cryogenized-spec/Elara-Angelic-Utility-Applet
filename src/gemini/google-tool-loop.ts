import type { GeminiToolContinuationRequest, GeminiToolResult, GeminiTurnRequest, GeminiStreamEvent } from './contracts';
import { geminiTurnPort } from './provider';
import { executeGoogleTool, confirmationRequestForCall, type GoogleToolHandlers, type GoogleToolExecutorOptions } from '../google/tools/executor';
import type { GoogleToolCall, GoogleToolName } from '../google/tools/contracts';
import { googleToolRegistry } from '../google/tools/registry';
import { googleServiceToolHandlers } from '../google/tools/service-handlers';
import { googleReadToolHandlers } from '../google/tools/read-handlers';
import { roleplayWorldToolHandlers } from '../google/tools/roleplay-world-handlers';
import { mediaToolHandlers } from '../media/tool-handler';
import { isMediaItem, isMediaProviderId } from '../domain/media';
import { requestGoogleToolConfirmations } from '../google/confirmation/broker';
import { requestGoogleCapabilityGrant } from '../google/oauth/request-broker';
import { googleOAuthAuthority } from '../google/oauth/authority';
import type { GoogleCapabilityKey } from '../google/oauth/contracts';
import { withRuntimeContext } from './runtime-context';
import { consumeRuntimeContextRefresh } from './runtime-context-freshness';
import { documentToolHandlers } from '../documents/tool-handler';

export interface GoogleToolLoopOptions {
  readonly tools?: readonly GoogleToolName[];
  readonly readOnly?: boolean;
  readonly maxToolCalls?: number;
  readonly executor?: Partial<GoogleToolExecutorOptions>;
  /**
   * Skip the interactive-chat runtime-context decorator (roleplay guidance,
   * wall-clock framing). Autonomous routine runs supply their own runtime
   * context and must not receive chat/roleplay instructions.
   */
  readonly suppressRuntimeContext?: boolean;
  /**
   * Honor an explicitly empty tool list instead of falling back to the full
   * read-tool surface. Non-chat callers (routine runs without Google
   * permissions) need a genuine no-tool request; the chat default (all read
   * tools) must not change.
   */
  readonly allowEmptyTools?: boolean;
  /**
   * Non-interactive caller (autonomous routine run). Headless callers must
   * never park on interactive UI: capability-grant and write-confirmation
   * brokers are bypassed (the tool result keeps its error / the mutation is
   * declined) instead of waiting on a user who is not watching a chat turn.
   */
  readonly headless?: boolean;
}

const DEFAULT_MAX_TOOL_CALLS = 8;
/**
 * Heartbeat while a mutation approval is parked on the user. The turn runner
 * treats every yielded event as stream activity, so this keeps a healthy
 * user-deliberation gap from tripping the idle-stall watchdog.
 */
const TOOL_CONFIRMATION_HEARTBEAT_MS = 20_000;

// ---------------------------------------------------------------------------
// ONE authoritative read-only policy.
//
// The registry descriptor's `risk` field — and nothing else — decides whether
// a tool is read-only. Handler maps answer "can this tool execute in this
// caller?" (availability); the registry answers "what is this tool allowed to
// do?" (classification). They must never be conflated, and namespace prefixes
// are never a security mechanism. Applied at BOTH declaration time and call
// time; at call time the tool must also be in the declared set, so a model
// that hallucinates an undeclared tool — read or not — is refused.
// ---------------------------------------------------------------------------

const registryRiskByName: ReadonlyMap<string, string> = new Map(googleToolRegistry.map((descriptor) => [descriptor.name, descriptor.risk]));

function isRegistryReadTool(tool: string): boolean {
  return registryRiskByName.get(tool) === 'read';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

type PendingToolCall = GoogleToolCall & Pick<GeminiToolResult, 'callId' | 'name'>;

function normalizeTools(tools: readonly GoogleToolName[] | undefined, allowEmpty: boolean): readonly GoogleToolName[] {
  if (tools?.length) return tools;
  if (allowEmpty && tools) return [];
  return Object.keys(googleReadToolHandlers) as GoogleToolName[];
}

function executorOptions(options: GoogleToolLoopOptions, request: GeminiTurnRequest, signal?: AbortSignal): GoogleToolExecutorOptions {
  return {
    oauth: options.executor?.oauth ?? googleOAuthAuthority,
    handlers: { ...googleServiceToolHandlers, ...roleplayWorldToolHandlers, ...documentToolHandlers, ...mediaToolHandlers, ...options.executor?.handlers },
    confirm: options.executor?.confirm,
    now: options.executor?.now,
    signal,
    generationId: request.generationId,
    isGenerationActive: request.isGenerationActive,
  };
}

function errorToolResult(call: PendingToolCall, message: string): GeminiToolResult {
  return { callId: call.callId, name: call.name, result: { ok: false, error: message } };
}

function artifactEvent(toolName: string, value: unknown): GeminiStreamEvent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Record<string, unknown>;
  if (typeof result.artifactId !== 'string' || typeof result.status !== 'string' || typeof result.mimeType !== 'string') return undefined;
  return { type: 'artifact-created', artifactId: result.artifactId, status: result.status, mimeType: result.mimeType, toolName, ...(typeof result.operationId === 'string' ? { operationId: result.operationId } : {}) };
}

/**
 * Derive a `media-resolved` event from a media tool result.
 *
 * Mirrors {@link artifactEvent}: the event is a projection of structured tool
 * output, so the media card never depends on reading the assistant's prose. A
 * result with no usable items yields no event — an empty search is not a card.
 */
function mediaEvent(value: unknown): GeminiStreamEvent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Record<string, unknown>;
  if (!isMediaProviderId(result.mediaProvider) || !Array.isArray(result.items)) return undefined;
  const items = (result.items as unknown[]).filter(isMediaItem);
  if (!items.length) return undefined;
  const queries = Array.isArray(result.queries)
    ? (result.queries as unknown[]).filter((query): query is string => typeof query === 'string')
    : [];
  return { type: 'media-resolved', provider: result.mediaProvider, queries, items };
}

function isRegisteredToolHandler(tool: GoogleToolName, handlers: GoogleToolHandlers): boolean {
  return Object.prototype.hasOwnProperty.call(handlers, tool);
}



export async function* streamGoogleToolLoop(request: GeminiTurnRequest, options: GoogleToolLoopOptions = {}, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const readOnly = options.readOnly ?? true;
  const tools = normalizeTools(request.tools as readonly GoogleToolName[] | undefined ?? options.tools, options.allowEmptyTools === true);
  const maxToolCalls = Math.max(1, Math.min(options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, 20));
  const executeOptions = executorOptions(options, request, signal);

  // Tool availability must not prevent the initial Gemini request. A stale or
  // partially upgraded client may have a registry/handler mismatch; the model
  // should still receive the prompt, and an actually-invoked unavailable tool
  // is handled as a normal tool result below.
  for (const tool of tools) {
    if (readOnly && !isRegistryReadTool(tool)) {
      throw new Error(`Tool ${tool} is not permitted in read-only mode.`);
    }
  }

  // One freshness decision per turn, after validation (a rejected turn is not a
  // model invocation and records no refresh) and skipped entirely for
  // headless callers that suppress interactive runtime context. Freshness is
  // application-level, not per-thread. Tool continuations within the turn
  // reuse this same instruction.
  const refreshRuntimeContext = options.suppressRuntimeContext === true ? false : consumeRuntimeContextRefresh(Date.now());
  const systemInstruction = options.suppressRuntimeContext === true ? request.systemInstruction?.trim() : withRuntimeContext(request.systemInstruction, { includeClock: refreshRuntimeContext });
  let stream = geminiTurnPort.streamReply({ ...request, tools, systemInstruction }, signal);
  let executedCalls = 0;
  let toolBudgetExhausted = false;

  while (true) {
    const pendingCalls: PendingToolCall[] = [];
    let interactionId = '';
    for await (const event of stream) {
      yield event;
      if (event.type === 'interaction-created') interactionId = event.interactionId;
      // The loop is a transparent event producer: pass everything through and
      // never flatten a structured failure into a string. The turn runner owns
      // the terminal outcome.
      if (event.type === 'tool-call' && !toolBudgetExhausted) pendingCalls.push({ callId: event.callId, name: event.name as GoogleToolName, tool: event.name as GoogleToolName, arguments: event.arguments });
      if (signal?.aborted) {
        yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
        return;
      }
      if (event.type === 'cancelled') return;
      if (event.type === 'failed') return;
    }

    if (pendingCalls.length === 0) return;
    if (!interactionId) interactionId = pendingCalls[0].callId;

    const results: GeminiToolResult[] = [];
    const allowedCount = Math.max(0, maxToolCalls - executedCalls);
    const allowedCalls = pendingCalls.slice(0, allowedCount);
    for (const call of pendingCalls.slice(allowedCalls.length)) results.push(errorToolResult(call, 'Google tool-call limit exceeded for this turn.'));

    const mutationEntries: Array<{ call: PendingToolCall; confirmation: NonNullable<ReturnType<typeof confirmationRequestForCall>> }> = [];
    const immediateCalls: PendingToolCall[] = [];
    for (const call of allowedCalls) {
      if (readOnly && (!isRegistryReadTool(call.name) || !(tools as readonly string[]).includes(call.name))) {
        // Call-time read-only enforcement, same oracle as declaration time:
        // the registry descriptor's risk must be exactly 'read' AND the tool
        // must be in the declared set. A model that hallucinates an undeclared
        // tool — write, destructive, send, or even a legitimate read it was
        // never granted — gets a refusal result; the handler is never invoked
        // and no confirmation UI is requested.
        results.push(errorToolResult(call, 'TOOL_NOT_PERMITTED'));
        continue;
      }
      if (!isRegisteredToolHandler(call.name as GoogleToolName, executeOptions.handlers)) {
        // Authorization passed but availability failed: a registry read tool
        // without a handler in this caller is a structured refusal, never an
        // execution.
        results.push(errorToolResult(call, 'HANDLER_UNAVAILABLE'));
        continue;
      }
      const confirmation = confirmationRequestForCall(call);
      if (confirmation) mutationEntries.push({ call, confirmation });
      else immediateCalls.push(call);
    }

    if (immediateCalls.length > 0) {
      yield { type: 'interaction-status', interactionId, status: 'executing_tools' };
      for (const call of immediateCalls) {
        if (call.name === 'document.create_pdf') {
          yield { type: 'interaction-status', interactionId, status: 'preparing_document' };
          yield { type: 'interaction-status', interactionId, status: 'compiling_pdf' };
        }
        if (signal?.aborted || request.isGenerationActive?.() === false) {
          yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
          return;
        }
        let result = await executeGoogleTool(call, executeOptions);
        if (signal?.aborted || request.isGenerationActive?.() === false) {
          yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
          return;
        }
        if (call.name === 'document.create_pdf') yield { type: 'interaction-status', interactionId, status: 'finalizing_artifact' };
        if (!result.ok && result.code === 'AUTHORIZATION_REQUIRED' && result.requiredCapability && !executeOptions.confirm && !options.headless) {
          yield { type: 'interaction-status', interactionId, status: 'awaiting_authorization' };
          const pendingGrant = requestGoogleCapabilityGrant(result.requiredCapability as GoogleCapabilityKey, signal);
          let granted = false;
          for (;;) {
            const outcome = await Promise.race([
              pendingGrant.then((value) => ({ settled: true as const, value })),
              delay(TOOL_CONFIRMATION_HEARTBEAT_MS).then(() => ({ settled: false as const })),
            ]);
            if (outcome.settled) { granted = outcome.value; break; }
            yield { type: 'interaction-status', interactionId, status: 'awaiting_authorization' };
          }
          if (granted && !signal?.aborted && request.isGenerationActive?.() !== false) result = await executeGoogleTool(call, executeOptions);
        }
        if (signal?.aborted || request.isGenerationActive?.() === false) {
          yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
          return;
        }
        if (result.ok) {
          results.push({ callId: call.callId, name: call.name, result: result.result });
          const created = artifactEvent(call.name, result.result);
          if (created) yield created;
          const media = mediaEvent(result.result);
          if (media) yield media;
        } else results.push(errorToolResult(call, result.code));
      }
    }

    let decisions: boolean[] = [];
    if (mutationEntries.length) {
      if (executeOptions.confirm) {
        decisions = await Promise.all(mutationEntries.map((entry) => executeOptions.confirm!(entry.confirmation)));
      } else if (options.headless) {
        // A headless caller has nobody to ask: mutations are declined, never parked on UI.
        decisions = mutationEntries.map(() => false);
      } else {
        yield { type: 'interaction-status', interactionId, status: 'awaiting_tool_confirmation' };
        const pending = requestGoogleToolConfirmations(mutationEntries.map((entry) => entry.confirmation), signal);
        for (;;) {
          const outcome = await Promise.race([
            pending.then((value) => ({ settled: true as const, value })),
            delay(TOOL_CONFIRMATION_HEARTBEAT_MS).then(() => ({ settled: false as const })),
          ]);
          if (outcome.settled) {
            decisions = outcome.value;
            break;
          }
          yield { type: 'interaction-status', interactionId, status: 'awaiting_tool_confirmation' };
        }
      }
    }

    for (let index = 0; index < mutationEntries.length; index += 1) {
      const entry = mutationEntries[index];
      if (decisions[index] !== true) {
        results.push(errorToolResult(entry.call, 'USER_DECLINED'));
        continue;
      }
      if (signal?.aborted || request.isGenerationActive?.() === false) {
        yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
        return;
      }
      let result = await executeGoogleTool(entry.call, { ...executeOptions, confirm: async () => true });
      if (signal?.aborted || request.isGenerationActive?.() === false) {
        yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
        return;
      }
      if (!result.ok && result.code === 'AUTHORIZATION_REQUIRED' && result.requiredCapability && !executeOptions.confirm && !options.headless) {
        yield { type: 'interaction-status', interactionId, status: 'awaiting_authorization' };
        const pendingGrant = requestGoogleCapabilityGrant(result.requiredCapability as GoogleCapabilityKey, signal);
        let granted = false;
        for (;;) {
          const outcome = await Promise.race([
            pendingGrant.then((value) => ({ settled: true as const, value })),
            delay(TOOL_CONFIRMATION_HEARTBEAT_MS).then(() => ({ settled: false as const })),
          ]);
          if (outcome.settled) { granted = outcome.value; break; }
          yield { type: 'interaction-status', interactionId, status: 'awaiting_authorization' };
        }
        if (granted && !signal?.aborted && request.isGenerationActive?.() !== false) result = await executeGoogleTool(entry.call, { ...executeOptions, confirm: async () => true });
      }
      if (signal?.aborted || request.isGenerationActive?.() === false) {
        yield { type: 'cancelled', ...(interactionId ? { interactionId } : {}) };
        return;
      }
      if (result.ok) {
        results.push({ callId: entry.call.callId, name: entry.call.name, result: result.result });
        const created = artifactEvent(entry.call.name, result.result);
        if (created) yield created;
        const media = mediaEvent(result.result);
        if (media) yield media;
      } else results.push(errorToolResult(entry.call, result.code));
    }

    const continuation: GeminiToolContinuationRequest = { model: request.model, previousInteractionId: interactionId, results, systemInstruction, generationConfig: request.generationConfig, tools };
    stream = geminiTurnPort.streamToolResult(continuation, signal);
    executedCalls += allowedCalls.length;
    // Never drop the final continuation stream on the floor: when the budget
    // is spent, keep consuming (so the closing answer and terminal event still
    // flow through) but stop collecting further tool calls.
    if (executedCalls >= maxToolCalls) toolBudgetExhausted = true;
  }
}
