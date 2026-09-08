export const ARTIFACT_LIMITS = {
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxMessageAttachmentBytes: 50 * 1024 * 1024,
  maxAttachmentsPerMessage: 8,
  maxFilenameLength: 180,
  maxTextCharacters: 200_000,
  maxImagePixels: 24_000_000,
  maxOcrLongEdge: 4_096,
  maxOcrDurationMs: 30_000,
  maxGeneratedSourceCharacters: 200_000,
  maxGeneratedPdfBytes: 15 * 1024 * 1024,
  maxCompilationLogCharacters: 20_000,
  maxCompilerDurationMs: 30_000,
} as const;

export type ArtifactLimits = typeof ARTIFACT_LIMITS;
