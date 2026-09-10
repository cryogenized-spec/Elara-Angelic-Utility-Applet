import { describe, expect, it } from 'vitest';
import { extractJsonPayload, parseRoutineOutcome } from './outcome';

describe('extractJsonPayload', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonPayload('{"outcome":"noop"}')).toEqual({ ok: true, value: { outcome: 'noop' } });
  });

  it('strips markdown fences', () => {
    expect(extractJsonPayload('```json\n{"outcome":"noop"}\n```')).toEqual({ ok: true, value: { outcome: 'noop' } });
  });

  it('recovers the object from surrounding prose', () => {
    expect(extractJsonPayload('Sure — here is the result: {"outcome":"noop"} hope that helps.')).toEqual({ ok: true, value: { outcome: 'noop' } });
  });

  it('reports EMPTY_OUTPUT for blank text and NO_JSON for prose without an object', () => {
    expect(extractJsonPayload('   \n ')).toEqual({ ok: false, error: 'EMPTY_OUTPUT' });
    expect(extractJsonPayload('I looked at your calendar.')).toEqual({ ok: false, error: 'NO_JSON' });
  });

  it('reports INVALID_JSON for malformed object text', () => {
    expect(extractJsonPayload('{"outcome": "noop"')).toEqual({ ok: false, error: 'INVALID_JSON' });
  });
});

describe('parseRoutineOutcome', () => {
  it('accepts a well-formed no-op', () => {
    const parsed = parseRoutineOutcome('{"outcome":"noop","reason":"calendar unchanged","itemsExamined":5}');
    expect(parsed).toEqual({ ok: true, outcome: { outcome: 'noop', reason: 'calendar unchanged', itemsExamined: 5 } });
  });

  it('accepts a well-formed event with evidence', () => {
    const parsed = parseRoutineOutcome(JSON.stringify({
      outcome: 'event',
      title: 'Morning stand-up moved to 09:30',
      summary: 'Your stand-up moved 30 minutes later; it now overlaps the design review.',
      importance: 2,
      confidence: 3,
      itemsExamined: 4,
      evidence: [{ kind: 'tool', ref: 'calendar.listEvents', note: 'today’s events' }],
    }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.outcome.outcome).toBe('event');
  });

  it('rejects unknown fields, bad scales, and missing required fields as INVALID_CONTRACT', () => {
    expect(parseRoutineOutcome('{"outcome":"noop","surprise":true}')).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
    expect(parseRoutineOutcome('{"outcome":"event","title":"t","summary":"s","importance":4,"confidence":2}')).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
    expect(parseRoutineOutcome('{"outcome":"event","summary":"missing title","importance":2,"confidence":2}')).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
    expect(parseRoutineOutcome('{"outcome":"explode"}')).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
  });

  it('accepts cannot_act as a successful structured refusal', () => {
    expect(parseRoutineOutcome('{\"outcome\":\"cannot_act\",\"reason\":\"frozen context is empty\"}')).toEqual({
      ok: true,
      outcome: { outcome: 'cannot_act', reason: 'frozen context is empty' },
    });
  });

  it('never falls back to an action when the text is not valid JSON', () => {
    expect(parseRoutineOutcome('Nothing to report — all quiet today.')).toMatchObject({ ok: false, error: 'NO_JSON' });
  });
});

// ---------------------------------------------------------------------------
// Security forensics: oversized fields, evidence bounds, unknown fields,
// multi-object output. The contract gate is the boundary between "model
// proposed" and "app accepted".
// ---------------------------------------------------------------------------

describe('parseRoutineOutcome — security', () => {
  it('rejects an oversized title and an oversized summary', () => {
    const oversizedTitle = JSON.stringify({ outcome: 'event', title: 'x'.repeat(121), summary: 's', importance: 2, confidence: 2 });
    const oversizedSummary = JSON.stringify({ outcome: 'event', title: 't', summary: 'y'.repeat(4_001), importance: 2, confidence: 2 });
    expect(parseRoutineOutcome(oversizedTitle)).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
    expect(parseRoutineOutcome(oversizedSummary)).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
  });

  it('rejects more than 8 evidence items and unknown evidence fields', () => {
    const tooMany = JSON.stringify({ outcome: 'event', title: 't', summary: 's', importance: 2, confidence: 2, evidence: Array.from({ length: 9 }, () => ({ kind: 'tool', ref: 'x' })) });
    expect(parseRoutineOutcome(tooMany)).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
    const unknownField = JSON.stringify({ outcome: 'event', title: 't', summary: 's', importance: 2, confidence: 2, evidence: [{ kind: 'tool', ref: 'x', sneaky: true }] });
    expect(parseRoutineOutcome(unknownField)).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
  });

  it('rejects oversized evidence refs and notes', () => {
    const payload = JSON.stringify({ outcome: 'event', title: 't', summary: 's', importance: 2, confidence: 2, evidence: [{ kind: 'tool', ref: 'r'.repeat(301) }] });
    expect(parseRoutineOutcome(payload)).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
  });

  it('rejects two JSON objects — exactly one object is the contract', () => {
    expect(parseRoutineOutcome('{"outcome":"noop"} {"outcome":"noop"}')).toMatchObject({ ok: false, error: 'INVALID_JSON' });
  });

  it('rejects an importance/confidence outside the 1–3 scale (spoofing)', () => {
    const spoofed = JSON.stringify({ outcome: 'event', title: 't', summary: 's', importance: 3, confidence: 99 });
    expect(parseRoutineOutcome(spoofed)).toMatchObject({ ok: false, error: 'INVALID_CONTRACT' });
  });
});
