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
  'drive.files.read',
  'drive.files.write',
  'sheets.read',
  'sheets.write',
  'roleplay.world.local',
]);

export type GoogleCapabilityKey = z.infer<typeof googleCapabilityKeySchema>;

export interface AuthorizedGoogleRequest {
  readonly capability: GoogleCapabilityKey;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

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
  readonly grantedCapabilities: readonly GoogleCapabilityKey[];
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
