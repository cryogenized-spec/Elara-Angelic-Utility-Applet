import { describe, expect, it } from 'vitest';
import { googleToolRegistry } from './registry';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionNames } from './gemini-declarations';

describe('Gemini capability declarations', () => {
  it('exposes every registered tool, including confirmation-gated writes', () => {
    expect(googleGeminiFunctionNames()).toEqual(googleToolRegistry.map((tool) => tool.name));
    expect(googleGeminiFunctionNames()).toContain('tasks.createTask');
    expect(googleGeminiFunctionNames()).toContain('gmail.sendMessage');
    expect(googleGeminiFunctionNames()).toContain('sheets.writeRange');
  });

  it('derives model-visible descriptions from the application registry', () => {
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.listEvents')?.description).toBe('List calendar events with explicit filters and pagination.');
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'roleplay_setting.update')?.description).toContain('Roleplay World Canvas');
  });

  it('declares concrete arguments for high-value write tools', () => {
    const createTask = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'tasks.createTask');
    expect(createTask?.parameters.required).toEqual(['taskListId', 'task']);
    expect(createTask?.parameters.properties).toHaveProperty('task');

    const sendMail = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'gmail.sendMessage');
    expect(sendMail?.parameters.required).toEqual(['rawRfc822']);
    expect(sendMail?.parameters.properties).toHaveProperty('rawRfc822');

    const writeRange = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'sheets.writeRange');
    expect(writeRange?.parameters.required).toEqual(['spreadsheetId', 'range', 'values']);
    expect(writeRange?.parameters.properties).toHaveProperty('values');
  });

  it('keeps declaration data free of execution-policy wording', () => {
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('Application tool risk:');
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('confirmation policy');
  });
});
