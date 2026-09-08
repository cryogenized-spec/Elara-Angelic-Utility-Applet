export type AttachmentKind =
  | 'image'
  | 'document'
  | 'text'
  | 'archive'
  | 'unknown';

export type ArtifactProvenance =
  | 'user_upload'
  | 'generated_tool'
  | 'derived_transformation';

export type ArtifactStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed';

export interface BaseMedia {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

/**
 * Provider handles are deliberately opaque to the artifact domain. A provider
 * adapter may cache a short-lived handle here, but the local Blob remains the
 * canonical representation and no provider SDK types cross this boundary.
 */
export interface ArtifactRemoteRef {
  provider: string;
  fileUri: string;
  expiresAt: number;
}

export interface Attachment extends BaseMedia {
  artifactType: 'attachment';
  kind: AttachmentKind;
  provenance: ArtifactProvenance;
  status: ArtifactStatus;
  data: Blob;
  remoteRef?: ArtifactRemoteRef;
  errorCode?: string;
  errorMessage?: string;
}

export type SourceCodeLanguage = 'lualatex' | 'latex' | 'python' | 'javascript' | 'typescript' | 'json' | 'css' | 'html' | 'markdown' | 'text' | 'svg';

export interface GeneratedArtifact extends BaseMedia {
  artifactType: 'generated';
  provenance: 'generated_tool';
  status: ArtifactStatus;
  sourceCode?: {
    language: SourceCodeLanguage;
    content: string;
  };
  outputBlob?: Blob;
  compilationLog?: string;
  parentArtifactIds?: string[];
  sourceMessageId?: string;
  toolName?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** A first-class output of OCR or another explicit artifact transformation. */
export interface DerivedArtifact extends BaseMedia {
  artifactType: 'derived';
  provenance: 'derived_transformation';
  status: ArtifactStatus;
  sourceCode?: {
    language: SourceCodeLanguage;
    content: string;
  };
  outputBlob?: Blob;
  parentArtifactIds: string[];
  transformation: string;
  sourceMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type Artifact = Attachment | GeneratedArtifact | DerivedArtifact;

/**
 * Existing chat persistence calls message text `text`; artifact references
 * extend that stable model without copying binary data into messages.
 */
export interface ConversationMessageArtifactRefs {
  attachments?: string[];
  artifacts?: string[];
}

export interface StoredArtifactMetadata extends BaseMedia {
  artifactType: Artifact['artifactType'];
  /** Durable identity for an in-flight async mutation. */
  operationId?: string;
  kind?: AttachmentKind;
  provenance: ArtifactProvenance;
  status: ArtifactStatus;
  sourceCode?: GeneratedArtifact['sourceCode'];
  compilationLog?: string;
  parentArtifactIds?: string[];
  sourceMessageId?: string;
  toolName?: string;
  transformation?: string;
  remoteRef?: ArtifactRemoteRef;
  errorCode?: string;
  errorMessage?: string;
}

export interface StoredArtifactBlob {
  id: string;
  /** IndexedDB-safe binary form; hydrated back to Blob by the repository. */
  data: Blob | ArrayBuffer;
}

export function isAttachment(artifact: Artifact): artifact is Attachment {
  return artifact.artifactType === 'attachment';
}

export function isGeneratedArtifact(artifact: Artifact): artifact is GeneratedArtifact {
  return artifact.artifactType === 'generated';
}

export function isDerivedArtifact(artifact: Artifact): artifact is DerivedArtifact {
  return artifact.artifactType === 'derived';
}
