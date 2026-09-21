import { googleToolCallSchema, type GoogleToolCall, type GoogleToolDescriptor, type GoogleToolName, type GoogleToolRisk } from './contracts';
import { googleToolRegistry } from './registry';
import { evaluateWriteConfirmation, isConfirmationFresh, MAX_CONFIRMATION_REVIEW_CHARS, writeConfirmationSchema, type WriteConfirmationRequest } from '../confirmation/policy';
import { requestGoogleToolConfirmation } from '../confirmation/broker';
import { googleCapabilityKeySchema, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus } from '../oauth/contracts';
import { isCapabilityAuthorized } from '../oauth/capability-policy';
import { classifyGoogleToolFailure, type GoogleToolFailure } from './diagnostics';
import { validateDriveSheetsToolArguments, driveSheetsToolArgumentSchemas, type DriveSheetsToolName } from './drive-sheets-schemas';
import { validateGmailToolArguments, gmailToolArgumentSchemas, type GmailToolName } from './gmail-schemas';
import { validateSemanticToolArguments, semanticToolArgumentSchemas, type SemanticToolName } from './semantic-schemas';
import { validateGoogleReadToolArguments, googleReadToolArgumentSchemas, type GoogleReadToolName } from './read-schemas';
import { validateRoleplayWorldToolArguments, roleplayWorldToolArgumentSchemas, type RoleplayWorldToolName } from './roleplay-world-schemas';
import { validateYouTubeToolArguments, youtubeToolArgumentSchemas, type YouTubeToolName } from '../../media/youtube-schema';
import { validateMemoryToolArguments, memoryToolArgumentSchemas, type MemoryToolName } from '../../memory/tool-schema';
import { describeMemoryReconcileTarget } from '../../memory/tool-handler';
import { kanbanToolArgumentSchemas, validateKanbanToolArguments, type KanbanToolName } from '../../kanban/tool-schema';
import { loadRoleplayPreferences } from '../../persistence/preferences';
import { clickupToolNameSchema, validateClickUpToolArguments, type ClickUpToolName } from '../../clickup/tool-schema';
import type { ClickUpOAuthAuthority } from '../../clickup/oauth/contracts';

export type LocalToolCapability = 'documents.local' | 'media.youtube.read' | 'memory.durable.local' | 'clickup.read' | 'clickup.write';
export type ToolCapability = GoogleCapabilityKey | LocalToolCapability;
export type GoogleToolInvocation = GoogleToolCall & { readonly callId?: string };

/**
 * Capabilities satisfied inside the application rather than by a Google OAuth
 * scope. They are not members of `googleCapabilityKeySchema`, so `safeCapability`
 * must recognize them before it parses.
 */
const LOCAL_TOOL_CAPABILITIES: ReadonlySet<string> = new Set<string>(['documents.local', 'media.youtube.read', 'memory.durable.local', 'clickup.read', 'clickup.write']);

/**
 * Capabilities that need no OAuth authorization check. This is the local set plus
 * `roleplay.world.local`, which is a registered capability key but is backed by
 * local storage rather than a Google scope.
 */
const NON_OAUTH_CAPABILITIES: ReadonlySet<string> = new Set<string>([...LOCAL_TOOL_CAPABILITIES, 'roleplay.world.local']);

export interface GoogleToolExecutionContext {
  readonly tool: GoogleToolName;
  readonly descriptor: GoogleToolDescriptor;
  readonly capability: ToolCapability;
  readonly risk: GoogleToolRisk;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly callId?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly signal?: AbortSignal;
  readonly generationId?: string;
  readonly isGenerationActive?: () => boolean;
}
export type GoogleToolHandler = (context: GoogleToolExecutionContext) => Promise<unknown>;
export type GoogleToolHandlers = Partial<Record<GoogleToolName, GoogleToolHandler>>;
export interface GoogleToolExecutorOptions {
  readonly oauth: GoogleOAuthAuthority;
  readonly clickupOAuth?: ClickUpOAuthAuthority;
  readonly handlers: GoogleToolHandlers;
  readonly confirm?: (request: WriteConfirmationRequest) => Promise<boolean>;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly generationId?: string;
  readonly isGenerationActive?: () => boolean;
}
export interface GoogleToolConfirmationContext {
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly generationId?: string;
}
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
  // Schema modules remain validation-only; provider/cache/runtime work stays in handlers.
  const clickUpName = clickupToolNameSchema.safeParse(tool);
  if (clickUpName.success) return validateClickUpToolArguments(clickUpName.data, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(memoryToolArgumentSchemas, tool)) return validateMemoryToolArguments(tool as MemoryToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(kanbanToolArgumentSchemas, tool)) return validateKanbanToolArguments(tool as KanbanToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(youtubeToolArgumentSchemas, tool)) return validateYouTubeToolArguments(tool as YouTubeToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(roleplayWorldToolArgumentSchemas, tool)) return validateRoleplayWorldToolArguments(tool as RoleplayWorldToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(gmailToolArgumentSchemas, tool)) return validateGmailToolArguments(tool as GmailToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(semanticToolArgumentSchemas, tool)) return validateSemanticToolArguments(tool as SemanticToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(driveSheetsToolArgumentSchemas, tool)) return validateDriveSheetsToolArguments(tool as DriveSheetsToolName, value) as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(googleReadToolArgumentSchemas, tool)) return validateGoogleReadToolArguments(tool as GoogleReadToolName, value) as Readonly<Record<string, unknown>>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object.');
  return Object.freeze({ ...(value as Record<string, unknown>) });
}
/** Narrows a capability to one backed by a Google OAuth scope. */
function isGoogleOAuthCapability(capability: ToolCapability): capability is GoogleCapabilityKey {
  return !NON_OAUTH_CAPABILITIES.has(capability);
}
function authorizationNeeded(status: GoogleOAuthStatus, capability: ToolCapability): boolean {
  if (!isGoogleOAuthCapability(capability)) return false;
  const stateNeedsRecovery = status.state === 'disconnected' || status.state === 'needs-consent' || status.state === 'revoked' || status.state === 'reauthorization-required';
  return !isCapabilityAuthorized(capability, status.grantedCapabilities) || stateNeedsRecovery || status.sessionReady === false;
}

function oauthCapabilitiesForDescriptor(descriptor: GoogleToolDescriptor): readonly GoogleCapabilityKey[] {
  const capability = safeCapability(descriptor.capability);
  const prerequisites = (descriptor.prerequisiteCapabilities ?? []).map(safeCapability);
  return [...new Set<ToolCapability>([capability, ...prerequisites])].filter(isGoogleOAuthCapability);
}

/**
 * Pure admission probe used by the Gemini loop before it displays a mutation
 * confirmation. It validates the tool shape and returns the first missing
 * Google capability without running a handler or confirmation broker.
 */
export type ToolAuthorizationRequirement =
  | { readonly provider: 'google'; readonly capability: GoogleCapabilityKey }
  | { readonly provider: 'clickup' };

export async function toolAuthorizationRequirement(
  call: GoogleToolCall,
  oauth: GoogleOAuthAuthority,
  clickupOAuth?: ClickUpOAuthAuthority,
): Promise<ToolAuthorizationRequirement | null> {
  const parsed = googleToolCallSchema.safeParse(call);
  if (!parsed.success) return null;
  const descriptor = findDescriptor(parsed.data.tool);
  if (!descriptor) return null;
  try { validateArguments(parsed.data.tool, parsed.data.arguments); } catch { return null; }

  if (clickupToolNameSchema.safeParse(parsed.data.tool).success) {
    if (!clickupOAuth) return { provider: 'clickup' };
    const status = await clickupOAuth.getStatus();
    return status.connected ? null : { provider: 'clickup' };
  }

  const required = oauthCapabilitiesForDescriptor(descriptor);
  if (!required.length) return null;
  const status = await oauth.getStatus();
  const capability = required.find((candidate) => authorizationNeeded(status, candidate));
  return capability ? { provider: 'google', capability } : null;
}

/** Backward-compatible Google-only admission probe for existing callers/tests. */
export async function googleToolAuthorizationRequirement(
  call: GoogleToolCall,
  oauth: GoogleOAuthAuthority,
): Promise<GoogleCapabilityKey | null> {
  const requirement = await toolAuthorizationRequirement(call, oauth);
  return requirement?.provider === 'google' ? requirement.capability : null;
}
function value(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : undefined;
}
function confirmationReviewText(tool: GoogleToolName, args: Readonly<Record<string, unknown>>): string | undefined {
  if (tool === 'memory.save' || tool === 'memory.reconcile') return value(args, 'body');
  if ((tool === 'gmail.sendMessage' || tool === 'gmail.replyMessage') && typeof args.body === 'string') return args.body;
  if (tool === 'sheets.updateCell' && typeof args.value === 'string') return args.value || '(empty string)';
  // Every other mutation exposes the exact validated argument object. A prose
  // summary is not enough authority for bulk rows, document edits, task notes,
  // calendar fields, or Drive metadata that the model actually proposed.
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return undefined;
  }
}
function confirmationSummary(tool: GoogleToolName, args: Readonly<Record<string, unknown>>, fallback: string): string {
  const id = value(args, 'id') ?? value(args, 'ref');
  switch (tool) {
    case 'calendar.createEvent': {
      const summary = value(args, 'summary') ?? 'untitled event';
      const start = value(args, 'start');
      const updates = value(args, 'sendUpdates');
      return `Create Calendar event “${summary}”${start ? ` at ${start}` : ''}${updates ? ` and send guest updates (${updates})` : ''}.`;
    }
    case 'calendar.updateEvent': {
      const updates = value(args, 'sendUpdates');
      return `Update Calendar event ${value(args, 'eventId') ?? 'selected event'} using the version just read${updates ? ` and send guest updates (${updates})` : ''}.`;
    }
    case 'calendar.deleteEvent': {
      const updates = value(args, 'sendUpdates');
      return `Delete Calendar event ${value(args, 'eventId') ?? 'selected event'} using the version just read${updates ? ` and send guest updates (${updates})` : ''}.`;
    }
    case 'tasks.createTaskList': return `Create Google Tasks list “${value(args, 'title') ?? 'Untitled'}”.`;
    case 'tasks.updateTaskList': return `Rename Google Tasks list ${value(args, 'taskListId') ?? 'selected list'} to “${value(args, 'title') ?? 'Untitled'}”.`;
    case 'tasks.deleteTaskList': return `Delete Google Tasks list ${value(args, 'taskListId') ?? 'selected list'} and the tasks it contains. If any contained task is assigned from Google Docs or Chat, Google may also delete that originating assignment.`;
    case 'tasks.createTask': {
      const title = value(args, 'title') ?? 'untitled task';
      const scheduledDate = value(args, 'scheduledDate');
      return `Create Google Task “${title}” in list ${value(args, 'taskListId') ?? 'selected list'}${scheduledDate ? ` scheduled for ${scheduledDate} (date only; no task time-of-day)` : ''}.`;
    }
    case 'tasks.updateTask': {
      const changes: string[] = [];
      if (value(args, 'title')) changes.push('title');
      if (Object.prototype.hasOwnProperty.call(args, 'notes')) changes.push('notes');
      if (value(args, 'scheduledDate')) changes.push(`scheduled date to ${value(args, 'scheduledDate')}`);
      if (args.clearScheduledDate === true) changes.push('remove the scheduled date');
      if (value(args, 'status')) changes.push(`status to ${value(args, 'status')}`);
      return `Update Google Task ${value(args, 'taskId') ?? 'selected task'} in list ${value(args, 'taskListId') ?? 'selected list'}${changes.length ? `: ${changes.join(', ')}` : ''}.`;
    }
    case 'tasks.moveTask': {
      const sourceList = value(args, 'taskListId') ?? 'selected list';
      const destinationList = value(args, 'destinationTaskListId');
      const parent = value(args, 'parent');
      const previous = value(args, 'previous');
      const listMove = destinationList ? ` from list ${sourceList} to list ${destinationList}` : ` within list ${sourceList}`;
      const destination = parent ? ` under parent ${parent}` : ' to the top level';
      const position = previous ? ` after sibling ${previous}` : ' as the first task among its destination siblings';
      return `Move Google Task ${value(args, 'taskId') ?? 'selected task'}${listMove}${destination}${position}.`;
    }
    case 'tasks.deleteTask': return `Delete Google Task ${value(args, 'taskId') ?? 'selected task'} from list ${value(args, 'taskListId') ?? 'selected list'}. If it is assigned from Google Docs or Chat, Google also deletes the originating assignment.`;
    case 'tasks.clearCompleted': return `Clear completed Google Tasks from list ${value(args, 'taskListId') ?? 'selected list'}; Google will hide those completed tasks from normal results.`;
    case 'docs.createDocument': return `Create the Google Doc “${value(args, 'title') ?? 'Untitled'}”.`;
    case 'docs.insertText': return `Insert text at index ${String(args.index ?? '?')} in tab ${value(args, 'tabId') ?? 'selected tab'} of Google Doc ${value(args, 'documentId') ?? 'selected document'}, only if revision ${value(args, 'revisionId') ?? 'the inspected revision'} is still current.`;
    case 'docs.appendParagraph': return `Append a paragraph to tab ${value(args, 'tabId') ?? 'selected tab'} of Google Doc ${value(args, 'documentId') ?? 'selected document'}, only if revision ${value(args, 'revisionId') ?? 'the inspected revision'} is still current.`;
    case 'docs.replaceText': return `Replace “${value(args, 'findText') ?? 'selected text'}” only in tab ${value(args, 'tabId') ?? 'selected tab'} of Google Doc ${value(args, 'documentId') ?? 'selected document'}, only if revision ${value(args, 'revisionId') ?? 'the inspected revision'} is still current.`;
    case 'docs.batchUpdate': return `Apply the requested changes to Google Doc ${value(args, 'documentId') ?? 'selected document'}.`;
    case 'chat.createMessage': return `Post a Google Chat message to ${value(args, 'spaceName') ?? 'the selected space'}.`;
    case 'chat.updateMessage': return `Update Google Chat message ${value(args, 'messageName') ?? 'selected message'}.`;
    case 'chat.deleteMessage': return `Delete Google Chat message ${value(args, 'messageName') ?? 'selected message'}.`;
    case 'gmail.modifyMessage': return `${value(args, 'action') ?? 'Organize'} Gmail message ${value(args, 'messageId') ?? 'selected message'}${value(args, 'labelId') ? ` using USER label ${value(args, 'labelId')}` : ''}.`;
    case 'gmail.modifyThread': return `${value(args, 'action') ?? 'Organize'} Gmail thread ${value(args, 'threadId') ?? 'selected thread'}${value(args, 'labelId') ? ` using USER label ${value(args, 'labelId')}` : ''}.`;
    case 'gmail.trashMessage': return `Move Gmail message ${value(args, 'messageId') ?? 'selected message'} to Trash.`;
    case 'gmail.untrashMessage': return `Restore Gmail message ${value(args, 'messageId') ?? 'selected message'} from Trash.`;
    case 'gmail.trashThread': return `Move Gmail thread ${value(args, 'threadId') ?? 'selected thread'} to Trash.`;
    case 'gmail.untrashThread': return `Restore Gmail thread ${value(args, 'threadId') ?? 'selected thread'} from Trash.`;
    case 'gmail.createLabel': return `Create Gmail USER label “${value(args, 'name') ?? 'Untitled'}”.`;
    case 'gmail.updateLabel': return `Rename Gmail USER label ${value(args, 'labelId') ?? 'selected label'} to “${value(args, 'name') ?? 'Untitled'}”.`;
    case 'gmail.deleteLabel': return `Delete Gmail USER label ${value(args, 'labelId') ?? 'selected label'} permanently and remove that label from messages and threads. The messages themselves are not deleted.`;
    case 'gmail.sendMessage': { const to = Array.isArray(args.to) ? args.to.filter((item): item is string => typeof item === 'string').join(', ') : 'recipient'; return `Send a new email to ${to} with subject “${value(args, 'subject') ?? '(no subject)'}”. Review the full body below before approving.`; }
    case 'gmail.replyMessage': return `Reply in Gmail thread ${value(args, 'threadId') ?? 'selected thread'} to ${value(args, 'to') ?? 'recipient'} with subject “${value(args, 'subject') ?? '(no subject)'}”. Review the full body below before approving.`;
    case 'drive.createFile': return `Create the Drive file “${value(args, 'name') ?? 'Untitled'}”.`;
    case 'drive.updateFile': return `Update Drive file ${value(args, 'fileId') ?? 'selected file'} with the requested metadata changes. The write only applies while the file still matches the ETag read for it.`;
    case 'drive.moveFile': {
      const file = value(args, 'fileId') ?? 'selected file';
      const destination = value(args, 'parentId') ?? 'the requested folder';
      const previous = value(args, 'previousParentId');
      return previous
        ? `Move Drive file ${file} from folder ${previous} to ${destination}.`
        : `Add folder ${destination} as a parent of Drive file ${file}. Drive files can have several parents, so the file stays in its current folder too unless a previous parent is removed.`;
    }
    case 'drive.trashFile': return `Move Drive file ${value(args, 'fileId') ?? 'selected file'} to trash. Trash is recoverable and Elara never permanently deletes files.`;
    case 'sheets.createSpreadsheet': return `Create Google spreadsheet “${value(args, 'title') ?? 'Untitled'}”${value(args, 'firstSheetTitle') ? ` with first sheet “${value(args, 'firstSheetTitle')}”` : ''}.`;
    case 'sheets.addSheet': return `Add sheet “${value(args, 'title') ?? 'Untitled'}” to spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'} with ${String(args.rowCount ?? 1000)} row(s) and ${String(args.columnCount ?? 26)} column(s).`;
    case 'sheets.writeRange': return `Write the prepared rows to ${value(args, 'range') ?? 'the selected range'} in spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'} using ${value(args, 'inputMode') === 'userEntered' ? 'USER_ENTERED parsing (formulas/dates/numbers may be interpreted)' : 'literal RAW input'}.`;
    case 'sheets.appendRows': return `Append the prepared rows to ${value(args, 'range') ?? 'the selected range'} in spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'} using ${value(args, 'inputMode') === 'userEntered' ? 'USER_ENTERED parsing (formulas/dates/numbers may be interpreted)' : 'literal RAW input'}.`;
    case 'sheets.updateCell': return `Write one cell at ${value(args, 'range') ?? 'the selected cell'} in spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'} using ${value(args, 'inputMode') === 'userEntered' ? 'USER_ENTERED parsing, which can interpret formulas' : 'literal RAW input'}. Review the exact cell input below before approving.`;
    case 'sheets.insertRows': return `Insert ${String(args.count ?? '?')} row(s) into sheet ${String(args.sheetId ?? '?')} of spreadsheet ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'}, starting at zero-based row index ${String(args.startIndex ?? '?')}.`;
    case 'sheets.batchUpdate': return `Apply the requested spreadsheet changes to ${value(args, 'spreadsheetId') ?? 'the selected spreadsheet'}.`;
    case 'roleplay_setting.create': return `Create ${String(args.type)} “${String(args.name)}” under ${typeof args.parentId === 'string' ? args.parentId : 'the world root'}.`;
    case 'roleplay_setting.update': return `Update ${id ?? 'selected entity'}: ${Object.entries(args).filter(([key]) => !['id', 'ref'].includes(key)).map(([key, entry]) => `${key}=${JSON.stringify(entry)}`).join(', ')}.`;
    case 'roleplay_setting.move': return `Move ${id ?? 'selected entity'} under ${typeof args.parentId === 'string' ? args.parentId : 'the world root'}.`;
    case 'roleplay_setting.delete': return `Delete ${id ?? 'selected entity'} and any child entities beneath it.`;
    case 'memory.save': return `Save durable memory “${value(args, 'title') ?? 'Untitled'}”. Review the full proposed body below before approving.`;
    case 'memory.reconcile': return `Reconcile the selected durable memory as ${value(args, 'relation') ?? 'related'} using new evidence “${value(args, 'title') ?? 'Untitled evidence'}”. Review the full proposed body below before approving.`;
    case 'clickup.createTask': return `Create ClickUp task “${value(args, 'name') ?? 'Untitled'}” in list ${value(args, 'listId') ?? 'selected list'}.`;
    case 'clickup.updateTask': return `Update ClickUp task ${value(args, 'taskId') ?? 'selected task'} with the reviewed field changes.`;
    case 'clickup.createTaskComment': return `Post the reviewed comment to ClickUp task ${value(args, 'taskId') ?? 'selected task'}.`;
    case 'clickup.replyToComment': return `Post the reviewed reply to ClickUp comment ${value(args, 'commentId') ?? 'selected comment'}.`;
    case 'clickup.setCustomField': return `${value(args, 'mode') === 'clear' ? 'Clear' : 'Set'} ClickUp Custom Field ${value(args, 'fieldId') ?? 'selected field'} on task ${value(args, 'taskId') ?? 'selected task'}.`;
    case 'clickup.attachArtifact': return `Attach Elara artifact ${value(args, 'artifactId') ?? 'selected artifact'} to ClickUp task ${value(args, 'taskId') ?? 'selected task'}.`;
    default: return fallback;
  }
}

function staticConfirmationRequest(tool: GoogleToolName, args: Readonly<Record<string, unknown>>, descriptor: GoogleToolDescriptor, requestedAt: string): WriteConfirmationRequest | null {
  try {
    const reviewText = confirmationReviewText(tool, args);
    if (reviewText && reviewText.length > MAX_CONFIRMATION_REVIEW_CHARS) return null;
    return writeConfirmationSchema.parse({
      tool: descriptor.name,
      risk: descriptor.risk as Exclude<GoogleToolRisk, 'read'>,
      resourceSummary: confirmationSummary(tool, args, descriptor.description),
      ...(reviewText ? { reviewText } : {}),
      requestedAt,
    });
  } catch {
    return null;
  }
}

export function confirmationRequestForCall(
  call: GoogleToolCall,
  now = new Date(),
  context: GoogleToolConfirmationContext = {},
): WriteConfirmationRequest | null {
  const parsed = googleToolCallSchema.safeParse(call);
  if (!parsed.success) return null;
  const descriptor = findDescriptor(parsed.data.tool);
  if (!descriptor || !evaluateWriteConfirmation(descriptor.risk).requiresConfirmation) return null;
  let args: Readonly<Record<string, unknown>>;
  try { args = validateArguments(parsed.data.tool, parsed.data.arguments); } catch { return null; }
  const request = staticConfirmationRequest(parsed.data.tool, args, descriptor, now.toISOString());
  if (!request) return null;
  if (parsed.data.tool !== 'memory.reconcile') return request;
  const targetRef = value(args, 'targetRef');
  const relation = value(args, 'relation') ?? 'related';
  if (!targetRef) return null;
  try {
    const target = describeMemoryReconcileTarget(targetRef, context.conversationId, context.messageId, context.generationId);
    return {
      ...request,
      resourceSummary: `Reconcile durable memory “${target.title}” (${target.kind}; ${target.lifecycle}) as ${relation}. Current content: “${target.excerpt}”. Proposed evidence/replacement: “${value(args, 'title') ?? 'Untitled evidence'}”. Review the full proposed body below before approving.`,
    };
  } catch {
    return null;
  }
}

export async function executeGoogleTool(call: GoogleToolInvocation, options: GoogleToolExecutorOptions): Promise<GoogleToolExecutionResult> {
  const id = correlationId();
  const providerCallId = typeof call.callId === 'string' && call.callId.trim() ? call.callId.trim() : undefined;
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
  if (clickupToolNameSchema.safeParse(validCall.tool).success) {
    if (!options.clickupOAuth) return { ok: false, correlationId: id, tool: validCall.tool, code: 'AUTHORIZATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'authorization' }) };
    try {
      const status = await options.clickupOAuth.getStatus();
      if (!status.connected) return { ok: false, correlationId: id, tool: validCall.tool, code: 'AUTHORIZATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'authorization' }) };
    } catch {
      return { ok: false, correlationId: id, tool: validCall.tool, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'network' }) };
    }
  }
  const oauthCapabilities = oauthCapabilitiesForDescriptor(descriptor);
  if (oauthCapabilities.length) {
    let status: GoogleOAuthStatus;
    try { status = await options.oauth.getStatus(); } catch { return { ok: false, correlationId: id, tool: validCall.tool, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'network' }) }; }
    for (const required of oauthCapabilities) {
      if (authorizationNeeded(status, required)) return { ok: false, correlationId: id, tool: validCall.tool, code: 'AUTHORIZATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'authorization' }), requiredCapability: required };
    }
  }
  const decision = evaluateWriteConfirmation(descriptor.risk);
  if (decision.requiresConfirmation) {
    const confirmation = confirmationRequestForCall(validCall, options.now?.() ?? new Date(), {
      conversationId: options.conversationId,
      messageId: options.messageId,
      generationId: options.generationId,
    });
    if (!confirmation) return { ok: false, correlationId: id, tool: validCall.tool, code: 'INVALID_TOOL_CALL', failure: classifyGoogleToolFailure({ kind: 'validation' }) };
    const confirm = options.confirm ?? requestGoogleToolConfirmation;
    let approved: boolean;
    let confirmationInvoked = false;
    try { confirmationInvoked = true; approved = await confirm(confirmation) && isConfirmationFresh(confirmation.requestedAt, options.now?.() ?? new Date()); } catch { approved = false; }
    if (!approved) return { ok: false, correlationId: id, tool: validCall.tool, code: confirmationInvoked ? 'USER_DECLINED' : 'CONFIRMATION_REQUIRED', failure: classifyGoogleToolFailure({ kind: 'confirmation' }), confirmation };
  }
  const handler = options.handlers[descriptor.name];
  if (!handler) return { ok: false, correlationId: id, tool: validCall.tool, code: 'HANDLER_UNAVAILABLE', failure: classifyGoogleToolFailure({ kind: 'unknown' }) };
  try {
    const result = await handler({
      tool: descriptor.name,
      descriptor,
      capability,
      risk: descriptor.risk,
      arguments: args,
      callId: providerCallId,
      conversationId: options.conversationId,
      messageId: options.messageId,
      signal: options.signal,
      generationId: options.generationId,
      isGenerationActive: options.isGenerationActive,
    });
    return { ok: true, correlationId: id, tool: descriptor.name, result };
  }
  catch { return { ok: false, correlationId: id, tool: descriptor.name, code: 'EXECUTION_FAILED', failure: classifyGoogleToolFailure({ kind: 'provider' }) }; }
}
