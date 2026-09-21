import type { MemoryCategoryKey } from '../domain/preferences';

function containsLuhnValidCardNumber(value: string): boolean {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  });
}

const BARE_CREDENTIAL_PATTERNS = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16,32}\b/,
  /\bAIza[0-9A-Za-z_-]{25,60}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/i,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/,
] as const;

/**
 * Narrow deterministic guard for credential-shaped material. Durable memory is
 * for personal continuity, not authentication secrets. This is deliberately
 * conservative and shared by automatic and model-initiated memory paths.
 */
export function containsCredentialMaterial(value: string): boolean {
  const compact = value.trim();
  const highSignalBarePrefix = /^(?:AKIA|ASIA|AIza|gh[pousr]_|xox[baprs]-|eyJ)/i.test(compact);
  return highSignalBarePrefix
    || /\b(?:password|passcode|pin|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\b\s*(?:is|=|:)\s*\S+/i.test(value)
    || /\b(?:bank account number|account number|routing number|credit card number|card number|cvv|cvc|iban)\b\s*(?:is|=|:)\s*\S+/i.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
    || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || BARE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(compact))
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || containsLuhnValidCardNumber(value);
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
