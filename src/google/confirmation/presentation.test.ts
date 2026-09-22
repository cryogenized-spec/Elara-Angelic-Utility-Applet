import { describe, expect, it } from 'vitest';
import { confirmationToolPresentation } from './presentation';

describe('confirmation tool presentation', () => {
  it('uses friendly provider and action labels for ClickUp mutations', () => {
    expect(confirmationToolPresentation('clickup.createTaskComment')).toEqual({ provider: 'ClickUp', action: 'Post comment' });
    expect(confirmationToolPresentation('clickup.attachArtifact')).toEqual({ provider: 'ClickUp', action: 'Attach file' });
  });

  it('humanizes unknown operations without exposing a dotted implementation id', () => {
    expect(confirmationToolPresentation('example.makeSomethingUseful')).toEqual({ provider: 'Elara', action: 'Make Something Useful' });
  });
});
