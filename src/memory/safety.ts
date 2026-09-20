import type { MemoryCategoryKey } from '../domain/preferences';

/**
 * Narrow deterministic guard for credential-shaped material. Durable memory is
 * for personal continuity, not authentication secrets. This is deliberately
 * conservative and shared by automatic and model-initiated memory paths.
 */
export function containsCredentialMaterial(value: string): boolean {
  return /\b(?:password|passcode|pin|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\b\s*(?:is|=|:)\s*\S+/i.test(value)
    || /\b(?:bank account number|account number|routing number|credit card number|card number|cvv|cvc|iban)\b\s*(?:is|=|:)\s*\S+/i.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
    || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value);
}


const SENSITIVE_CATEGORY_HINTS: ReadonlyArray<readonly [MemoryCategoryKey, RegExp]> = [
  ['health_wellbeing', /\b(?:diagnos(?:ed|is)|medication|prescription|therap(?:y|ist)|mental health|physical health|illness|disease|symptoms?)\b/i],
  ['money_finances', /\b(?:salary|income|debt|loan|mortgage|bank account|credit card|finances?|financial|monthly budget|rent payment)\b/i],
  ['intimacy_sexuality', /\b(?:sexuality|sexual orientation|sex life|sexual|intimacy|intimate relationship)\b/i],
  ['religion_spirituality', /\b(?:religion|religious|christian|muslim|islam|hindu|buddhist|buddhism|jewish|judaism|atheist|agnostic|spiritual(?:ity)?|prayer|pray(?:ing)?|church|mosque|synagogue)\b/i],
  ['politics_civics', /\b(?:politics|political|vot(?:e|ed|ing)|voter|party member|election preference|political party)\b/i],
  ['race_ethnicity', /\b(?:my race|racial identity|my ethnicity|ethnic identity|ethnic background)\b/i],
  ['legal_criminal_history', /\b(?:arrested|convicted|conviction|charged with|criminal record|probation|parole)\b/i],
  ['precise_location_home', /\b(?:my home address|my street address|my address is|i live at|residential address)\b/i],
];

/**
 * Deterministic, deliberately narrow hints for obviously sensitive personal
 * evidence. This is not a semantic classifier. Its purpose is to fail closed
 * when model-supplied category metadata plainly conflicts with sensitive text.
 */
export function sensitiveMemoryCategoryHints(value: string): MemoryCategoryKey[] {
  return SENSITIVE_CATEGORY_HINTS
    .filter(([, pattern]) => pattern.test(value))
    .map(([category]) => category);
}
