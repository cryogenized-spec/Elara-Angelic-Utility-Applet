import { z } from 'zod';
import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_MAX_TAGS,
  MEMORY_TAG_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
} from './normalize';
import type { MemoryPermission } from './permissions';

export const MEMORY_TOOL_NAMES = [
  'memory.save',
  'memory.observe',
  'memory.consolidate',
  'memory.forget',
  'memory.delete',
] as const;
export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];
export type MemoryToolExposure = 'gemini' | 'internal';

export interface MemoryToolDescriptor {
  readonly name: MemoryToolName;
  readonly permission: MemoryPermission;
  readonly exposure: MemoryToolExposure;
  readonly description: string;
}

/**
 * Central memory-tool boundary. The tool → permission mapping lives here
 * exactly once. Future memory.observe / memory.consolidate / memory.forget /
 * memory.delete tools graduate by flipping `exposure`, never by adding
 * per-tool authorization rules — the memory permission policy stays the single
 * authorization oracle.
 */
export const memoryToolRegistry: readonly MemoryToolDescriptor[] = [
  {
    name: 'memory.save',
    permission: 'save',
    exposure: 'gemini',
    description:
      "Save a durable memory to Elara's long-term notebook. Use deliberately for information likely to remain useful across conversations: stable preferences, recurring habits, important constraints, ongoing projects, significant people or relationships, meaningful events, schedules, or durable facts. Never store trivial, transient, redundant, or inappropriate details, and never treat every statement as permanent memory. An explicit user request to remember something is a strong signal to save; an explicit request not to remember must never produce a save.",
  },
  {
    name: 'memory.observe',
    permission: 'observe',
    exposure: 'internal',
    description: 'Record a micro-observation as evidence. Internal only; no Gemini-visible tool yet.',
  },
  {
    name: 'memory.consolidate',
    permission: 'consolidate',
    exposure: 'internal',
    description: 'Consolidate an observation into an established memory. Internal only; no Gemini-visible tool yet.',
  },
  {
    name: 'memory.forget',
    permission: 'forget',
    exposure: 'internal',
    description: 'Archive a memory. Internal only; model forget is denied by default policy.',
  },
  {
    name: 'memory.delete',
    permission: 'delete',
    exposure: 'internal',
    description: 'Permanently delete a memory. Internal only; model delete is denied by default policy.',
  },
];

export const memoryToolNameSchema = z.enum(MEMORY_TOOL_NAMES);

export function isMemoryToolName(value: string): value is MemoryToolName {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * The model may only propose established-knowledge kinds through memory.save.
 * MICRO_OBSERVATION is the evidence layer with its own later operational
 * pathway and is structurally rejected here.
 */
export const MEMORY_SAVE_KINDS = ['CORE', 'CONTEXTUAL', 'EPISODIC'] as const;

/**
 * Strict model-facing arguments for memory.save. Only semantic fields the
 * model should control are accepted; `.strict()` rejects every
 * application-owned field (id, timestamps, source, folderId, lifecycle,
 * provenance, relationships, supersession, reinforcement, expiry, …).
 */
export const memorySaveToolArgsSchema = z
  .object({
    title: z.string().trim().min(1, 'Memory title is required.').max(MEMORY_TITLE_MAX_LENGTH),
    body: z.string().trim().min(1, 'Memory body is required.').max(MEMORY_BODY_MAX_LENGTH),
    kind: z.enum(MEMORY_SAVE_KINDS).optional(),
    tags: z.array(z.string().trim().min(1).max(MEMORY_TAG_MAX_LENGTH)).max(MEMORY_MAX_TAGS).optional(),
  })
  .strict();

export type MemorySaveToolArgs = z.infer<typeof memorySaveToolArgsSchema>;

export interface MemoryFunctionDeclaration {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly additionalProperties: boolean;
    readonly required?: readonly string[];
  };
}

const SAVE_PARAMETERS: Record<string, unknown> = {
  title: { type: 'string', description: 'Short durable-memory title.' },
  body: { type: 'string', description: 'The memory note in Elara\'s own understanding of the conversation.' },
  kind: {
    type: 'string',
    enum: [...MEMORY_SAVE_KINDS],
    description: 'Optional kind: CORE for foundational facts, CONTEXTUAL for ongoing context, EPISODIC for notable events.',
  },
  tags: { type: 'array', items: { type: 'string' }, description: 'Optional lowercase tags.' },
};

export const memoryGeminiFunctionDeclarations: readonly MemoryFunctionDeclaration[] = memoryToolRegistry
  .filter((descriptor) => descriptor.exposure === 'gemini')
  .map((descriptor) => ({
    type: 'function',
    name: descriptor.name,
    description: descriptor.description,
    parameters: {
      type: 'object',
      properties: descriptor.name === 'memory.save' ? SAVE_PARAMETERS : {},
      additionalProperties: false,
      ...(descriptor.name === 'memory.save' ? { required: ['title', 'body'] as const } : {}),
    },
  }));

export function memoryGeminiFunctionNames(): readonly MemoryToolName[] {
  return memoryToolRegistry.filter((descriptor) => descriptor.exposure === 'gemini').map((descriptor) => descriptor.name);
}
