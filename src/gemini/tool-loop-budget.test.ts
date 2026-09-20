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

  it('includes the serialized pending continuation payload in the hard-budget projection', () => {
    const snapshot = {
      ...base,
      cumulativeGrossInputTokens: 100_000,
      lastGrossInputTokens: 40_000,
      interactions: 3,
    };
    expect(projectedNextGross(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY, 20_000)).toBe(160_000);
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY, {
      continuationInputTokens: 20_000,
      compactInputTokens: 18_000,
      terminalInputTokens: 9_000,
    })).toBe('compact');
  });

  it('sizes fresh compact and terminal requests from their actual serialized payloads', () => {
    const snapshot = {
      ...base,
      cumulativeGrossInputTokens: 130_000,
      lastGrossInputTokens: 25_000,
      interactions: 4,
    };
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY, {
      continuationInputTokens: 5_000,
      compactInputTokens: 25_000,
      terminalInputTokens: 15_000,
    })).toBe('terminal-synthesis');
    expect(decideToolLoopBudget(snapshot, DEFAULT_TOOL_LOOP_BUDGET_POLICY, {
      continuationInputTokens: 5_000,
      compactInputTokens: 25_000,
      terminalInputTokens: 25_000,
    })).toBe('local-fallback');
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
        nextPageToken: 'page-2-cursor',
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
    expect(checkpoint).toContain('page-2-cursor');
    expect(checkpoint).not.toContain('must-not-appear');
  });

  it('marks truncated collections, preserves ETags, and exposes bounded recovery evidence', () => {
    const entry = checkpointEntryFor(
      { tool: 'drive.searchFiles', arguments: { query: 'Quarterly' } },
      {
        trust: 'untrusted-external',
        source: 'drive',
        files: Array.from({ length: 8 }, (_, index) => ({
          id: `file-${index + 1}`,
          name: `Report ${index + 1}.pdf`,
          etag: `"etag-${index + 1}"`,
        })),
      },
      true,
    );
    const checkpoint = buildInvestigationCheckpoint('Find the report.', [entry], 4_000);
    expect(checkpoint).toContain('file-5');
    expect(checkpoint).not.toContain('file-6');
    expect(checkpoint).toContain('checkpointTruncated');
    expect(checkpoint).toContain('"omittedItems":3');
    expect(checkpoint).toContain('\"etag-1\"');
    expect(checkpoint).toContain('Exact reread is permitted');
  });

  it('retains bounded Gmail message body and header evidence in a checkpoint', () => {
    const entry = checkpointEntryFor(
      { tool: 'gmail.getMessage', arguments: { messageId: 'm-semantic' } },
      {
        trust: 'untrusted-external',
        source: 'gmail',
        id: 'm-semantic',
        headers: { from: 'Alice <alice@example.com>', subject: 'Build status' },
        bodyText: 'The deployment window moved to Tuesday at 09:00. '.repeat(20),
        bodyTruncated: false,
      },
      true,
    );
    const checkpoint = buildInvestigationCheckpoint('Check the message.', [entry], 2_000);
    expect(checkpoint).toContain('deployment window moved to Tuesday');
    expect(checkpoint).toContain('Alice');
  });

  it('retains bounded Google Docs block/tab text evidence in a checkpoint', () => {
    const entry = checkpointEntryFor(
      { tool: 'docs.inspectDocument', arguments: { documentId: 'doc-1' } },
      {
        trust: 'untrusted-external',
        source: 'docs',
        documentId: 'doc-1',
        title: 'Launch plan',
        blocks: [{ kind: 'paragraph', text: 'Primary launch date is 18 October.' }],
        tabs: [{
          tabId: 'tab-1',
          title: 'Risks',
          endIndex: 20,
          blocks: [{ kind: 'paragraph', text: 'Fallback region is eu-west.' }],
        }],
      },
      true,
    );
    const checkpoint = buildInvestigationCheckpoint('Inspect the plan.', [entry], 2_000);
    expect(checkpoint).toContain('Primary launch date is 18 October');
    expect(checkpoint).toContain('Fallback region is eu-west');
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
