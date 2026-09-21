import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../autonomy/cloud/pairing';
import {
  CLICKUP_MCP_CLIENT_INFO,
  CLICKUP_MCP_PATH,
  CLICKUP_MCP_PROTOCOL_VERSION,
  MCP_META_CLIENT_CAPABILITIES,
  MCP_META_CLIENT_INFO,
  MCP_META_PROTOCOL_VERSION,
} from './mcp-protocol';
import {
  CLICKUP_TOOL_NAMES,
  clickupToolNameSchema,
  validateClickUpToolArguments,
  type ClickUpMcpToolDefinition,
  type ClickUpToolName,
} from './tool-schema';

const MAX_MCP_RESPONSE_BYTES = 1_500_000;
const MCP_REQUEST_TIMEOUT_MS = 30_000;

type JsonRpcId = string | number;

type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result?: Record<string, unknown>;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly data?: unknown;
  };
};

export class ClickUpMcpError extends Error {
  constructor(
    readonly code: string | number,
    message: string,
    readonly status = 0,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

function activePairing(): AutonomyPairing {
  if (typeof window === 'undefined') throw new ClickUpMcpError('pairing', 'ClickUp MCP requires a paired self-hosted Worker.');
  const pairing = loadPairing();
  if (!pairing) throw new ClickUpMcpError('pairing', 'Pair this Elara installation with its Worker before using ClickUp.');
  return pairing;
}

function workerBaseUrl(pairing: AutonomyPairing): string {
  let url: URL;
  try {
    url = new URL(pairing.workerUrl.trim());
  } catch {
    throw new ClickUpMcpError('worker-url', 'The paired Worker URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ClickUpMcpError('worker-url', 'The paired Worker URL must be an HTTPS URL without credentials, query, or fragment.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function pairingToken(pairing: AutonomyPairing): Promise<string> {
  const token = (await resolvePairingToken(pairing)).trim();
  if (!token) throw new ClickUpMcpError('credential', 'The paired Worker installation credential is unavailable.');
  return token;
}

function requestMeta() {
  return {
    [MCP_META_PROTOCOL_VERSION]: CLICKUP_MCP_PROTOCOL_VERSION,
    [MCP_META_CLIENT_CAPABILITIES]: {},
    [MCP_META_CLIENT_INFO]: CLICKUP_MCP_CLIENT_INFO,
  };
}

function parseJsonRpc(value: unknown, expectedId: JsonRpcId): JsonRpcResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0' || record.id !== expectedId) return null;
  return record as JsonRpcResponse;
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_MCP_RESPONSE_BYTES) {
    throw new ClickUpMcpError('response-too-large', 'ClickUp MCP returned a response larger than Elara allows.', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MCP_RESPONSE_BYTES) {
      throw new ClickUpMcpError('response-too-large', 'ClickUp MCP returned a response larger than Elara allows.', response.status);
    }
    return new TextDecoder().decode(bytes);
  }

  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_MCP_RESPONSE_BYTES) {
        throw new ClickUpMcpError('response-too-large', 'ClickUp MCP returned a response larger than Elara allows.', response.status);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  }
}

function parseSse(text: string, expectedId: JsonRpcId): JsonRpcResponse | null {
  let matched: JsonRpcResponse | null = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = parseJsonRpc(JSON.parse(data) as unknown, expectedId);
      if (parsed) matched = parsed;
    } catch {
      // Ignore unrelated/malformed SSE events; the terminal matching frame is authoritative.
    }
  }
  return matched;
}

async function decodeResponse(response: Response, expectedId: JsonRpcId): Promise<JsonRpcResponse> {
  const text = await readBoundedText(response);
  const contentType = (response.headers.get('content-type') ?? '').toLocaleLowerCase();
  let message: JsonRpcResponse | null = null;
  if (contentType.includes('text/event-stream')) {
    message = parseSse(text, expectedId);
  } else {
    try { message = parseJsonRpc(JSON.parse(text) as unknown, expectedId); } catch { message = null; }
  }

  if (!message) throw new ClickUpMcpError('protocol', 'ClickUp MCP returned an invalid JSON-RPC response.', response.status);
  if (message.error) {
    throw new ClickUpMcpError(
      message.error.code ?? 'rpc-error',
      message.error.message ?? 'ClickUp MCP request failed.',
      response.status,
      message.error.data,
    );
  }
  if (!response.ok || !message.result) {
    throw new ClickUpMcpError(`http-${response.status}`, `ClickUp MCP responded with HTTP ${response.status}.`, response.status);
  }
  return message;
}

async function mcpPost(
  method: 'server/discover' | 'tools/list' | 'tools/call',
  params: Record<string, unknown>,
  name?: ClickUpToolName,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const pairing = activePairing();
  const token = await pairingToken(pairing);
  const id = crypto.randomUUID();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: requestMeta() },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${workerBaseUrl(pairing)}${CLICKUP_MCP_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': CLICKUP_MCP_PROTOCOL_VERSION,
        'Mcp-Method': method,
        ...(name ? { 'Mcp-Name': name } : {}),
      },
      body,
      signal: controller.signal,
    });
    return (await decodeResponse(response, id)).result!;
  } catch (error) {
    if (error instanceof ClickUpMcpError) throw error;
    if (controller.signal.aborted) {
      throw new ClickUpMcpError(signal?.aborted ? 'cancelled' : 'timeout', signal?.aborted ? 'ClickUp MCP request was cancelled.' : 'ClickUp MCP request timed out.');
    }
    throw new ClickUpMcpError('network', 'The paired ClickUp MCP Worker could not be reached.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function completeResult(result: Record<string, unknown>, operation: string): Record<string, unknown> {
  if (result.resultType !== 'complete') {
    throw new ClickUpMcpError('protocol', `ClickUp MCP ${operation} did not return a complete result.`);
  }
  return result;
}

let discoveryReady = false;
let toolCache: { expiresAt: number; tools: readonly ClickUpMcpToolDefinition[] } | null = null;

async function ensureDiscovery(signal?: AbortSignal): Promise<void> {
  if (discoveryReady) return;
  const result = completeResult(await mcpPost('server/discover', {}, undefined, signal), 'server/discover');
  const supported = Array.isArray(result.supportedVersions) ? result.supportedVersions : [];
  if (!supported.includes(CLICKUP_MCP_PROTOCOL_VERSION)) {
    throw new ClickUpMcpError('protocol-version', 'The paired Worker does not support Elara\'s ClickUp MCP protocol version.');
  }
  discoveryReady = true;
}

function parseToolDefinitions(value: unknown): readonly ClickUpMcpToolDefinition[] {
  if (!Array.isArray(value)) throw new ClickUpMcpError('protocol', 'ClickUp MCP tools/list returned an invalid tool collection.');
  const tools: ClickUpMcpToolDefinition[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new ClickUpMcpError('protocol', 'ClickUp MCP tools/list returned an invalid tool definition.');
    }
    const record = candidate as Record<string, unknown>;
    const name = clickupToolNameSchema.safeParse(record.name);
    if (!name.success || typeof record.description !== 'string' || !record.inputSchema || typeof record.inputSchema !== 'object') {
      throw new ClickUpMcpError('protocol', 'ClickUp MCP tools/list returned an unexpected tool definition.');
    }
    tools.push({
      name: name.data,
      description: record.description,
      inputSchema: record.inputSchema as Readonly<Record<string, unknown>>,
    });
  }
  const returnedNames = new Set(tools.map((tool) => tool.name));
  for (const expected of CLICKUP_TOOL_NAMES) {
    if (!returnedNames.has(expected)) throw new ClickUpMcpError('protocol', `ClickUp MCP is missing canonical tool ${expected}.`);
  }
  return tools;
}

export async function listClickUpMcpTools(signal?: AbortSignal, force = false): Promise<readonly ClickUpMcpToolDefinition[]> {
  await ensureDiscovery(signal);
  if (!force && toolCache && toolCache.expiresAt > Date.now()) return toolCache.tools;
  const result = completeResult(await mcpPost('tools/list', {}, undefined, signal), 'tools/list');
  const tools = parseToolDefinitions(result.tools);
  const ttlMs = typeof result.ttlMs === 'number' && Number.isFinite(result.ttlMs)
    ? Math.max(0, Math.min(result.ttlMs, 5 * 60_000))
    : 0;
  toolCache = { expiresAt: Date.now() + ttlMs, tools };
  return tools;
}

export async function callClickUpMcpTool<T extends ClickUpToolName>(
  tool: T,
  rawArguments: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  await ensureDiscovery(signal);
  const argumentsValue = validateClickUpToolArguments(tool, rawArguments);
  const result = completeResult(await mcpPost('tools/call', {
    name: tool,
    arguments: argumentsValue,
  }, tool, signal), 'tools/call');

  if (result.isError === true) {
    const structured = result.structuredContent;
    const error = structured && typeof structured === 'object' && !Array.isArray(structured)
      ? (structured as Record<string, unknown>).error
      : undefined;
    const errorRecord = error && typeof error === 'object' && !Array.isArray(error) ? error as Record<string, unknown> : undefined;
    throw new ClickUpMcpError(
      typeof errorRecord?.code === 'string' ? errorRecord.code : 'tool-error',
      typeof errorRecord?.message === 'string' ? errorRecord.message : 'ClickUp tool execution failed.',
      typeof errorRecord?.status === 'number' ? errorRecord.status : 0,
      structured,
    );
  }

  if (!result.structuredContent || typeof result.structuredContent !== 'object' || Array.isArray(result.structuredContent)) {
    throw new ClickUpMcpError('protocol', 'ClickUp MCP tool call returned no structured result.');
  }
  return result.structuredContent;
}

export function resetClickUpMcpClientForTests(): void {
  discoveryReady = false;
  toolCache = null;
}
