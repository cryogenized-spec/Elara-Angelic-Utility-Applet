import { describe, expect, it } from 'vitest';
import {
  applySemanticEntityMatch,
  normalizeSemanticProposal,
  resolveSemanticEntity,
  semanticLinkProposalSchema,
  type SemanticEntityRecord,
} from './semantic-entities';

/**
 * Companion continuity Pass 2 — entity and concept linking.
 *
 * Identity is application-owned and conservative: exact normalized keys only,
 * no fuzzy similarity, ambiguity fails safely, corrections preserve
 * historical aliases, and linking itself carries no epistemic authority.
 */

describe('semantic link proposal normalization', () => {
  it('accepts a strict proposal and normalizes identity text', () => {
    const normalized = normalizeSemanticProposal({
      kind: 'person',
      canonicalLabel: '  Zuhayr  ',
      aliases: ['Z', 'z', 'Z'],
      evidenceRef: 'Zuhayr is the owner',
    });
    expect(normalized).toEqual({
      kind: 'person',
      label: 'Zuhayr',
      aliases: ['Z'],
      evidenceRef: 'Zuhayr is the owner',
    });
  });

  it('collapses Unicode and whitespace variants of the same name', () => {
    const normalized = normalizeSemanticProposal({
      kind: 'person',
      canonicalLabel: 'D\u00e9bora  ',
      aliases: ['De\u0301bora', ' débora '],
      evidenceRef: 'my name is Débora',
    });
    expect(normalized?.label).toBe('Débora');
    expect(normalized?.aliases).toEqual([]);
  });

  it('rejects malformed, oversized, empty and authority-laden proposals', () => {
    expect(normalizeSemanticProposal({ kind: 'person', canonicalLabel: '', aliases: [], evidenceRef: 'x' })).toBeNull();
    expect(normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'x'.repeat(81), aliases: [], evidenceRef: 'x' })).toBeNull();
    expect(normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Dawie', aliases: [], evidenceRef: '   ' })).toBeNull();
    expect(normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Dawie', aliases: [], evidenceRef: 'x', confidence: 0.9 })).toBeNull();
    expect(normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Dawie', aliases: [], evidenceRef: 'x', folderId: 'evil' })).toBeNull();
    expect(normalizeSemanticProposal({
      kind: 'person',
      canonicalLabel: 'Dawie',
      aliases: Array.from({ length: 9 }, (_, index) => `alias-${index}`),
      evidenceRef: 'x',
    })).toBeNull();
    expect(normalizeSemanticProposal({
      kind: 'person',
      canonicalLabel: 'Dawie',
      aliases: Array.from({ length: 8 }, (_, index) => `alias-${index}`),
      evidenceRef: 'x',
    })).not.toBeNull();
  });

  it('rejects arbitrary top-level concept classes', () => {
    expect(semanticLinkProposalSchema.safeParse({ kind: 'organization', canonicalLabel: 'Acme', aliases: [], evidenceRef: 'x' }).success).toBe(false);
    expect(normalizeSemanticProposal({ kind: 'organization', canonicalLabel: 'Acme', aliases: [], evidenceRef: 'x' })).toBeNull();
  });

  it('rejects credential-shaped identity material', () => {
    expect(normalizeSemanticProposal({
      kind: 'person',
      canonicalLabel: 'my API key is EXAMPLE_NOT_A_REAL_SECRET_12345',
      aliases: [],
      evidenceRef: 'x',
    })).toBeNull();
    expect(normalizeSemanticProposal({
      kind: 'person',
      canonicalLabel: 'Dawie',
      aliases: ['password is hunter2'],
      evidenceRef: 'x',
    })).toBeNull();
  });
});

describe('semantic entity resolution', () => {
  const zuhayr: SemanticEntityRecord = { id: 'semantic_1', kind: 'person', title: 'Zuhayr', aliases: ['Z'] };

  it('matches an existing concept by exact title or alias before creating a new one', () => {
    const byTitle = resolveSemanticEntity(normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr again' })!, [zuhayr]);
    expect(byTitle).toEqual({ status: 'match', fileId: 'semantic_1', renamed: false });

    const byAlias = resolveSemanticEntity(normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'z', aliases: [], evidenceRef: 'thanks z' })!, [zuhayr]);
    expect(byAlias).toEqual({ status: 'match', fileId: 'semantic_1', renamed: true });
  });

  it('never merges on fuzzy similarity alone', () => {
    const dovy: SemanticEntityRecord = { id: 'semantic_2', kind: 'person', title: 'Dovy', aliases: [] };

    const similar = resolveSemanticEntity(
      normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Dawie', aliases: [], evidenceRef: 'Davy and Dawie sound alike' })!,
      [dovy],
    );
    expect(similar).toEqual({ status: 'create' });

    const zohayer = resolveSemanticEntity(
      normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Zohayer', aliases: [], evidenceRef: 'my cousin is Zohayer' })!,
      [zuhayr],
    );
    expect(zohayer).toEqual({ status: 'create' });
  });

  it('applies a user correction as a rename that preserves the historical alias', () => {
    const proposal = normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Dawie', aliases: ['Dovy'], evidenceRef: 'Dovy is actually Dawie' })!;
    const corrected = resolveSemanticEntity(proposal, [dovyRecord()]);
    expect(corrected).toEqual({ status: 'match', fileId: 'semantic_2', renamed: true });

    const upserted = applySemanticEntityMatch(dovyRecord(), proposal);
    expect(upserted.title).toBe('Dawie');
    expect(upserted.aliases).toContain('Dovy');
    expect(upserted.changed).toBe(true);
  });

  it('fails safely when a proposal is ambiguous between two same-kind concepts', () => {
    const first: SemanticEntityRecord = { id: 'semantic_3', kind: 'person', title: 'Sarah', aliases: [] };
    const second: SemanticEntityRecord = { id: 'semantic_4', kind: 'person', title: 'Sarah M.', aliases: ['Sarah'] };

    const ambiguous = resolveSemanticEntity(
      normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Sarah', aliases: [], evidenceRef: 'Sarah said hi' })!,
      [first, second],
    );
    expect(ambiguous).toEqual({ status: 'unresolved', reason: 'ambiguous' });
  });

  it('fails safely on project/person identity overlap across kinds', () => {
    const personKanban: SemanticEntityRecord = { id: 'semantic_5', kind: 'person', title: 'Kanban', aliases: [] };
    const project: SemanticEntityRecord = { id: 'semantic_6', kind: 'project', title: 'Memory Bank', aliases: [] };

    const crossKind = resolveSemanticEntity(
      normalizeSemanticProposal({ kind: 'project', canonicalLabel: 'Kanban', aliases: [], evidenceRef: 'the Kanban board uses Google Tasks' })!,
      [personKanban, project],
    );
    expect(crossKind).toEqual({ status: 'unresolved', reason: 'ambiguous' });
  });

  it('keeps you-profile and you-preferences as singletons per kind', () => {
    const profile: SemanticEntityRecord = { id: 'semantic_7', kind: 'you-profile', title: 'Profile', aliases: [] };
    const preferences: SemanticEntityRecord = { id: 'semantic_8', kind: 'you-preferences', title: 'Preferences', aliases: [] };

    expect(resolveSemanticEntity(
      normalizeSemanticProposal({ kind: 'you-profile', canonicalLabel: 'Me', aliases: [], evidenceRef: 'I am the user' })!,
      [profile, preferences],
    )).toEqual({ status: 'match', fileId: 'semantic_7', renamed: false });

    expect(resolveSemanticEntity(
      normalizeSemanticProposal({ kind: 'you-preferences', canonicalLabel: 'Tastes', aliases: [], evidenceRef: 'I like compact layouts' })!,
      [],
    )).toEqual({ status: 'create' });
  });

  it('bounds merged alias lists deterministically without dropping the correction target', () => {
    const crowded: SemanticEntityRecord = {
      id: 'semantic_9',
      kind: 'person',
      title: 'Alex',
      aliases: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    };
    const upserted = applySemanticEntityMatch(
      crowded,
      normalizeSemanticProposal({ kind: 'person', canonicalLabel: 'Alexis', aliases: ['Alex', 'I', 'J', 'K'], evidenceRef: 'Alex is actually Alexis' })!,
    );
    expect(upserted.title).toBe('Alexis');
    expect(upserted.aliases).toHaveLength(8);
    expect(upserted.aliases).toContain('Alex');
    expect(upserted.aliases).not.toContain('Alexis');
  });
});

function dovyRecord(): SemanticEntityRecord {
  return { id: 'semantic_2', kind: 'person', title: 'Dovy', aliases: [] };
}
