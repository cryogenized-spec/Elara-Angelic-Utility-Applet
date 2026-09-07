import type { GeminiToolContinuationRequest, GeminiToolResult, GeminiTurnRequest, GeminiStreamEvent } from './contracts';
import { geminiTurnPort } from './provider';
import { executeGoogleTool, confirmationRequestForCall, type GoogleToolHandlers, type GoogleToolExecutorOptions } from '../google/tools/executor';
import type { GoogleToolCall, GoogleToolName } from '../google/tools/contracts';
import { googleServiceToolHandlers } from '../google/tools/service-handlers';
import { googleReadToolHandlers } from '../google/tools/read-handlers';
import { roleplayWorldToolHandlers } from '../google/tools/roleplay-world-handlers';
import { requestGoogleToolConfirmations } from '../google/confirmation/broker';
import { googleOAuthAuthority } from '../google/oauth/authority';
import { withRuntimeContext } from './runtime-context';

export interface GoogleToolLoopOptions {
  readonly tools?: readonly GoogleToolName[];
  readonly readOnly?: boolean;
  readonly maxToolCalls?: number;
  readonly executor?: Partial<GoogleToolExecutorOptions>;
}

const DEFAULT_MAX_TOOL_CALLS = 8;
/**
 * Heartbeat while a mutation approval is parked on the user. The turn runner
 * treats every yielded event as stream activity, so this keeps a healthy
 * user-deliberation gap from tripping the idle-stall watchdog.
 */
const TOOL_CONFIRMATION_HEARTBEAT_MS = 20_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

type PendingToolCall = GoogleToolCall & Pick<GeminiToolResult, 'callId' | 'name'>;

function normalizeTools(tools: readonly GoogleToolName[] | undefined): readonly GoogleToolName[] {
  return tools?.length ? tools : Object.keys(googleReadToolHandlers) as GoogleToolName[];
}

function executorOptions(options: GoogleToolLoopOptions): GoogleToolExecutorOptions {
  return {
    oauth: options.executor?.oauth ?? googleOAuthAuthority,
    handlers: { ...googleServiceToolHandlers, ...roleplayWorldToolHandlers, ...options.executor?.handlers },
    confirm: options.executor?.confirm,
    now: options.executor?.now,
  };
}

function errorToolResult(call: PendingToolCall, message: string): GeminiToolResult {
  return { callId: call.callId, name: call.name, result: { ok: false, error: message } };
}

function isRegisteredToolHandler(tool: GoogleToolName, handlers: GoogleToolHandlers): boolean {
  return Object.prototype.hasOwnProperty.call(handlers, tool);
}

export async function* streamGoogleToolLoop(request: GeminiTurnRequest, options: GoogleToolLoopOptions = {}, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const readOnly = options.readOnly ?? true;
  const tools = normalizeTools(request.tools as readonly GoogleToolName[] | undefined ?? options.tools);
  const maxToolCalls = Math.max(1, Math.min(options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, 20));
  const executeOptions = executorOptions(options);

  // Tool availability must not prevent the initial Gemini request. A stale or
  // partially upgraded client may have a registry/handler mismatch; the model
  // should still receive the prompt, and an actually-invoked unavailable tool
  // is handled as a normal tool result below.
  for (const tool of tools) {
    if (readOnly && !Object.prototype.hasOwnProperty.call(googleReadToolHandlers, tool) && !tool.startsWith('roleplay_setting.')) {
      throw new Error(`Tool ${tool} is not permitted in read-only mode.`);
    }
  }

  const systemInstruction = withRuntimeContext(request.systemInstruction);
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
      if (signal?.aborted || event.type === 'cancelled') return;
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
      if (!isRegisteredToolHandler(call.name as GoogleToolName, executeOptions.handlers)) {
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
        const result = await executeGoogleTool(call, executeOptions);
        results.push(result.ok ? { callId: call.callId, name: call.name, result: result.result } : errorToolResult(call, result.code));
      }
    }

    let decisions: boolean[] = [];
    if (mutationEntries.length) {
      if (executeOptions.confirm) {
        decisions = await Promise.all(mutationEntries.map((entry) => executeOptions.confirm!(entry.confirmation)));
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
      const result = await executeGoogleTool(entry.call, { ...executeOptions, confirm: async () => true });
      results.push(result.ok ? { callId: entry.call.callId, name: entry.call.name, result: result.result } : errorToolResult(entry.call, result.code));
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
