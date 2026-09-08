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
import { db } from '../persistence/conversation';

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
}

export type CreateArtifactInput = CreateAttachmentInput | CreateGeneratedArtifactInput | CreateDerivedArtifactInput;

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
  includeData?: boolean;
}

export interface ArtifactRepository {
  create(input: CreateArtifactInput): Promise<Artifact>;
  get(id: string): Promise<Artifact>;
  list(options?: ListArtifactsOptions): Promise<Artifact[]>;
  updateMetadata(id: string, patch: ArtifactMetadataPatch): Promise<Artifact>;
  setStatus(id: string, status: ArtifactStatus, error?: { code?: string; message?: string }): Promise<Artifact>;
  attachToMessage(artifactId: string, messageId: string, conversationId: string): Promise<void>;
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

async function artifactFromStored(metadata: StoredArtifactMetadata, data: Blob | ArrayBuffer | undefined): Promise<Artifact> {
  const hydrated = await hydrateBlob(data, metadata.mimeType);
  if (metadata.artifactType === 'attachment') {
    if (!hydrated) throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The attachment data is unavailable.');
    return { ...metadata, artifactType: 'attachment', kind: metadata.kind ?? 'unknown', data: hydrated } satisfies Attachment;
  }
  if (metadata.artifactType === 'generated') {
    return { ...metadata, artifactType: 'generated', provenance: 'generated_tool', outputBlob: hydrated } satisfies GeneratedArtifact;
  }
  return { ...metadata, artifactType: 'derived', provenance: 'derived_transformation', parentArtifactIds: metadata.parentArtifactIds ?? [], transformation: metadata.transformation ?? 'unknown', outputBlob: hydrated } satisfies DerivedArtifact;
}

async function readStoredArtifact(id: string): Promise<Artifact> {
  const metadata = await db.artifactMetadata.get(id);
  if (!metadata) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
  const blob = await db.artifactBlobs.get(id);
  return artifactFromStored(metadata, blob?.data);
}

function messageRefs(message: { attachments?: string[]; artifacts?: string[] }, artifact: Artifact): string[] {
  return artifact.artifactType === 'attachment' ? [...(message.attachments ?? [])] : [...(message.artifacts ?? [])];
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
        await db.artifactMetadata.add(metadata);
        if (persistedData) await db.artifactBlobs.add({ id: artifactId, data: persistedData });
      });
      return artifactFromStored(metadata, data);
    } catch (cause) {
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The artifact could not be saved locally.', cause);
    }
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
      const blob = options.includeData ? (await db.artifactBlobs.get(item.id))?.data : undefined;
      if (item.artifactType === 'attachment' && !blob) return artifactFromStored(item, new Blob());
      return artifactFromStored(item, blob);
    }));
  },

  async updateMetadata(id, patch) {
    const existing = await db.artifactMetadata.get(id);
    if (!existing) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
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
    const persistedOutput = patch.outputBlob ? await blobToArrayBuffer(patch.outputBlob) : undefined;
    await db.transaction('rw', db.artifactMetadata, db.artifactBlobs, async () => {
      await db.artifactMetadata.put(next);
      if (persistedOutput) await db.artifactBlobs.put({ id, data: persistedOutput });
    });
    return readStoredArtifact(id);
  },

  async setStatus(id, status, error) {
    const existing = await db.artifactMetadata.get(id);
    if (!existing) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
    await db.artifactMetadata.put({
      ...existing,
      status,
      errorCode: error?.code,
      errorMessage: error?.message?.slice(0, 500),
    });
    return readStoredArtifact(id);
  },

  async attachToMessage(artifactId, messageId, conversationId) {
    const artifact = await readStoredArtifact(artifactId);
    const message = await db.messages.get(messageId);
    if (!message || message.conversationId !== conversationId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'The target message is unavailable.');
    const refs = messageRefs(message, artifact);
    if (!refs.includes(artifactId)) refs.push(artifactId);
    if (artifact.artifactType === 'attachment') {
      if (refs.length > ARTIFACT_LIMITS.maxAttachmentsPerMessage) throw new ArtifactError('FILE_TOO_LARGE', `A message can include at most ${ARTIFACT_LIMITS.maxAttachmentsPerMessage} attachments.`);
      const referenced = await Promise.all(refs.map((ref) => db.artifactMetadata.get(ref)));
      const totalBytes = referenced.reduce((total, item) => total + (item?.size ?? 0), 0);
      if (totalBytes > ARTIFACT_LIMITS.maxMessageAttachmentBytes) throw new ArtifactError('FILE_TOO_LARGE', 'The message attachment total is too large.');
    }
    const next = artifact.artifactType === 'attachment' ? { ...message, attachments: refs } : { ...message, artifacts: refs };
    await db.messages.put(next);
  },

  async detachFromMessage(artifactId, messageId, conversationId) {
    const message = await db.messages.get(messageId);
    if (!message || message.conversationId !== conversationId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'The target message is unavailable.');
    const next: typeof message = {
      ...message,
      attachments: message.attachments?.filter((id) => id !== artifactId),
      artifacts: message.artifacts?.filter((id) => id !== artifactId),
    };
    if (!next.attachments?.length) delete next.attachments;
    if (!next.artifacts?.length) delete next.artifacts;
    await db.messages.put(next);
  },

  async delete(id) {
    const metadata = await db.artifactMetadata.get(id);
    if (!metadata) throw new ArtifactError('ARTIFACT_NOT_FOUND', 'That artifact is no longer available.');
    try {
      await db.transaction('rw', db.artifactMetadata, db.artifactBlobs, db.messages, async () => {
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
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'The artifact could not be deleted.', cause);
    }
  },
};
