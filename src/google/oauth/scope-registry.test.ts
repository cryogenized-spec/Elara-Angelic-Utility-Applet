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

describe('Google OAuth scope registry', () => {
  it('contains every first-class Workspace capability', () => {
    for (const capability of REQUIRED_CAPABILITIES) expect(() => getGoogleScope(capability)).not.toThrow();
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
});
