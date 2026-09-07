import { describe, expect, it } from 'vitest';
import {
  DRIVE_APP_FILE_SCOPE,
  DRIVE_LIBRARY_SCOPE,
  alternativeReadCapabilities,
  authorizationStateFor,
  computeEffectiveCapabilities,
  inferEnabledReadCapabilities,
  isCapabilityAuthorized,
  normalizeCapabilityKey,
  parseProviderScopes,
  providerSatisfiesCapability,
  resolveAuthorizingCapability,
} from './capability-policy';

describe('Google capability policy', () => {
  it('migrates legacy Drive capability keys to the app-file pair', () => {
    expect(normalizeCapabilityKey('drive.files.read')).toBe('drive.files.app.read');
    expect(normalizeCapabilityKey('drive.files.write')).toBe('drive.files.app.write');
    expect(normalizeCapabilityKey('drive.library.read')).toBe('drive.library.read');
  });

  it('parses GIS scope strings without inventing grants', () => {
    expect(parseProviderScopes(`${DRIVE_APP_FILE_SCOPE} ${DRIVE_LIBRARY_SCOPE}`)).toEqual([
      DRIVE_APP_FILE_SCOPE,
      DRIVE_LIBRARY_SCOPE,
    ]);
    expect(parseProviderScopes('openid email')).toEqual([]);
  });

  it('treats drive.file as technically sufficient for Docs/Sheets/Drive app-file reads and writes', () => {
    expect(providerSatisfiesCapability('docs.read', [DRIVE_APP_FILE_SCOPE])).toBe(true);
    expect(providerSatisfiesCapability('sheets.write', [DRIVE_APP_FILE_SCOPE])).toBe(true);
    expect(providerSatisfiesCapability('drive.library.read', [DRIVE_APP_FILE_SCOPE])).toBe(false);
  });

  it('infers sibling reads from drive.file without inferring writes', () => {
    const inferred = inferEnabledReadCapabilities(['docs.read'], [DRIVE_APP_FILE_SCOPE]);
    expect(inferred).toEqual(expect.arrayContaining(['sheets.read', 'drive.files.app.read']));
    expect(inferred).not.toContain('docs.write');
    expect(inferred).not.toContain('sheets.write');
    expect(inferred).not.toContain('drive.files.app.write');
  });

  it('does not infer Docs/Sheets reads from a library grant', () => {
    expect(inferEnabledReadCapabilities(['drive.library.read'], [DRIVE_LIBRARY_SCOPE])).toEqual([]);
  });

  it('infers Calendar event reads from the write scope but never infers writes', () => {
    const effective = computeEffectiveCapabilities(
      ['calendar.events.write'],
      ['https://www.googleapis.com/auth/calendar.events'],
    );
    expect(effective).toEqual(expect.arrayContaining(['calendar.events.write', 'calendar.events.read']));
    expect(computeEffectiveCapabilities(
      ['calendar.events.read'],
      ['https://www.googleapis.com/auth/calendar.events.readonly'],
    )).not.toContain('calendar.events.write');
  });

  it('never treats a write as effective unless the user enabled it', () => {
    const effective = computeEffectiveCapabilities(['docs.read'], [DRIVE_APP_FILE_SCOPE]);
    expect(effective).toContain('docs.read');
    expect(effective).not.toContain('docs.write');
    expect(effective).not.toContain('sheets.write');
  });

  it('authorizes Docs/Sheets/Drive app reads through an effective library grant', () => {
    const effective = computeEffectiveCapabilities(['drive.library.read'], [DRIVE_LIBRARY_SCOPE]);
    expect(isCapabilityAuthorized('docs.read', effective)).toBe(true);
    expect(isCapabilityAuthorized('sheets.read', effective)).toBe(true);
    expect(isCapabilityAuthorized('drive.files.app.read', effective)).toBe(true);
    expect(isCapabilityAuthorized('docs.write', effective)).toBe(false);
    expect(isCapabilityAuthorized('sheets.write', effective)).toBe(false);
    expect(resolveAuthorizingCapability('docs.read', effective)).toBe('drive.library.read');
  });

  it('keeps library search as a distinct alternative rather than a rename of app-file read', () => {
    expect(alternativeReadCapabilities('docs.read')).toEqual(['docs.read', 'drive.library.read']);
    expect(alternativeReadCapabilities('docs.write')).toEqual(['docs.write']);
  });

  it('reports connected only when v1 core capabilities are effective', () => {
    expect(authorizationStateFor([], [], false)).toBe('disconnected');
    expect(authorizationStateFor(['docs.read'], ['docs.read'], false)).toBe('partially-authorized');
    expect(authorizationStateFor(['docs.read'], ['docs.read'], true)).toBe('reauthorization-required');
  });
});
