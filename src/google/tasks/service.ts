import type { GoogleOAuthAuthority } from '../oauth/contracts';
import { readBoundedProviderJson } from '../provider-json-boundary';

const MAX_PROVIDER_JSON_BYTES = 2 * 1024 * 1024;
const MAX_TASK_LIST_ID_LENGTH = 500;
const MAX_TASK_ID_LENGTH = 500;
const MAX_PAGE_TOKEN_LENGTH = 5_000;
const MAX_TASK_RESULTS = 100;
const MAX_TASK_LIST_RESULTS = 100;
const MAX_TITLE_LENGTH = 1_024;
const MAX_NOTES_LENGTH = 8_192;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_OFFSET_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))$/i;

export type GoogleTaskStatus = 'needsAction' | 'completed';
export type GoogleTaskAssignmentSurface = 'CONTEXT_TYPE_UNSPECIFIED' | 'GMAIL' | 'DOCUMENT' | 'SPACE';

export interface GoogleTaskLink {
  readonly type?: string;
  readonly description?: string;
  readonly link?: string;
}

export interface GoogleTaskAssignmentInfo {
  readonly linkToTask?: string;
  readonly surfaceType?: GoogleTaskAssignmentSurface;
  readonly driveResourceInfo?: { readonly driveFileId?: string; readonly resourceKey?: string };
  readonly spaceInfo?: { readonly space?: string };
}

export interface GoogleTask {
  readonly trust?: 'untrusted-external';
  readonly source?: 'tasks';
  readonly id: string;
  readonly title?: string;
  readonly etag?: string;
  readonly notes?: string;
  /** Date-only scheduling semantics. Google Tasks discards time-of-day from its provider `due` field. */
  readonly scheduledDate?: string;
  readonly status?: GoogleTaskStatus;
  readonly completed?: string;
  readonly parent?: string;
  readonly position?: string;
  readonly updated?: string;
  readonly deleted?: boolean;
  readonly hidden?: boolean;
  readonly links?: readonly GoogleTaskLink[];
  readonly webViewLink?: string;
  readonly assignmentInfo?: GoogleTaskAssignmentInfo;
  readonly truncatedFields?: readonly string[];
}

export interface TaskListSummary {
  readonly trust?: 'untrusted-external';
  readonly source?: 'tasks';
  readonly id: string;
  readonly title: string;
  readonly etag?: string;
  readonly updated?: string;
  readonly truncatedFields?: readonly string[];
}

export interface GoogleTaskListPage {
  readonly trust?: 'untrusted-external';
  readonly source?: 'tasks';
  readonly items: readonly TaskListSummary[];
  readonly nextPageToken?: string;
  readonly truncated?: boolean;
}

export interface GoogleTaskPage {
  readonly trust?: 'untrusted-external';
  readonly source?: 'tasks';
  readonly items: readonly GoogleTask[];
  readonly nextPageToken?: string;
  readonly truncated?: boolean;
}

export interface CreateSemanticTaskInput {
  readonly taskListId: string;
  readonly title: string;
  readonly notes?: string;
  readonly scheduledDate?: string;
  readonly parent?: string;
  readonly previous?: string;
}

export interface UpdateSemanticTaskInput {
  readonly etag?: string;
  readonly taskListId: string;
  readonly taskId: string;
  readonly title?: string;
  readonly notes?: string;
  readonly scheduledDate?: string;
  readonly clearScheduledDate?: boolean;
  readonly status?: GoogleTaskStatus;
}

type TaskPayload = {
  id?: string;
  etag?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  completed?: string;
  parent?: string;
  position?: string;
  updated?: string;
  deleted?: boolean;
  hidden?: boolean;
  links?: Array<{ type?: string; description?: string; link?: string }>;
  webViewLink?: string;
  assignmentInfo?: {
    linkToTask?: string;
    surfaceType?: string;
    driveResourceInfo?: { driveFileId?: string; resourceKey?: string };
    spaceInfo?: { space?: string };
  };
};

type TaskListPayload = { id?: string; etag?: string; title?: string; updated?: string };
type TasksResponse = { items?: TaskPayload[]; nextPageToken?: string };
type TaskListsResponse = { items?: TaskListPayload[]; nextPageToken?: string };

const MAX_PROVIDER_LINKS = 20;
const MAX_PROVIDER_TEXT_LENGTH = 2_000;

function projectedProviderText(
  value: unknown,
  maxLength: number,
  field: string,
  truncated: Set<string>,
  trim = false,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = (trim ? value.trim() : value).split('\0').join('');
  if (!normalized) return trim ? undefined : '';
  if (normalized.length > maxLength) {
    truncated.add(field);
    return normalized.slice(0, maxLength);
  }
  return normalized;
}

function projectedProviderId(value: unknown, maxLength: number, field: string, truncated: Set<string>): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    truncated.add(field);
    return undefined;
  }
  return normalized;
}


function boundedId(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Tasks ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Tasks ${field} is too long.`);
  return normalized;
}

function boundedText(value: string, field: string, maxLength: number, allowEmpty = false): string {
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new Error(`Google Tasks ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Tasks ${field} is too long.`);
  return normalized;
}

function boundedPageToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_PAGE_TOKEN_LENGTH) throw new Error('Google Tasks page token is too long.');
  return normalized || undefined;
}

function boundedMaxResults(value: number | undefined, max: number, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Google Tasks ${field} must be an integer from 1 to ${max}.`);
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDateParts(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function normalizeScheduledDate(value: string): string {
  const normalized = value.trim();
  const match = DATE_PATTERN.exec(normalized);
  if (!match) throw new Error('Google Tasks scheduled date must be YYYY-MM-DD; Tasks does not support a time-of-day here.');
  const [, year, month, day] = match;
  if (!validDateParts(Number(year), Number(month), Number(day))) throw new Error('Google Tasks scheduled date is not a real calendar date.');
  return normalized;
}

function providerDueForScheduledDate(value: string): string {
  return `${normalizeScheduledDate(value)}T00:00:00.000Z`;
}

function scheduledDateFromProviderDue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  const match = DATE_PATTERN.exec(date);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return validDateParts(Number(year), Number(month), Number(day)) ? date : undefined;
}

function boundedFilterTimestamp(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  const match = RFC3339_OFFSET_PATTERN.exec(normalized);
  if (!match) throw new Error(`Google Tasks ${field} must be an RFC 3339 timestamp with an explicit UTC offset.`);
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  if (!validDateParts(Number(year), Number(month), Number(day)) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new Error(`Google Tasks ${field} is not a real RFC 3339 timestamp.`);
  }
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    throw new Error(`Google Tasks ${field} has an invalid UTC offset.`);
  }
  return normalized;
}

function taskStatus(value: string | undefined): GoogleTaskStatus | undefined {
  return value === 'needsAction' || value === 'completed' ? value : undefined;
}

function assignmentSurface(value: string | undefined): GoogleTaskAssignmentSurface | undefined {
  return value === 'CONTEXT_TYPE_UNSPECIFIED' || value === 'GMAIL' || value === 'DOCUMENT' || value === 'SPACE' ? value : undefined;
}

export interface GoogleTasksMutationOptions {
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
  readonly beforeProviderFetch?: () => void | Promise<void>;
}

function requireTaskMutationCurrent(options: GoogleTasksMutationOptions, operation: string): void {
  if (options.signal?.aborted || options.isGenerationActive?.() === false) {
    throw new DOMException(`${operation} lost turn authority.`, 'AbortError');
  }
}

function taskProviderMutationGuard(options: GoogleTasksMutationOptions, operation: string): () => Promise<void> {
  return async () => {
    requireTaskMutationCurrent(options, operation);
    await options.beforeProviderFetch?.();
    requireTaskMutationCurrent(options, operation);
  };
}

export class GoogleTasksService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  private changed(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('elara:tasks-changed'));
  }

  async listTaskLists(pageToken?: string, maxResults?: number, signal?: AbortSignal): Promise<GoogleTaskListPage> {
    signal?.throwIfAborted();
    const access = await this.oauth.authorize('tasks.read');
    const url = new URL('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    const safePageToken = boundedPageToken(pageToken);
    const safeMaxResults = boundedMaxResults(maxResults, MAX_TASK_LIST_RESULTS, 'task-list maxResults');
    if (safePageToken) url.searchParams.set('pageToken', safePageToken);
    if (safeMaxResults !== undefined) url.searchParams.set('maxResults', String(safeMaxResults));
    const response = await access.fetch(url, { signal });
    const payload = await this.readJson<TaskListsResponse>(response);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems.slice(0, MAX_TASK_LIST_RESULTS).flatMap((item) => {
      try {
        return [this.mapTaskList(item)];
      } catch {
        return [];
      }
    });
    const nextPageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.length <= MAX_PAGE_TOKEN_LENGTH
      ? payload.nextPageToken
      : undefined;
    return {
      items,
      ...(nextPageToken ? { nextPageToken } : {}),
      ...((rawItems.length > MAX_TASK_LIST_RESULTS || (typeof payload.nextPageToken === 'string' && !nextPageToken)) ? { truncated: true } : {}),
    };
  }

  async getTaskList(taskListId: string): Promise<TaskListSummary> {
    const access = await this.oauth.authorize('tasks.read');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}`);
    return this.mapTaskList(await this.readJson<TaskListPayload>(response));
  }

  async createTaskList(title: string, options: GoogleTasksMutationOptions = {}): Promise<TaskListSummary> {
    const safeTitle = boundedText(title, 'task list title', MAX_TITLE_LENGTH);
    requireTaskMutationCurrent(options, 'Google Tasks create list');
    const access = await this.oauth.authorize('tasks.write');
    requireTaskMutationCurrent(options, 'Google Tasks create list');
    const response = await access.fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: safeTitle }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, taskProviderMutationGuard(options, 'Google Tasks create list'));
    const result = this.mapTaskList(await this.readJson<TaskListPayload>(response));
    this.changed();
    return result;
  }

  async updateTaskList(taskListId: string, title: string, etag?: string, options: GoogleTasksMutationOptions = {}): Promise<TaskListSummary> {
    requireTaskMutationCurrent(options, 'Google Tasks update list');
    const access = await this.oauth.authorize('tasks.write');
    requireTaskMutationCurrent(options, 'Google Tasks update list');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
      body: JSON.stringify({ title: boundedText(title, 'task list title', MAX_TITLE_LENGTH) }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, taskProviderMutationGuard(options, 'Google Tasks update list'));
    const result = this.mapTaskList(await this.readJson<TaskListPayload>(response));
    this.changed();
    return result;
  }

  async deleteTaskList(taskListId: string, etag?: string, options: GoogleTasksMutationOptions = {}): Promise<void> {
    boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH);
    requireTaskMutationCurrent(options, 'Google Tasks delete list');
    requireTaskMutationCurrent(options, 'Google Tasks delete task');
    const access = await this.oauth.authorize('tasks.write');
    requireTaskMutationCurrent(options, 'Google Tasks delete task');
    requireTaskMutationCurrent(options, 'Google Tasks delete list');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}`, { method: 'DELETE', headers: etag ? { 'If-Match': etag } : {}, ...(options.signal ? { signal: options.signal } : {}) }, taskProviderMutationGuard(options, 'Google Tasks delete list'));
    await this.assertOk(response);
    this.changed();
  }

  async listTasks(taskListId: string, options: { signal?: AbortSignal; pageToken?: string; showCompleted?: boolean; showDeleted?: boolean; showHidden?: boolean; showAssigned?: boolean; dueMin?: string; dueMax?: string; updatedMin?: string; completedMin?: string; completedMax?: string; maxResults?: number } = {}): Promise<GoogleTaskPage> {
    options.signal?.throwIfAborted();
    const access = await this.oauth.authorize('tasks.read');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks`);
    const safePageToken = boundedPageToken(options.pageToken);
    const safeMaxResults = boundedMaxResults(options.maxResults, MAX_TASK_RESULTS, 'task maxResults');
    const params: Record<string, unknown> = {
      pageToken: safePageToken,
      maxResults: safeMaxResults,
      showCompleted: options.showCompleted,
      showDeleted: options.showDeleted,
      showHidden: options.showHidden,
      showAssigned: options.showAssigned,
      dueMin: boundedFilterTimestamp(options.dueMin, 'dueMin'),
      dueMax: boundedFilterTimestamp(options.dueMax, 'dueMax'),
      updatedMin: boundedFilterTimestamp(options.updatedMin, 'updatedMin'),
      completedMin: boundedFilterTimestamp(options.completedMin, 'completedMin'),
      completedMax: boundedFilterTimestamp(options.completedMax, 'completedMax'),
    };
    this.applyParams(url, params);
    const response = await access.fetch(url, { signal: options.signal });
    const payload = await this.readJson<TasksResponse>(response);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const nextPageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.length <= MAX_PAGE_TOKEN_LENGTH
      ? payload.nextPageToken
      : undefined;
    return {
      items: this.mapTasks(rawItems.slice(0, MAX_TASK_RESULTS)),
      ...(nextPageToken ? { nextPageToken } : {}),
      ...((rawItems.length > MAX_TASK_RESULTS || (typeof payload.nextPageToken === 'string' && !nextPageToken)) ? { truncated: true } : {}),
    };
  }

  async getTask(taskListId: string, taskId: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.read');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`);
    return this.mapTask(await this.readJson<TaskPayload>(response));
  }

  async createSemanticTask(input: CreateSemanticTaskInput, options: GoogleTasksMutationOptions = {}): Promise<GoogleTask> {
    const body: Record<string, unknown> = { title: boundedText(input.title, 'task title', MAX_TITLE_LENGTH) };
    if (input.notes !== undefined) body.notes = boundedText(input.notes, 'task notes', MAX_NOTES_LENGTH, true);
    if (input.scheduledDate !== undefined) body.due = providerDueForScheduledDate(input.scheduledDate);
    return this.writeTask(
      'POST',
      `lists/${encodeURIComponent(boundedId(input.taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks`,
      body,
      { parent: input.parent, previous: input.previous },
      options,
    );
  }

  async updateSemanticTask(input: UpdateSemanticTaskInput, options: GoogleTasksMutationOptions = {}): Promise<GoogleTask> {
    if (input.scheduledDate !== undefined && input.clearScheduledDate) throw new Error('Google Tasks update cannot set and clear the scheduled date at the same time.');
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = boundedText(input.title, 'task title', MAX_TITLE_LENGTH);
    if (input.notes !== undefined) body.notes = boundedText(input.notes, 'task notes', MAX_NOTES_LENGTH, true);
    if (input.scheduledDate !== undefined) body.due = providerDueForScheduledDate(input.scheduledDate);
    if (input.clearScheduledDate) body.due = null;
    if (input.status !== undefined) body.status = input.status;
    if (Object.keys(body).length === 0) throw new Error('Google Tasks update requires at least one task field change.');
    return this.writeTask(
      'PATCH',
      `lists/${encodeURIComponent(boundedId(input.taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(input.taskId, 'task ID', MAX_TASK_ID_LENGTH))}`,
      body,
      { etag: input.etag },
      options,
    );
  }

  async deleteTask(taskListId: string, taskId: string, etag?: string, options: GoogleTasksMutationOptions = {}): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`, { method: 'DELETE', headers: etag ? { 'If-Match': etag } : {}, ...(options.signal ? { signal: options.signal } : {}) }, taskProviderMutationGuard(options, 'Google Tasks delete task'));
    await this.assertOk(response);
    this.changed();
  }

  async moveTask(taskListId: string, taskId: string, parent?: string, previous?: string, destinationTaskListId?: string, options: GoogleTasksMutationOptions = {}): Promise<GoogleTask> {
    requireTaskMutationCurrent(options, 'Google Tasks move task');
    const access = await this.oauth.authorize('tasks.write');
    requireTaskMutationCurrent(options, 'Google Tasks move task');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}/move`);
    if (destinationTaskListId) url.searchParams.set('destinationTasklist', boundedId(destinationTaskListId, 'destination task list ID', MAX_TASK_LIST_ID_LENGTH));
    if (parent) url.searchParams.set('parent', boundedId(parent, 'parent ID', MAX_TASK_ID_LENGTH));
    if (previous) url.searchParams.set('previous', boundedId(previous, 'previous task ID', MAX_TASK_ID_LENGTH));
    const response = await access.fetch(url, { method: 'POST', ...(options.signal ? { signal: options.signal } : {}) }, taskProviderMutationGuard(options, 'Google Tasks move task'));
    const result = this.mapTask(await this.readJson<TaskPayload>(response));
    this.changed();
    return result;
  }

  async clearCompleted(taskListId: string, options: GoogleTasksMutationOptions = {}): Promise<void> {
    requireTaskMutationCurrent(options, 'Google Tasks clear completed');
    const access = await this.oauth.authorize('tasks.write');
    requireTaskMutationCurrent(options, 'Google Tasks clear completed');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/clear`, { method: 'POST', ...(options.signal ? { signal: options.signal } : {}) }, taskProviderMutationGuard(options, 'Google Tasks clear completed'));
    await this.assertOk(response);
    this.changed();
  }

  private async writeTask(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>, params: { parent?: string; previous?: string; etag?: string } = {}, options: GoogleTasksMutationOptions = {}): Promise<GoogleTask> {
    requireTaskMutationCurrent(options, 'Google Tasks write task');
    const access = await this.oauth.authorize('tasks.write');
    requireTaskMutationCurrent(options, 'Google Tasks write task');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/${path}`);
    if (params.parent) url.searchParams.set('parent', boundedId(params.parent, 'parent ID', MAX_TASK_ID_LENGTH));
    if (params.previous) url.searchParams.set('previous', boundedId(params.previous, 'previous task ID', MAX_TASK_ID_LENGTH));
    const response = await access.fetch(url, { method, headers: { 'content-type': 'application/json', ...(params.etag ? { 'If-Match': params.etag } : {}) }, body: JSON.stringify(body), ...(options.signal ? { signal: options.signal } : {}) }, taskProviderMutationGuard(options, 'Google Tasks write task'));
    const result = this.mapTask(await this.readJson<TaskPayload>(response));
    this.changed();
    return result;
  }

  private async readJson<T extends object>(response: Response): Promise<T> {
    if (response.status === 412) throw new Error('This item changed in Google. Sync and reopen it before saving.');
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
    return readBoundedProviderJson<T>(response, { operation: 'Google Tasks request', maxBytes: MAX_PROVIDER_JSON_BYTES });
  }

  private async assertOk(response: Response): Promise<void> {
    if (response.status === 412) throw new Error('This item changed in Google. Sync and reopen it before saving.');
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
  }

  private mapTaskList(item: TaskListPayload): TaskListSummary {
    const truncated = new Set<string>();
    const id = projectedProviderId(item.id, MAX_TASK_LIST_ID_LENGTH, 'id', truncated);
    const title = projectedProviderText(item.title, MAX_TITLE_LENGTH, 'title', truncated);
    if (!id || !title) throw new Error('Google Tasks response contained an incomplete task list.');
    const etag = projectedProviderId(item.etag, 1_024, 'etag', truncated);
    const updated = projectedProviderText(item.updated, 128, 'updated', truncated, true);
    return {
      trust: 'untrusted-external',
      source: 'tasks',
      id,
      title,
      ...(etag ? { etag } : {}),
      ...(updated ? { updated } : {}),
      ...(truncated.size ? { truncatedFields: [...truncated].sort() } : {}),
    };
  }

  private mapTasks(items: TaskPayload[]): GoogleTask[] {
    return items.flatMap((item) => {
      try {
        return item.id ? [this.mapTask(item)] : [];
      } catch {
        return [];
      }
    });
  }

  private mapTask(item: TaskPayload): GoogleTask {
    const truncated = new Set<string>();
    const id = projectedProviderId(item.id, MAX_TASK_ID_LENGTH, 'id', truncated);
    if (!id) throw new Error('Google Tasks response contained a task without a usable id.');
    const info = item.assignmentInfo;
    const surfaceType = assignmentSurface(info?.surfaceType);
    const rawLinks = Array.isArray(item.links) ? item.links : [];
    if (rawLinks.length > MAX_PROVIDER_LINKS) truncated.add('links');
    const links = rawLinks.slice(0, MAX_PROVIDER_LINKS).map((link) => ({
      ...(projectedProviderText(link.type, 128, 'links.type', truncated, true) ? { type: projectedProviderText(link.type, 128, 'links.type', truncated, true) } : {}),
      ...(projectedProviderText(link.description, MAX_PROVIDER_TEXT_LENGTH, 'links.description', truncated) ? { description: projectedProviderText(link.description, MAX_PROVIDER_TEXT_LENGTH, 'links.description', truncated) } : {}),
      ...(projectedProviderText(link.link, MAX_PROVIDER_TEXT_LENGTH, 'links.link', truncated, true) ? { link: projectedProviderText(link.link, MAX_PROVIDER_TEXT_LENGTH, 'links.link', truncated, true) } : {}),
    }));
    const title = projectedProviderText(item.title, MAX_TITLE_LENGTH, 'title', truncated);
    const etag = projectedProviderId(item.etag, 1_024, 'etag', truncated);
    const notes = projectedProviderText(item.notes, MAX_NOTES_LENGTH, 'notes', truncated);
    const completed = projectedProviderText(item.completed, 128, 'completed', truncated, true);
    const parent = projectedProviderId(item.parent, MAX_TASK_ID_LENGTH, 'parent', truncated);
    const position = projectedProviderText(item.position, 256, 'position', truncated, true);
    const updated = projectedProviderText(item.updated, 128, 'updated', truncated, true);
    const webViewLink = projectedProviderText(item.webViewLink, MAX_PROVIDER_TEXT_LENGTH, 'webViewLink', truncated, true);
    const linkToTask = projectedProviderText(info?.linkToTask, MAX_PROVIDER_TEXT_LENGTH, 'assignmentInfo.linkToTask', truncated, true);
    const driveFileId = projectedProviderId(info?.driveResourceInfo?.driveFileId, 500, 'assignmentInfo.driveFileId', truncated);
    const resourceKey = projectedProviderText(info?.driveResourceInfo?.resourceKey, 1_024, 'assignmentInfo.resourceKey', truncated, true);
    const space = projectedProviderText(info?.spaceInfo?.space, 1_024, 'assignmentInfo.space', truncated, true);

    return {
      trust: 'untrusted-external',
      source: 'tasks',
      id,
      ...(title !== undefined ? { title } : {}),
      ...(etag ? { etag } : {}),
      ...(notes !== undefined ? { notes } : {}),
      scheduledDate: scheduledDateFromProviderDue(item.due),
      status: taskStatus(item.status),
      ...(completed ? { completed } : {}),
      ...(parent ? { parent } : {}),
      ...(position ? { position } : {}),
      ...(updated ? { updated } : {}),
      ...(typeof item.deleted === 'boolean' ? { deleted: item.deleted } : {}),
      ...(typeof item.hidden === 'boolean' ? { hidden: item.hidden } : {}),
      ...(links.length ? { links } : {}),
      ...(webViewLink ? { webViewLink } : {}),
      ...(info ? {
        assignmentInfo: {
          ...(linkToTask ? { linkToTask } : {}),
          ...(surfaceType ? { surfaceType } : {}),
          ...((driveFileId || resourceKey) ? { driveResourceInfo: { ...(driveFileId ? { driveFileId } : {}), ...(resourceKey ? { resourceKey } : {}) } } : {}),
          ...(space ? { spaceInfo: { space } } : {}),
        },
      } : {}),
      ...(truncated.size ? { truncatedFields: [...truncated].sort() } : {}),
    };
  }

  private applyParams(url: URL, options: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(options)) if (value !== undefined) url.searchParams.set(key, String(value));
  }
}
