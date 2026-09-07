import type { GoogleToolName, GoogleToolRisk } from '../google/tools/contracts';
import { googleToolRegistry } from '../google/tools/registry';
import { executeGoogleTool, type GoogleToolExecutorOptions } from '../google/tools/executor';
import { googleServiceToolHandlers } from '../google/tools/service-handlers';
import { googleReadToolHandlers } from '../google/tools/read-handlers';
import { roleplayWorldToolHandlers } from '../google/tools/roleplay-world-handlers';
import { requestRoleplayConfirmation } from '../google/confirmation/roleplay-broker';
import { googleOAuthAuthority } from '../google/oauth/authority';
import { geminiTurnPort } from './provider';
import { withRuntimeContext } from './runtime-context';
import type { GeminiStreamEvent, GeminiToolContinuationRequest, GeminiTurnRequest } from './contracts';

export interface GoogleToolLoopOptions { readonly tools?: readonly GoogleToolName[]; readonly executor?: Partial<GoogleToolExecutorOptions>; readonly maxToolCalls?: number; readonly readOnly?: boolean; }
const DEFAULT_MAX_TOOL_CALLS = 8;

function registryRisk(tool: GoogleToolName): GoogleToolRisk { const descriptor = googleToolRegistry.find((entry) => entry.name === tool); if (!descriptor) throw new Error('Tool is not registered.'); return descriptor.risk; }
function normalizeTools(tools: readonly GoogleToolName[] | undefined, readOnly: boolean): readonly GoogleToolName[] { const requested = tools?.length ? [...tools] : [...Object.keys(googleReadToolHandlers) as GoogleToolName[]]; const unique = [...new Set(requested)]; for (const tool of unique) { if (readOnly && registryRisk(tool) !== 'read') throw new Error(`Tool ${tool} is not permitted in read-only mode.`); } return unique; }
function executorOptions(options: GoogleToolLoopOptions, signal?: AbortSignal): GoogleToolExecutorOptions { return { oauth: options.executor?.oauth ?? googleOAuthAuthority, handlers: options.executor?.handlers ?? { ...googleServiceToolHandlers, ...googleReadToolHandlers, ...roleplayWorldToolHandlers }, confirm: options.executor?.confirm ?? ((request) => request.tool.startsWith('roleplay_setting.') ? requestRoleplayConfirmation(request, signal) : Promise.resolve(false)), now: options.executor?.now }; }
function errorToolResult(event: Extract<GeminiStreamEvent, { type: 'tool-call' }>, error: { code: string }, request: GeminiTurnRequest): GeminiToolContinuationRequest { return { model: request.model, previousInteractionId: event.interactionId, result: { callId: event.callId, name: event.name, result: { ok: false, error } }, systemInstruction: request.systemInstruction, generationConfig: request.generationConfig, tools: request.tools }; }

export async function* streamGoogleToolLoop(request: GeminiTurnRequest, options: GoogleToolLoopOptions = {}, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const readOnly = options.readOnly ?? true;
  const tools = normalizeTools(options.tools ?? request.tools as GoogleToolName[] | undefined, readOnly);
  const executeOptions = executorOptions(options, signal);
  const systemInstruction = withRuntimeContext(request.systemInstruction);
  let stream = geminiTurnPort.streamReply({ ...request, tools, systemInstruction }, signal);
  let executedCalls = 0;
  while (true) {
    let continuation: GeminiToolContinuationRequest | null = null;
    for await (const event of stream) {
      yield event;
      if (event.type !== 'tool-call') continue;
      executedCalls += 1;
      if (executedCalls > (options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS)) { continuation = errorToolResult(event, { code: 'TOOL_CALL_LIMIT_EXCEEDED' }, { ...request, tools, systemInstruction }); break; }
      if (!tools.includes(event.name as GoogleToolName)) { continuation = errorToolResult(event, { code: 'TOOL_NOT_PERMITTED' }, { ...request, tools, systemInstruction }); break; }
      const result = await executeGoogleTool({ tool: event.name as GoogleToolName, arguments: event.arguments }, executeOptions);
      continuation = result.ok
        ? { model: request.model, previousInteractionId: event.interactionId, result: { callId: event.callId, name: event.name, result: result.result }, systemInstruction, generationConfig: request.generationConfig, tools }
        : { model: request.model, previousInteractionId: event.interactionId, result: { callId: event.callId, name: event.name, result: { ok: false, code: result.code, message: result.failure.message, requiresUserAction: result.failure.requiresUserAction } }, systemInstruction, generationConfig: request.generationConfig, tools };
      break;
    }
    if (!continuation) return;
    stream = geminiTurnPort.streamToolResult(continuation, signal);
  }
}
