import type { MemoryInput, MemoryProvenance } from './types';

export const MEMORY_TITLE_MAX_LENGTH = 160;
export const MEMORY_BODY_MAX_LENGTH = 50_000;
export const MEMORY_TAG_MAX_LENGTH = 64;
export const MEMORY_MAX_TAGS = 32;
export const MEMORY_MAX_RELATIONSHIPS = 64;

export function clampUnitInterval(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

export function normalizeTitle(title: string): string {
  const value = title.trim();
  if (!value) throw new Error('Memory title is required.');
  if (value.length > MEMORY_TITLE_MAX_LENGTH) throw new Error(`Memory title must be ${MEMORY_TITLE_MAX_LENGTH} characters or fewer.`);
  return value;
}

export function normalizeBody(body: string): string {
  const value = body.trim();
  if (!value) throw new Error('Memory body is required.');
  if (value.length > MEMORY_BODY_MAX_LENGTH) throw new Error(`Memory body must be ${MEMORY_BODY_MAX_LENGTH} characters or fewer.`);
  return value;
}

export function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? [])
    .map((tag) => tag.trim().toLocaleLowerCase())
    .filter(Boolean)
    .map((tag) => tag.slice(0, MEMORY_TAG_MAX_LENGTH)))]
    .slice(0, MEMORY_MAX_TAGS);
}

export function normalizeIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))].slice(0, MEMORY_MAX_RELATIONSHIPS);
}

export function normalizeProvenance(provenance: MemoryProvenance, fallbackNow: number): MemoryProvenance {
  const source = provenance.source;
  return {
    source,
    createdAt: Number.isFinite(provenance.createdAt) ? provenance.createdAt : fallbackNow,
    ...(provenance.conversationId?.trim() ? { conversationId: provenance.conversationId.trim() } : {}),
    ...(provenance.messageId?.trim() ? { messageId: provenance.messageId.trim() } : {}),
    ...(provenance.note?.trim() ? { note: provenance.note.trim().slice(0, 500) } : {}),
  };
}

export function normalizeMemoryInput(input: MemoryInput, now: number): MemoryInput {
  return {
    kind: input.kind ?? 'CONTEXTUAL',
    title: normalizeTitle(input.title),
    body: normalizeBody(input.body),
    observedAt: Number.isFinite(input.observedAt) ? input.observedAt : now,
    confidence: clampUnitInterval(input.confidence ?? 0.7, 0.7),
    importance: clampUnitInterval(input.importance ?? 0.5, 0.5),
    lifecycle: input.lifecycle ?? 'active',
    source: normalizeProvenance(input.source ?? { source: 'user', createdAt: now }, now),
    tags: normalizeTags(input.tags),
    relatedMemoryIds: normalizeIds(input.relatedMemoryIds),
    supportingMemoryIds: normalizeIds(input.supportingMemoryIds),
    conflictingMemoryIds: normalizeIds(input.conflictingMemoryIds),
    supersedes: normalizeIds(input.supersedes),
    supersededBy: normalizeIds(input.supersededBy),
    folderId: input.folderId?.trim() || null,
    expiresAt: input.expiresAt ?? null,
  };
}
