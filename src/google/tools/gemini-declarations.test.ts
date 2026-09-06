import { describe, expect, it } from 'vitest';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionNames } from './gemini-declarations';

const names = new Set(googleGeminiFunctionNames());

describe('Gemini capability declarations', () => {
  it('exposes read capabilities plus the Roleplay world capabilities', () => {
    expect([...names]).toEqual([
      'calendar.listEvents','tasks.listTaskLists','tasks.listTasks','tasks.getTask','docs.getDocument','chat.listMessages','chat.getMessage','gmail.listMessages','gmail.getMessage','gmail.listThreads','gmail.getThread','gmail.listLabels','gmail.getLabel','drive.searchFiles','drive.getFile','drive.downloadFile','sheets.getSpreadsheet','sheets.readRange',
      'roleplay_setting.list','roleplay_setting.inspect','roleplay_setting.create','roleplay_setting.update','roleplay_setting.move','roleplay_setting.delete',
    ]);
  });
  it('derives model-visible descriptions from the application registry', () => {
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.listEvents')?.description).toBe('List calendar events with explicit filters and pagination.');
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'roleplay_setting.update')?.description).toContain('Roleplay World Canvas');
  });
  it('keeps declaration data free of execution-policy wording', () => {
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('Application tool risk:');
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('confirmation policy');
  });
});
