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

function errorToolResult(call: GoogleToolCall, message: string): GeminiToolResult {
  return { callId: call.callId, name: call.name, result: { ok: false, error: message } };
}

export async function* streamGoogleToolLoop(request: GeminiTurnRequest, options: GoogleToolLoopOptions = {}, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const readOnly = options.readOnly ?? true;
  const tools = normalizeTools(request.tools ?? options.tools);
  const maxToolCalls = Math.max(1, Math.min(options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, 20));
  for (const tool of tools) {
    if (!Object.prototype.hasOwnProperty.call(googleServiceToolHandlers, tool) && !Object.prototype.hasOwnProperty.call(roleplayWorldToolHandlers, tool) && !Object.prototype.hasOwnProperty.call(googleReadToolHandlers, tool)) throw new Error(`Tool ${tool} is not registered.`);
    if (readOnly && !Object.prototype.hasOwnProperty.call(googleReadToolHandlers, tool) && !tool.startsWith('roleplay_setting.')) throw new Error(`Tool ${tool} is not permitted in read-only mode.`);
  }

  const executeOptions = executorOptions(options);
  const systemInstruction = withRuntimeContext(request.systemInstruction);
  let stream = geminiTurnPort.streamReply({ ...request, tools, systemInstruction }, signal);
  let executedCalls = 0;

  while (true) {
    const pendingCalls: GoogleToolCall[] = [];
    let interactionId = '';
    for await (const event of stream) {
      yield event;
      if (event.type === 'interaction-created') interactionId = event.interactionId;
      if (event.type === 'tool-call') pendingCalls.push({ callId: event.callId, name: event.name as GoogleToolName, arguments: event.arguments });
      if (signal?.aborted || event.type === 'cancelled' || event.type === 'failed') return;
    }

    if (pendingCalls.length === 0) return;
    if (!interactionId) interactionId = pendingCalls[0].callId;

    const results: GeminiToolResult[] = [];
    const allowedCalls = pendingCalls.slice(0, Math.max(0, maxToolCalls - executedCalls));
    for (const call of pendingCalls.slice(allowedCalls.length)) results.push(errorToolResult(call, 'Google tool-call limit exceeded for this turn.'));

    const mutationEntries: Array<{ call: GoogleToolCall; confirmation: NonNullable<ReturnType<typeof confirmationRequestForCall>> }> = [];
    for (const call of allowedCalls) {
      const confirmation = confirmationRequestForCall(call);
      if (confirmation) mutationEntries.push({ call, confirmation });
      else {
        const result = await executeGoogleTool(call, executeOptions);
        results.push(result.ok ? { callId: call.callId, name: call.name, result: result.result } : errorToolResult(call, result.code));
      }
    }

    let decisions: boolean[] = [];
    if (mutationEntries.length) {
      if (executeOptions.confirm) {
        decisions = await Promise.all(mutationEntries.map((entry) => executeOptions.confirm!(entry.confirmation)));
      } else {
        decisions = await requestGoogleToolConfirmations(mutationEntries.map((entry) => entry.confirmation), signal);
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
    if (executedCalls >= maxToolCalls) return;
  }
}
