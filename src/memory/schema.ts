import { z } from 'zod';
import { MEMORY_KINDS, MEMORY_LIFECYCLES, MEMORY_SOURCES } from './types';
import { MEMORY_BODY_MAX_LENGTH, MEMORY_MAX_RELATIONSHIPS, MEMORY_MAX_TAGS, MEMORY_TAG_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from './normalize';

export const memoryProvenanceSchema = z.object({
  source: z.enum(MEMORY_SOURCES),
  createdAt: z.number().finite(),
  conversationId: z.string().min(1).max(256).optional(),
  messageId: z.string().min(1).max(256).optional(),
  note: z.string().max(500).optional(),
}).strict();

export const durableMemorySchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(MEMORY_KINDS),
  title: z.string().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  body: z.string().min(1).max(MEMORY_BODY_MAX_LENGTH),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  observedAt: z.number().finite(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  lifecycle: z.enum(MEMORY_LIFECYCLES),
  source: memoryProvenanceSchema,
  tags: z.array(z.string().min(1).max(MEMORY_TAG_MAX_LENGTH)).max(MEMORY_MAX_TAGS),
  relatedMemoryIds: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS),
  supportingMemoryIds: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS),
  conflictingMemoryIds: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS),
  supersedes: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS),
  supersededBy: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS),
  reinforcementCount: z.number().int().nonnegative(),
  folderId: z.string().min(1).max(256).nullable(),
  expiresAt: z.number().finite().nullable(),
  lastRecalledAt: z.number().finite().nullable(),
  recallCount: z.number().int().nonnegative(),
}).strict();

export const memoryInputSchema = z.object({
  kind: z.enum(MEMORY_KINDS).optional(),
  title: z.string().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  body: z.string().min(1).max(MEMORY_BODY_MAX_LENGTH),
  observedAt: z.number().finite().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  lifecycle: z.enum(MEMORY_LIFECYCLES).optional(),
  source: memoryProvenanceSchema.optional(),
  tags: z.array(z.string().min(1).max(MEMORY_TAG_MAX_LENGTH)).max(MEMORY_MAX_TAGS).optional(),
  relatedMemoryIds: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS).optional(),
  supportingMemoryIds: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS).optional(),
  conflictingMemoryIds: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS).optional(),
  supersedes: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS).optional(),
  supersededBy: z.array(z.string().min(1)).max(MEMORY_MAX_RELATIONSHIPS).optional(),
  folderId: z.string().min(1).max(256).nullable().optional(),
  expiresAt: z.number().finite().nullable().optional(),
}).strict();
