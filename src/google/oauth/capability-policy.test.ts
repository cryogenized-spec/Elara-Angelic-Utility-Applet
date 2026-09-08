import { describe, expect, it } from 'vitest';
import {
  GOOGLE_V1_CORE_CAPABILITIES,
  GOOGLE_V1_OPTIONAL_CAPABILITIES,
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
import { getGoogleScope, googleScopeRegistry } from './scope-registry';
import type { GoogleCapabilityKey } from './contracts';

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
    expect(effective).toEqual(expect.arrayContaining(['docs.read', 'sheets.read', 'drive.files.app.read']));
    expect(effective).not.toContain('docs.write');
    expect(effective).not.toContain('sheets.write');
    expect(effective).not.toContain('drive.files.app.write');
  });

  it('does not treat a Google drive.file grant as Elara authority by itself', () => {
    expect(computeEffectiveCapabilities([], [DRIVE_APP_FILE_SCOPE])).toEqual([]);
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

describe('effective-capability invariants', () => {
  const scopeOf = (capability: GoogleCapabilityKey): string => {
    const scope = getGoogleScope(capability).scope;
    if (!scope) throw new Error(`expected a provider scope for ${capability}`);
    return scope;
  };

  const SATISFIABILITY_CASES: ReadonlyArray<{ readonly enabled: readonly GoogleCapabilityKey[]; readonly scopes: readonly string[] }> = [
    { enabled: ['docs.read'], scopes: [DRIVE_APP_FILE_SCOPE] },
    { enabled: ['docs.read'], scopes: [DRIVE_LIBRARY_SCOPE] },
    { enabled: ['docs.write'], scopes: [DRIVE_APP_FILE_SCOPE] },
    { enabled: ['docs.write'], scopes: [DRIVE_LIBRARY_SCOPE] },
    { enabled: ['sheets.read'], scopes: [DRIVE_LIBRARY_SCOPE] },
    { enabled: ['gmail.read'], scopes: [scopeOf('gmail.modify')] },
    { enabled: ['gmail.modify'], scopes: [scopeOf('gmail.read')] },
    { enabled: ['gmail.modify', 'gmail.send', 'gmail.labels'], scopes: [scopeOf('gmail.read')] },
    { enabled: ['calendar.events.write'], scopes: [scopeOf('calendar.events.read')] },
    { enabled: ['calendar.events.write'], scopes: [scopeOf('calendar.events.write')] },
    { enabled: ['tasks.write'], scopes: [scopeOf('tasks.read')] },
    { enabled: ['drive.library.read'], scopes: [DRIVE_LIBRARY_SCOPE] },
    { enabled: ['drive.files.app.write'], scopes: [DRIVE_APP_FILE_SCOPE] },
    // Degenerate legacy/corrupt state: enabled capability with NO provider grant.
    { enabled: ['docs.write', 'gmail.modify'], scopes: [] },
    { enabled: ['docs.read', 'gmail.read', 'calendar.events.read'], scopes: [] },
    // Raw provider grants with no enabled capability must manufacture nothing.
    { enabled: [], scopes: [DRIVE_APP_FILE_SCOPE, DRIVE_LIBRARY_SCOPE, scopeOf('calendar.events.write'), scopeOf('calendar.events.read'), scopeOf('gmail.modify'), scopeOf('gmail.read'), scopeOf('tasks.write'), scopeOf('tasks.read')] },
  ];

  it('never reports a provider-backed capability effective that the current scope set cannot satisfy', () => {
    for (const { enabled, scopes } of SATISFIABILITY_CASES) {
      const label = `${enabled.join('+') || '(no enabled capability)'} × ${scopes.join(' ') || '(no scopes)'}`;
      const effective = computeEffectiveCapabilities(enabled, scopes);
      for (const capability of effective) {
        if (capability === 'roleplay.world.local') continue;
        expect(providerSatisfiesCapability(capability, scopes), `${capability} effective without a satisfiable grant [${label}]`).toBe(true);
      }
    }
  });

  it('never manufactures a capability the user did not enable — and a raw grant manufactures nothing at all', () => {
    for (const { enabled, scopes } of SATISFIABILITY_CASES) {
      const label = `${enabled.join('+') || '(no enabled capability)'} × ${scopes.join(' ') || '(no scopes)'}`;
      const effective = computeEffectiveCapabilities(enabled, scopes);
      if (enabled.length === 0) {
        expect(effective, `raw grant manufactured authority [${label}]`).toEqual([]);
        continue;
      }
      for (const capability of effective) {
        if (enabled.includes(capability) || capability === 'roleplay.world.local') continue;
        // Only sibling reads sharing an already-enabled grant may be inferred.
        expect(getGoogleScope(capability).access, `${capability} inferred without explicit enablement [${label}]`).toBe('read');
      }
    }
  });

  it('an enabled capability with no provider grant is never effective', () => {
    expect(computeEffectiveCapabilities(['docs.write', 'gmail.modify'], [])).toEqual([]);
    expect(computeEffectiveCapabilities(['docs.read', 'gmail.read', 'calendar.events.read'], [])).toEqual([]);
    expect(computeEffectiveCapabilities([], [])).toEqual([]);
    expect(computeEffectiveCapabilities(['roleplay.world.local'], [])).toEqual(['roleplay.world.local']);
  });

  it('holds across the reviewed enabled × scope matrix with precise effective sets', () => {
    // docs.read + drive.file → app-file reads effective; writes never inferred.
    let effective = computeEffectiveCapabilities(['docs.read'], [DRIVE_APP_FILE_SCOPE]);
    expect(effective).toEqual(expect.arrayContaining(['docs.read', 'sheets.read', 'drive.files.app.read']));
    for (const write of ['docs.write', 'sheets.write', 'drive.files.app.write'] as const) expect(effective).not.toContain(write);

    // docs.read + drive.readonly → library grant authorizes reads only, and only
    // when the library capability itself is effective.
    effective = computeEffectiveCapabilities(['docs.read', 'drive.library.read'], [DRIVE_LIBRARY_SCOPE]);
    expect(effective).toEqual(['drive.library.read']);
    expect(isCapabilityAuthorized('docs.read', effective)).toBe(true);
    expect(isCapabilityAuthorized('docs.write', effective)).toBe(false);
    expect(isCapabilityAuthorized('sheets.read', effective)).toBe(true);

    // docs.write + drive.file → the enabled write and its implied sibling reads; no other writes.
    effective = computeEffectiveCapabilities(['docs.write'], [DRIVE_APP_FILE_SCOPE]);
    expect(effective).toContain('docs.write');
    expect(effective).toContain('docs.read');
    expect(effective).not.toContain('sheets.write');
    expect(effective).not.toContain('drive.files.app.write');

    // docs.write + drive.readonly → a library grant must never authorize writes.
    expect(computeEffectiveCapabilities(['docs.write'], [DRIVE_LIBRARY_SCOPE])).toEqual([]);

    // gmail.modify + gmail.readonly → only the satisfiable read side is effective.
    effective = computeEffectiveCapabilities(['gmail.modify'], [scopeOf('gmail.read')]);
    expect(effective).toEqual(['gmail.read']);
    expect(effective).not.toContain('gmail.modify');

    // gmail.read + gmail.modify → write scope satisfies the read; modify is never inferred.
    effective = computeEffectiveCapabilities(['gmail.read'], [scopeOf('gmail.modify')]);
    expect(effective).toEqual(['gmail.read']);

    // no enabled capability + broad grant → nothing.
    expect(computeEffectiveCapabilities([], [DRIVE_APP_FILE_SCOPE, scopeOf('calendar.events.write'), scopeOf('gmail.modify')])).toEqual([]);
  });
});

describe('the `connected` definition is pinned to v1 core', () => {
  const CORE = GOOGLE_V1_CORE_CAPABILITIES;
  const OPTIONAL = GOOGLE_V1_OPTIONAL_CAPABILITIES;
  const REGISTERED_NON_CORE = googleScopeRegistry
    .map((entry) => entry.capability)
    .filter((capability) => capability !== 'roleplay.world.local' && !(CORE as readonly string[]).includes(capability));

  it('connected means every v1 core capability is effective', () => {
    expect(authorizationStateFor(CORE, CORE, false)).toBe('connected');
    for (const missing of CORE) {
      expect(authorizationStateFor(CORE, CORE.filter((capability) => capability !== missing), false), `missing ${missing}`).toBe('partially-authorized');
    }
    expect(authorizationStateFor(CORE, CORE, true)).toBe('reauthorization-required');
  });

  it('connected is not the same as every registered Google capability being effective', () => {
    // Core plus extras effective → still connected, because core is what counts…
    expect(authorizationStateFor([...CORE, ...REGISTERED_NON_CORE], [...CORE, ...REGISTERED_NON_CORE], false)).toBe('connected');
    // …but extras alone never manufacture connected.
    for (const extra of REGISTERED_NON_CORE) {
      expect(authorizationStateFor([extra], [extra], false), extra).toBe('partially-authorized');
    }
  });

  it('names the capabilities that must never move `connected`', () => {
    const neverMovesConnected: readonly GoogleCapabilityKey[] = [
      'chat.read',
      'chat.write',
      'calendar.list.read',
      'calendar.settings.read',
      'drive.library.read',
      'gmail.send',
      'gmail.labels',
    ];
    for (const capability of neverMovesConnected) {
      expect(authorizationStateFor([capability], [capability], false), capability).toBe('partially-authorized');
    }
    for (const capability of OPTIONAL) {
      expect(authorizationStateFor([capability], [capability], false), capability).toBe('partially-authorized');
    }
  });
});

describe('produced authorization states stay within the v1-era allowlist', () => {
  const CORE = GOOGLE_V1_CORE_CAPABILITIES;
  const OPTIONAL = GOOGLE_V1_OPTIONAL_CAPABILITIES;
  const REGISTERED_NON_CORE = googleScopeRegistry
    .map((entry) => entry.capability)
    .filter((capability) => capability !== 'roleplay.world.local' && !(CORE as readonly string[]).includes(capability));

  it('the reducer never emits the transport-reserved states', () => {
    const reserved = new Set(['needs-consent', 'token-recovery', 'revoked']);
    const allowed = new Set(['disconnected', 'connected', 'partially-authorized', 'reauthorization-required']);
    const samples: ReadonlyArray<readonly [readonly GoogleCapabilityKey[], readonly GoogleCapabilityKey[], boolean]> = [
      [[], [], false],
      [CORE, CORE, false],
      [CORE, CORE, true],
      [['docs.read'], ['docs.read'], false],
      [['docs.read'], [], false],
      [['docs.read', 'gmail.read'], ['docs.read'], false],
      [OPTIONAL, OPTIONAL, false],
      [['drive.library.read'], ['drive.library.read'], true],
      [[...CORE, ...REGISTERED_NON_CORE], [...CORE], false],
    ];
    for (const [enabled, effective, needsReauthorization] of samples) {
      const state = authorizationStateFor(enabled, effective, needsReauthorization);
      expect(allowed.has(state), `unexpected state ${state}`).toBe(true);
      expect(reserved.has(state), `reserved state ${state} produced by the v1 reducer`).toBe(false);
    }
  });
});
