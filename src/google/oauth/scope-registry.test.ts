import { describe, expect, it } from 'vitest';
import { getGoogleScope, googleScopeRegistry } from './scope-registry';

const REQUIRED_CAPABILITIES = [
  'calendar.events.read',
  'calendar.events.write',
  'calendar.list.read',
  'calendar.settings.read',
  'tasks.read',
  'tasks.write',
  'gmail.read',
  'gmail.modify',
  'gmail.labels',
  'gmail.send',
  'drive.files.read',
  'drive.files.write',
  'docs.read',
  'docs.write',
  'sheets.read',
  'sheets.write',
  'chat.read',
  'chat.write',
] as const;

const EXPECTED_SCOPES: Record<(typeof REQUIRED_CAPABILITIES)[number], string> = {
  'calendar.events.read': 'https://www.googleapis.com/auth/calendar.events.readonly',
  'calendar.events.write': 'https://www.googleapis.com/auth/calendar.events',
  'calendar.list.read': 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'calendar.settings.read': 'https://www.googleapis.com/auth/calendar.settings.readonly',
  'tasks.read': 'https://www.googleapis.com/auth/tasks.readonly',
  'tasks.write': 'https://www.googleapis.com/auth/tasks',
  'gmail.read': 'https://www.googleapis.com/auth/gmail.readonly',
  'gmail.modify': 'https://www.googleapis.com/auth/gmail.modify',
  'gmail.labels': 'https://www.googleapis.com/auth/gmail.labels',
  'gmail.send': 'https://www.googleapis.com/auth/gmail.send',
  'drive.files.read': 'https://www.googleapis.com/auth/drive.file',
  'drive.files.write': 'https://www.googleapis.com/auth/drive.file',
  'docs.read': 'https://www.googleapis.com/auth/drive.file',
  'docs.write': 'https://www.googleapis.com/auth/drive.file',
  'sheets.read': 'https://www.googleapis.com/auth/drive.file',
  'sheets.write': 'https://www.googleapis.com/auth/drive.file',
  'chat.read': 'https://www.googleapis.com/auth/chat.messages.readonly',
  'chat.write': 'https://www.googleapis.com/auth/chat.messages',
};

describe('Google OAuth scope registry', () => {
  it('contains every first-class Workspace capability', () => {
    for (const capability of REQUIRED_CAPABILITIES) expect(() => getGoogleScope(capability)).not.toThrow();
  });

  it('maps first-class capabilities to the audited least-privilege scopes', () => {
    for (const capability of REQUIRED_CAPABILITIES) expect(getGoogleScope(capability).scope).toBe(EXPECTED_SCOPES[capability]);
  });

  it('keeps provider scope strings out of model-facing tool contracts', async () => {
    const contracts = await import('../tools/contracts');
    const source = JSON.stringify(contracts.googleToolCallSchema);
    for (const entry of googleScopeRegistry) {
      if (!entry.scope) continue;
      expect(source).not.toContain(entry.scope);
    }
  });

  it('uses unique application capability keys', () => {
    const keys = googleScopeRegistry.map((entry) => entry.capability);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses HTTPS provider scope URIs for Google capabilities', () => {
    for (const entry of googleScopeRegistry) {
      if (entry.capability === 'roleplay.world.local') continue;
      expect(entry.scope.startsWith('https://www.googleapis.com/auth/')).toBe(true);
    }
  });

  it('keeps the local Roleplay capability provider-free', () => {
    expect(getGoogleScope('roleplay.world.local').scope).toBe('');
  });

  it('keeps Gmail authorization granular', () => {
    expect(getGoogleScope('gmail.read').scope).not.toBe(getGoogleScope('gmail.modify').scope);
    expect(getGoogleScope('gmail.modify').scope).not.toBe(getGoogleScope('gmail.labels').scope);
    expect(getGoogleScope('gmail.send').scope).not.toBe(getGoogleScope('gmail.modify').scope);
    expect(getGoogleScope('gmail.send').scope).not.toBe(getGoogleScope('gmail.labels').scope);
  });

  it('uses message scopes for the Chat message service boundary', () => {
    expect(getGoogleScope('chat.read').scope).toBe('https://www.googleapis.com/auth/chat.messages.readonly');
    expect(getGoogleScope('chat.write').scope).toBe('https://www.googleapis.com/auth/chat.messages');
  });
});
