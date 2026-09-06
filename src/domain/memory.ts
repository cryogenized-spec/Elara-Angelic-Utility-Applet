export const MEMORY_KINDS = ['CORE', 'CONTEXTUAL', 'EPISODIC', 'MICRO_OBSERVATION'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_LIFECYCLES = ['active', 'dormant', 'archived'] as const;
export type MemoryLifecycle = (typeof MEMORY_LIFECYCLES)[number];

export interface DurableMemory {
  id: string;
  kind: MemoryKind;
  lifecycle: MemoryLifecycle;
  content: string;
  folderId: string | null;
  confidence: number;
  importance: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  lastRecalledAt: number | null;
  recallCount: number;
  reinforcementCount: number;
  tags: string[];
  provenance: string;
}

export interface MemoryInput {
  kind?: MemoryKind;
  content: string;
  folderId?: string | null;
  confidence?: number;
  importance?: number;
  expiresAt?: number | null;
  tags?: string[];
  provenance?: string;
}

export interface MemoryRetrievalScope {
  folderId?: string | null;
  includeGlobal?: boolean;
  now?: number;
  maxItems?: number;
  maxCharacters?: number;
  query?: string;
}

export interface RetrievedMemory extends DurableMemory {
  score: number;
}
