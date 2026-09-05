import { describe, expect, it } from 'vitest';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionNames } from './gemini-declarations';

const names = new Set(googleGeminiFunctionNames());

describe('Gemini capability declarations', () => {
  it('exposes only read capabilities on the ordinary conversational surface', () => {
    expect([...names]).toEqual([
      'calendar.listEvents',
      'tasks.listTaskLists',
      'tasks.listTasks',
      'tasks.getTask',
      'docs.getDocument',
      'chat.listMessages',
      'chat.getMessage',
      'gmail.listMessages',
      'gmail.getMessage',
      'gmail.listThreads',
      'gmail.getThread',
      'gmail.listLabels',
      'gmail.getLabel',
      'drive.searchFiles',
      'drive.getFile',
      'drive.downloadFile',
      'sheets.getSpreadsheet',
      'sheets.readRange',
    ]);
  });

  it('derives model-visible descriptions from the application registry', () => {
    const calendar = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.listEvents');
    expect(calendar?.description).toBe('List calendar events with explicit filters and pagination.');
  });

  it('keeps declaration data free of execution-policy wording', () => {
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('Application tool risk:');
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('confirmation policy');
  });
});
