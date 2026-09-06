/**
 * Canonical Character Master instruction slot for Elara.
 *
 * The application intentionally ships this empty so a fresh install never
 * pre-populates the editable Master Prompt field. First-run onboarding may
 * offer optional templates for the user to choose.
 */
export const ELARA_SYSTEM_INSTRUCTION = '';

/**
 * Resolve the active Character Master without creating a second persona layer.
 *
 * The persisted value is authoritative: non-empty custom text is returned
 * byte-for-byte (apart from surrounding whitespace-only detection), while an
 * empty value resolves to the canonical empty default.
 */
export function resolveMasterCharacterInstruction(value: string | null | undefined): string {
  if (!hasMasterCharacterInstruction(value)) return ELARA_SYSTEM_INSTRUCTION;
  return value as string;
}

export function hasMasterCharacterInstruction(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
