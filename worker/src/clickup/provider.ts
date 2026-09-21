import type { ClickUpToolArguments } from '../../../src/clickup/tool-schema';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const CLICKUP_TOKEN_ENDPOINT = 'https://api.clickup.com/api/v2/oauth/token';
const MAX_PROVIDER_BODY_BYTES = 1_250_000;
const CLICKUP_REQUEST_TIMEOUT_MS = 20_000;

export interface ClickUpOAuthServerEnv {
  readonly CLICKUP_OAUTH_CLIENT_ID?: string;
  readonly CLICKUP_OAUTH_CLIENT_SECRET?: string;
}

export interface ClickUpRateLimitSnapshot {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: number | null;
}

export class ClickUpProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rateLimit: ClickUpRateLimitSnapshot,
  ) {
    super(message);
  }
}

export interface ClickUpProviderResult<T> {
  readonly data: T;
  readonly rateLimit: ClickUpRateLimitSnapshot;
}

export interface ClickUpUserIdentity {
  readonly id: string;
  readonly username?: string;
  readonly email?: string;
  readonly profilePicture?: string;
}

export interface ClickUpWorkspaceIdentity {
  readonly id: string;
  readonly name: string;
  readonly members: readonly ClickUpUserIdentity[];
}

const EMPTY_RATE_LIMIT: ClickUpRateLimitSnapshot = Object.freeze({ limit: null, remaining: null, resetAt: null });

async function providerFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLICKUP_REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    throw new ClickUpProviderError(
      502,
      timedOut ? 'timeout' : 'network',
      timedOut ? 'ClickUp did not respond before the request deadline.' : 'ClickUp could not be reached.',
      EMPTY_RATE_LIMIT,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function boundedToken(value: string, label: string): string {
  const token = value.trim();
  if (!token || token.length > 16_384) throw new Error(`ClickUp ${label} is invalid.`);
  return token;
}

function boundedId(value: string, label: string): string {
  const id = value.trim();
  if (!id || id.length > 500 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`ClickUp ${label} is invalid.`);
  return id;
}

function numericBodyId(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`ClickUp ${label} must be a decimal id.`);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`ClickUp ${label} is outside JavaScript's safe integer range.`);
  return numeric;
}

function rateLimitFromHeaders(headers: Headers): ClickUpRateLimitSnapshot {
  const parse = (name: string): number | null => {
    const value = headers.get(name);
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  return {
    limit: parse('X-RateLimit-Limit'),
    remaining: parse('X-RateLimit-Remaining'),
    resetAt: parse('X-RateLimit-Reset'),
  };
}

function providerCode(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).ECODE ?? (payload as Record<string, unknown>).code;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 128);
  }
  return `http-${status}`;
}

function providerMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['err', 'message', 'error_description', 'error']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim().slice(0, 1000);
    }
  }
  return `ClickUp responded with HTTP ${status}.`;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const rateLimit = rateLimitFromHeaders(response.headers);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BODY_BYTES) {
    throw new ClickUpProviderError(
      502,
      'response-too-large',
      'ClickUp returned a response larger than Elara allows.',
      rateLimit,
    );
  }

  const reader = response.body?.getReader();
  let text = '';
  if (!reader) {
    const raw = new Uint8Array(await response.arrayBuffer());
    if (raw.byteLength > MAX_PROVIDER_BODY_BYTES) {
      throw new ClickUpProviderError(502, 'response-too-large', 'ClickUp returned a response larger than Elara allows.', rateLimit);
    }
    text = new TextDecoder().decode(raw);
  } else {
    const decoder = new TextDecoder();
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        total += value.byteLength;
        if (total > MAX_PROVIDER_BODY_BYTES) {
          throw new ClickUpProviderError(502, 'response-too-large', 'ClickUp returned a response larger than Elara allows.', rateLimit);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (cause) {
      await reader.cancel().catch(() => undefined);
      throw cause;
    }
  }

  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ClickUpProviderError(
      502,
      'invalid-json',
      'ClickUp returned malformed JSON.',
      rateLimit,
    );
  }
}

async function clickupRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<ClickUpProviderResult<T>> {
  if (!path.startsWith('/')) throw new Error('ClickUp provider paths must be relative.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${boundedToken(accessToken, 'access token')}`);
  headers.set('Accept', 'application/json');
  const response = await providerFetch(fetcher, `${CLICKUP_API_BASE}${path}`, { ...init, headers });
  const payload = await readJsonResponse(response);
  const rateLimit = rateLimitFromHeaders(response.headers);
  if (!response.ok) {
    throw new ClickUpProviderError(response.status, providerCode(payload, response.status), providerMessage(payload, response.status), rateLimit);
  }
  return { data: payload as T, rateLimit };
}

export async function exchangeClickUpAuthorizationCode(
  env: ClickUpOAuthServerEnv,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await providerFetch(fetcher, CLICKUP_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: required(env.CLICKUP_OAUTH_CLIENT_ID, 'CLICKUP_OAUTH_CLIENT_ID'),
      client_secret: required(env.CLICKUP_OAUTH_CLIENT_SECRET, 'CLICKUP_OAUTH_CLIENT_SECRET'),
      code: boundedToken(code, 'authorization code'),
    }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new ClickUpProviderError(
      response.status,
      providerCode(payload, response.status),
      providerMessage(payload, response.status),
      rateLimitFromHeaders(response.headers),
    );
  }
  const accessToken = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).access_token === 'string'
    ? (payload as Record<string, unknown>).access_token as string
    : '';
  return boundedToken(accessToken, 'access token');
}

function normalizedUser(value: unknown): ClickUpUserIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawId = record.id;
  const id = typeof rawId === 'number' && Number.isSafeInteger(rawId)
    ? String(rawId)
    : typeof rawId === 'string' && rawId.trim()
      ? rawId.trim()
      : '';
  if (!id) return null;
  const username = typeof record.username === 'string' && record.username.trim() ? record.username.trim().slice(0, 500) : undefined;
  const email = typeof record.email === 'string' && record.email.trim() ? record.email.trim().slice(0, 320) : undefined;
  const profilePicture = typeof record.profilePicture === 'string' && record.profilePicture.startsWith('https://')
    ? record.profilePicture.slice(0, 2048)
    : undefined;
  return { id, ...(username ? { username } : {}), ...(email ? { email } : {}), ...(profilePicture ? { profilePicture } : {}) };
}

export async function fetchAuthorizedClickUpUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<ClickUpProviderResult<ClickUpUserIdentity>> {
  const result = await clickupRequest<Record<string, unknown>>(accessToken, '/user', {}, fetcher);
  const user = normalizedUser(result.data.user ?? result.data);
  if (!user) throw new ClickUpProviderError(502, 'invalid-user', 'ClickUp returned an invalid authorized-user response.', result.rateLimit);
  return { data: user, rateLimit: result.rateLimit };
}

export async function fetchAuthorizedClickUpWorkspaces(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<ClickUpProviderResult<readonly ClickUpWorkspaceIdentity[]>> {
  const result = await clickupRequest<Record<string, unknown>>(accessToken, '/team', {}, fetcher);
  const teams = Array.isArray(result.data.teams) ? result.data.teams : [];
  const workspaces = teams.flatMap((item): ClickUpWorkspaceIdentity[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const rawId = record.id;
    const id = typeof rawId === 'number' && Number.isSafeInteger(rawId)
      ? String(rawId)
      : typeof rawId === 'string' && rawId.trim()
        ? rawId.trim()
        : '';
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, 500) : '';
    if (!id || !name) return [];
    const members = Array.isArray(record.members)
      ? record.members.map((member) => {
          if (!member || typeof member !== 'object') return null;
          const user = (member as Record<string, unknown>).user;
          return normalizedUser(user);
        }).filter((user): user is ClickUpUserIdentity => Boolean(user))
      : [];
    return [{ id, name, members }];
  });
  return { data: workspaces, rateLimit: result.rateLimit };
}

function queryPath(path: string, query: URLSearchParams): string {
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function appendMany(query: URLSearchParams, name: string, values: readonly string[] | undefined): void {
  for (const value of values ?? []) query.append(name, value);
}

export async function listClickUpSpaces(accessToken: string, workspaceId: string, archived = false, fetcher: typeof fetch = fetch) {
  const query = new URLSearchParams({ archived: String(archived) });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/team/${boundedId(workspaceId, 'workspace id')}/space`, query), {}, fetcher);
}

export async function listClickUpFolders(accessToken: string, spaceId: string, archived = false, fetcher: typeof fetch = fetch) {
  const query = new URLSearchParams({ archived: String(archived) });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/space/${boundedId(spaceId, 'space id')}/folder`, query), {}, fetcher);
}

export async function getClickUpFolder(accessToken: string, folderId: string, includeSubfolders = true, fetcher: typeof fetch = fetch) {
  const query = new URLSearchParams({ include_subfolders: String(includeSubfolders) });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/folder/${boundedId(folderId, 'folder id')}`, query), {}, fetcher);
}

export async function listClickUpFolderLists(accessToken: string, folderId: string, archived = false, fetcher: typeof fetch = fetch) {
  const query = new URLSearchParams({ archived: String(archived) });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/folder/${boundedId(folderId, 'folder id')}/list`, query), {}, fetcher);
}

export async function listClickUpFolderlessLists(accessToken: string, spaceId: string, archived = false, fetcher: typeof fetch = fetch) {
  const query = new URLSearchParams({ archived: String(archived) });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/space/${boundedId(spaceId, 'space id')}/list`, query), {}, fetcher);
}

export async function getClickUpList(accessToken: string, listId: string, fetcher: typeof fetch = fetch) {
  return clickupRequest<Record<string, unknown>>(accessToken, `/list/${boundedId(listId, 'list id')}`, {}, fetcher);
}

export interface ClickUpWorkspaceTaskFilters {
  readonly page?: number;
  readonly includeClosed?: boolean;
  readonly includeSubtasks?: boolean;
  readonly spaceIds?: readonly string[];
  readonly folderIds?: readonly string[];
  readonly listIds?: readonly string[];
  readonly assigneeIds?: readonly string[];
  readonly statuses?: readonly string[];
  readonly dateUpdatedGt?: number;
}

export async function listClickUpWorkspaceTasks(
  accessToken: string,
  workspaceId: string,
  filters: ClickUpWorkspaceTaskFilters = {},
  fetcher: typeof fetch = fetch,
) {
  const query = new URLSearchParams({
    page: String(Math.max(0, Math.floor(filters.page ?? 0))),
    include_closed: String(filters.includeClosed ?? false),
    subtasks: String(filters.includeSubtasks ?? false),
    include_markdown_description: 'true',
  });
  appendMany(query, 'space_ids[]', filters.spaceIds);
  appendMany(query, 'project_ids[]', filters.folderIds);
  appendMany(query, 'list_ids[]', filters.listIds);
  appendMany(query, 'assignees[]', filters.assigneeIds);
  appendMany(query, 'statuses[]', filters.statuses);
  if (filters.dateUpdatedGt !== undefined) query.set('date_updated_gt', String(Math.max(0, Math.floor(filters.dateUpdatedGt))));
  return clickupRequest<Record<string, unknown>>(
    accessToken,
    queryPath(`/team/${boundedId(workspaceId, 'workspace id')}/task`, query),
    {},
    fetcher,
  );
}

export async function getClickUpTask(
  accessToken: string,
  taskId: string,
  includeSubtasks = false,
  fetcher: typeof fetch = fetch,
) {
  const query = new URLSearchParams({
    include_subtasks: String(includeSubtasks),
    include_markdown_description: 'true',
  });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/task/${boundedId(taskId, 'task id')}`, query), {}, fetcher);
}

export async function getClickUpTaskComments(
  accessToken: string,
  taskId: string,
  cursor?: { start: number; startId: string },
  fetcher: typeof fetch = fetch,
) {
  const query = new URLSearchParams();
  if (cursor) {
    query.set('start', String(Math.max(0, Math.floor(cursor.start))));
    query.set('start_id', boundedId(cursor.startId, 'comment id'));
  }
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/task/${boundedId(taskId, 'task id')}/comment`, query), {}, fetcher);
}

function dateFields(value: string | undefined, providerName: 'due_date' | 'start_date'): Record<string, unknown> {
  if (!value) return {};
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`Invalid ClickUp ${providerName}.`);
  return {
    [providerName]: millis,
    [`${providerName}_time`]: value.includes('T'),
  };
}

export function buildClickUpCreateTaskBody(args: ClickUpToolArguments<'clickup.createTask'>): Record<string, unknown> {
  return {
    name: args.name,
    ...(args.markdownContent !== undefined ? { markdown_content: args.markdownContent } : {}),
    ...(args.assigneeIds ? { assignees: args.assigneeIds.map((id) => numericBodyId(id, 'assignee id')) } : {}),
    ...(args.tags ? { tags: args.tags } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(args.priority !== undefined ? { priority: args.priority } : {}),
    ...dateFields(args.dueAt, 'due_date'),
    ...dateFields(args.startAt, 'start_date'),
    ...(args.timeEstimateMs !== undefined ? { time_estimate: args.timeEstimateMs } : {}),
    ...(args.points !== undefined ? { points: args.points } : {}),
    ...(args.parentTaskId ? { parent: args.parentTaskId } : {}),
    ...(args.notifyAll !== undefined ? { notify_all: args.notifyAll } : {}),
  };
}

export function buildClickUpUpdateTaskBody(args: ClickUpToolArguments<'clickup.updateTask'>): Record<string, unknown> {
  return {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.markdownContent !== undefined ? { markdown_content: args.markdownContent } : {}),
    ...(args.status !== undefined ? { status: args.status } : {}),
    ...(args.priority !== undefined ? { priority: args.priority } : {}),
    ...dateFields(args.dueAt, 'due_date'),
    ...dateFields(args.startAt, 'start_date'),
    ...(args.timeEstimateMs !== undefined ? { time_estimate: args.timeEstimateMs } : {}),
    ...(args.points !== undefined ? { points: args.points } : {}),
    ...(args.parentTaskId !== undefined ? { parent: args.parentTaskId } : {}),
    ...(args.assignees ? {
      assignees: {
        ...(args.assignees.add ? { add: args.assignees.add.map((id) => numericBodyId(id, 'assignee id')) } : {}),
        ...(args.assignees.remove ? { rem: args.assignees.remove.map((id) => numericBodyId(id, 'assignee id')) } : {}),
      },
    } : {}),
    ...(args.archived !== undefined ? { archived: args.archived } : {}),
  };
}

async function jsonMutation(
  accessToken: string,
  path: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
  fetcher: typeof fetch,
) {
  return clickupRequest<Record<string, unknown>>(accessToken, path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, fetcher);
}

export async function createClickUpTask(
  accessToken: string,
  args: ClickUpToolArguments<'clickup.createTask'>,
  fetcher: typeof fetch = fetch,
) {
  return jsonMutation(accessToken, `/list/${boundedId(args.listId, 'list id')}/task`, 'POST', buildClickUpCreateTaskBody(args), fetcher);
}

export async function updateClickUpTask(
  accessToken: string,
  args: ClickUpToolArguments<'clickup.updateTask'>,
  fetcher: typeof fetch = fetch,
) {
  return jsonMutation(accessToken, `/task/${boundedId(args.taskId, 'task id')}`, 'PUT', buildClickUpUpdateTaskBody(args), fetcher);
}

function structuredComment(text: string, mentionUserIds: readonly string[] | undefined): Record<string, unknown> {
  if (!mentionUserIds?.length) return { comment_text: text };
  const segments: Array<Record<string, unknown>> = [{ text }];
  for (const id of mentionUserIds) {
    segments.push({ type: 'tag', user: { id: numericBodyId(id, 'mention user id') } });
  }
  return { comment: segments };
}

export function buildClickUpCommentBody(
  text: string,
  mentionUserIds: readonly string[] | undefined,
  notifyAll: boolean | undefined,
): Record<string, unknown> {
  return {
    ...structuredComment(text, mentionUserIds),
    notify_all: notifyAll ?? false,
  };
}

export async function createClickUpTaskComment(
  accessToken: string,
  args: ClickUpToolArguments<'clickup.createTaskComment'>,
  fetcher: typeof fetch = fetch,
) {
  return jsonMutation(
    accessToken,
    `/task/${boundedId(args.taskId, 'task id')}/comment`,
    'POST',
    buildClickUpCommentBody(args.text, args.mentionUserIds, args.notifyAll),
    fetcher,
  );
}

export async function replyToClickUpComment(
  accessToken: string,
  args: ClickUpToolArguments<'clickup.replyToComment'>,
  fetcher: typeof fetch = fetch,
) {
  return jsonMutation(
    accessToken,
    `/comment/${boundedId(args.commentId, 'comment id')}/reply`,
    'POST',
    buildClickUpCommentBody(args.text, args.mentionUserIds, args.notifyAll),
    fetcher,
  );
}

export async function getClickUpListCustomFields(
  accessToken: string,
  listId: string,
  fetcher: typeof fetch = fetch,
) {
  const query = new URLSearchParams({ include_applied_objects: 'true' });
  return clickupRequest<Record<string, unknown>>(accessToken, queryPath(`/list/${boundedId(listId, 'list id')}/field`, query), {}, fetcher);
}

export async function setClickUpTaskCustomField(
  accessToken: string,
  taskId: string,
  fieldId: string,
  value: unknown,
  fetcher: typeof fetch = fetch,
) {
  return jsonMutation(
    accessToken,
    `/task/${boundedId(taskId, 'task id')}/field/${boundedId(fieldId, 'field id')}`,
    'POST',
    { value },
    fetcher,
  );
}

export async function clearClickUpTaskCustomField(
  accessToken: string,
  taskId: string,
  fieldId: string,
  fetcher: typeof fetch = fetch,
) {
  return clickupRequest<Record<string, unknown>>(
    accessToken,
    `/task/${boundedId(taskId, 'task id')}/field/${boundedId(fieldId, 'field id')}`,
    { method: 'DELETE' },
    fetcher,
  );
}

export async function uploadClickUpTaskAttachment(
  accessToken: string,
  taskId: string,
  file: Blob,
  filename: string,
  fetcher: typeof fetch = fetch,
) {
  if (file.size > 1024 * 1024 * 1024) throw new Error('ClickUp task attachments are limited to 1 GB.');
  const form = new FormData();
  form.append('attachment[0]', file, filename.slice(0, 255));
  return clickupRequest<Record<string, unknown>>(
    accessToken,
    `/task/${boundedId(taskId, 'task id')}/attachment`,
    { method: 'POST', body: form },
    fetcher,
  );
}

export const CLICKUP_TASK_INDEX_WEBHOOK_EVENTS = Object.freeze([
  'taskCreated',
  'taskUpdated',
  'taskDeleted',
  'taskPriorityUpdated',
  'taskStatusUpdated',
  'taskAssigneeUpdated',
  'taskDueDateUpdated',
  'taskTagUpdated',
  'taskMoved',
  'taskTimeEstimateUpdated',
] as const);

export async function createClickUpWebhook(
  accessToken: string,
  workspaceId: string,
  endpoint: string,
  events: readonly string[] = CLICKUP_TASK_INDEX_WEBHOOK_EVENTS,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('ClickUp webhook endpoint must be a clean HTTPS URL.');
  }
  return jsonMutation(
    accessToken,
    `/team/${boundedId(workspaceId, 'workspace id')}/webhook`,
    'POST',
    { endpoint: url.toString(), events: [...events] },
    fetcher,
  );
}

export async function deleteClickUpWebhook(
  accessToken: string,
  webhookId: string,
  fetcher: typeof fetch = fetch,
) {
  return clickupRequest<Record<string, unknown>>(
    accessToken,
    `/webhook/${boundedId(webhookId, 'webhook id')}`,
    { method: 'DELETE' },
    fetcher,
  );
}
