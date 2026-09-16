import { z } from 'zod';
import { MEMORY_TAG_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from './normalize';

export const MEMORY_TOOL_BODY_MAX_LENGTH = 4_000;
export const MEMORY_TOOL_MAX_TAGS = 12;

export const memorySaveToolArgumentsSchema = z.object({
  title: z.string().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  body: z.string().min(1).max(MEMORY_TOOL_BODY_MAX_LENGTH),
  kind: z.enum(['CONTEXTUAL', 'EPISODIC']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(MEMORY_TAG_MAX_LENGTH)).max(MEMORY_TOOL_MAX_TAGS).optional(),
}).strict();

export const memoryToolArgumentSchemas = {
  'memory.save': memorySaveToolArgumentsSchema,
} as const;

export type MemoryToolName = keyof typeof memoryToolArgumentSchemas;
export type MemorySaveToolArguments = z.infer<typeof memorySaveToolArgumentsSchema>;

export function validateMemoryToolArguments(tool: MemoryToolName, value: unknown): MemorySaveToolArguments {
  return memoryToolArgumentSchemas[tool].parse(value);
}
