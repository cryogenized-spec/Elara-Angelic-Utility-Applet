import type { ClickUpToolArguments } from '../../../src/clickup/tool-schema';

type TaskIndexSql = DurableObjectState['storage']['sql'];

export interface ClickUpTaskIndexState {
  readonly workspaceId: string;
  readonly fullSyncComplete: boolean;
  readonly nextPage: number;
  readonly lastRefreshAt: number;
  readonly lastProviderUpdatedAt: number;
  readonly indexedTasks: number;
  readonly oldestIndexedAt: number;
  readonly incrementalSince: number;
  readonly incrementalNextPage: number;
  readonly incrementalMaxUpdatedAt: number;
}

type StateRow = {
  workspace_id: string;
  full_sync_complete: number;
  next_page: number;
  last_refresh_at: number;
  last_provider_updated_at: number;
  incremental_since: number;
  incremental_next_page: number;
  incremental_max_updated_at: number;
};

type SearchRow = {
  task_json: string;
  assignee_ids_json: string;
};

export const MAX_INDEXED_TASK_JSON_CHARS = 64_000;
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

function normalizedIndexedUser(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const userId = id(source?.id);
  if (!source || !userId) return null;
  return {
    id: userId,
    ...(text(source.username, 300) ? { username: text(source.username, 300) } : {}),
    ...(text(source.email, 320) ? { email: text(source.email, 320) } : {}),
    ...(text(source.initials, 20) ? { initials: text(source.initials, 20) } : {}),
  };
}

function normalizedIndexedRelation(value: unknown): Record<string, unknown> | undefined {
  const source = record(value);
  const relationId = id(source?.id);
  if (!source || !relationId) return undefined;
  return {
    id: relationId,
    ...(text(source.name, 500) ? { name: text(source.name, 500) } : {}),
  };
}

function normalizedIndexedStatus(value: unknown): string | Record<string, unknown> | undefined {
  if (typeof value === 'string') return text(value, 500);
  const source = record(value);
  if (!source) return undefined;
  const status = text(source.status, 500);
  const type = text(source.type, 100);
  if (!status && !type) return undefined;
  return {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };
}

function normalizedIndexedPriority(value: unknown): Record<string, unknown> | undefined {
  const source = record(value);
  if (!source) return undefined;
  const priority = text(source.priority, 100);
  const priorityId = id(source.id);
  if (!priority && !priorityId) return undefined;
  return {
    ...(priorityId ? { id: priorityId } : {}),
    ...(priority ? { priority } : {}),
  };
}

function normalizedIndexedTag(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const name = text(source?.name ?? value, 200);
  return name ? { name } : null;
}

function boundedIndexedValue(value: unknown, max = 1_000): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return text(value, max) ?? '';
  try {
    const rendered = JSON.stringify(value);
    return rendered.length <= max ? value : `${rendered.slice(0, max - 1)}…`;
  } catch {
    return '[unavailable]';
  }
}

function normalizedIndexedCustomField(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const fieldId = id(source?.id);
  if (!source || !fieldId) return null;
  return {
    id: fieldId,
    ...(text(source.name, 500) ? { name: text(source.name, 500) } : {}),
    ...(text(source.type, 100) ? { type: text(source.type, 100) } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'value') ? { value: boundedIndexedValue(source.value) } : {}),
  };
}

function indexedTaskProjection(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const taskId = id(source?.id);
  if (!source || !taskId) return null;

  const status = normalizedIndexedStatus(source.status);
  const priority = normalizedIndexedPriority(source.priority);
  const assignees = boundedArray(source.assignees, 50)
    .map(normalizedIndexedUser)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const tags = boundedArray(source.tags, 50)
    .map(normalizedIndexedTag)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const list = normalizedIndexedRelation(source.list);
  const folder = normalizedIndexedRelation(source.folder);
  const space = normalizedIndexedRelation(source.space);
  const customFields = boundedArray(source.custom_fields, 50)
    .map(normalizedIndexedCustomField)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const projection: Record<string, unknown> = {
    id: taskId,
    ...(id(source.custom_id) ? { custom_id: id(source.custom_id) } : {}),
    ...(text(source.name, 1_000) ? { name: text(source.name, 1_000) } : {}),
    ...(text(source.markdown_description) ? { markdown_description: text(source.markdown_description) } : {}),
    ...(text(source.text_content) ? { text_content: text(source.text_content) } : {}),
    ...(text(source.description) ? { description: text(source.description) } : {}),
    ...(status !== undefined ? { status } : {}),
    archived: source.archived === true,
    ...(id(source.parent) ? { parent: id(source.parent) } : {}),
    ...(millis(source.date_created) > 0 ? { date_created: millis(source.date_created) } : {}),
    ...(millis(source.date_updated) > 0 ? { date_updated: millis(source.date_updated) } : {}),
    ...(millis(source.date_closed) > 0 ? { date_closed: millis(source.date_closed) } : {}),
    ...(millis(source.date_done) > 0 ? { date_done: millis(source.date_done) } : {}),
    ...(millis(source.due_date) > 0 ? { due_date: millis(source.due_date) } : {}),
    ...(millis(source.start_date) > 0 ? { start_date: millis(source.start_date) } : {}),
    ...(typeof source.time_estimate === 'number' && Number.isFinite(source.time_estimate) ? { time_estimate: source.time_estimate } : {}),
    ...(typeof source.points === 'number' && Number.isFinite(source.points) ? { points: source.points } : {}),
    ...(priority ? { priority } : {}),
    ...(assignees.length ? { assignees } : { assignees: [] }),
    ...(tags.length ? { tags } : { tags: [] }),
    ...(list ? { list } : {}),
    ...(folder ? { folder } : {}),
    ...(space ? { space } : {}),
    ...(text(source.url, 2_048) ? { url: text(source.url, 2_048) } : {}),
    ...(customFields.length ? { custom_fields: customFields } : { custom_fields: [] }),
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
    serialized = JSON.stringify(projection);
  }
  if (serialized.length > MAX_INDEXED_TASK_JSON_CHARS) {
    delete projection.assignees;
    delete projection.tags;
    serialized = JSON.stringify(projection);
  }
  if (serialized.length <= MAX_INDEXED_TASK_JSON_CHARS) return projection;

  // Last-resort projection is deliberately tiny but preserves the stable
  // identity/location needed for search refreshes, webhook deletion and live
  // follow-up reads. Never persist provider-controlled JSON above the cap.
  const minimal: Record<string, unknown> = {
    id: taskId,
    ...(text(source.name, 1_000) ? { name: text(source.name, 1_000) } : {}),
    ...(status !== undefined ? { status } : {}),
    archived: source.archived === true,
    ...(id(source.parent) ? { parent: id(source.parent) } : {}),
    ...(millis(source.date_updated) > 0 ? { date_updated: millis(source.date_updated) } : {}),
    ...(list ? { list } : {}),
    ...(folder ? { folder } : {}),
    ...(space ? { space } : {}),
  };
  const minimalSerialized = JSON.stringify(minimal);
  return minimalSerialized.length <= MAX_INDEXED_TASK_JSON_CHARS
    ? minimal
    : { id: taskId, archived: source.archived === true };
}

function searchableText(task: Record<string, unknown>): string {
  const status = statusValue(task.status);
  const list = record(task.list);
  const folder = record(task.folder);
  const tags = boundedArray(task.tags, 50).flatMap((entry) => {
    const item = record(entry);
    const name = text(item?.name ?? entry, 200);
    return name ? [name] : [];
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
      last_provider_updated_at INTEGER NOT NULL,
      incremental_since INTEGER NOT NULL DEFAULT 0,
      incremental_next_page INTEGER NOT NULL DEFAULT 0,
      incremental_max_updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  for (const statement of [
    'ALTER TABLE clickup_task_index_state ADD COLUMN incremental_since INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE clickup_task_index_state ADD COLUMN incremental_next_page INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE clickup_task_index_state ADD COLUMN incremental_max_updated_at INTEGER NOT NULL DEFAULT 0',
  ]) {
    try { sql.exec(statement); } catch { /* Already present on current schema. */ }
  }
}

export function clearClickUpTaskIndex(sql: TaskIndexSql): void {
  sql.exec('DELETE FROM clickup_task_index');
  sql.exec('DELETE FROM clickup_task_index_state');
}

export function clearClickUpWorkspaceTaskIndex(sql: TaskIndexSql, workspaceId: string): void {
  sql.exec('DELETE FROM clickup_task_index WHERE workspace_id = ?', workspaceId);
  sql.exec('DELETE FROM clickup_task_index_state WHERE workspace_id = ?', workspaceId);
}

export function markClickUpWorkspaceTaskIndexStale(sql: TaskIndexSql, workspaceId: string): void {
  sql.exec(
    'UPDATE clickup_task_index_state SET last_refresh_at = 0 WHERE workspace_id = ?',
    workspaceId,
  );
}

export function markAllClickUpTaskIndexesStale(sql: TaskIndexSql): void {
  sql.exec('UPDATE clickup_task_index_state SET last_refresh_at = 0');
}

export function removeClickUpTaskFromIndex(sql: TaskIndexSql, workspaceId: string, taskId: string): void {
  sql.exec(
    'DELETE FROM clickup_task_index WHERE workspace_id = ? AND task_id = ?',
    workspaceId,
    taskId,
  );
}

export function removeClickUpTaskFromAllIndexes(sql: TaskIndexSql, taskId: string): void {
  sql.exec('DELETE FROM clickup_task_index WHERE task_id = ?', taskId);
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
    'SELECT workspace_id, full_sync_complete, next_page, last_refresh_at, last_provider_updated_at, incremental_since, incremental_next_page, incremental_max_updated_at FROM clickup_task_index_state WHERE workspace_id = ?',
    workspaceId,
  ).toArray()[0];
  const aggregate = sql.exec<{ count: number; oldest_indexed_at: number | null }>(
    'SELECT COUNT(*) AS count, MIN(indexed_at) AS oldest_indexed_at FROM clickup_task_index WHERE workspace_id = ?',
    workspaceId,
  ).toArray()[0];

  return {
    workspaceId,
    fullSyncComplete: row?.full_sync_complete === 1,
    nextPage: row?.next_page ?? 0,
    lastRefreshAt: row?.last_refresh_at ?? 0,
    lastProviderUpdatedAt: row?.last_provider_updated_at ?? 0,
    indexedTasks: aggregate?.count ?? 0,
    oldestIndexedAt: aggregate?.oldest_indexed_at ?? 0,
    incrementalSince: row?.incremental_since ?? 0,
    incrementalNextPage: row?.incremental_next_page ?? 0,
    incrementalMaxUpdatedAt: row?.incremental_max_updated_at ?? 0,
  };
}

export function setTaskIndexState(
  sql: TaskIndexSql,
  state: Omit<ClickUpTaskIndexState, 'indexedTasks'>,
): void {
  sql.exec(`
    INSERT INTO clickup_task_index_state (
      workspace_id, full_sync_complete, next_page, last_refresh_at, last_provider_updated_at,
      incremental_since, incremental_next_page, incremental_max_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      full_sync_complete = excluded.full_sync_complete,
      next_page = excluded.next_page,
      last_refresh_at = excluded.last_refresh_at,
      last_provider_updated_at = excluded.last_provider_updated_at,
      incremental_since = excluded.incremental_since,
      incremental_next_page = excluded.incremental_next_page,
      incremental_max_updated_at = excluded.incremental_max_updated_at
  `,
  state.workspaceId,
  state.fullSyncComplete ? 1 : 0,
  state.nextPage,
  state.lastRefreshAt,
  state.lastProviderUpdatedAt,
  state.incrementalSince,
  state.incrementalNextPage,
  state.incrementalMaxUpdatedAt);
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
  clauses.push('archived = 0');
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
