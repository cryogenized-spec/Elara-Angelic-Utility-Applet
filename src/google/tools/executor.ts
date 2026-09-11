import { googleToolCallSchema, type GoogleToolCall, type GoogleToolDescriptor, type GoogleToolName, type GoogleToolRisk } from './contracts';
import { googleToolRegistry } from './registry';
import { evaluateWriteConfirmation, isConfirmationFresh, type WriteConfirmationRequest } from '../confirmation/policy';
import { requestGoogleToolConfirmation } from '../confirmation/broker';
import { googleCapabilityKeySchema, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus } from '../oauth/contracts';
import { isCapabilityAuthorized } from '../oauth/capability-policy';
import { classifyGoogleToolFailure, type GoogleToolFailure } from './diagnostics';
import { validateDriveSheetsToolArguments, driveSheetsToolArgumentSchemas, type DriveSheetsToolName } from './drive-sheets-schemas';
import { validateSemanticToolArguments, semanticToolArgumentSchemas, type SemanticToolName } from './semantic-schemas';
import { validateGoogleReadToolArguments, googleReadToolArgumentSchemas, type GoogleReadToolName } from './read-schemas';
import { validateRoleplayWorldToolArguments, roleplayWorldToolArgumentSchemas, type RoleplayWorldToolName } from './roleplay-world-schemas';
import { validateYouTubeToolArguments, youtubeToolArgumentSchemas, type YouTubeToolName } from '../../media/youtube-schema';
import { loadRoleplayPreferences } from '../../persistence/preferences';

export type LocalToolCapability = 'documents.local' | 'media.youtube.read';
export type ToolCapability = GoogleCapabilityKey | LocalToolCapability;

/**
 * Capabilities satisfied inside the application rather than by a Google OAuth
 * scope. They are not members of `googleCapabilityKeySchema`, so `safeCapability`
 * must recognize them before it parses.
 */
const LOCAL_TOOL_CAPABILITIES: ReadonlySet<string> = new Set<string>(['documents.local', 'media.youtube.read']);

/**
 * Capabilities that need no OAuth authorization check. This is the local set plus
 * `roleplay.world.local`, which is a registered capability key but is backed by
 * local storage rather than a Google scope.
 */
const NON_OAUTH_CAPABILITIES: ReadonlySet<string> = new Set<string>([...LOCAL_TOOL_CAPABILITIES, 'roleplay.world.local']);

export interface GoogleToolExecutionContext { readonly tool: GoogleToolName; readonly descriptor: GoogleToolDescriptor; readonly capability: ToolCapability; readonly risk: GoogleToolRisk; readonly arguments: Readonly<Record<string, unknown>>; readonly signal?: AbortSignal; readonly generationId?: string; readonly isGenerationActive?: () => boolean; }
export type GoogleToolHandler = (context: GoogleToolExecutionContext) => Promise<unknown>;
export type GoogleToolHandlers = Partial<Record<GoogleToolName, GoogleToolHandler>>;
export interface GoogleToolExecutorOptions { readonly oauth: GoogleOAuthAuthority; readonly handlers: GoogleToolHandlers; readonly confirm?: (request: WriteConfirmationRequest) => Promise<boolean>; readonly now?: () => Date; readonly signal?: AbortSignal; readonly generationId?: string; readonly isGenerationActive?: () => boolean; }
export type GoogleToolExecutionResult =
  | { readonly ok: true; readonly correlationId: string; readonly tool: GoogleToolName; readonly result: unknown }
  | { readonly ok: false; readonly correlationId: string; readonly tool?: GoogleToolName; readonly code: 'INVALID_TOOL_CALL' | 'AUTHORIZATION_REQUIRED' | 'CONFIRMATION_REQUIRED' | 'USER_DECLINED' | 'HANDLER_UNAVAILABLE' | 'EXECUTION_FAILED'; readonly failure: GoogleToolFailure; readonly confirmation?: WriteConfirmationRequest; readonly requiredCapability?: GoogleCapabilityKey };

function correlationId(): string { return crypto.randomUUID(); }
function findDescriptor(tool: GoogleToolName): GoogleToolDescriptor | undefined { return googleToolRegistry.find((entry) => entry.name === tool); }
function safeCapability(value: string): ToolCapability {
  if (LOCAL_TOOL_CAPABILITIES.has(value)) return value as LocalToolCapability;
  return googleCapabilityKeySchema.parse(value);
}
function validateArguments(tool: GoogleToolName, value: unknown): Readonly<Record<string, unknown>> {
  // The schema module is Zod plus two constants only; the media provider, cache,
  // and budget stay behind the handler's dynamic import.
  if (Object.prototype.hasOwnProperty.call(youtubeToolArgumentSchemas, tool)) return validateYouTubeToolArguments(tool as YouTubeToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(roleplayWorldToolArgumentSchemas, tool)) return validateRoleplayWorldToolArguments(tool as RoleplayWorldToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(semanticToolArgumentSchemas, tool)) return validateSemanticToolArguments(tool as SemanticToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(driveSheetsToolArgumentSchemas, tool)) return validateDriveSheetsToolArguments(tool as DriveSheetsToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(googleReadToolArgumentSchemas, tool)) return validateGoogleReadToolArguments(tool as GoogleReadToolName, value) as Readonly<Record<string, unknown>>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object.');
  return Object.freeze({ ...(value as Record<string, unknown>) });
}
/**
 * Narrows a capability to one backed by a Google OAuth scope. Written as a
 * predicate rather than a set lookup so the compiler narrows at every call site.
 */
function isGoogleOAuthCapability(capability: ToolCapability): capability is GoogleCapabilityKey {
  return !NON_OAUTH_CAPABILITIES.has(capability);
}
function authorizationNeeded(status: GoogleOAuthStatus, capability: ToolCapability): boolean {
  if (!isGoogleOAuthCapability(capability)) return false;
  const stateNeedsRecovery = status.state === 'disconnected' || status.state === 'needs-consent' || status.state === 'revoked' || status.state === 'reauthorization-required';
  return !isCapabilityAuthorized(capability, status.grantedCapabilities) || stateNeedsRecovery;
}
function value(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : undefined;
}
function confirmationSummary(tool: GoogleToolName, args: Readonly<Record<string, unknown>>, fallback: string): string {
  const id = value(args, 'id') ?? value(args, 'ref');
  switch (tool) {
    case 'calendar.createEvent': {
      const summary = value(args, 'summary') ?? 'untitled event';
      const start = value(args, 'start');
      return `Create Calendar event “${summary}”${start ? ` at ${start}` : ''}.`;
    }
    case 'tasks.createTask': {
      const task = args.task && typeof args.task === 'object' && !Array.isArray(args.task) ? args.task as Record<string, unknown> : undefined;
      const title = typeof task?.title === 'string' && task.title.trim() ? task.title.trim() : undefined;
      return `Create Google Task${title ? ` “${title}”` : ''}${value(args, 'taskListId') ? ` in list ${value(args, 'taskListId')}` : ''}.`;
    }
    case 'tasks.updateTask': return `Update Google Task ${value(args, 'taskId') ?? 'selected task'} in list ${value(args, 'taskListId') ?? 'selected list'}.`;
    case 'tasks.moveTask': return `Move Google Task ${value(args, 'taskId') ?? 'selected task'} to the requested position.`;
    case 'tasks.deleteTask': return `Delete Google Task ${value(args, 'taskId') ?? 'selected task'}.`;
    case 'tasks.clearCompleted': return `Clear completed Google Tasks from list ${value(args, 'taskListId') ?? 'selected list'}.`;
    case 'docs.createDocument': return `Create the Google Doc “${value(args, 'title') ?? 'Untitled'}”.`;
    case 'docs.insertText': return `Insert text at index ${String(args.index ?? '?')} in Google Doc ${value(args, 'documentId') ?? 'selected document'}.`;
    case 'docs.appendParagraph': return `Append a paragraph to Google Doc ${value(args, 'documentId') ?? 'selected document'}.`;
    case 'docs.replaceText': return `Replace “${value(args, 'findText') ?? 'selected text'}” in Google Doc ${value(args, 'documentId') ?? 'selected document'}.`;
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
    case 'gmail.createLabel': return 'Create a Gmail label from the requested label definition.';
    case 'gmail.updateLabel': return `Update Gmail label ${value(args, 'labelId') ?? 'selected label'}.`;
    case 'gmail.deleteLabel': return `Delete Gmail label ${value(args, 'labelId') ?? 'selected label'}.`;
    case 'gmail.sendMessage': {
      const to = Array.isArray(args.to) ? args.to.filter((item): item is string => typeof item === 'string').join(', ') : 'recipient';
      return `Send email to ${to} with subject “${value(args, 'subject') ?? '(no subject)'}”.`;
    }
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

export function confirmationRequestForCall(call: GoogleToolCall, now = new Date()): WriteConfirmationRequest | null {
  const parsed = googleToolCallSchema.safeParse(call);
  if (!parsed.success) return null;
  const descriptor = findDescriptor(parsed.data.tool);
  if (!descriptor || !evaluateWriteConfirmation(descriptor.risk).requiresConfirmation) return null;
  let args: Readonly<Record<string, unknown>>;
  try { args = validateArguments(parsed.data.tool, parsed.data.arguments); } catch { return null; }
  return { tool: descriptor.name, risk: descriptor.risk as Exclude<GoogleToolRisk, 'read'>, resourceSummary: confirmationSummary(parsed.data.tool, args, descriptor.description), requestedAt: now.toISOString() };
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
  if (isGoogleOAuthCapability(capability)) {
    let status: GoogleOAuthStatus;
    try { status = await options.oauth.getStatus(); } catch { return { ok: false, correlationId: id, tool: validCall.tool, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'network' }) }; }
    if (authorizationNeeded(status, capability)) return { ok: false, correlationId: id, tool: validCall.tool, code: 'AUTHORIZATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'authorization' }), requiredCapability: capability };
  }
  const decision = evaluateWriteConfirmation(descriptor.risk);
  if (decision.requiresConfirmation) {
    const requestedAt = (options.now?.() ?? new Date()).toISOString();
    const confirmation: WriteConfirmationRequest = { tool: descriptor.name, risk: descriptor.risk as Exclude<GoogleToolRisk, 'read'>, resourceSummary: confirmationSummary(validCall.tool, args, descriptor.description), requestedAt };
    const confirm = options.confirm ?? requestGoogleToolConfirmation;
    let approved = false;
    let confirmationInvoked = false;
    try { confirmationInvoked = true; approved = await confirm(confirmation) && isConfirmationFresh(requestedAt, options.now?.() ?? new Date()); } catch { approved = false; }
    if (!approved) return { ok: false, correlationId: id, tool: validCall.tool, code: confirmationInvoked ? 'USER_DECLINED' : 'CONFIRMATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'confirmation' }), confirmation };
  }
  const handler = options.handlers[descriptor.name];
  if (!handler) return { ok: false, correlationId: id, tool: validCall.tool, code: 'HANDLER_UNAVAILABLE', failure: classifyGoogleToolFailure({ kind: 'unknown' }) };
  try { const result = await handler({ tool: descriptor.name, descriptor, capability, risk: descriptor.risk, arguments: args, signal: options.signal, generationId: options.generationId, isGenerationActive: options.isGenerationActive }); return { ok: true, correlationId: id, tool: descriptor.name, result }; }
  catch { return { ok: false, correlationId: id, tool: descriptor.name, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'provider' }) }; }
}
