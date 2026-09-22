import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { googleToolRegistry } from '../google/tools/registry';
import type { GoogleToolDescriptor } from '../google/tools/contracts';
import { confirmationRequestForCall } from '../google/tools/executor';
import { saveMemory } from './store';
import { memoryToolHandlers } from './tool-handler';

const confirmationContext = {
  conversationId: 'thread-confirmation',
  messageId: 'message-confirmation',
  generationId: 'generation-confirmation',
} as const;

function descriptorForLookup(): GoogleToolDescriptor {
  const descriptor = googleToolRegistry.find((tool) => tool.name === 'memory.lookup');
  if (!descriptor) throw new Error('memory.lookup descriptor missing from registry.');
  return descriptor;
}

async function lookupRef(query: string): Promise<string> {
  const handler = memoryToolHandlers['memory.lookup'];
  if (!handler) throw new Error('memory.lookup handler missing.');
  const descriptor = descriptorForLookup();
  const result = await handler({
    tool: 'memory.lookup',
    descriptor,
    capability: 'memory.durable.local',
    risk: descriptor.risk,
    arguments: { query },
    callId: 'lookup-call',
    conversationId: confirmationContext.conversationId,
    messageId: confirmationContext.messageId,
    generationId: confirmationContext.generationId,
    isGenerationActive: () => true,
  }) as { matches?: Array<{ ref?: unknown }> };
  const ref = result.matches?.[0]?.ref;
  if (typeof ref !== 'string') throw new Error('memory.lookup did not return an opaque ref.');
  return ref;
}

describe('durable memory write confirmation safety', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.memories, db.folders, db.folderAssignments, async () => {
      await db.memories.clear();
      await db.folders.clear();
      await db.folderAssignments.clear();
    });
  });

  it('requires review of the entire validated memory.save body', () => {
    const body = `Persist this durable project note. ${'x'.repeat(600)}`;
    const request = confirmationRequestForCall({
      tool: 'memory.save',
      arguments: {
        title: 'Project note',
        body,
        kind: 'EPISODIC',
        confidence: 0.9,
        importance: 0.8,
        tags: ['Project', ' Priority '],
      },
    }, new Date('2026-09-17T08:00:00Z'));

    expect(request?.resourceSummary).toContain('Project note');
    expect(request?.resourceSummary).toContain('Kind: EPISODIC');
    expect(request?.resourceSummary).toContain('confidence: 0.9');
    expect(request?.resourceSummary).toContain('importance: 0.8');
    expect(request?.resourceSummary).toContain('tags: project, priority');
    expect(request?.resourceSummary).toMatch(/full proposed body/i);
    expect(request?.reviewText).toBe(body);
    expect(request?.reviewText).toContain('x'.repeat(600));
  });

  it('identifies the reconciliation target and exposes the entire proposed body without leaking its durable id or opaque ref', async () => {
    const target = await saveMemory({
      title: 'Layout preference',
      body: 'The user currently prefers the spacious editor layout.',
      kind: 'CONTEXTUAL',
    });
    const targetRef = await lookupRef('layout preference');
    const proposedBody = `The user now explicitly prefers the compact editor layout. ${'y'.repeat(500)}`;

    const request = confirmationRequestForCall({
      tool: 'memory.reconcile',
      arguments: {
        targetRef,
        relation: 'supersede',
        title: 'Corrected layout preference',
        body: proposedBody,
        tags: ['Layout', 'Correction'],
      },
    }, new Date('2026-09-17T08:00:00Z'), confirmationContext);

    expect(request?.resourceSummary).toContain('Layout preference');
    expect(request?.resourceSummary).toContain('CONTEXTUAL');
    expect(request?.resourceSummary).toContain('active');
    expect(request?.resourceSummary).toContain('spacious editor layout');
    expect(request?.resourceSummary).toMatch(/supersede/i);
    expect(request?.resourceSummary).toContain('Corrected layout preference');
    expect(request?.resourceSummary).toContain('Tags on the new evidence: layout, correction');
    expect(request?.resourceSummary).not.toContain(target.id);
    expect(request?.resourceSummary).not.toContain(targetRef);
    expect(request?.reviewText).toBe(proposedBody);
    expect(request?.reviewText).toContain('y'.repeat(500));
  });

  it('shows effective default durable-memory metadata even when optional fields are omitted', () => {
    const request = confirmationRequestForCall({
      tool: 'memory.save',
      arguments: { title: 'Defaults', body: 'Remember this.' },
    });
    expect(request?.resourceSummary).toContain('Kind: CONTEXTUAL');
    expect(request?.resourceSummary).toContain('confidence: 0.7');
    expect(request?.resourceSummary).toContain('importance: 0.5');
    expect(request?.resourceSummary).toContain('tags: none');
  });

  it('refuses to display a reconciliation target outside the lookup grant turn', async () => {
    await saveMemory({ title: 'Private project note', body: 'Only the originating turn may resolve this display snapshot.' });
    const targetRef = await lookupRef('private project note');

    const call = {
      tool: 'memory.reconcile' as const,
      arguments: {
        targetRef,
        relation: 'support',
        title: 'New evidence',
        body: 'Supporting evidence.',
      },
    };

    expect(confirmationRequestForCall(call, new Date('2026-09-17T08:00:00Z'), {
      ...confirmationContext,
      generationId: 'different-generation',
    })).toBeNull();
    expect(confirmationRequestForCall(call, new Date('2026-09-17T08:00:00Z'))).toBeNull();
  });
});
