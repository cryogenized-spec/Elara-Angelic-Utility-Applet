import type { ChatMessage } from '../domain/chat';
import type {
  Artifact,
  ArtifactStatus,
  Attachment,
  AttachmentKind,
  DerivedArtifact,
  GeneratedArtifact,
  SourceCodeLanguage,
  StoredArtifactMetadata,
} from '../domain/artifact';
import { ArtifactError } from './errors';
import { ARTIFACT_LIMITS } from './limits';
import { db, loadConversation } from '../persistence/conversation';

export interface CreateAttachmentInput {
  artifactType: 'attachment';
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  data: Blob;
  provenance?: Attachment['provenance'];
  status?: ArtifactStatus;
  remoteRef?: Attachment['remoteRef'];
}

export interface CreateGeneratedArtifactInput {
  artifactType: 'generated';
  name: string;
  mimeType: string;
  outputBlob?: Blob;
  sourceCode?: { language: SourceCodeLanguage; content: string };
  compilationLog?: string;
  parentArtifactIds?: string[];
  sourceMessageId?: string;
  toolName?: string;
  status?: ArtifactStatus;
  operationId?: string;
}

export interface CreateDerivedArtifactInput {
  artifactType: 'derived';
  name: string;
  mimeType: string;
  outputBlob?: Blob;
  sourceCode?: { language: SourceCodeLanguage; content: string };
  parentArtifactIds: string[];
  transformation: string;
  sourceMessageId?: string;
  status?: ArtifactStatus;
  operationId?: string;
}

export type CreateArtifactInput = CreateAttachmentInput | CreateGeneratedArtifactInput | CreateDerivedArtifactInput;

export interface ArtifactOperationGuard {
  operationId: string;
  expectedStatus?: ArtifactStatus;
  /** Evaluated inside the transaction immediately before durable writes. */
  isValid?: () => boolean;
}

export interface ArtifactMetadataPatch {
  name?: string;
  mimeType?: string;
  outputBlob?: Blob;
  remoteRef?: Attachment['remoteRef'] | null;
  sourceCode?: { language: SourceCodeLanguage; content: string };
  compilationLog?: string;
  parentArtifactIds?: string[];
  sourceMessageId?: string;
  toolName?: string;
  transformation?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ListArtifactsOptions {
  status?: ArtifactStatus;
  provenance?: Artifact['provenance'];
  sourceMessageId?: string;
}

export interface ArtifactRepository {
  create(input: CreateArtifactInput): Promise<Artifact>;
  get(id: string): Promise<Artifact>;
  list(options?: ListArtifactsOptions): Promise<Artifact[]>;
  createAndAttach(input: CreateArtifactInput, messageId: string, conversationId: string, guard?: ArtifactOperationGuard): Promise<Artifact>;
  updateMetadata(id: string, patch: ArtifactMetadataPatch, guard?: ArtifactOperationGuard): Promise<Artifact>;
  beginOperation(id: string, operationId: string, expectedStatus?: ArtifactStatus): Promise<Artifact>;
  setStatus(id: string, status: ArtifactStatus, error?: { code?: string; message?: string }, guard?: ArtifactOperationGuard): Promise<Artifact>;
  attachToMessage(artifactId: string, messageId: string, conversationId: string): Promise<void>;
  appendMessageWithArtifacts(message: ChatMessage, conversationId: string, artifactIds?: readonly string[]): Promise<import('../domain/chat').ConversationState>;
  detachFromMessage(artifactId: string, messageId: string, conversationId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

function id(): string {
  return crypto.randomUUID();
}

function safeName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'Untitled artifact').slice(0, ARTIFACT_LIMITS.maxFilenameLength);
}

function safeMimeType(mimeType: string): string {
  const cleaned = mimeType.trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(cleaned) ? cleaned : 'application/octet-stream';
}

function safeSourceCode(sourceCode: CreateGeneratedArtifactInput['sourceCode'] | CreateDerivedArtifactInput['sourceCode']): CreateGeneratedArtifactInput['sourceCode'] {
  if (!sourceCode) return undefined;
  return { language: sourceCode.language, content: sourceCode.content.slice(0, ARTIFACT_LIMITS.maxGeneratedSourceCharacters) };
}

function metadataFromInput(artifactId: string, input: CreateArtifactInput, now: number): StoredArtifactMetadata {
  if (input.artifactType === 'derived') {
    return {
      id: artifactId,
      artifactType: 'derived',
      operationId: input.operationId,
      name: safeName(input.name),
      mimeType: safeMimeType(input.mimeType),
      size: input.outputBlob?.size ?? input.sourceCode?.content.length ?? 0,
      createdAt: now,
      provenance: 'derived_transformation',
      status: input.status ?? 'pending',
      sourceCode: safeSourceCode(input.sourceCode),
      parentArtifactIds: [...input.parentArtifactIds],
      transformation: input.transformation.slice(0, 160),
      sourceMessageId: input.sourceMessageId,
    };
  }

  if (input.artifactType === 'generated') {
    return {
      id: artifactId,
      artifactType: 'generated',
      operationId: input.operationId,
      name: safeName(input.name),
      mimeType: safeMimeType(input.mimeType),
      size: input.outputBlob?.size ?? input.sourceCode?.content.length ?? 0,
      createdAt: now,
      provenance: 'generated_tool',
      status: input.status ?? 'pending',
      sourceCode: safeSourceCode(input.sourceCode),
      compilationLog: input.compilationLog?.slice(0, ARTIFACT_LIMITS.maxCompilationLogCharacters),
      parentArtifactIds: input.parentArtifactIds ? [...input.parentArtifactIds] : undefined,
      sourceMessageId: input.sourceMessageId,
      toolName: input.toolName?.slice(0, 160),
    };
  }

  return {
    id: artifactId,
    artifactType: 'attachment',
    kind: input.kind,
    name: safeName(input.name),
    mimeType: safeMimeType(input.mimeType),
    size: input.data.size,
    createdAt: now,
    provenance: input.provenance ?? 'user_upload',
    status: input.status ?? 'processing',
    remoteRef: input.remoteRef,
  };
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function canonicalBlob(bytes: ArrayBuffer, mimeType: string): Blob {
  const blob = new Blob([bytes], { type: mimeType }) as Blob & { stream?: () => ReadableStream<Uint8Array> };
  // Some test/browser Blob shims expose arrayBuffer() but not stream(). Keep
  // the domain contract Blob-shaped without allowing a cross-realm clone to
  // escape into consumers such as Response or the Gemini adapter.
  if (typeof blob.stream !== 'function' && typeof Response !== 'undefined') {
    Object.defineProperty(blob, 'stream', { configurable: true, value: () => new Response(bytes).body });
  }
  return blob;
}

async function hydrateBlob(data: Blob | ArrayBuffer | undefined, mimeType: string): Promise<Blob | undefined> {
  if (!data) return undefined;
  if (isArrayBuffer(data)) return canonicalBlob(data, mimeType);
  const candidate = data as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof candidate.arrayBuffer === 'function') return canonicalBlob(await candidate.arrayBuffer(), mimeType);
  if (typeof FileReader !== 'undefined') {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('The artifact data could not be read.'));
      reader.readAsArrayBuffer(data as Blob);
    });
    return canonicalBlob(bytes, mimeType);
  }
  return canonicalBlob(await new Response(data as Blob).arrayBuffer(), mimeType);
}

async function blobToArrayBuffer(data: Blob): Promise<ArrayBuffer> {
  if (typeof data.arrayBuffer === 'function') return data.arrayBuffer();
  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('The artifact data could not be read.'));
      reader.readAsArrayBuffer(data);
    });
  }
  return new Response(data).arrayBuffer();
}

function validateStoredMetadata(metadata: StoredArtifactMetadata): void {
  if (!metadata || typeof metadata.id !== 'string' || typeof metadata.name !== 'string' || typeof metadata.mimeType !== 'string' || !Number.isFinite(metadata.size) || metadata.size < 0) {
    throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'Artifact metadata is corrupt.');
  }
  if (!['attachment', 'generated', 'derived'].includes(metadata.artifactType) || !['pending', 'processing', 'ready', 'failed'].includes(metadata.status)) {
    throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'Artifact metadata has an invalid type or lifecycle status.');
  }
  if (metadata.artifactType === 'attachment' && !metadata.kind) {
    throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'Attachment metadata is missing its kind.');
  }
  if (metadata.artifactType === 'derived' && (!Array.isArray(metadata.parentArtifactIds) || typeof metadata.transformation !== 'string')) {
    throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'Derived artifact lineage metadata is corrupt.');
  }
}

async function artifactFromStored(metadata: StoredArtifactMetadata, data: Blob | ArrayBuffer | undefined): Promise<Artifact> {
  validateStoredMetadata(metadata);
  const hydrated = await hydrateBlob(data, metadata.mimeType);
  if (metadata.artifactType === 'attachment') {
    if (!hydrated) throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The attachment payload is missing.');
    return { ...metadata, artifactType: 'attachment', kind: metadata.kind!, data: hydrated } satisfies Attachment;
  }
  const hasSourcePayload = metadata.mimeType !== 'application/pdf' && typeof metadata.sourceCode?.content === 'string';
  if (metadata.status === 'ready' && !hydrated && !hasSourcePayload) {
    throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'A ready artifact payload is missing.');
  }
  if (metadata.artifactType === 'generated') {
    return { ...metadata, artifactType: 'generated', provenance: 'generated_tool', outputBlob: hydrated } satisfies GeneratedArtifact;
  }
  return { ...metadata, artifactType: 'derived', provenance: 'derived_transformation', parentArtifactIds: metadata.parentArtifactIds!, transformation: metadata.transformation!, outputBlob: hydrated } satisfies DerivedArtifact;
}

async function readStoredArtifact(id: string): Promise<Artifact> {
  const metadata = await db.artifactMetadata.get(id);
  if (!metadata) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
  const blob = await db.artifactBlobs.get(id);
  return artifactFromStored(metadata, blob?.data);
}

async function readStoredArtifactInTransaction(id: string): Promise<Artifact> {
  const metadata = await db.artifactMetadata.get(id);
  if (!metadata) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
  const blob = await db.artifactBlobs.get(id);
  return artifactFromStored(metadata, blob?.data);
}

function uniqueIds(ids: readonly string[] | undefined): string[] {
  return [...new Set(ids ?? [])];
}

async function validateMessageReferences(message: ChatMessage): Promise<{ attachments: string[]; artifacts: string[]; attachmentBytes: number }> {
  const attachments = uniqueIds(message.attachments);
  const artifacts = uniqueIds(message.artifacts);
  let attachmentBytes = 0;
  for (const artifactId of attachments) {
    const artifact = await readStoredArtifactInTransaction(artifactId);
    if (artifact.artifactType !== 'attachment') throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'A message attachment reference has the wrong artifact type.');
    attachmentBytes += artifact.size;
  }
  for (const artifactId of artifacts) {
    const artifact = await readStoredArtifactInTransaction(artifactId);
    if (artifact.artifactType === 'attachment') throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'A message artifact reference has the wrong artifact type.');
  }
  if (attachments.length > ARTIFACT_LIMITS.maxAttachmentsPerMessage) throw new ArtifactError('FILE_TOO_LARGE', `A message can include at most ${ARTIFACT_LIMITS.maxAttachmentsPerMessage} attachments.`);
  if (attachmentBytes > ARTIFACT_LIMITS.maxMessageAttachmentBytes) throw new ArtifactError('FILE_TOO_LARGE', 'The message attachment total is too large.');
  return { attachments, artifacts, attachmentBytes };
}

function operationError(message: string): ArtifactError {
  return new ArtifactError('ARTIFACT_OPERATION_STALE', message);
}

function assertOperation(metadata: StoredArtifactMetadata, guard?: ArtifactOperationGuard): void {
  if (!guard) return;
  if (metadata.operationId !== guard.operationId) throw operationError('The artifact operation is stale.');
  if (guard.expectedStatus && metadata.status !== guard.expectedStatus) throw operationError('The artifact lifecycle state is stale.');
  if (guard.isValid && !guard.isValid()) throw operationError('The artifact operation is stale.');
}

function validStatusTransition(current: ArtifactStatus, next: ArtifactStatus): boolean {
  if (current === 'pending') return next === 'processing' || next === 'ready' || next === 'failed';
  if (current === 'processing') return next === 'ready' || next === 'failed';
  return false;
}

export const artifactRepository: ArtifactRepository = {
  async create(input) {
    const artifactId = id();
    const now = Date.now();
    const metadata = metadataFromInput(artifactId, input, now);
    const data = input.artifactType === 'attachment' ? input.data : input.outputBlob;
    if (data && data.size > ARTIFACT_LIMITS.maxAttachmentBytes && input.artifactType === 'attachment') {
      throw new ArtifactError('FILE_TOO_LARGE', 'This file is too large to add.');
    }
    try {
      const persistedData = data ? await blobToArrayBuffer(data) : undefined;
      await db.transaction('rw', db.artifactMetadata, db.artifactBlobs, async () => {
        if (input.artifactType !== 'attachment') {
          for (const parentId of uniqueIds(input.parentArtifactIds)) await readStoredArtifactInTransaction(parentId);
        }
        await db.artifactMetadata.add(metadata);
        if (persistedData) await db.artifactBlobs.add({ id: artifactId, data: persistedData });
      });
      return artifactFromStored(metadata, data);
    } catch (cause) {
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The artifact could not be saved locally.', cause);
    }
  },

  async createAndAttach(input, messageId, conversationId, guard) {
    const artifactId = id();
    const metadata = metadataFromInput(artifactId, input, Date.now());
    const data = input.artifactType === 'attachment' ? input.data : input.outputBlob;
    if (data && data.size > ARTIFACT_LIMITS.maxAttachmentBytes && input.artifactType === 'attachment') {
      throw new ArtifactError('FILE_TOO_LARGE', 'This file is too large to add.');
    }
    try {
      const persistedData = data ? await blobToArrayBuffer(data) : undefined;
      await db.transaction('rw', db.messages, db.artifactMetadata, db.artifactBlobs, async () => {
        const message = await db.messages.get(messageId);
        if (!message || message.conversationId !== conversationId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'The target message is unavailable.');
        for (const parentId of uniqueIds(input.artifactType === 'attachment' ? [] : input.parentArtifactIds)) await readStoredArtifactInTransaction(parentId);
        const sourceMessageId = input.artifactType === 'attachment' ? undefined : input.sourceMessageId;
        if (sourceMessageId && sourceMessageId !== messageId) throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The source message does not match the target message.');
        assertOperation(metadata, guard);
        await db.artifactMetadata.add(metadata);
        if (persistedData) {
          assertOperation(metadata, guard);
          await db.artifactBlobs.add({ id: artifactId, data: persistedData });
        }
        const next = input.artifactType === 'attachment'
          ? { ...message, attachments: uniqueIds([...(message.attachments ?? []), artifactId]) }
          : { ...message, artifacts: uniqueIds([...(message.artifacts ?? []), artifactId]) };
        const validated = await validateMessageReferences(next);
        assertOperation(metadata, guard);
        await db.messages.put({ ...next, attachments: validated.attachments.length ? validated.attachments : undefined, artifacts: validated.artifacts.length ? validated.artifacts : undefined });
      });
      return readStoredArtifact(artifactId);
    } catch (cause) {
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The artifact could not be created and associated.', cause);
    }
  },

  async appendMessageWithArtifacts(message, conversationId, artifactIds = []) {
    const ids = uniqueIds(artifactIds);
    const storedMessage: ChatMessage = { ...message, conversationId };
    try {
      await db.transaction('rw', db.messages, db.threads, db.artifactMetadata, db.artifactBlobs, async () => {
        const thread = await db.threads.get(conversationId);
        if (!thread) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'Conversation thread not found.');
        if (await db.messages.get(storedMessage.id)) throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The message already exists.');
        const attachments = uniqueIds(storedMessage.attachments);
        const artifacts = uniqueIds(storedMessage.artifacts);
        for (const artifactId of ids) {
          const artifact = await readStoredArtifactInTransaction(artifactId);
          if (artifact.artifactType === 'attachment') attachments.push(artifactId);
          else artifacts.push(artifactId);
        }
        const next: ChatMessage = { ...storedMessage, attachments: uniqueIds(attachments), artifacts: uniqueIds(artifacts) };
        const validated = await validateMessageReferences(next);
        await db.messages.add({ ...next, attachments: validated.attachments.length ? validated.attachments : undefined, artifacts: validated.artifacts.length ? validated.artifacts : undefined });
        await db.threads.update(conversationId, { updatedAt: Date.now() });
      });
    } catch (cause) {
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The message and its artifacts could not be saved atomically.', cause);
    }
    return loadConversation(conversationId);
  },

  async get(id) {
    return readStoredArtifact(id);
  },

  async list(options = {}) {
    const metadata = await db.artifactMetadata.toArray();
    const filtered = metadata.filter((item) =>
      (options.status === undefined || item.status === options.status) &&
      (options.provenance === undefined || item.provenance === options.provenance) &&
      (options.sourceMessageId === undefined || item.sourceMessageId === options.sourceMessageId),
    );
    return Promise.all(filtered.map(async (item) => {
      const blob = (await db.artifactBlobs.get(item.id))?.data;
      return artifactFromStored(item, blob);
    }));
  },

  async updateMetadata(id, patch, guard) {
    const persistedOutput = patch.outputBlob ? await blobToArrayBuffer(patch.outputBlob) : undefined;
    await db.transaction('rw', db.artifactMetadata, db.artifactBlobs, async () => {
      const existing = await db.artifactMetadata.get(id);
      if (!existing) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
      assertOperation(existing, guard);
      const next: StoredArtifactMetadata = {
        ...existing,
        ...(patch.name === undefined ? {} : { name: safeName(patch.name) }),
        ...(patch.mimeType === undefined ? {} : { mimeType: safeMimeType(patch.mimeType) }),
        ...(patch.outputBlob === undefined ? {} : { size: patch.outputBlob.size }),
        ...(patch.remoteRef === undefined ? {} : { remoteRef: patch.remoteRef ?? undefined }),
        ...(patch.sourceCode === undefined ? {} : { sourceCode: safeSourceCode(patch.sourceCode) }),
        ...(patch.compilationLog === undefined ? {} : { compilationLog: patch.compilationLog.slice(0, ARTIFACT_LIMITS.maxCompilationLogCharacters) }),
        ...(patch.parentArtifactIds === undefined ? {} : { parentArtifactIds: [...patch.parentArtifactIds] }),
        ...(patch.sourceMessageId === undefined ? {} : { sourceMessageId: patch.sourceMessageId }),
        ...(patch.toolName === undefined ? {} : { toolName: patch.toolName.slice(0, 160) }),
        ...(patch.transformation === undefined ? {} : { transformation: patch.transformation.slice(0, 160) }),
        ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
        ...(patch.errorMessage === undefined ? {} : { errorMessage: patch.errorMessage.slice(0, 500) }),
      };
      assertOperation(next, guard);
      await db.artifactMetadata.put(next);
      if (persistedOutput) {
        assertOperation(next, guard);
        await db.artifactBlobs.put({ id, data: persistedOutput });
      }
    });
    return readStoredArtifact(id);
  },

  async beginOperation(id, operationId, expectedStatus) {
    await db.transaction('rw', db.artifactMetadata, async () => {
      const existing = await db.artifactMetadata.get(id);
      if (!existing) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
      if (expectedStatus && existing.status !== expectedStatus) throw operationError('The artifact is no longer in the expected lifecycle state.');
      await db.artifactMetadata.put({ ...existing, operationId });
    });
    return readStoredArtifact(id);
  },

  async setStatus(id, status, error, guard) {
    await db.transaction('rw', db.artifactMetadata, async () => {
      const existing = await db.artifactMetadata.get(id);
      if (!existing) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
      assertOperation(existing, guard);
      if (existing.status !== status && !validStatusTransition(existing.status, status)) throw operationError(`Cannot transition an artifact from ${existing.status} to ${status}.`);
      await db.artifactMetadata.put({ ...existing, status, errorCode: error?.code, errorMessage: error?.message?.slice(0, 500) });
    });
    return readStoredArtifact(id);
  },

  async attachToMessage(artifactId, messageId, conversationId) {
    try {
      await db.transaction('rw', db.messages, db.artifactMetadata, db.artifactBlobs, async () => {
        const artifact = await readStoredArtifactInTransaction(artifactId);
        const message = await db.messages.get(messageId);
        if (!message || message.conversationId !== conversationId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'The target message is unavailable.');
        const current = await validateMessageReferences(message);
        const next = artifact.artifactType === 'attachment'
          ? { ...message, attachments: uniqueIds([...current.attachments, artifactId]) }
          : { ...message, artifacts: uniqueIds([...current.artifacts, artifactId]) };
        const validated = await validateMessageReferences(next);
        await db.messages.put({ ...next, attachments: validated.attachments.length ? validated.attachments : undefined, artifacts: validated.artifacts.length ? validated.artifacts : undefined });
      });
    } catch (cause) {
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The message artifact association could not be saved.', cause);
    }
  },

  async detachFromMessage(artifactId, messageId, conversationId) {
    await db.transaction('rw', db.messages, async () => {
      const message = await db.messages.get(messageId);
      if (!message || message.conversationId !== conversationId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'The target message is unavailable.');
      const next: typeof message = { ...message, attachments: message.attachments?.filter((id) => id !== artifactId), artifacts: message.artifacts?.filter((id) => id !== artifactId) };
      if (!next.attachments?.length) delete next.attachments;
      if (!next.artifacts?.length) delete next.artifacts;
      await db.messages.put(next);
    });
  },

  async delete(id) {
    try {
      await db.transaction('rw', db.artifactMetadata, db.artifactBlobs, db.messages, async () => {
        const metadata = await db.artifactMetadata.get(id);
        if (!metadata) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
        const messages = await db.messages.toArray();
        await Promise.all(messages.map((message) => {
          const next = {
            ...message,
            attachments: message.attachments?.filter((ref) => ref !== id),
            artifacts: message.artifacts?.filter((ref) => ref !== id),
          } as typeof message;
          if (!next.attachments?.length) delete next.attachments;
          if (!next.artifacts?.length) delete next.artifacts;
          return db.messages.put(next);
        }));
        await db.artifactBlobs.delete(id);
        await db.artifactMetadata.delete(id);
      });
    } catch (cause) {
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The artifact could not be deleted.', cause);
    }
  },
};
