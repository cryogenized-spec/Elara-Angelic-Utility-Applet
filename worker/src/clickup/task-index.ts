import type { ClickUpToolArguments } from '../../../src/clickup/tool-schema';

type TaskIndexSql = DurableObjectState['storage']['sql'];

export interface ClickUpTaskIndexState {
  readonly workspaceId: string;
  readonly fullSyncComplete: boolean;
  readonly nextPage: number;
  readonly lastRefreshAt: number;
  readonly lastProviderUpdatedAt: number;
  readonly indexedTasks: number;
}

type StateRow = {
  workspace_id: string;
  full_sync_complete: number;
  next_page: number;
  last_refresh_at: number;
  last_provider_updated_at: number;
};

type SearchRow = {
  task_json: string;
  assignee_ids_json: string;
};

const MAX_INDEXED_TASK_JSON_CHARS = 64_000;
const MAX_SEARCH_CANDIDATES = 1_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function id(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function millis(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return 0;
}

function text(value: unknown, max = 12_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function statusValue(value: unknown): { name?: string; type?: string } {
  if (typeof value === 'string') return { name: text(value, 500) };
  const source = record(value);
  return {
    name: text(source?.status, 500),
    type: text(source?.type, 100),
  };
}

function boundedArray(value: unknown, max = 100): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function indexedTaskProjection(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const taskId = id(source?.id);
  if (!source || !taskId) return null;

  const projection: Record<string, unknown> = {
    id: taskId,
    ...(id(source.custom_id) ? { custom_id: id(source.custom_id) } : {}),
    ...(text(source.name, 1_000) ? { name: text(source.name, 1_000) } : {}),
    ...(text(source.markdown_description) ? { markdown_description: text(source.markdown_description) } : {}),
    ...(text(source.text_content) ? { text_content: text(source.text_content) } : {}),
    ...(text(source.description) ? { description: text(source.description) } : {}),
    ...(source.status !== undefined ? { status: source.status } : {}),
    archived: source.archived === true,
    ...(id(source.parent) ? { parent: id(source.parent) } : {}),
    ...(source.date_created !== undefined ? { date_created: source.date_created } : {}),
    ...(source.date_updated !== undefined ? { date_updated: source.date_updated } : {}),
    ...(source.date_closed !== undefined ? { date_closed: source.date_closed } : {}),
    ...(source.date_done !== undefined ? { date_done: source.date_done } : {}),
    ...(source.due_date !== undefined ? { due_date: source.due_date } : {}),
    ...(source.start_date !== undefined ? { start_date: source.start_date } : {}),
    ...(typeof source.time_estimate === 'number' ? { time_estimate: source.time_estimate } : {}),
    ...(typeof source.points === 'number' ? { points: source.points } : {}),
    ...(source.priority !== undefined ? { priority: source.priority } : {}),
    assignees: boundedArray(source.assignees, 50),
    tags: boundedArray(source.tags, 50),
    ...(source.list !== undefined ? { list: source.list } : {}),
    ...(source.folder !== undefined ? { folder: source.folder } : {}),
    ...(source.space !== undefined ? { space: source.space } : {}),
    ...(text(source.url, 2_048) ? { url: text(source.url, 2_048) } : {}),
    custom_fields: boundedArray(source.custom_fields, 50),
  };

  let serialized = JSON.stringify(projection);
  if (serialized.length > MAX_INDEXED_TASK_JSON_CHARS) {
    delete projection.custom_fields;
    serialized = JSON.stringify(projection);
  }
  if (serialized.length > MAX_INDEXED_TASK_JSON_CHARS) {
    delete projection.markdown_description;
    delete projection.text_content;
    delete projection.description;
  }
  return projection;
}

function searchableText(task: Record<string, unknown>): string {
  const status = statusValue(task.status);
  const list = record(task.list);
  const folder = record(task.folder);
  const tags = boundedArray(task.tags, 50).flatMap((entry) => {
    const item = record(entry);
    return text(item?.name ?? entry, 200) ?? [];
  });
  const assignees = boundedArray(task.assignees, 50).flatMap((entry) => {
    const item = record(entry);
    return [text(item?.username, 300), text(item?.email, 320)].filter((item): item is string => Boolean(item));
  });

  return [
    text(task.id, 500),
    text(task.custom_id, 500),
    text(task.name, 1_000),
    text(task.markdown_description),
    text(task.text_content),
    text(task.description),
    status.name,
    text(list?.name, 500),
    text(folder?.name, 500),
    ...tags,
    ...assignees,
  ].filter((item): item is string => Boolean(item))
    .join('\n')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .slice(0, 40_000);
}

function assigneeIds(task: Record<string, unknown>): string[] {
  return boundedArray(task.assignees, 50).flatMap((entry) => {
    const value = id(record(entry)?.id);
    return value ? [value] : [];
  });
}

function relationId(task: Record<string, unknown>, key: 'list' | 'folder' | 'space'): string | null {
  return id(record(task[key])?.id) ?? null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function queryTerms(query: string): string[] {
  return [...new Set(
    query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 12),
  )];
}

function placeholders(values: readonly string[]): string {
  return values.map(() => '?').join(', ');
}

export function initializeClickUpTaskIndex(sql: TaskIndexSql): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS clickup_task_index (
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_json TEXT NOT NULL,
      search_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      closed INTEGER NOT NULL,
      archived INTEGER NOT NULL,
      parent_id TEXT,
      list_id TEXT,
      folder_id TEXT,
      space_id TEXT,
      status TEXT,
      assignee_ids_json TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, task_id)
    )
  `);
  sql.exec('CREATE INDEX IF NOT EXISTS clickup_task_index_workspace_updated ON clickup_task_index(workspace_id, updated_at DESC)');
  sql.exec('CREATE INDEX IF NOT EXISTS clickup_task_index_workspace_list ON clickup_task_index(workspace_id, list_id)');
  sql.exec('CREATE INDEX IF NOT EXISTS clickup_task_index_workspace_folder ON clickup_task_index(workspace_id, folder_id)');
  sql.exec('CREATE INDEX IF NOT EXISTS clickup_task_index_workspace_space ON clickup_task_index(workspace_id, space_id)');
  sql.exec(`
    CREATE TABLE IF NOT EXISTS clickup_task_index_state (
      workspace_id TEXT PRIMARY KEY,
      full_sync_complete INTEGER NOT NULL,
      next_page INTEGER NOT NULL,
      last_refresh_at INTEGER NOT NULL,
      last_provider_updated_at INTEGER NOT NULL
    )
  `);
}

export function clearClickUpTaskIndex(sql: TaskIndexSql): void {
  sql.exec('DELETE FROM clickup_task_index');
  sql.exec('DELETE FROM clickup_task_index_state');
}

export function clearClickUpWorkspaceTaskIndex(sql: TaskIndexSql, workspaceId: string): void {
  sql.exec('DELETE FROM clickup_task_index WHERE workspace_id = ?', workspaceId);
  sql.exec('DELETE FROM clickup_task_index_state WHERE workspace_id = ?', workspaceId);
}

export function upsertClickUpTaskIndexPage(
  sql: TaskIndexSql,
  workspaceId: string,
  tasks: readonly unknown[],
  indexedAt = Date.now(),
): { indexed: number; maxProviderUpdatedAt: number } {
  let indexed = 0;
  let maxProviderUpdatedAt = 0;

  for (const candidate of tasks.slice(0, 100)) {
    const task = indexedTaskProjection(candidate);
    const taskId = id(task?.id);
    if (!task || !taskId) continue;

    const status = statusValue(task.status);
    const updatedAt = millis(task.date_updated);
    const isClosed = millis(task.date_closed) > 0 || status.type === 'closed';
    const serialized = JSON.stringify(task);
    const assignees = assigneeIds(task);

    sql.exec(`
      INSERT INTO clickup_task_index (
        workspace_id, task_id, task_json, search_text, updated_at, closed, archived,
        parent_id, list_id, folder_id, space_id, status, assignee_ids_json, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, task_id) DO UPDATE SET
        task_json = excluded.task_json,
        search_text = excluded.search_text,
        updated_at = excluded.updated_at,
        closed = excluded.closed,
        archived = excluded.archived,
        parent_id = excluded.parent_id,
        list_id = excluded.list_id,
        folder_id = excluded.folder_id,
        space_id = excluded.space_id,
        status = excluded.status,
        assignee_ids_json = excluded.assignee_ids_json,
        indexed_at = excluded.indexed_at
    `,
    workspaceId,
    taskId,
    serialized,
    searchableText(task),
    updatedAt,
    isClosed ? 1 : 0,
    task.archived === true ? 1 : 0,
    id(task.parent) ?? null,
    relationId(task, 'list'),
    relationId(task, 'folder'),
    relationId(task, 'space'),
    status.name ?? null,
    JSON.stringify(assignees),
    indexedAt);

    indexed += 1;
    maxProviderUpdatedAt = Math.max(maxProviderUpdatedAt, updatedAt);
  }

  return { indexed, maxProviderUpdatedAt };
}

export function taskIndexState(sql: TaskIndexSql, workspaceId: string): ClickUpTaskIndexState {
  const row = sql.exec<StateRow>(
    'SELECT workspace_id, full_sync_complete, next_page, last_refresh_at, last_provider_updated_at FROM clickup_task_index_state WHERE workspace_id = ?',
    workspaceId,
  ).toArray()[0];
  const count = sql.exec<{ count: number }>(
    'SELECT COUNT(*) AS count FROM clickup_task_index WHERE workspace_id = ?',
    workspaceId,
  ).toArray()[0]?.count ?? 0;

  return {
    workspaceId,
    fullSyncComplete: row?.full_sync_complete === 1,
    nextPage: row?.next_page ?? 0,
    lastRefreshAt: row?.last_refresh_at ?? 0,
    lastProviderUpdatedAt: row?.last_provider_updated_at ?? 0,
    indexedTasks: count,
  };
}

export function setTaskIndexState(
  sql: TaskIndexSql,
  state: Omit<ClickUpTaskIndexState, 'indexedTasks'>,
): void {
  sql.exec(`
    INSERT INTO clickup_task_index_state (
      workspace_id, full_sync_complete, next_page, last_refresh_at, last_provider_updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      full_sync_complete = excluded.full_sync_complete,
      next_page = excluded.next_page,
      last_refresh_at = excluded.last_refresh_at,
      last_provider_updated_at = excluded.last_provider_updated_at
  `,
  state.workspaceId,
  state.fullSyncComplete ? 1 : 0,
  state.nextPage,
  state.lastRefreshAt,
  state.lastProviderUpdatedAt);
}

export function searchClickUpTaskIndex(
  sql: TaskIndexSql,
  args: ClickUpToolArguments<'clickup.searchTasks'>,
): unknown[] {
  const clauses = ['workspace_id = ?'];
  const bindings: Array<string | number> = [args.workspaceId];

  for (const term of queryTerms(args.query)) {
    clauses.push("search_text LIKE ? ESCAPE '\\'");
    bindings.push(`%${escapeLike(term)}%`);
  }
  if (!args.includeClosed) clauses.push('closed = 0');
  if (!args.includeSubtasks) clauses.push('parent_id IS NULL');
  if (args.listIds?.length) {
    clauses.push(`list_id IN (${placeholders(args.listIds)})`);
    bindings.push(...args.listIds);
  }
  if (args.folderIds?.length) {
    clauses.push(`folder_id IN (${placeholders(args.folderIds)})`);
    bindings.push(...args.folderIds);
  }
  if (args.spaceIds?.length) {
    clauses.push(`space_id IN (${placeholders(args.spaceIds)})`);
    bindings.push(...args.spaceIds);
  }
  if (args.statuses?.length) {
    clauses.push(`status IN (${placeholders(args.statuses)})`);
    bindings.push(...args.statuses);
  }

  const rows = sql.exec<SearchRow>(
    `SELECT task_json, assignee_ids_json
       FROM clickup_task_index
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC, task_id ASC
      LIMIT ${MAX_SEARCH_CANDIDATES}`,
    ...bindings,
  ).toArray();

  const requiredAssignees = new Set(args.assigneeIds ?? []);
  const limit = args.limit ?? 20;
  const output: unknown[] = [];

  for (const row of rows) {
    if (requiredAssignees.size) {
      let indexedAssignees: string[] = [];
      try {
        const parsed = JSON.parse(row.assignee_ids_json) as unknown;
        if (Array.isArray(parsed)) indexedAssignees = parsed.filter((entry): entry is string => typeof entry === 'string');
      } catch {
        indexedAssignees = [];
      }
      if (!indexedAssignees.some((candidate) => requiredAssignees.has(candidate))) continue;
    }

    try {
      output.push(JSON.parse(row.task_json) as unknown);
    } catch {
      continue;
    }
    if (output.length >= limit) break;
  }

  return output;
}
