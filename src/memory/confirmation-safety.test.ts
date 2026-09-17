import { describe, expect, it } from 'vitest';
import { confirmationRequestForCall } from '../google/tools/executor';

describe('durable memory write confirmation safety', () => {
  it('shows the durable body in memory.save confirmation with a bounded preview', () => {
    const body = `Persist this durable project note. ${'x'.repeat(600)}`;
    const request = confirmationRequestForCall({
      tool: 'memory.save',
      arguments: { title: 'Project note', body },
    }, new Date('2026-09-17T08:00:00Z'));

    expect(request?.resourceSummary).toContain('Project note');
    expect(request?.resourceSummary).toContain('Persist this durable project note.');
    expect(request?.resourceSummary).toContain('…');
    expect(request?.resourceSummary).not.toContain('x'.repeat(400));
  });

  it('shows relation, evidence title, and durable body for memory.reconcile', () => {
    const request = confirmationRequestForCall({
      tool: 'memory.reconcile',
      arguments: {
        targetRef: 'memref_1234567890abcdef',
        relation: 'supersede',
        title: 'Corrected preference',
        body: 'The newer user statement replaces the older preference.',
      },
    }, new Date('2026-09-17T08:00:00Z'));

    expect(request?.resourceSummary).toMatch(/supersede/i);
    expect(request?.resourceSummary).toContain('Corrected preference');
    expect(request?.resourceSummary).toContain('newer user statement');
    expect(request?.resourceSummary).not.toContain('memref_1234567890abcdef');
  });
});