import type { GoogleOAuthAuthority } from '../oauth/contracts';

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
}

export interface TaskListSummary {
  readonly id: string;
  readonly title: string;
  readonly etag?: string;
  readonly updated?: string;
}

export interface GoogleTaskListPage {
  readonly items: readonly TaskListSummary[];
  readonly nextPageToken?: string;
}

export interface GoogleTaskPage {
  readonly items: readonly GoogleTask[];
  readonly nextPageToken?: string;
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
    return {
      items: (payload.items ?? []).flatMap((item) => {
        if (!item.id || !item.title) return [];
        return [{ id: item.id, title: item.title, etag: item.etag, updated: item.updated }];
      }),
      nextPageToken: payload.nextPageToken,
    };
  }

  async getTaskList(taskListId: string): Promise<TaskListSummary> {
    const access = await this.oauth.authorize('tasks.read');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}`);
    return this.mapTaskList(await this.readJson<TaskListPayload>(response));
  }

  async createTaskList(title: string): Promise<TaskListSummary> {
    const safeTitle = boundedText(title, 'task list title', MAX_TITLE_LENGTH);
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: safeTitle }),
    });
    const result = this.mapTaskList(await this.readJson<TaskListPayload>(response));
    this.changed();
    return result;
  }

  async updateTaskList(taskListId: string, title: string, etag?: string): Promise<TaskListSummary> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
      body: JSON.stringify({ title: boundedText(title, 'task list title', MAX_TITLE_LENGTH) }),
    });
    const result = this.mapTaskList(await this.readJson<TaskListPayload>(response));
    this.changed();
    return result;
  }

  async deleteTaskList(taskListId: string, etag?: string): Promise<void> {
    boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH);
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}`, { method: 'DELETE', headers: etag ? { 'If-Match': etag } : {} });
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
    return { items: this.mapTasks(payload.items ?? []), nextPageToken: payload.nextPageToken };
  }

  async getTask(taskListId: string, taskId: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.read');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`);
    return this.mapTask(await this.readJson<TaskPayload>(response));
  }

  async createSemanticTask(input: CreateSemanticTaskInput): Promise<GoogleTask> {
    const body: Record<string, unknown> = { title: boundedText(input.title, 'task title', MAX_TITLE_LENGTH) };
    if (input.notes !== undefined) body.notes = boundedText(input.notes, 'task notes', MAX_NOTES_LENGTH, true);
    if (input.scheduledDate !== undefined) body.due = providerDueForScheduledDate(input.scheduledDate);
    return this.writeTask(
      'POST',
      `lists/${encodeURIComponent(boundedId(input.taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks`,
      body,
      { parent: input.parent, previous: input.previous },
    );
  }

  async updateSemanticTask(input: UpdateSemanticTaskInput): Promise<GoogleTask> {
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
    );
  }

  async deleteTask(taskListId: string, taskId: string, etag?: string): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`, { method: 'DELETE', headers: etag ? { 'If-Match': etag } : {} });
    await this.assertOk(response);
    this.changed();
  }

  async moveTask(taskListId: string, taskId: string, parent?: string, previous?: string, destinationTaskListId?: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.write');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}/move`);
    if (destinationTaskListId) url.searchParams.set('destinationTasklist', boundedId(destinationTaskListId, 'destination task list ID', MAX_TASK_LIST_ID_LENGTH));
    if (parent) url.searchParams.set('parent', boundedId(parent, 'parent ID', MAX_TASK_ID_LENGTH));
    if (previous) url.searchParams.set('previous', boundedId(previous, 'previous task ID', MAX_TASK_ID_LENGTH));
    const response = await access.fetch(url, { method: 'POST' });
    const result = this.mapTask(await this.readJson<TaskPayload>(response));
    this.changed();
    return result;
  }

  async clearCompleted(taskListId: string): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/clear`, { method: 'POST' });
    await this.assertOk(response);
    this.changed();
  }

  private async writeTask(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>, params: { parent?: string; previous?: string; etag?: string } = {}): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.write');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/${path}`);
    if (params.parent) url.searchParams.set('parent', boundedId(params.parent, 'parent ID', MAX_TASK_ID_LENGTH));
    if (params.previous) url.searchParams.set('previous', boundedId(params.previous, 'previous task ID', MAX_TASK_ID_LENGTH));
    const response = await access.fetch(url, { method, headers: { 'content-type': 'application/json', ...(params.etag ? { 'If-Match': params.etag } : {}) }, body: JSON.stringify(body) });
    const result = this.mapTask(await this.readJson<TaskPayload>(response));
    this.changed();
    return result;
  }

  private async readJson<T extends object>(response: Response): Promise<T> {
    if (response.status === 412) throw new Error('This item changed in Google. Sync and reopen it before saving.');
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  private async assertOk(response: Response): Promise<void> {
    if (response.status === 412) throw new Error('This item changed in Google. Sync and reopen it before saving.');
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
  }

  private mapTaskList(item: TaskListPayload): TaskListSummary {
    if (!item.id || !item.title) throw new Error('Google Tasks response contained an incomplete task list.');
    return { id: item.id, title: item.title, etag: item.etag, updated: item.updated };
  }

  private mapTasks(items: TaskPayload[]): GoogleTask[] {
    return items.flatMap((item) => item.id ? [this.mapTask(item)] : []);
  }

  private mapTask(item: TaskPayload): GoogleTask {
    if (!item.id) throw new Error('Google Tasks response contained a task without an id.');
    const info = item.assignmentInfo;
    const surfaceType = assignmentSurface(info?.surfaceType);
    return {
      id: item.id,
      title: item.title,
      etag: item.etag,
      notes: item.notes,
      scheduledDate: scheduledDateFromProviderDue(item.due),
      status: taskStatus(item.status),
      completed: item.completed,
      parent: item.parent,
      position: item.position,
      updated: item.updated,
      deleted: item.deleted,
      hidden: item.hidden,
      links: item.links?.map((link) => ({ type: link.type, description: link.description, link: link.link })),
      webViewLink: item.webViewLink,
      assignmentInfo: info ? {
        linkToTask: info.linkToTask,
        surfaceType,
        driveResourceInfo: info.driveResourceInfo ? { driveFileId: info.driveResourceInfo.driveFileId, resourceKey: info.driveResourceInfo.resourceKey } : undefined,
        spaceInfo: info.spaceInfo ? { space: info.spaceInfo.space } : undefined,
      } : undefined,
    };
  }

  private applyParams(url: URL, options: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(options)) if (value !== undefined) url.searchParams.set(key, String(value));
  }
}
