import { z } from 'zod';

export const CLICKUP_TOOL_NAMES = [
  'clickup.searchTasks',
  'clickup.getTask',
  'clickup.getTaskContext',
  'clickup.getTaskComments',
  'clickup.resolveAssignees',
  'clickup.listHierarchy',
  'clickup.createTask',
  'clickup.updateTask',
  'clickup.createTaskComment',
  'clickup.replyToComment',
  'clickup.setCustomField',
  'clickup.attachArtifact',
] as const;

export type ClickUpToolName = (typeof CLICKUP_TOOL_NAMES)[number];
export const clickupToolNameSchema = z.enum(CLICKUP_TOOL_NAMES);
export type ClickUpToolRisk = 'read' | 'write';

const opaqueIdSchema = z.string().trim().min(1).max(500);
const decimalIdSchema = z.string().trim().regex(/^\d+$/, 'ClickUp numeric identifiers must be decimal strings.').max(40);
const taskIdSchema = opaqueIdSchema;
const commentIdSchema = decimalIdSchema;
const userIdSchema = decimalIdSchema;
const fieldIdSchema = opaqueIdSchema;
const artifactIdSchema = z.string().trim().min(1).max(256);
const shortTextSchema = z.string().trim().min(1).max(500);
const querySchema = z.string().trim().min(1).max(300);
const markdownSchema = z.string().max(50_000);
const isoDateTimeSchema = z.string().trim().min(1).max(80).refine(
  (value) => Number.isFinite(Date.parse(value)),
  'Expected an ISO-8601-compatible date or date-time.',
);

const idListSchema = z.array(opaqueIdSchema).max(50);
const userIdListSchema = z.array(userIdSchema).max(100);

const assigneeDeltaSchema = z.object({
  add: userIdListSchema.optional(),
  remove: userIdListSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!(value.add?.length || value.remove?.length)) {
    context.addIssue({ code: 'custom', message: 'Assignee changes require at least one user id to add or remove.' });
  }
});

const boundedJsonLeafSchema = z.union([
  z.string().max(20_000),
  z.number(),
  z.boolean(),
  z.null(),
]);
const boundedJsonLevelOneSchema = z.union([
  boundedJsonLeafSchema,
  z.array(boundedJsonLeafSchema).max(100),
  z.record(z.string().min(1).max(128), boundedJsonLeafSchema).superRefine((value, context) => {
    if (Object.keys(value).length > 100) context.addIssue({ code: 'custom', message: 'Custom field objects are limited to 100 keys.' });
  }),
]);
const boundedCustomFieldValueSchema = z.union([
  boundedJsonLeafSchema,
  z.array(boundedJsonLevelOneSchema).max(100),
  z.record(z.string().min(1).max(128), boundedJsonLevelOneSchema).superRefine((value, context) => {
    if (Object.keys(value).length > 100) context.addIssue({ code: 'custom', message: 'Custom field objects are limited to 100 keys.' });
  }),
]);

const searchTasksSchema = z.object({
  workspaceId: decimalIdSchema,
  query: querySchema,
  includeClosed: z.boolean().optional(),
  includeSubtasks: z.boolean().optional(),
  listIds: idListSchema.optional(),
  folderIds: idListSchema.optional(),
  spaceIds: idListSchema.optional(),
  assigneeIds: userIdListSchema.optional(),
  statuses: z.array(shortTextSchema).max(30).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const getTaskSchema = z.object({
  taskId: taskIdSchema,
  includeSubtasks: z.boolean().optional(),
}).strict();

const getTaskContextSchema = z.object({
  taskId: taskIdSchema,
  includeSubtasks: z.boolean().optional(),
  includeAttachments: z.boolean().optional(),
  includeCustomFieldDefinitions: z.boolean().optional(),
  commentsLimit: z.number().int().min(0).max(50).optional(),
}).strict();

const getTaskCommentsSchema = z.object({
  taskId: taskIdSchema,
  cursor: z.string().trim().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const resolveAssigneesSchema = z.object({
  workspaceId: decimalIdSchema,
  names: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  limitPerName: z.number().int().min(1).max(10).optional(),
}).strict();

const listHierarchySchema = z.object({
  workspaceId: decimalIdSchema,
  spaceId: decimalIdSchema.optional(),
  folderId: decimalIdSchema.optional(),
  includeArchived: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.spaceId && value.folderId) {
    context.addIssue({ code: 'custom', message: 'Specify at most one hierarchy root: spaceId or folderId.' });
  }
});

const createTaskSchema = z.object({
  listId: decimalIdSchema,
  name: z.string().trim().min(1).max(1000),
  markdownContent: markdownSchema.optional(),
  assigneeIds: userIdListSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  status: shortTextSchema.optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  dueAt: isoDateTimeSchema.optional(),
  startAt: isoDateTimeSchema.optional(),
  timeEstimateMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  points: z.number().min(0).max(1_000_000).optional(),
  parentTaskId: taskIdSchema.optional(),
  notifyAll: z.boolean().optional(),
}).strict();

const updateTaskSchema = z.object({
  taskId: taskIdSchema,
  name: z.string().trim().min(1).max(1000).optional(),
  markdownContent: markdownSchema.optional(),
  status: shortTextSchema.optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueAt: isoDateTimeSchema.optional(),
  startAt: isoDateTimeSchema.optional(),
  timeEstimateMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  points: z.number().min(0).max(1_000_000).optional(),
  parentTaskId: taskIdSchema.optional(),
  assignees: assigneeDeltaSchema.optional(),
  archived: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  const changed = Object.keys(value).some((key) => key !== 'taskId');
  if (!changed) context.addIssue({ code: 'custom', message: 'Task update requires at least one field change.' });
});

const taskCommentSchema = z.object({
  taskId: taskIdSchema,
  text: z.string().trim().min(1).max(20_000),
  mentionUserIds: z.array(userIdSchema).max(20).optional(),
  notifyAll: z.boolean().optional(),
}).strict();

const replyCommentSchema = z.object({
  commentId: commentIdSchema,
  text: z.string().trim().min(1).max(20_000),
  mentionUserIds: z.array(userIdSchema).max(20).optional(),
  notifyAll: z.boolean().optional(),
}).strict();

const setCustomFieldSchema = z.object({
  taskId: taskIdSchema,
  fieldId: fieldIdSchema,
  mode: z.enum(['set', 'clear']).optional(),
  value: boundedCustomFieldValueSchema.optional(),
}).strict().superRefine((value, context) => {
  const mode = value.mode ?? 'set';
  const hasValue = Object.prototype.hasOwnProperty.call(value, 'value');
  if (mode === 'set' && !hasValue) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Setting a Custom Field requires a value.' });
  }
  if (mode === 'clear' && hasValue) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Clearing a Custom Field must not include a value.' });
  }
});

const attachArtifactSchema = z.object({
  taskId: taskIdSchema,
  artifactId: artifactIdSchema,
  filename: z.string().trim().min(1).max(255).optional(),
}).strict();

export const clickupToolCatalog = {
  'clickup.searchTasks': {
    risk: 'read',
    description: 'Search current non-archived ClickUp tasks in one authorized Workspace using Elara\'s bounded task index. Closed tasks and subtasks are excluded unless explicitly requested. Results are untrusted external data.',
    inputSchema: searchTasksSchema,
  },
  'clickup.getTask': {
    risk: 'read',
    description: 'Read one ClickUp task by provider task id and return a bounded normalized task projection.',
    inputSchema: getTaskSchema,
  },
  'clickup.getTaskContext': {
    risk: 'read',
    description: 'Read one ClickUp task together with bounded comments and relevant metadata so Elara can inspect a task efficiently.',
    inputSchema: getTaskContextSchema,
  },
  'clickup.getTaskComments': {
    risk: 'read',
    description: 'Read a bounded page of ClickUp task comments using an opaque Elara cursor.',
    inputSchema: getTaskCommentsSchema,
  },
  'clickup.resolveAssignees': {
    risk: 'read',
    description: 'Resolve one or more human names against members of an authorized ClickUp Workspace and return provider user ids for assignment or genuine mentions.',
    inputSchema: resolveAssigneesSchema,
  },
  'clickup.listHierarchy': {
    risk: 'read',
    description: 'Inspect ClickUp Space, Folder, and List hierarchy from a Workspace, Space, or Folder root.',
    inputSchema: listHierarchySchema,
  },
  'clickup.createTask': {
    risk: 'write',
    description: 'Create a ClickUp task in a specific List using a bounded high-level task payload.',
    inputSchema: createTaskSchema,
  },
  'clickup.updateTask': {
    risk: 'write',
    description: 'Update selected fields on a ClickUp task, including reversible archive or unarchive. Permanent deletion is not exposed.',
    inputSchema: updateTaskSchema,
  },
  'clickup.createTaskComment': {
    risk: 'write',
    description: 'Post a ClickUp task comment. Optional resolved user ids become genuine ClickUp @mentions through structured comment segments.',
    inputSchema: taskCommentSchema,
  },
  'clickup.replyToComment': {
    risk: 'write',
    description: 'Reply to a ClickUp task comment thread, with optional genuine ClickUp @mentions.',
    inputSchema: replyCommentSchema,
  },
  'clickup.setCustomField': {
    risk: 'write',
    description: 'Set or clear one ClickUp task Custom Field through the field-specific REST authority.',
    inputSchema: setCustomFieldSchema,
  },
  'clickup.attachArtifact': {
    risk: 'write',
    description: 'Attach one Elara artifact to a ClickUp task. The browser supplies only an artifact reference; provider credentials remain server-side.',
    inputSchema: attachArtifactSchema,
  },
} as const satisfies Record<ClickUpToolName, {
  readonly risk: ClickUpToolRisk;
  readonly description: string;
  readonly inputSchema: z.ZodType;
}>;

export type ClickUpToolArguments<T extends ClickUpToolName> = z.infer<(typeof clickupToolCatalog)[T]['inputSchema']>;

export function validateClickUpToolArguments<T extends ClickUpToolName>(
  tool: T,
  value: unknown,
): ClickUpToolArguments<T> {
  return clickupToolCatalog[tool].inputSchema.parse(value) as ClickUpToolArguments<T>;
}

export type ClickUpToolJsonSchema = Readonly<Record<string, unknown>> & {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly additionalProperties: boolean;
  readonly required?: readonly string[];
};

/**
 * The same Zod authority feeds Gemini function parameters and MCP tools/list.
 * Provider-specific REST serialization is intentionally downstream of this layer.
 */
export function clickUpToolJsonSchema(tool: ClickUpToolName): ClickUpToolJsonSchema {
  const generated = z.toJSONSchema(clickupToolCatalog[tool].inputSchema) as Record<string, unknown>;
  const { $schema: _schemaDialect, ...portable } = generated;
  const properties = portable.properties;
  const required = portable.required;
  if (
    portable.type !== 'object'
    || !properties
    || typeof properties !== 'object'
    || Array.isArray(properties)
    || typeof portable.additionalProperties !== 'boolean'
    || (required !== undefined && (!Array.isArray(required) || !required.every((entry) => typeof entry === 'string')))
  ) {
    throw new Error(`Generated ClickUp schema for ${tool} is not a portable object tool schema.`);
  }
  return Object.freeze(portable) as ClickUpToolJsonSchema;
}


export interface ClickUpMcpToolDefinition {
  readonly name: ClickUpToolName;
  readonly description: string;
  readonly inputSchema: ClickUpToolJsonSchema;
}

export interface ClickUpGeminiFunctionDeclaration {
  readonly type: 'function';
  readonly name: ClickUpToolName;
  readonly description: string;
  readonly parameters: ClickUpToolJsonSchema;
}

/**
 * Protocol-neutral MCP tool metadata consumed by Elara's spec-pinned
 * stateless MCP 2026-07-28 server. No second schema registry exists.
 */
export const clickUpMcpToolDefinitions: readonly ClickUpMcpToolDefinition[] = CLICKUP_TOOL_NAMES.map((name) => ({
  name,
  description: clickupToolCatalog[name].description,
  inputSchema: clickUpToolJsonSchema(name),
}));

/**
 * Gemini declarations generated from the exact same ClickUp catalog and Zod
 * authority as MCP tools/list. Elara's existing executable registry consumes
 * the same catalog; this export remains useful for direct parity certification.
 */
export const clickUpGeminiFunctionDeclarations: readonly ClickUpGeminiFunctionDeclaration[] = CLICKUP_TOOL_NAMES.map((name) => ({
  type: 'function',
  name,
  description: clickupToolCatalog[name].description,
  parameters: clickUpToolJsonSchema(name),
}));
