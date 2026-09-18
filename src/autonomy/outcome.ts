import { z } from 'zod';
import { routineEvidenceSchema, routineImportanceSchema } from './contracts';

// ---------------------------------------------------------------------------
// Structured routine outcome gate.
//
// The agent loop's final text must parse as a RoutineOutcome. Anything else —
// prose, injected instructions, malformed JSON, unknown fields — is a run
// FAILURE, never a fallback action. This is the "LLM proposes, code decides"
// boundary expressed at the output contract.
// ---------------------------------------------------------------------------

export const routineOutcomeSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('noop'),
    reason: z.string().max(500).optional(),
    itemsExamined: z.number().int().min(0).max(100_000).optional(),
  }),
  z.strictObject({
    outcome: z.literal('event'),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(4_000),
    importance: routineImportanceSchema,
    confidence: routineImportanceSchema,
    itemsExamined: z.number().int().min(0).max(100_000).optional(),
    evidence: z.array(routineEvidenceSchema).max(8).optional(),
  }),
  z.strictObject({
    outcome: z.literal('cannot_act'),
    reason: z.string().min(1).max(500),
  }),
]);
export type RoutineOutcome = z.infer<typeof routineOutcomeSchema>;

export type RoutineOutcomeParse =
  | { ok: true; outcome: RoutineOutcome }
  | { ok: false; error: 'EMPTY_OUTPUT' | 'NO_JSON' | 'INVALID_JSON' | 'INVALID_CONTRACT' };

/**
 * Extract a JSON payload from model text. Tolerates surrounding prose and
 * Markdown code fences (models add them despite instructions) but never
 * evaluates anything other than a single JSON object.
 */
export function extractJsonPayload(text: string): { ok: true; value: unknown } | { ok: false; error: 'EMPTY_OUTPUT' | 'NO_JSON' | 'INVALID_JSON' } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'EMPTY_OUTPUT' };
  const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const candidates = [withoutFences];
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(withoutFences.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      continue;
    }
  }
  return withoutFences.includes('{') ? { ok: false, error: 'INVALID_JSON' } : { ok: false, error: 'NO_JSON' };
}

/** Parse and validate the agent's terminal output against the outcome contract. */
export function parseRoutineOutcome(text: string): RoutineOutcomeParse {
  const extracted = extractJsonPayload(text);
  if (!extracted.ok) return { ok: false, error: extracted.error };
  const parsed = routineOutcomeSchema.safeParse(extracted.value);
  if (!parsed.success) return { ok: false, error: 'INVALID_CONTRACT' };
  return { ok: true, outcome: parsed.data };
}
