import { z } from 'zod';

export const googleCapabilityKeySchema = z.enum([
  'calendar.events.read',
  'calendar.events.write',
  'calendar.list.read',
  'calendar.settings.read',
  'tasks.read',
  'tasks.write',
  'docs.read',
  'docs.write',
  'chat.read',
  'chat.write',
  'gmail.read',
  'gmail.modify',
  'gmail.labels',
  'gmail.send',
  'drive.files.app.read',
  'drive.files.app.write',
  'drive.library.read',
  'sheets.read',
  'sheets.write',
  'roleplay.world.local',
]);

export type GoogleCapabilityKey = z.infer<typeof googleCapabilityKeySchema>;

export interface AuthorizedGoogleRequest {
  readonly capability: GoogleCapabilityKey;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * GIS token-client-era reducers can only produce `disconnected`, `connected`,
 * `partially-authorized`, and `reauthorization-required`.
 *
 * `needs-consent`, `token-recovery`, and `revoked` are RESERVED for the
 * durable authorization-code + PKCE authority (a later, separate subsystem).
 * The v1 reducer must never emit them; callers may still treat them as
 * recovery states defensively.
 */
export type GoogleOAuthState =
  | 'disconnected'
  | 'connected'
  | 'needs-consent'
  | 'token-recovery'
  | 'reauthorization-required'
  | 'partially-authorized'
  | 'revoked';

export interface GoogleOAuthStatus {
  readonly state: GoogleOAuthState;
  /** Effective capabilities: user-enabled (plus inferred reads) that the provider grant currently satisfies. */
  readonly grantedCapabilities: readonly GoogleCapabilityKey[];
  /** Capabilities the user explicitly enabled in Elara. Writes are never inferred into this set. */
  readonly enabledCapabilities: readonly GoogleCapabilityKey[];
  /** Provider scopes actually returned by Google (GIS `scope` or equivalent). */
  readonly grantedProviderScopes: readonly string[];
  readonly account?: {
    readonly email: string;
    readonly displayName?: string;
  };
}

export interface GoogleOAuthAuthority {
  authorize(capability: GoogleCapabilityKey): Promise<AuthorizedGoogleRequest>;
  getStatus(): Promise<GoogleOAuthStatus>;
  disconnect(): Promise<void>;
}
