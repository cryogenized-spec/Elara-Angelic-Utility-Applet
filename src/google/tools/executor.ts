import { googleToolCallSchema, type GoogleToolCall, type GoogleToolDescriptor, type GoogleToolName, type GoogleToolRisk } from './contracts';
import { googleToolRegistry } from './registry';
import { evaluateWriteConfirmation, isConfirmationFresh, type WriteConfirmationRequest } from '../confirmation/policy';
import { requestGoogleToolConfirmation } from '../confirmation/broker';
import { googleCapabilityKeySchema, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus } from '../oauth/contracts';
import { classifyGoogleToolFailure, type GoogleToolFailure } from './diagnostics';
import { validateDriveSheetsToolArguments, driveSheetsToolArgumentSchemas, type DriveSheetsToolName } from './drive-sheets-schemas';
import { validateGoogleReadToolArguments, googleReadToolArgumentSchemas, type GoogleReadToolName } from './read-schemas';
import { validateRoleplayWorldToolArguments, roleplayWorldToolArgumentSchemas, type RoleplayWorldToolName } from './roleplay-world-schemas';
import { loadRoleplayPreferences } from '../../persistence/preferences';

export interface GoogleToolExecutionContext { readonly tool: GoogleToolName; readonly descriptor: GoogleToolDescriptor; readonly capability: GoogleCapabilityKey; readonly risk: GoogleToolRisk; readonly arguments: Readonly<Record<string, unknown>>; }
export type GoogleToolHandler = (context: GoogleToolExecutionContext) => Promise<unknown>;
export type GoogleToolHandlers = Partial<Record<GoogleToolName, GoogleToolHandler>>;
export interface GoogleToolExecutorOptions { readonly oauth: GoogleOAuthAuthority; readonly handlers: GoogleToolHandlers; readonly confirm?: (request: WriteConfirmationRequest) => Promise<boolean>; readonly now?: () => Date; }
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
function value(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : undefined;
}
function confirmationSummary(tool: GoogleToolName, args: Readonly<Record<string, unknown>>, fallback: string): string {
  const id = value(args, 'id') ?? value(args, 'ref');
  switch (tool) {
    case 'tasks.createTask': return `Create a Google Task${value(args, 'taskListId') ? ` in list ${value(args, 'taskListId')}` : ''}.`;
    case 'tasks.updateTask': return `Update Google Task ${value(args, 'taskId') ?? 'selected task'} in list ${value(args, 'taskListId') ?? 'selected list'}.`;
    case 'tasks.moveTask': return `Move Google Task ${value(args, 'taskId') ?? 'selected task'} to the requested position.`;
    case 'tasks.deleteTask': return `Delete Google Task ${value(args, 'taskId') ?? 'selected task'}.`;
    case 'tasks.clearCompleted': return `Clear completed Google Tasks from list ${value(args, 'taskListId') ?? 'selected list'}.`;
    case 'docs.createDocument': return `Create the Google Doc “${value(args, 'title') ?? 'Untitled'}”.`;
    case 'docs.batchUpdate': return `Apply the requested changes to Google Doc ${value(args, 'documentId') ?? 'selected document'}.`;
    case 'chat.createMessage': return `Post a Google Chat message to ${value(args, 'spaceName') ?? 'the selected space'}.`;
    case 'chat.updateMessage': return `Update Google Chat message ${value(args, 'messageName') ?? 'selected message'}.`;
    case 'chat.deleteMessage': return `Delete Google Chat message ${value(args, 'messageName') ?? 'selected message'}.`;
    case 'gmail.modifyMessage': return `Change labels on Gmail message ${value(args, 'messageId') ?? 'selected message'}.`;
    case 'gmail.modifyThread': return `Change labels on Gmail thread ${value(args, 'threadId') ?? 'selected thread'}.`;
    case 'gmail.trashMessage': return `Move Gmail message ${value(args, 'messageId') ?? 'selected message'} to Trash.`;
    case 'gmail.untrashMessage': return `Restore Gmail message ${value(args, 'messageId') ?? 'selected message'} from Trash.`;
    case 'gmail.trashThread': return `Move Gmail thread ${value(args, 'threadId') ?? 'selected thread'} to Trash.`;
    case 'gmail.untrashThread': return `Restore Gmail thread ${value(args, 'threadId') ?? 'selected thread'} from Trash.`;
    case 'gmail.createLabel': return `Create a Gmail label from the requested label definition.`;
    case 'gmail.updateLabel': return `Update Gmail label ${value(args, 'labelId') ?? 'selected label'}.`;
    case 'gmail.deleteLabel': return `Delete Gmail label ${value(args, 'labelId') ?? 'selected label'}.`;
    case 'gmail.sendMessage': return 'Send the prepared email from the authorized Gmail account.';
    case 'drive.createFile': return `Create the Drive file “${value(args, 'name') ?? 'Untitled'}”.`;
    case 'drive.updateFile': return `Update Drive file ${value(args, 'fileId') ?? 'selected file'} with the requested metadata changes.`;
    case 'drive.moveFile': return `Move Drive file ${value(args, 'fileId') ?? 'selected file'} to ${value(args, 'parentId') ?? 'the requested folder'}.`;
    case 'sheets.writeRange': return `Write the prepared rows to ${value(args, 'range') ?? 'the selected range'} in spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'}.`;
    case 'sheets.appendRows': return `Append the prepared rows to ${value(args, 'range') ?? 'the selected range'} in spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'}.`;
    case 'sheets.batchUpdate': return `Apply the requested spreadsheet changes to ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'}.`;
    case 'roleplay_setting.create': return `Create ${String(args.type)} “${String(args.name)}” under ${typeof args.parentId === 'string' ? args.parentId : 'the world root'}.`;
    case 'roleplay_setting.update': return `Update ${id ?? 'selected entity'}: ${Object.entries(args).filter(([key]) => !['id', 'ref'].includes(key)).map(([key, entry]) => `${key}=${JSON.stringify(entry)}`).join(', ')}.`;
    case 'roleplay_setting.move': return `Move ${id ?? 'selected entity'} under ${typeof args.parentId === 'string' ? args.parentId : 'the world root'}.`;
    case 'roleplay_setting.delete': return `Delete ${id ?? 'selected entity'} and any child entities beneath it.`;
    default: return fallback;
  }
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
  const isRoleplayTool = validCall.tool.startsWith('roleplay_setting.');
  if (isRoleplayTool && !(await loadRoleplayPreferences()).enabled) return { ok: false, correlationId: id, tool: validCall.tool, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'unknown' }) };
  if (capability !== 'roleplay.world.local') {
    let status: GoogleOAuthStatus;
    try { status = await options.oauth.getStatus(); } catch { return { ok: false, correlationId: id, tool: validCall.tool, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'network' }) }; }
    if (authorizationNeeded(status, capability)) return { ok: false, correlationId: id, tool: validCall.tool, code: 'AUTHORIZATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'authorization' }) };
  }
  const decision = evaluateWriteConfirmation(descriptor.risk);
  if (decision.requiresConfirmation) {
    const requestedAt = (options.now?.() ?? new Date()).toISOString();
    const confirmation: WriteConfirmationRequest = { tool: descriptor.name, risk: descriptor.risk as Exclude<GoogleToolRisk, 'read'>, resourceSummary: confirmationSummary(validCall.tool, args, descriptor.description), requestedAt };
    const confirm = options.confirm ?? requestGoogleToolConfirmation;
    let approved = false;
    try { approved = await confirm(confirmation) && isConfirmationFresh(requestedAt, options.now?.() ?? new Date()); } catch { approved = false; }
    if (!approved) return { ok: false, correlationId: id, tool: validCall.tool, code: options.confirm || descriptor.name.startsWith('roleplay_setting.') ? 'USER_DECLINED' : 'CONFIRMATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'confirmation' }), confirmation };
  }
  const handler = options.handlers[descriptor.name];
  if (!handler) return { ok: false, correlationId: id, tool: validCall.tool, code: 'HANDLER_UNAVAILABLE', failure: classifyGoogleToolFailure({ kind: 'unknown' }) };
  try { const result = await handler({ tool: descriptor.name, descriptor, capability, risk: descriptor.risk, arguments: args }); return { ok: true, correlationId: id, tool: descriptor.name, result }; }
  catch { return { ok: false, correlationId: id, tool: descriptor.name, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'provider' }) }; }
}
