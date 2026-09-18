import { z } from 'zod';
import { MEMORY_TAG_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from './normalize';

export const MEMORY_TOOL_BODY_MAX_LENGTH = 4_000;
export const MEMORY_TOOL_MAX_TAGS = 12;
export const MEMORY_LOOKUP_QUERY_MAX_LENGTH = 500;
export const MEMORY_LOOKUP_REF_MAX_LENGTH = 96;

const toolTagsSchema = z.array(z.string().min(1).max(MEMORY_TAG_MAX_LENGTH)).max(MEMORY_TOOL_MAX_TAGS).optional();

export const memoryLookupToolArgumentsSchema = z.object({
  query: z.string().min(1).max(MEMORY_LOOKUP_QUERY_MAX_LENGTH),
}).strict();

export const memorySaveToolArgumentsSchema = z.object({
  title: z.string().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  body: z.string().min(1).max(MEMORY_TOOL_BODY_MAX_LENGTH),
  kind: z.enum(['CONTEXTUAL', 'EPISODIC']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: toolTagsSchema,
}).strict();

export const memoryReconcileToolArgumentsSchema = z.object({
  targetRef: z.string().min(1).max(MEMORY_LOOKUP_REF_MAX_LENGTH),
  relation: z.enum(['support', 'conflict', 'related', 'supersede']),
  title: z.string().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  body: z.string().min(1).max(MEMORY_TOOL_BODY_MAX_LENGTH),
  tags: toolTagsSchema,
}).strict();

export const memoryToolArgumentSchemas = {
  'memory.lookup': memoryLookupToolArgumentsSchema,
  'memory.save': memorySaveToolArgumentsSchema,
  'memory.reconcile': memoryReconcileToolArgumentsSchema,
} as const;

export type MemoryToolName = keyof typeof memoryToolArgumentSchemas;
export type MemoryLookupToolArguments = z.infer<typeof memoryLookupToolArgumentsSchema>;
export type MemorySaveToolArguments = z.infer<typeof memorySaveToolArgumentsSchema>;
export type MemoryReconcileToolArguments = z.infer<typeof memoryReconcileToolArgumentsSchema>;
export interface MemoryToolArgumentsByName {
  'memory.lookup': MemoryLookupToolArguments;
  'memory.save': MemorySaveToolArguments;
  'memory.reconcile': MemoryReconcileToolArguments;
}
export type MemoryToolArguments = MemoryToolArgumentsByName[MemoryToolName];

/** Preserve the exact argument type for literal callers while allowing union dispatch in the central executor. */
export function validateMemoryToolArguments<T extends MemoryToolName>(tool: T, value: unknown): MemoryToolArgumentsByName[T] {
  return memoryToolArgumentSchemas[tool].parse(value) as MemoryToolArgumentsByName[T];
}
