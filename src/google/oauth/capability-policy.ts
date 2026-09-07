import { googleCapabilityKeySchema, type GoogleCapabilityKey, type GoogleOAuthState } from './contracts';
import { getGoogleScope, googleScopeRegistry } from './scope-registry';

/**
 * A provider scope is not an application capability.
 *
 * Chain: application capability → required provider scope(s) → granted scopes → effective capabilities.
 * Reads that share an already-enabled provider grant may be inferred. Writes/sends never are.
 */

export const DRIVE_APP_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_LIBRARY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Write/send scopes that also satisfy the matching read-only provider scope. */
export const PROVIDER_SCOPE_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
  'https://www.googleapis.com/auth/calendar.events': ['https://www.googleapis.com/auth/calendar.events.readonly'],
  'https://www.googleapis.com/auth/tasks': ['https://www.googleapis.com/auth/tasks.readonly'],
  'https://www.googleapis.com/auth/gmail.modify': ['https://www.googleapis.com/auth/gmail.readonly'],
  'https://www.googleapis.com/auth/chat.messages': ['https://www.googleapis.com/auth/chat.messages.readonly'],
};

export const LEGACY_CAPABILITY_ALIASES: Readonly<Record<string, GoogleCapabilityKey>> = {
  'drive.files.read': 'drive.files.app.read',
  'drive.files.write': 'drive.files.app.write',
};

/** Core v1 capabilities. Optional extras (Gmail send/labels, Drive library) do not block `connected`. */
export const GOOGLE_V1_CORE_CAPABILITIES = [
  'calendar.events.read',
  'calendar.events.write',
  'tasks.read',
  'tasks.write',
  'gmail.read',
  'gmail.modify',
  'drive.files.app.read',
  'drive.files.app.write',
  'docs.read',
  'docs.write',
  'sheets.read',
  'sheets.write',
] as const satisfies readonly GoogleCapabilityKey[];

export const GOOGLE_V1_OPTIONAL_CAPABILITIES = [
  'gmail.labels',
  'gmail.send',
  'drive.library.read',
] as const satisfies readonly GoogleCapabilityKey[];

const FILE_READ_CAPABILITIES = new Set<GoogleCapabilityKey>([
  'docs.read',
  'sheets.read',
  'drive.files.app.read',
]);

const CHAT_CAPABILITIES = new Set<GoogleCapabilityKey>(['chat.read', 'chat.write']);

export function normalizeCapabilityKey(value: string): GoogleCapabilityKey | undefined {
  const aliased = LEGACY_CAPABILITY_ALIASES[value] ?? value;
  const parsed = googleCapabilityKeySchema.safeParse(aliased);
  return parsed.success ? parsed.data : undefined;
}

export function parseProviderScopes(scopeHeader: string | undefined | null): string[] {
  if (!scopeHeader) return [];
  return [...new Set(scopeHeader.split(/\s+/).map((part) => part.trim()).filter((part) => part.startsWith('https://')))];
}

export function expandProviderScopes(granted: readonly string[]): ReadonlySet<string> {
  const expanded = new Set(granted);
  for (const scope of granted) {
    for (const implied of PROVIDER_SCOPE_IMPLICATIONS[scope] ?? []) expanded.add(implied);
  }
  return expanded;
}

export function providerSatisfiesCapability(capability: GoogleCapabilityKey, grantedScopes: readonly string[]): boolean {
  const required = getGoogleScope(capability).scope;
  if (!required) return true;
  return expandProviderScopes(grantedScopes).has(required);
}

/**
 * Sibling *read* capabilities whose required provider scope is already granted.
 * Never infers write/send capabilities. Chat stays out of v1 inference.
 */
export function inferEnabledReadCapabilities(
  enabled: readonly GoogleCapabilityKey[],
  grantedScopes: readonly string[],
): GoogleCapabilityKey[] {
  const expanded = expandProviderScopes(grantedScopes);
  const enabledScopes = new Set(
    enabled
      .map((capability) => getGoogleScope(capability).scope)
      .filter((scope): scope is string => Boolean(scope)),
  );
  const inferred: GoogleCapabilityKey[] = [];
  for (const entry of googleScopeRegistry) {
    if (entry.access !== 'read' || !entry.scope) continue;
    if (CHAT_CAPABILITIES.has(entry.capability)) continue;
    if (enabled.includes(entry.capability)) continue;
    if (!expanded.has(entry.scope)) continue;
    const userAlreadyUsesThisGrant = enabledScopes.has(entry.scope)
      || [...enabledScopes].some((scope) => (PROVIDER_SCOPE_IMPLICATIONS[scope] ?? []).includes(entry.scope));
    if (!userAlreadyUsesThisGrant) continue;
    inferred.push(entry.capability);
  }
  return inferred;
}

export function computeEffectiveCapabilities(
  enabled: readonly GoogleCapabilityKey[],
  grantedScopes: readonly string[],
): GoogleCapabilityKey[] {
  if (enabled.length > 0 && grantedScopes.length === 0) return [...enabled];
  const inferredReads = inferEnabledReadCapabilities(enabled, grantedScopes);
  const candidates = [...new Set([...enabled, ...inferredReads])];
  return candidates.filter((capability) => {
    if (capability === 'roleplay.world.local') return true;
    return providerSatisfiesCapability(capability, grantedScopes);
  });
}

export function authorizationStateFor(
  enabled: readonly GoogleCapabilityKey[],
  effective: readonly GoogleCapabilityKey[],
  needsReauthorization: boolean,
): GoogleOAuthState {
  if (enabled.length === 0 && effective.length === 0) return 'disconnected';
  if (needsReauthorization) return 'reauthorization-required';
  const coreSatisfied = GOOGLE_V1_CORE_CAPABILITIES.every((capability) => effective.includes(capability));
  return coreSatisfied ? 'connected' : 'partially-authorized';
}

export function alternativeReadCapabilities(capability: GoogleCapabilityKey): readonly GoogleCapabilityKey[] {
  if (!FILE_READ_CAPABILITIES.has(capability)) return [capability];
  return [capability, 'drive.library.read'];
}

export function isCapabilityAuthorized(
  capability: GoogleCapabilityKey,
  effective: readonly GoogleCapabilityKey[],
): boolean {
  if (capability === 'roleplay.world.local') return true;
  return alternativeReadCapabilities(capability).some((candidate) => effective.includes(candidate));
}

export function resolveAuthorizingCapability(
  requested: GoogleCapabilityKey,
  effective: readonly GoogleCapabilityKey[],
): GoogleCapabilityKey | undefined {
  if (requested === 'roleplay.world.local') return requested;
  for (const candidate of alternativeReadCapabilities(requested)) {
    if (effective.includes(candidate)) return candidate;
  }
  return undefined;
}

export const CAPABILITY_CONSENT_COPY: Readonly<Record<GoogleCapabilityKey, string>> = {
  'calendar.events.read': 'To continue, Elara needs permission to read your Google Calendar.',
  'calendar.events.write': 'To continue, Elara needs permission to create or edit Google Calendar events.',
  'calendar.list.read': 'To continue, Elara needs permission to see which calendars you subscribe to.',
  'calendar.settings.read': 'To continue, Elara needs permission to read your Calendar settings.',
  'tasks.read': 'To continue, Elara needs permission to read your Google Tasks.',
  'tasks.write': 'To continue, Elara needs permission to create or change Google Tasks.',
  'docs.read': 'To continue, Elara needs permission to read Google Docs in her app-file boundary — or Drive library access to read a discovered document.',
  'docs.write': 'To continue, Elara needs permission to create or edit Google Docs she is allowed to use.',
  'chat.read': 'To continue, Elara needs permission to read Google Chat messages.',
  'chat.write': 'To continue, Elara needs permission to send or change Google Chat messages.',
  'gmail.read': 'To continue, Elara needs permission to read your Gmail.',
  'gmail.modify': 'To continue, Elara needs permission to organize Gmail messages and threads.',
  'gmail.labels': 'To continue, Elara needs permission to manage Gmail labels.',
  'gmail.send': 'To continue, Elara needs permission to send email from your Gmail account.',
  'drive.files.app.read': 'To continue, Elara needs permission to read files in her app-file boundary.',
  'drive.files.app.write': 'To continue, Elara needs permission to create or change files in her app-file boundary.',
  'drive.library.read': 'To continue, Elara needs permission to search your broader Google Drive library. This is more sensitive than app-file access.',
  'sheets.read': 'To continue, Elara needs permission to read spreadsheets in her app-file boundary — or Drive library access to read a discovered spreadsheet.',
  'sheets.write': 'To continue, Elara needs permission to change spreadsheets she is allowed to use.',
  'roleplay.world.local': 'Roleplay World is application-local and does not use Google.',
};
