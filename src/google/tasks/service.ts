import type { GoogleOAuthAuthority } from '../oauth/contracts';

const MAX_TASK_LIST_ID_LENGTH = 500;
const MAX_TASK_ID_LENGTH = 500;
const MAX_PAGE_TOKEN_LENGTH = 5_000;
const MAX_RESULTS = 100;

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status?: string;
  parent?: string;
  position?: string;
  updated?: string;
}

type TaskPayload = {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  parent?: string;
  position?: string;
  updated?: string;
};

type TasksResponse = { items?: TaskPayload[]; nextPageToken?: string };
type TaskListsResponse = { items?: Array<{ id?: string; title?: string; updated?: string }>; nextPageToken?: string };

export interface TaskListSummary { id: string; title: string; updated?: string; }

function boundedId(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Tasks ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Tasks ${field} is too long.`);
  return normalized;
}

function boundedPageToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_PAGE_TOKEN_LENGTH) throw new Error('Google Tasks page token is too long.');
  return normalized || undefined;
}

function boundedMaxResults(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) throw new Error(`Google Tasks maxResults must be an integer from 1 to ${MAX_RESULTS}.`);
  return value;
}

export class GoogleTasksService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listTaskLists(pageToken?: string): Promise<{ items: TaskListSummary[]; nextPageToken?: string }> {
    const access = await this.oauth.authorize('tasks.read');
    const url = new URL('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    const safePageToken = boundedPageToken(pageToken);
    if (safePageToken) url.searchParams.set('pageToken', safePageToken);
    const response = await access.fetch(url);
    const payload = await this.readJson<TaskListsResponse>(response);
    return {
      items: (payload.items ?? []).filter((item): item is Required<Pick<typeof item, 'id' | 'title'>> & typeof item => Boolean(item.id && item.title)),
      nextPageToken: payload.nextPageToken,
    };
  }

  async listTasks(taskListId: string, options: { pageToken?: string; showCompleted?: boolean; showDeleted?: boolean; showHidden?: boolean; dueMin?: string; dueMax?: string; updatedMin?: string; completedMin?: string; completedMax?: string; maxResults?: number } = {}): Promise<{ items: GoogleTask[]; nextPageToken?: string }> {
    const access = await this.oauth.authorize('tasks.read');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks`);
    const safePageToken = boundedPageToken(options.pageToken);
    const safeMaxResults = boundedMaxResults(options.maxResults);
    const params = { ...options, pageToken: safePageToken, maxResults: safeMaxResults };
    this.applyParams(url, params);
    const response = await access.fetch(url);
    const payload = await this.readJson<TasksResponse>(response);
    return { items: this.mapTasks(payload.items ?? []), nextPageToken: payload.nextPageToken };
  }

  async getTask(taskListId: string, taskId: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.read');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`);
    const payload = await this.readJson<TaskPayload>(response);
    return this.mapTask(payload);
  }

  async createTask(taskListId: string, task: Record<string, unknown>, parent?: string, previous?: string): Promise<GoogleTask> {
    return this.writeTask('POST', `lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks`, task, { parent, previous });
  }

  async updateTask(taskListId: string, taskId: string, task: Record<string, unknown>): Promise<GoogleTask> {
    return this.writeTask('PUT', `lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`, task);
  }

  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}`, { method: 'DELETE' });
    await this.assertOk(response);
  }

  async moveTask(taskListId: string, taskId: string, parent?: string, previous?: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.write');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/tasks/${encodeURIComponent(boundedId(taskId, 'task ID', MAX_TASK_ID_LENGTH))}/move`);
    if (parent) url.searchParams.set('parent', boundedId(parent, 'parent ID', MAX_TASK_ID_LENGTH));
    if (previous) url.searchParams.set('previous', boundedId(previous, 'previous task ID', MAX_TASK_ID_LENGTH));
    const response = await access.fetch(url, { method: 'POST' });
    const payload = await this.readJson<TaskPayload>(response);
    return this.mapTask(payload);
  }

  async clearCompleted(taskListId: string): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(boundedId(taskListId, 'task list ID', MAX_TASK_LIST_ID_LENGTH))}/clear`, { method: 'POST' });
    await this.assertOk(response);
  }

  private async writeTask(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>, params: { parent?: string; previous?: string } = {}): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.write');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/${path}`);
    if (params.parent) url.searchParams.set('parent', boundedId(params.parent, 'parent ID', MAX_TASK_ID_LENGTH));
    if (params.previous) url.searchParams.set('previous', boundedId(params.previous, 'previous task ID', MAX_TASK_ID_LENGTH));
    const response = await access.fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await this.readJson<TaskPayload>(response);
    return this.mapTask(payload);
  }

  private async readJson<T extends object>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  private async assertOk(response: Response): Promise<void> {
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
  }

  private mapTasks(items: TaskPayload[]): GoogleTask[] {
    return items.filter((item): item is Required<Pick<TaskPayload, 'id' | 'title'>> & TaskPayload => Boolean(item.id && item.title)).map((item) => this.mapTask(item));
  }

  private mapTask(item: TaskPayload): GoogleTask {
    if (!item.id || !item.title) throw new Error('Google Tasks response contained an incomplete task.');
    return { id: item.id, title: item.title, notes: item.notes, due: item.due, status: item.status, parent: item.parent, position: item.position, updated: item.updated };
  }

  private applyParams(url: URL, options: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(options)) if (value !== undefined) url.searchParams.set(key, String(value));
  }
}
