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
export type MemoryToolArguments = MemoryLookupToolArguments | MemorySaveToolArguments | MemoryReconcileToolArguments;

export function validateMemoryToolArguments(tool: 'memory.lookup', value: unknown): MemoryLookupToolArguments;
export function validateMemoryToolArguments(tool: 'memory.save', value: unknown): MemorySaveToolArguments;
export function validateMemoryToolArguments(tool: 'memory.reconcile', value: unknown): MemoryReconcileToolArguments;
export function validateMemoryToolArguments(tool: MemoryToolName, value: unknown): MemoryToolArguments {
  return memoryToolArgumentSchemas[tool].parse(value) as MemoryToolArguments;
}
