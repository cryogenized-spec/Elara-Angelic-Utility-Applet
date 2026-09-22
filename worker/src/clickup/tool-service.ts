import {
  ELARA_INTERNAL_HEADER,
  deriveInstallationId,
  internalWakeMarker,
} from '../../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../../src/clickup/mcp-protocol';
import {
  validateClickUpToolArguments,
  type ClickUpToolArguments,
  type ClickUpToolName,
} from '../../../src/clickup/tool-schema';

export interface ClickUpToolServiceEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly CLICKUP_OAUTH?: DurableObjectNamespace;
}

export class ClickUpToolServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

const MAX_TASK_TEXT_CHARS = 12_000;
const MAX_COMMENT_TEXT_CHARS = 8_000;
const MAX_PROVIDER_ARRAY = 100;
const MAX_COMMENT_PROVIDER_PAGES = 4;

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

function providerId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function providerMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedPreview(value: unknown, maxChars = 1_000): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return boundedText(value, maxChars) ?? '';
  try {
    const rendered = JSON.stringify(value);
    if (rendered.length <= maxChars) return value;
    return `${rendered.slice(0, maxChars - 1)}…`;
  } catch {
    return '[unavailable]';
  }
}

function normalizedUser(value: unknown) {
  const record = objectValue(value);
  const id = providerId(record?.id);
  if (!record || !id) return null;
  return {
    id,
    ...(boundedText(record.username, 300) ? { username: boundedText(record.username, 300) } : {}),
    ...(boundedText(record.email, 320) ? { email: boundedText(record.email, 320) } : {}),
  };
}

function normalizedStatus(value: unknown) {
  if (typeof value === 'string') return boundedText(value, 300);
  const record = objectValue(value);
  return boundedText(record?.status, 300);
}

function normalizeAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).flatMap((entry) => {
    const record = objectValue(entry);
    const id = providerId(record?.id);
    const title = boundedText(record?.title, 500) ?? boundedText(record?.name, 500);
    if (!record || (!id && !title)) return [];
    return [{
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(boundedText(record.extension, 30) ? { extension: boundedText(record.extension, 30) } : {}),
      ...(boundedText(record.mimetype, 200) ? { mimeType: boundedText(record.mimetype, 200) } : {}),
      ...(providerMillis(record.date) !== undefined ? { date: providerMillis(record.date) } : {}),
      ...(providerId(record.user_id) ? { userId: providerId(record.user_id) } : {}),
    }];
  });
}

function normalizeCustomFields(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((entry) => {
    const record = objectValue(entry);
    const id = providerId(record?.id);
    if (!record || !id) return [];
    return [{
      id,
      ...(boundedText(record.name, 500) ? { name: boundedText(record.name, 500) } : {}),
      ...(boundedText(record.type, 100) ? { type: boundedText(record.type, 100) } : {}),
      ...(Object.prototype.hasOwnProperty.call(record, 'value') ? { value: boundedPreview(record.value) } : {}),
    }];
  });
}

export function normalizeClickUpTask(value: unknown, options: { includeAttachments?: boolean } = {}) {
  const record = objectValue(value);
  const id = providerId(record?.id);
  if (!record || !id) throw new ClickUpToolServiceError('provider_shape', 'ClickUp returned a task without a usable id.');

  const list = objectValue(record.list);
  const folder = objectValue(record.folder);
  const space = objectValue(record.space);
  const priority = objectValue(record.priority);
  const assignees = Array.isArray(record.assignees)
    ? record.assignees.slice(0, 50).map(normalizedUser).filter((user): user is NonNullable<ReturnType<typeof normalizedUser>> => Boolean(user))
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.slice(0, 50).flatMap((tag) => {
        const tagRecord = objectValue(tag);
        const name = boundedText(tagRecord?.name ?? tag, 200);
        return name ? [name] : [];
      })
    : [];

  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    id,
    ...(providerId(record.custom_id) ? { customId: providerId(record.custom_id) } : {}),
    name: boundedText(record.name, 1_000) ?? '(untitled task)',
    ...(boundedText(record.markdown_description, MAX_TASK_TEXT_CHARS)
      ? { markdownDescription: boundedText(record.markdown_description, MAX_TASK_TEXT_CHARS) }
      : boundedText(record.text_content ?? record.description, MAX_TASK_TEXT_CHARS)
        ? { textDescription: boundedText(record.text_content ?? record.description, MAX_TASK_TEXT_CHARS) }
        : {}),
    ...(normalizedStatus(record.status) ? { status: normalizedStatus(record.status) } : {}),
    archived: record.archived === true,
    ...(providerId(record.parent) ? { parentTaskId: providerId(record.parent) } : {}),
    ...(providerMillis(record.date_created) !== undefined ? { createdAtMs: providerMillis(record.date_created) } : {}),
    ...(providerMillis(record.date_updated) !== undefined ? { updatedAtMs: providerMillis(record.date_updated) } : {}),
    ...(providerMillis(record.date_closed) !== undefined ? { closedAtMs: providerMillis(record.date_closed) } : {}),
    ...(providerMillis(record.date_done) !== undefined ? { doneAtMs: providerMillis(record.date_done) } : {}),
    ...(providerMillis(record.due_date) !== undefined ? { dueAtMs: providerMillis(record.due_date) } : {}),
    ...(providerMillis(record.start_date) !== undefined ? { startAtMs: providerMillis(record.start_date) } : {}),
    ...(typeof record.time_estimate === 'number' ? { timeEstimateMs: record.time_estimate } : {}),
    ...(typeof record.points === 'number' ? { points: record.points } : {}),
    ...(priority && boundedText(priority.priority, 100) ? { priority: boundedText(priority.priority, 100) } : {}),
    ...(assignees.length ? { assignees } : {}),
    ...(tags.length ? { tags } : {}),
    ...(list && providerId(list.id) ? { list: { id: providerId(list.id)!, ...(boundedText(list.name, 500) ? { name: boundedText(list.name, 500) } : {}) } } : {}),
    ...(folder && providerId(folder.id) ? { folder: { id: providerId(folder.id)!, ...(boundedText(folder.name, 500) ? { name: boundedText(folder.name, 500) } : {}) } } : {}),
    ...(space && providerId(space.id) ? { space: { id: providerId(space.id)! } } : {}),
    ...(boundedText(record.url, 2_048) ? { url: boundedText(record.url, 2_048) } : {}),
    customFields: normalizeCustomFields(record.custom_fields),
    ...(options.includeAttachments ? { attachments: normalizeAttachments(record.attachments) } : {}),
  };
}

function commentText(record: Record<string, unknown>): string {
  const direct = boundedText(record.comment_text, MAX_COMMENT_TEXT_CHARS);
  if (direct) return direct;
  if (!Array.isArray(record.comment)) return '';
  const parts: string[] = [];
  for (const segment of record.comment.slice(0, 200)) {
    const item = objectValue(segment);
    if (!item) continue;
    const text = boundedText(item.text, 2_000);
    if (text) parts.push(text);
    else {
      const user = objectValue(item.user);
      const username = boundedText(user?.username, 300);
      if (username) parts.push(`@${username}`);
    }
    if (parts.join(' ').length >= MAX_COMMENT_TEXT_CHARS) break;
  }
  return boundedText(parts.join(' '), MAX_COMMENT_TEXT_CHARS) ?? '';
}

function normalizeComment(value: unknown) {
  const record = objectValue(value);
  const id = providerId(record?.id);
  if (!record || !id) return null;
  const user = normalizedUser(record.user);
  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    id,
    text: commentText(record),
    ...(providerMillis(record.date) !== undefined ? { dateMs: providerMillis(record.date) } : {}),
    ...(user ? { user } : {}),
    ...(record.resolved === true ? { resolved: true } : {}),
  };
}

function cursorSecret(env: ClickUpToolServiceEnv): string {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token) throw new ClickUpToolServiceError('configuration', 'ClickUp is not configured on this Worker.', 503);
  return token;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function cursorMac(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`elara-clickup-comments-cursor-v2\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // WebCrypto requires an ArrayBuffer-backed BufferSource. Copying here makes
  // that ownership explicit under TS6/TS7 instead of allowing the generic
  // Uint8Array<ArrayBufferLike> type to include SharedArrayBuffer.
  const ownedPayload = new Uint8Array(payload.byteLength);
  ownedPayload.set(payload);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ownedPayload.buffer));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) mismatch |= left[index]! ^ right[index]!;
  return mismatch === 0;
}

async function encodeCursor(
  env: ClickUpToolServiceEnv,
  workspaceId: string,
  taskId: string,
  grantRevision: number,
  start: number,
  startId: string,
): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify({
    v: 2,
    workspaceId,
    taskId,
    grantRevision,
    start,
    startId,
  }));
  const mac = await cursorMac(cursorSecret(env), payload);
  return `${base64Url(payload)}.${base64Url(mac)}`;
}

async function decodeCursor(
  env: ClickUpToolServiceEnv,
  workspaceId: string,
  taskId: string,
  grantRevision: number,
  value: string | undefined,
): Promise<{ start: number; startId: string } | undefined> {
  if (!value) return undefined;
  try {
    const [payloadPart, macPart, extra] = value.split('.');
    if (!payloadPart || !macPart || extra !== undefined) throw new Error('invalid');
    const payload = fromBase64Url(payloadPart);
    const presentedMac = fromBase64Url(macPart);
    const expectedMac = await cursorMac(cursorSecret(env), payload);
    if (!equalBytes(presentedMac, expectedMac)) throw new Error('invalid');

    const parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    const start = providerMillis(parsed.start);
    const startId = providerId(parsed.startId);
    if (
      parsed.v !== 2
      || parsed.workspaceId !== workspaceId
      || parsed.taskId !== taskId
      || parsed.grantRevision !== grantRevision
      || start === undefined
      || !startId
    ) throw new Error('invalid');
    return { start, startId };
  } catch (error) {
    if (error instanceof ClickUpToolServiceError) throw error;
    throw new ClickUpToolServiceError('validation', 'The ClickUp comments cursor is invalid.', 400);
  }
}

async function vaultStub(env: ClickUpToolServiceEnv): Promise<DurableObjectStub> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.CLICKUP_OAUTH) throw new ClickUpToolServiceError('configuration', 'ClickUp is not configured on this Worker.', 503);
  const installationId = await deriveInstallationId(token);
  return env.CLICKUP_OAUTH.get(env.CLICKUP_OAUTH.idFromName(installationId));
}

async function command<T>(
  env: ClickUpToolServiceEnv,
  body: Record<string, unknown>,
  expectedRevision?: number,
): Promise<T> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token) throw new ClickUpToolServiceError('configuration', 'ClickUp is not configured on this Worker.', 503);
  const response = await (await vaultStub(env)).fetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [ELARA_INTERNAL_HEADER]: await internalWakeMarker(token),
      ...(expectedRevision !== undefined ? {
        [CLICKUP_GRANT_REVISION_HEADER]: String(expectedRevision),
      } : {}),
    },
    body: JSON.stringify(body),
  }));
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new ClickUpToolServiceError(
      typeof payload?.code === 'string' ? payload.code : `http-${response.status}`,
      typeof payload?.message === 'string' ? payload.message : `ClickUp provider command failed with HTTP ${response.status}.`,
      response.status,
      typeof payload?.retryAt === 'number' ? payload.retryAt : undefined,
    );
  }
  return payload.result as T;
}

async function comments(
  env: ClickUpToolServiceEnv,
  workspaceId: string,
  taskId: string,
  cursorValue: string | undefined,
  limit: number,
  expectedRevision?: number,
) {
  const cursorGrantRevision = expectedRevision ?? 0;
  let cursor = await decodeCursor(env, workspaceId, taskId, cursorGrantRevision, cursorValue);
  const output: ReturnType<typeof normalizeComment>[] = [];
  let lastRaw: Record<string, unknown> | undefined;
  let providerHasMore = false;
  let providerPages = 0;

  while (output.length < limit && providerPages < MAX_COMMENT_PROVIDER_PAGES) {
    providerPages += 1;
    const raw = await command<Record<string, unknown>>(env, {
      operation: 'getTaskComments',
      workspaceId,
      taskId,
      ...(cursor ? { start: cursor.start, startId: cursor.startId } : {}),
    }, expectedRevision);
    const entries = Array.isArray(raw.comments) ? raw.comments : [];
    for (const entry of entries) {
      const record = objectValue(entry);
      const normalized = normalizeComment(entry);
      if (!record || !normalized) continue;
      if (output.length < limit) {
        output.push(normalized);
        lastRaw = record;
      }
    }
    providerHasMore = entries.length >= 25;
    if (output.length >= limit || !providerHasMore || !lastRaw) break;
    const start = providerMillis(lastRaw.date);
    const startId = providerId(lastRaw.id);
    if (start === undefined || !startId) break;
    cursor = { start, startId };
  }

  let nextCursor: string | null = null;
  if (providerHasMore && lastRaw) {
    const start = providerMillis(lastRaw.date);
    const startId = providerId(lastRaw.id);
    if (start !== undefined && startId) nextCursor = await encodeCursor(
      env,
      workspaceId,
      taskId,
      cursorGrantRevision,
      start,
      startId,
    );
  }

  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    comments: output.filter(Boolean).slice(0, limit),
    nextCursor,
  };
}

function normalizedHierarchyItem(value: unknown, kind: 'space' | 'folder' | 'list') {
  const record = objectValue(value);
  const id = providerId(record?.id);
  if (!record || !id) return null;
  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    kind,
    id,
    name: boundedText(record.name, 500) ?? '(unnamed)',
    ...(record.archived === true ? { archived: true } : {}),
  };
}

function listFrom(value: unknown, key: string, kind: 'space' | 'folder' | 'list') {
  const record = objectValue(value);
  const items = Array.isArray(record?.[key]) ? record![key] as unknown[] : [];
  return items.slice(0, MAX_PROVIDER_ARRAY)
    .map((item) => normalizedHierarchyItem(item, kind))
    .filter((item): item is NonNullable<ReturnType<typeof normalizedHierarchyItem>> => Boolean(item));
}

function normalizeMutationResult(value: unknown) {
  const record = objectValue(value);
  if (!record) return { ok: true };
  if (providerId(record.id) && boundedText(record.name, 1_000)) return normalizeClickUpTask(record);
  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    ok: true,
    ...(providerId(record.id) ? { id: providerId(record.id) } : {}),
    ...(providerId(record.hist_id) ? { historyId: providerId(record.hist_id) } : {}),
    ...(providerMillis(record.date) !== undefined ? { dateMs: providerMillis(record.date) } : {}),
  };
}

async function searchTasks(env: ClickUpToolServiceEnv, args: ClickUpToolArguments<'clickup.searchTasks'>, expectedRevision?: number) {
  const raw = await command<Record<string, unknown>>(env, {
    operation: 'searchTaskIndex',
    arguments: args,
  }, expectedRevision);
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const index = objectValue(raw.index) ?? {};
  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    searchMode: 'persistent-sqlite-index' as const,
    query: args.query,
    tasks: tasks.slice(0, args.limit ?? 20).map((task) => normalizeClickUpTask(task)),
    index: {
      indexedTasks: typeof index.indexedTasks === 'number' ? index.indexedTasks : 0,
      fullSyncComplete: index.fullSyncComplete === true,
      lastRefreshAt: typeof index.lastRefreshAt === 'number' ? index.lastRefreshAt : 0,
      refreshIncomplete: index.refreshIncomplete === true,
      ...(objectValue(index.refreshError) ? { refreshError: objectValue(index.refreshError) } : {}),
    },
  };
}

async function listHierarchy(env: ClickUpToolServiceEnv, args: ClickUpToolArguments<'clickup.listHierarchy'>, expectedRevision?: number) {
  const archived = args.includeArchived ?? false;
  if (args.folderId) {
    const raw = await command<Record<string, unknown>>(env, {
      operation: 'getFolder',
      workspaceId: args.workspaceId,
      folderId: args.folderId,
      includeSubfolders: true,
    }, expectedRevision);
    const root = normalizedHierarchyItem(raw, 'folder');
    return {
      trust: 'untrusted-external' as const,
      provider: 'clickup' as const,
      root,
      lists: listFrom(raw, 'lists', 'list'),
      folders: listFrom(raw, 'folders', 'folder'),
    };
  }

  if (args.spaceId) {
    const [foldersRaw, listsRaw] = await Promise.all([
      command<Record<string, unknown>>(env, { operation: 'listFolders', workspaceId: args.workspaceId, spaceId: args.spaceId, archived }, expectedRevision),
      command<Record<string, unknown>>(env, { operation: 'listFolderlessLists', workspaceId: args.workspaceId, spaceId: args.spaceId, archived }, expectedRevision),
    ]);
    return {
      trust: 'untrusted-external' as const,
      provider: 'clickup' as const,
      root: { kind: 'space' as const, id: args.spaceId },
      folders: listFrom(foldersRaw, 'folders', 'folder'),
      lists: listFrom(listsRaw, 'lists', 'list'),
    };
  }

  const spacesRaw = await command<Record<string, unknown>>(env, {
    operation: 'listSpaces',
    workspaceId: args.workspaceId,
    archived,
  }, expectedRevision);
  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    root: { kind: 'workspace' as const, id: args.workspaceId },
    spaces: listFrom(spacesRaw, 'spaces', 'space'),
  };
}

async function resolveAssignees(env: ClickUpToolServiceEnv, args: ClickUpToolArguments<'clickup.resolveAssignees'>, expectedRevision?: number) {
  const workspace = await command<Record<string, unknown>>(env, {
    operation: 'getWorkspaceAuthorizationContext',
    workspaceId: args.workspaceId,
  }, expectedRevision);
  const members = Array.isArray(workspace.members) ? workspace.members as unknown[] : [];
  const limit = args.limitPerName ?? 5;

  const results = args.names.map((name) => {
    const needle = name.normalize('NFKC').trim().toLocaleLowerCase();
    const ranked = members.flatMap((entry) => {
      const userRecord = objectValue(objectValue(entry)?.user) ?? objectValue(entry);
      const user = normalizedUser(userRecord);
      if (!user) return [];
      const username = user.username?.normalize('NFKC').toLocaleLowerCase() ?? '';
      const email = user.email?.normalize('NFKC').toLocaleLowerCase() ?? '';
      const local = email.split('@')[0] ?? '';
      const exact = username === needle || email === needle || local === needle;
      const contains = username.includes(needle) || email.includes(needle);
      if (!exact && !contains) return [];
      return [{ ...user, match: exact ? 'exact' as const : 'partial' as const }];
    }).sort((left, right) => Number(right.match === 'exact') - Number(left.match === 'exact'));

    return { query: name, matches: ranked.slice(0, limit) };
  });

  return {
    trust: 'untrusted-external' as const,
    provider: 'clickup' as const,
    workspaceId: args.workspaceId,
    results,
  };
}

export async function executeClickUpTool(
  env: ClickUpToolServiceEnv,
  tool: ClickUpToolName,
  rawArguments: unknown,
  expectedRevision?: number,
): Promise<unknown> {
  const args = validateClickUpToolArguments(tool, rawArguments);

  switch (tool) {
    case 'clickup.searchTasks':
      return searchTasks(env, args as ClickUpToolArguments<'clickup.searchTasks'>, expectedRevision);
    case 'clickup.getTask': {
      const value = args as ClickUpToolArguments<'clickup.getTask'>;
      const raw = await command<Record<string, unknown>>(env, {
        operation: 'getTask',
        arguments: value,
      }, expectedRevision);
      return normalizeClickUpTask(raw);
    }
    case 'clickup.getTaskComments': {
      const value = args as ClickUpToolArguments<'clickup.getTaskComments'>;
      return comments(env, value.workspaceId, value.taskId, value.cursor, value.limit ?? 25, expectedRevision);
    }
    case 'clickup.getTaskContext': {
      const value = args as ClickUpToolArguments<'clickup.getTaskContext'>;
      const rawTask = await command<Record<string, unknown>>(env, {
        operation: 'getTask',
        arguments: { workspaceId: value.workspaceId, taskId: value.taskId, includeSubtasks: value.includeSubtasks },
      }, expectedRevision);
      const task = normalizeClickUpTask(rawTask, { includeAttachments: value.includeAttachments });
      const taskComments = value.commentsLimit === 0
        ? { trust: 'untrusted-external' as const, provider: 'clickup' as const, comments: [], nextCursor: null }
        : await comments(env, value.workspaceId, value.taskId, undefined, value.commentsLimit ?? 25, expectedRevision);
      let customFieldDefinitions: unknown[] | undefined;
      if (value.includeCustomFieldDefinitions && task.list?.id) {
        const rawFields = await command<Record<string, unknown>>(env, {
          operation: 'getListCustomFields',
          workspaceId: value.workspaceId,
          listId: task.list.id,
        }, expectedRevision);
        const fields = Array.isArray(rawFields.fields) ? rawFields.fields : [];
        customFieldDefinitions = fields.slice(0, 50).flatMap((field) => {
          const record = objectValue(field);
          const id = providerId(record?.id);
          if (!record || !id) return [];
          return [{
            trust: 'untrusted-external' as const,
            id,
            ...(boundedText(record.name, 500) ? { name: boundedText(record.name, 500) } : {}),
            ...(boundedText(record.type, 100) ? { type: boundedText(record.type, 100) } : {}),
            ...(record.type_config !== undefined ? { typeConfig: boundedPreview(record.type_config, 2_000) } : {}),
          }];
        });
      }
      return {
        trust: 'untrusted-external' as const,
        provider: 'clickup' as const,
        task,
        comments: taskComments.comments,
        nextCommentsCursor: taskComments.nextCursor,
        ...(customFieldDefinitions ? { customFieldDefinitions } : {}),
      };
    }
    case 'clickup.resolveAssignees':
      return resolveAssignees(env, args as ClickUpToolArguments<'clickup.resolveAssignees'>, expectedRevision);
    case 'clickup.listHierarchy':
      return listHierarchy(env, args as ClickUpToolArguments<'clickup.listHierarchy'>, expectedRevision);
    case 'clickup.createTask': {
      const raw = await command<Record<string, unknown>>(env, { operation: 'createTask', arguments: args }, expectedRevision);
      return normalizeMutationResult(raw);
    }
    case 'clickup.updateTask': {
      const raw = await command<Record<string, unknown>>(env, { operation: 'updateTask', arguments: args }, expectedRevision);
      return normalizeMutationResult(raw);
    }
    case 'clickup.createTaskComment': {
      const raw = await command<Record<string, unknown>>(env, { operation: 'createTaskComment', arguments: args }, expectedRevision);
      return normalizeMutationResult(raw);
    }
    case 'clickup.replyToComment': {
      const raw = await command<Record<string, unknown>>(env, { operation: 'replyToComment', arguments: args }, expectedRevision);
      return normalizeMutationResult(raw);
    }
    case 'clickup.setCustomField': {
      const value = args as ClickUpToolArguments<'clickup.setCustomField'>;
      const raw = value.mode === 'clear'
        ? await command<Record<string, unknown>>(env, {
            operation: 'clearCustomField',
            workspaceId: value.workspaceId,
            taskId: value.taskId,
            fieldId: value.fieldId,
          }, expectedRevision)
        : await command<Record<string, unknown>>(env, {
            operation: 'setCustomField',
            workspaceId: value.workspaceId,
            taskId: value.taskId,
            fieldId: value.fieldId,
            value: value.value,
          }, expectedRevision);
      return normalizeMutationResult(raw);
    }
    case 'clickup.attachArtifact':
      throw new ClickUpToolServiceError(
        'attachment_staging_required',
        'ClickUp artifact attachment is not available until the authenticated artifact staging path is connected.',
        501,
      );
  }
}
