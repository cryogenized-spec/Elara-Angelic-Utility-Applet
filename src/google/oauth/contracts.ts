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
]);

export type GoogleCapabilityKey = z.infer<typeof googleCapabilityKeySchema>;

export interface AuthorizedGoogleRequest {
  readonly capability: GoogleCapabilityKey;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface GoogleOAuthAuthority {
  authorize(capability: GoogleCapabilityKey): Promise<AuthorizedGoogleRequest>;
  getStatus(): Promise<{
    state: 'disconnected' | 'connected' | 'needs-consent' | 'token-recovery' | 'reauthorization-required' | 'partially-authorized' | 'revoked';
    grantedCapabilities: readonly GoogleCapabilityKey[];
  }>;
  disconnect(): Promise<void>;
}
