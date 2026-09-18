/**
 * Drive adapter bounds.
 *
 * Single authority for the limits that must agree exactly across the Drive
 * service, the model-facing argument schema, the Gemini function declaration and
 * the download artifact boundary. Declarations and validation import these
 * values instead of repeating them, so a bound cannot drift on one surface while
 * the provider adapter keeps the old one.
 */
export const DRIVE_LIMITS = {
  /** Hard ceiling for one download/export transfer, enforced before and during the provider read. */
  maxTransferBytes: 10 * 1024 * 1024,
  maxQueryLength: 2_000,
  maxFileIdLength: 500,
  maxPageTokenLength: 2_048,
  maxPageSize: 100,
  maxExportMimeTypeLength: 200,
  /** Bound for one provider ETag passed as a conditional-write precondition. */
  maxEtagLength: 1_024,
  maxNameLength: 500,
  maxDescriptionLength: 2_000,
} as const;

export type DriveLimits = typeof DRIVE_LIMITS;
