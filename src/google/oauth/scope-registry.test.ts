import { describe, expect, it } from 'vitest';
import { getGoogleScope, googleScopeRegistry } from './scope-registry';

const REQUIRED_CAPABILITIES = [
  'calendar.events.read',
  'calendar.events.write',
  'tasks.read',
  'tasks.write',
  'gmail.read',
  'gmail.modify',
  'gmail.send',
  'drive.files.read',
  'drive.files.write',
  'docs.read',
  'docs.write',
  'sheets.read',
  'sheets.write',
] as const;

const EXPECTED_SCOPES: Record<(typeof REQUIRED_CAPABILITIES)[number], string> = {
  'calendar.events.read': 'https://www.googleapis.com/auth/calendar.events.readonly',
  'calendar.events.write': 'https://www.googleapis.com/auth/calendar.events',
  'tasks.read': 'https://www.googleapis.com/auth/tasks.readonly',
  'tasks.write': 'https://www.googleapis.com/auth/tasks',
  'gmail.read': 'https://www.googleapis.com/auth/gmail.readonly',
  'gmail.modify': 'https://www.googleapis.com/auth/gmail.modify',
  'gmail.send': 'https://www.googleapis.com/auth/gmail.send',
  'drive.files.read': 'https://www.googleapis.com/auth/drive.file',
  'drive.files.write': 'https://www.googleapis.com/auth/drive.file',
  'docs.read': 'https://www.googleapis.com/auth/drive.file',
  'docs.write': 'https://www.googleapis.com/auth/drive.file',
  'sheets.read': 'https://www.googleapis.com/auth/drive.file',
  'sheets.write': 'https://www.googleapis.com/auth/drive.file',
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
    for (const entry of googleScopeRegistry) expect(source).not.toContain(entry.scope);
  });

  it('uses unique application capability keys', () => {
    const keys = googleScopeRegistry.map((entry) => entry.capability);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses HTTPS provider scope URIs', () => {
    for (const entry of googleScopeRegistry) expect(entry.scope.startsWith('https://www.googleapis.com/auth/')).toBe(true);
  });

  it('keeps Gmail authorization granular', () => {
    expect(getGoogleScope('gmail.read').scope).not.toBe(getGoogleScope('gmail.modify').scope);
    expect(getGoogleScope('gmail.send').scope).not.toBe(getGoogleScope('gmail.modify').scope);
  });
});
