import { describe, expect, it } from 'vitest';
import { googleToolRegistry } from './registry';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionNames } from './gemini-declarations';

describe('Gemini capability declarations', () => {
  it('exposes Gemini-visible registered tools, including Calendar parity and confirmation-gated writes', () => {
    expect(googleGeminiFunctionNames()).toEqual(googleToolRegistry.filter((tool) => tool.exposure === 'gemini').map((tool) => tool.name));
    expect(googleGeminiFunctionNames()).toEqual(expect.arrayContaining([
      'calendar.listCalendars', 'calendar.listEvents', 'calendar.getEvent', 'calendar.getSettings', 'calendar.queryFreeBusy',
      'calendar.createEvent', 'calendar.updateEvent', 'calendar.deleteEvent',
      'tasks.createTask', 'gmail.sendMessage', 'sheets.writeRange',
    ]));
    expect(googleGeminiFunctionNames()).not.toContain('docs.batchUpdate');
    expect(googleGeminiFunctionNames()).not.toContain('sheets.batchUpdate');
    expect(googleGeminiFunctionNames()).not.toContain('chat.listMessages');
  });

  it('derives model-visible descriptions from the application registry', () => {
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.listEvents')?.description).toContain('timezone');
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.updateEvent')?.description).toContain('ETag');
    expect(googleGeminiFunctionDeclarations.find((tool) => tool.name === 'roleplay_setting.update')?.description).toContain('Roleplay World Canvas');
  });

  it('declares concrete Calendar read-before-write and scheduling arguments', () => {
    const listCalendars = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.listCalendars');
    expect(listCalendars?.parameters.properties).toHaveProperty('showOwnOrganizationOnly');
    expect(listCalendars?.parameters.properties).toHaveProperty('minAccessRole');

    const freeBusy = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.queryFreeBusy');
    expect(freeBusy?.parameters.required).toEqual(['timeMin', 'timeMax', 'calendarIds']);
    expect(freeBusy?.parameters.properties).toHaveProperty('calendarIds');

    const createEvent = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.createEvent');
    expect(createEvent?.parameters.required).toEqual(['summary', 'start', 'end']);
    expect(createEvent?.parameters.properties).toHaveProperty('recurrence');
    expect(createEvent?.parameters.properties).toHaveProperty('sendUpdates');

    const updateEvent = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.updateEvent');
    expect(updateEvent?.parameters.required).toEqual(['eventId', 'etag']);
    expect(updateEvent?.parameters.properties).toHaveProperty('etag');

    const deleteEvent = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'calendar.deleteEvent');
    expect(deleteEvent?.parameters.required).toEqual(['eventId', 'etag']);

    expect(JSON.stringify(createEvent?.parameters.properties.sendUpdates)).not.toContain('none');
  });

  it('declares concrete arguments for other high-value write tools', () => {
    const createTask = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'tasks.createTask');
    expect(createTask?.parameters.required).toEqual(['taskListId', 'title']);
    expect(createTask?.parameters.properties).toHaveProperty('title');
    expect(createTask?.parameters.properties).not.toHaveProperty('task');

    const sendMail = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'gmail.sendMessage');
    expect(sendMail?.parameters.required).toEqual(['to', 'subject', 'body']);
    expect(sendMail?.parameters.properties).toHaveProperty('to');
    expect(sendMail?.parameters.properties).not.toHaveProperty('rawRfc822');

    const writeRange = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'sheets.writeRange');
    expect(writeRange?.parameters.required).toEqual(['spreadsheetId', 'range', 'values']);
    expect(writeRange?.parameters.properties).toHaveProperty('values');
  });

  it('keeps declaration data free of execution-policy wording', () => {
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('Application tool risk:');
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toContain('confirmation policy');
  });
});
