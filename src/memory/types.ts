export const MEMORY_KINDS = ['CORE', 'CONTEXTUAL', 'EPISODIC', 'MICRO_OBSERVATION'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_LIFECYCLES = ['active', 'dormant', 'archived'] as const;
export type MemoryLifecycle = (typeof MEMORY_LIFECYCLES)[number];

export const MEMORY_SOURCES = ['user', 'elara', 'import', 'migration'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export interface MemoryProvenance {
  source: MemorySource;
  createdAt: number;
  conversationId?: string;
  messageId?: string;
  note?: string;
}

export interface DurableMemory {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  observedAt: number;
  confidence: number;
  importance: number;
  lifecycle: MemoryLifecycle;
  source: MemoryProvenance;
  tags: string[];
  relatedMemoryIds: string[];
  supportingMemoryIds: string[];
  conflictingMemoryIds: string[];
  supersedes: string[];
  supersededBy: string[];
  reinforcementCount: number;
  folderId: string | null;
  expiresAt: number | null;
  lastRecalledAt: number | null;
  recallCount: number;
}

export interface MemoryInput {
  kind?: MemoryKind;
  title: string;
  body: string;
  observedAt?: number;
  confidence?: number;
  importance?: number;
  lifecycle?: MemoryLifecycle;
  source?: MemoryProvenance;
  tags?: string[];
  relatedMemoryIds?: string[];
  supportingMemoryIds?: string[];
  conflictingMemoryIds?: string[];
  supersedes?: string[];
  supersededBy?: string[];
  folderId?: string | null;
  expiresAt?: number | null;
}

export interface MemoryRetrievalScope {
  folderId?: string | null;
  folderIds?: string[];
  includeGlobal?: boolean;
  now?: number;
  maxItems?: number;
  maxCharacters?: number;
  query?: string;
}

export interface RetrievedMemory extends DurableMemory {
  score: number;
}
