export type ArtifactErrorCode =
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'IMAGE_PROCESSING_FAILED'
  | 'OCR_FAILED'
  | 'OCR_TIMEOUT'
  | 'PROVIDER_ATTACHMENT_FAILED'
  | 'DOCUMENT_COMPILATION_FAILED'
  | 'DOCUMENT_COMPILATION_TIMEOUT'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_STORAGE_FAILED'
  | 'ARTIFACT_OPERATION_STALE';

export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode;
  readonly userMessage: string;
  readonly cause?: unknown;

  constructor(code: ArtifactErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'ArtifactError';
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

export function artifactErrorMessage(error: unknown, fallback = 'The artifact could not be processed.'): string {
  if (error instanceof ArtifactError) return error.userMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
