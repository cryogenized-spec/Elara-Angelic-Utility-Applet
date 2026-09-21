import { z } from 'zod';

export const kanbanToolNameSchema = z.enum([
  'kanban.inspect',
  'kanban.refresh',
  'kanban.locate',
  'kanban.focus',
]);

export type KanbanToolName = z.infer<typeof kanbanToolNameSchema>;

const id = z.string().trim().min(1).max(1024);
const page = {
  offset: z.number().int().min(0).max(20_000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const kanbanToolArgumentSchemas = {
  'kanban.inspect': z.object({
    listId: id.optional(),
    includeCompleted: z.boolean().optional(),
    ...page,
  }).strict(),
  'kanban.refresh': z.object({}).strict(),
  'kanban.locate': z.object({
    query: z.string().trim().min(1).max(200),
    includeCompleted: z.boolean().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }).strict(),
  'kanban.focus': z.object({
    listId: id,
    taskId: id.optional(),
  }).strict(),
} satisfies Record<KanbanToolName, z.ZodTypeAny>;

export function validateKanbanToolArguments(name: KanbanToolName, value: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...kanbanToolArgumentSchemas[name].parse(value) });
}
