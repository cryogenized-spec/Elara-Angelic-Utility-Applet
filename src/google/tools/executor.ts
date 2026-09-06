import { googleToolCallSchema, type GoogleToolCall, type GoogleToolDescriptor, type GoogleToolName, type GoogleToolRisk } from './contracts';
import { googleToolRegistry } from './registry';
import { evaluateWriteConfirmation, isConfirmationFresh, type WriteConfirmationRequest } from '../confirmation/policy';
import { googleCapabilityKeySchema, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus } from '../oauth/contracts';
import { classifyGoogleToolFailure, type GoogleToolFailure } from './diagnostics';
import { validateDriveSheetsToolArguments, driveSheetsToolArgumentSchemas, type DriveSheetsToolName } from './drive-sheets-schemas';
import { validateGoogleReadToolArguments, googleReadToolArgumentSchemas, type GoogleReadToolName } from './read-schemas';
import { validateRoleplayWorldToolArguments, roleplayWorldToolArgumentSchemas, type RoleplayWorldToolName } from './roleplay-world-schemas';

export interface GoogleToolExecutionContext {
  readonly tool: GoogleToolName;
  readonly descriptor: GoogleToolDescriptor;
  readonly capability: GoogleCapabilityKey;
  readonly risk: GoogleToolRisk;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type GoogleToolHandler = (context: GoogleToolExecutionContext) => Promise<unknown>;
export type GoogleToolHandlers = Partial<Record<GoogleToolName, GoogleToolHandler>>;

export interface GoogleToolExecutorOptions {
  readonly oauth: GoogleOAuthAuthority;
  readonly handlers: GoogleToolHandlers;
  readonly confirm?: (request: WriteConfirmationRequest) => Promise<boolean>;
  readonly now?: () => Date;
}

export type GoogleToolExecutionResult =
  | { readonly ok: true; readonly correlationId: string; readonly tool: GoogleToolName; readonly result: unknown }
  | { readonly ok: false; readonly correlationId: string; readonly tool?: GoogleToolName; readonly code: 'INVALID_TOOL_CALL' | 'AUTHORIZATION_REQUIRED' | 'CONFIRMATION_REQUIRED' | 'USER_DECLINED' | 'HANDLER_UNAVAILABLE' | 'EXECUTION_FAILED'; readonly failure: GoogleToolFailure; readonly confirmation?: WriteConfirmationRequest };

function correlationId(): string { return crypto.randomUUID(); }
function findDescriptor(tool: GoogleToolName): GoogleToolDescriptor | undefined { return googleToolRegistry.find((entry) => entry.name === tool); }
function safeCapability(value: string): GoogleCapabilityKey { return googleCapabilityKeySchema.parse(value); }

function validateArguments(tool: GoogleToolName, value: unknown): Readonly<Record<string, unknown>> {
  if (Object.prototype.hasOwnProperty.call(roleplayWorldToolArgumentSchemas, tool)) return validateRoleplayWorldToolArguments(tool as RoleplayWorldToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(driveSheetsToolArgumentSchemas, tool)) return validateDriveSheetsToolArguments(tool as DriveSheetsToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(googleReadToolArgumentSchemas, tool)) return validateGoogleReadToolArguments(tool as GoogleReadToolName, value) as Readonly<Record<string, unknown>>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object.');
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function authorizationNeeded(status: GoogleOAuthStatus, capability: GoogleCapabilityKey): boolean {
  if (capability === 'roleplay.world.local') return false;
  const capabilityGranted = status.grantedCapabilities.includes(capability);
  const stateNeedsRecovery = status.state === 'disconnected' || status.state === 'needs-consent' || status.state === 'revoked' || status.state === 'reauthorization-required';
  return !capabilityGranted || stateNeedsRecovery;
}

function confirmationSummary(tool: GoogleToolName, args: Readonly<Record<string, unknown>>, fallback: string): string {
  if (!tool.startsWith('roleplay_setting.')) return fallback;
  const id = typeof args.id === 'string' ? args.id : typeof args.ref === 'string' ? `ref:${args.ref}` : 'new entity';
  if (tool === 'roleplay_setting.create') return `Create ${String(args.type)} “${String(args.name)}” under ${typeof args.parentId === 'string' ? args.parentId : 'the world root'}.`;
  if (tool === 'roleplay_setting.update') return `Update ${id}: ${Object.entries(args).filter(([key]) => !['id', 'ref'].includes(key)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')}.`;
  if (tool === 'roleplay_setting.move') return `Move ${id} under ${typeof args.parentId === 'string' ? args.parentId : 'the world root'}.`;
  if (tool === 'roleplay_setting.delete') return `Delete ${id} and any child entities beneath it.`;
  return fallback;
}

export async function executeGoogleTool(call: GoogleToolCall, options: GoogleToolExecutorOptions): Promise<GoogleToolExecutionResult> {
  const id = correlationId();
  const parsed = googleToolCallSchema.safeParse(call);
  if (!parsed.success) return { ok: false, correlationId: id, code: 'INVALID_TOOL_CALL', failure: classifyGoogleToolFailure({ kind: 'validation' }) };
  const validCall = parsed.data;
  const descriptor = findDescriptor(validCall.tool);
  if (!descriptor) return { ok: false, correlationId: id, tool: validCall.tool, code: 'INVALID_TOOL_CALL', failure: classifyGoogleToolFailure({ kind: 'validation' }) };

  let args: Readonly<Record<string, unknown>>;
  try { args = validateArguments(validCall.tool, validCall.arguments); } catch { return { ok: false, correlationId: id, tool: validCall.tool, code: 'INVALID_TOOL_CALL', failure: classifyGoogleToolFailure({ kind: 'validation' }) }; }

  const capability = safeCapability(descriptor.capability);
  if (capability !== 'roleplay.world.local') {
    let status: GoogleOAuthStatus;
    try { status = await options.oauth.getStatus(); } catch { return { ok: false, correlationId: id, tool: validCall.tool, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'network' }) }; }
    if (authorizationNeeded(status, capability)) return { ok: false, correlationId: id, tool: validCall.tool, code: 'AUTHORIZATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'authorization' }) };
  }

  const decision = evaluateWriteConfirmation(descriptor.risk);
  if (decision.requiresConfirmation) {
    const confirmationRisk: Exclude<GoogleToolRisk, 'read'> = descriptor.risk;
    const requestedAt = (options.now?.() ?? new Date()).toISOString();
    const confirmation: WriteConfirmationRequest = {
      tool: descriptor.name,
      risk: confirmationRisk,
      resourceSummary: confirmationSummary(validCall.tool, args, descriptor.description),
      requestedAt,
    };
    if (!options.confirm) return { ok: false, correlationId: id, tool: validCall.tool, code: 'CONFIRMATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'confirmation' }), confirmation };
    let approved = false;
    try { approved = await options.confirm(confirmation) && isConfirmationFresh(requestedAt, options.now?.() ?? new Date()); } catch { approved = false; }
    if (!approved) return { ok: false, correlationId: id, tool: validCall.tool, code: 'USER_DECLINED', failure: classifyGoogleToolFailure({ kind: 'confirmation' }), confirmation };
  }

  const handler = options.handlers[descriptor.name];
  if (!handler) return { ok: false, correlationId: id, tool: validCall.tool, code: 'HANDLER_UNAVAILABLE', failure: classifyGoogleToolFailure({ kind: 'unknown' }) };
  try {
    const result = await handler({ tool: descriptor.name, descriptor, capability, risk: descriptor.risk, arguments: args });
    return { ok: true, correlationId: id, tool: descriptor.name, result };
  } catch { return { ok: false, correlationId: id, tool: descriptor.name, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'provider' }) }; }
}
