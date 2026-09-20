import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_LOOP_BUDGET_POLICY,
  addGrossUsage,
  aggregateUsage,
  buildInvestigationCheckpoint,
  checkpointEntryFor,
  decideToolLoopBudget,
  projectedNextGross,
  type ToolLoopBudgetSnapshot,
} from './tool-loop-budget';

const base: ToolLoopBudgetSnapshot = {
  cumulativeGrossInputTokens: 0,
  lastGrossInputTokens: 0,
  interactions: 1,
  compactions: 0,
};

describe('Gemini tool-loop TPM budget', () => {
  it('meters gross provider input without subtracting cached tokens', () => {
    const next = addGrossUsage(base, { inputTokens: 42_000, cachedTokens: 39_000 });
    expect(next.cumulativeGrossInputTokens).toBe(42_000);
    expect(next.lastGrossInputTokens).toBe(42_000);
  });

  it('projects the next continuation from the recent gross size', () => {
    const snapshot = { ...base, cumulativeGrossInputTokens: 112_000, lastGrossInputTokens: 45_000, interactions: 3 };
    expect(projectedNextGross(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe(157_000);
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe('compact');
  });

  it('compacts after four model interactions even when provider usage is unavailable', () => {
    const snapshot = { ...base, interactions: 4 };
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe('compact');
  });

  it('uses terminal synthesis instead of first compaction when only the smaller terminal reserve still fits', () => {
    const snapshot = {
      ...base,
      cumulativeGrossInputTokens: 137_000,
      lastGrossInputTokens: 30_000,
      interactions: 3,
      compactions: 0,
    };
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe('terminal-synthesis');
  });

  it('falls back locally when neither first compaction nor terminal synthesis can fit the hard ceiling', () => {
    const snapshot = {
      ...base,
      cumulativeGrossInputTokens: 140_000,
      lastGrossInputTokens: 30_000,
      interactions: 3,
      compactions: 0,
    };
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe('local-fallback');
  });

  it('uses terminal synthesis after the one compaction when the old-chain projection would cross hard budget', () => {
    const snapshot = {
      ...base,
      cumulativeGrossInputTokens: 132_000,
      lastGrossInputTokens: 25_000,
      interactions: 5,
      compactions: 1,
    };
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe('terminal-synthesis');
  });

  it('fails locally rather than dispatching once the absolute gross limit is already reached', () => {
    const snapshot = {
      ...base,
      cumulativeGrossInputTokens: 150_000,
      lastGrossInputTokens: 30_000,
      interactions: 5,
      compactions: 1,
    };
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY)).toBe('local-fallback');
  });

  it('builds a bounded checkpoint and strips credential-shaped object keys', () => {
    const entry = checkpointEntryFor(
      { tool: 'gmail.getMessage', arguments: { messageId: 'm1' } },
      {
        trust: 'untrusted-external',
        subject: 'GitHub PR #79',
        bodyText: 'Kanban board integration. '.repeat(100),
        accessToken: 'must-not-appear',
      },
      true,
    );
    const checkpoint = buildInvestigationCheckpoint(
      'Find the Kanban.',
      [entry],
      1_200,
    );
    expect(checkpoint.length).toBeLessThanOrEqual(1_225);
    expect(checkpoint).toContain('UNTRUSTED_EXTERNAL');
    expect(checkpoint).toContain('GitHub PR #79');
    expect(checkpoint).not.toContain('must-not-appear');
  });

  it('aggregates per-interaction provider usage into turn usage', () => {
    expect(aggregateUsage(
      { inputTokens: 30_000, cachedTokens: 20_000, outputTokens: 500 },
      { inputTokens: 40_000, cachedTokens: 35_000, outputTokens: 700 },
    )).toMatchObject({
      inputTokens: 70_000,
      cachedTokens: 55_000,
      outputTokens: 1_200,
    });
  });
});
