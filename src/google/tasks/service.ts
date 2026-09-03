import type { AuthorizedGoogleRequest, GoogleOAuthAuthority } from '../oauth/contracts';

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

interface TasksResponse {
  items?: Array<{
    id?: string;
    title?: string;
    notes?: string;
    due?: string;
    status?: string;
    parent?: string;
    position?: string;
    updated?: string;
  }>;
  nextPageToken?: string;
}

export interface TaskListSummary { id: string; title: string; updated?: string; }

interface TaskListsResponse {
  items?: Array<{ id?: string; title?: string; updated?: string }>;
  nextPageToken?: string;
}

export class GoogleTasksService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listTaskLists(pageToken?: string): Promise<{ items: TaskListSummary[]; nextPageToken?: string }> {
    const access = await this.oauth.authorize('tasks.read');
    const url = new URL('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await access.fetch(url);
    const payload = await this.readJson<TaskListsResponse>(response);
    return {
      items: (payload.items ?? []).filter((item): item is Required<Pick<typeof item, 'id' | 'title'>> & typeof item => Boolean(item.id && item.title)),
      nextPageToken: payload.nextPageToken,
    };
  }

  async listTasks(taskListId: string, options: { pageToken?: string; showCompleted?: boolean; showDeleted?: boolean; showHidden?: boolean; dueMin?: string; dueMax?: string; updatedMin?: string; maxResults?: number } = {}): Promise<{ items: GoogleTask[]; nextPageToken?: string }> {
    const access = await this.oauth.authorize('tasks.read');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`);
    this.applyParams(url, options);
    const response = await access.fetch(url);
    const payload = await this.readJson<TasksResponse>(response);
    return { items: this.mapTasks(payload.items ?? []), nextPageToken: payload.nextPageToken };
  }

  async getTask(taskListId: string, taskId: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.read');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`);
    const payload = await this.readJson<TasksResponse[number]>(response);
    return this.mapTask(payload);
  }

  async createTask(taskListId: string, task: Record<string, unknown>, parent?: string, previous?: string): Promise<GoogleTask> {
    return this.writeTask('POST', `lists/${encodeURIComponent(taskListId)}/tasks`, task, { parent, previous });
  }

  async updateTask(taskListId: string, taskId: string, task: Record<string, unknown>): Promise<GoogleTask> {
    return this.writeTask('PUT', `lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, task);
  }

  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    await this.assertOk(response);
  }

  async moveTask(taskListId: string, taskId: string, parent?: string, previous?: string): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.write');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}/move`);
    if (parent) url.searchParams.set('parent', parent);
    if (previous) url.searchParams.set('previous', previous);
    const response = await access.fetch(url, { method: 'POST' });
    const payload = await this.readJson<TasksResponse[number]>(response);
    return this.mapTask(payload);
  }

  async clearCompleted(taskListId: string): Promise<void> {
    const access = await this.oauth.authorize('tasks.write');
    const response = await access.fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/clear`, { method: 'POST' });
    await this.assertOk(response);
  }

  private async writeTask(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>, params: { parent?: string; previous?: string } = {}): Promise<GoogleTask> {
    const access = await this.oauth.authorize('tasks.write');
    const url = new URL(`https://tasks.googleapis.com/tasks/v1/${path}`);
    if (params.parent) url.searchParams.set('parent', params.parent);
    if (params.previous) url.searchParams.set('previous', params.previous);
    const response = await access.fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await this.readJson<TasksResponse[number]>(response);
    return this.mapTask(payload);
  }

  private async readJson<T extends object>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  private async assertOk(response: Response): Promise<void> {
    if (!response.ok) throw new Error(`Google Tasks request failed (${response.status}).`);
  }

  private mapTasks(items: Array<NonNullable<TasksResponse['items']>[number]>): GoogleTask[] {
    return items.filter((item): item is Required<Pick<typeof item, 'id' | 'title'>> & typeof item => Boolean(item.id && item.title)).map((item) => this.mapTask(item));
  }

  private mapTask(item: NonNullable<TasksResponse['items']>[number]): GoogleTask {
    if (!item.id || !item.title) throw new Error('Google Tasks response contained an incomplete task.');
    return { id: item.id, title: item.title, notes: item.notes, due: item.due, status: item.status, parent: item.parent, position: item.position, updated: item.updated };
  }

  private applyParams(url: URL, options: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(options)) if (value !== undefined) url.searchParams.set(key, String(value));
  }
}
