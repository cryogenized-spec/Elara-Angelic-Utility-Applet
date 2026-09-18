import { z } from 'zod';

export const googleCapabilityKeySchema = z.enum([
  'calendar.events.read',
  'calendar.events.write',
  'calendar.list.read',
  'calendar.settings.read',
  'calendar.freebusy.read',
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
  /**
   * Optional guard runs immediately before each real provider fetch, including
   * a retry after token refresh. It must throw when the caller has lost the
   * authority to perform the request.
   */
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit, beforeProviderFetch?: () => void) => Promise<Response>;
}

/**
 * The interactive browser-only authority uses disconnected/connected,
 * partially-authorized and reauthorization-required. A paired self-hosted
 * Worker may additionally surface token-recovery while its durable vault is
 * temporarily unreachable. needs-consent/revoked remain available as explicit
 * recovery states for future provider-state refinement.
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
  /** Provider scopes actually returned by Google (GIS `scope` or durable code exchange equivalent). */
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
