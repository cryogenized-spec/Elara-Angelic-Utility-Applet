import { describe, expect, it } from 'vitest';
import { googleToolNameSchema, toolActivityPresentation } from './contracts';

describe('tool activity presentation', () => {
  it('classifies every registered Gemini tool without UI-only lookup tables', () => {
    for (const name of googleToolNameSchema.options) {
      const presentation = toolActivityPresentation(name);
      expect(presentation.categoryLabel.length).toBeGreaterThan(0);
      expect(presentation.actionLabel.length).toBeGreaterThan(0);
    }
  });

  it('groups Workspace services while retaining their service identity', () => {
    expect(toolActivityPresentation('calendar.listEvents')).toEqual({
      category: 'google-workspace',
      categoryLabel: 'Google Workspace',
      serviceLabel: 'Calendar',
      actionLabel: 'List Events',
    });
  });

  it('keeps YouTube, roleplay, and document creation categorical', () => {
    expect(toolActivityPresentation('youtube.search')).toMatchObject({ category: 'youtube', categoryLabel: 'YouTube' });
    expect(toolActivityPresentation('roleplay_setting.inspect')).toMatchObject({ category: 'roleplay', categoryLabel: 'Roleplay World' });
    expect(toolActivityPresentation('document.create_pdf')).toMatchObject({ category: 'documents', categoryLabel: 'Documents & Artifacts' });
  });
});
