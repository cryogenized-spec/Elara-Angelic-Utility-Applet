import { z } from 'zod';
import { googleCapabilityKeySchema, type GoogleCapabilityKey } from './contracts';

export type GoogleScopeSensitivity = 'non-sensitive' | 'sensitive' | 'restricted';

export interface GoogleScopeDescriptor {
  readonly capability: GoogleCapabilityKey;
  readonly scope: string;
  readonly access: 'read' | 'write' | 'send';
  readonly sensitivity: GoogleScopeSensitivity;
  readonly rationale: string;
}

/**
 * Application-owned OAuth registry. Provider scope strings belong here, never in
 * model-visible tool schemas. Choose the narrowest practical Google scope for
 * each capability and review this table against Google's live scope catalog.
 */
export const googleScopeRegistry: readonly GoogleScopeDescriptor[] = [
  { capability: 'calendar.events.read', scope: 'https://www.googleapis.com/auth/calendar.events.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Calendar events without granting calendar mutation.' },
  { capability: 'calendar.events.write', scope: 'https://www.googleapis.com/auth/calendar.events', access: 'write', sensitivity: 'sensitive', rationale: 'Create and edit Calendar events when explicitly required.' },
  { capability: 'calendar.list.read', scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read subscribed calendar list without calendar mutation.' },
  { capability: 'calendar.settings.read', scope: 'https://www.googleapis.com/auth/calendar.settings.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Calendar settings without calendar mutation.' },
  { capability: 'tasks.read', scope: 'https://www.googleapis.com/auth/tasks.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Google Tasks without mutation rights.' },
  { capability: 'tasks.write', scope: 'https://www.googleapis.com/auth/tasks', access: 'write', sensitivity: 'sensitive', rationale: 'Create, edit, organize, and delete Google Tasks.' },
  { capability: 'docs.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'App-file Docs reads; library discovery is a separate capability.' },
  { capability: 'docs.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'App-file Docs writes. Never inferred from a provider grant alone.' },
  { capability: 'chat.read', scope: 'https://www.googleapis.com/auth/chat.messages.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Google Chat messages only when Chat is enabled. Deferred from Workspace v1.' },
  { capability: 'chat.write', scope: 'https://www.googleapis.com/auth/chat.messages', access: 'write', sensitivity: 'sensitive', rationale: 'Create, update, and delete user-authenticated Google Chat messages. Deferred from Workspace v1.' },
  { capability: 'gmail.read', scope: 'https://www.googleapis.com/auth/gmail.readonly', access: 'read', sensitivity: 'restricted', rationale: 'Read Gmail data; restricted user-data access requires production verification/compliance planning.' },
  { capability: 'gmail.modify', scope: 'https://www.googleapis.com/auth/gmail.modify', access: 'write', sensitivity: 'restricted', rationale: 'Modify message/thread labels and trash state.' },
  { capability: 'gmail.labels', scope: 'https://www.googleapis.com/auth/gmail.labels', access: 'write', sensitivity: 'restricted', rationale: 'Manage mailbox labels without using the broader message-modification capability for label administration.' },
  { capability: 'gmail.send', scope: 'https://www.googleapis.com/auth/gmail.send', access: 'send', sensitivity: 'sensitive', rationale: 'Send mail without granting mailbox modification rights.' },
  { capability: 'drive.files.app.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Read files the app created or the user admitted into the app-file boundary.' },
  { capability: 'drive.files.app.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Create or change files inside the app-file boundary. Never inferred from drive.file alone.' },
  { capability: 'drive.library.read', scope: 'https://www.googleapis.com/auth/drive.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Search and read the user\'s broader Drive corpus. Distinct consent path from app-file access.' },
  { capability: 'sheets.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'App-file Sheets reads; library discovery is a separate capability.' },
  { capability: 'sheets.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'App-file Sheets writes. Never inferred from a provider grant alone.' },
  { capability: 'roleplay.world.local', scope: '', access: 'write', sensitivity: 'non-sensitive', rationale: 'Application-local Roleplay World Canvas; no Google OAuth scope is required.' },
];

const registryByCapability = new Map(googleScopeRegistry.map((entry) => [entry.capability, entry]));

export function getGoogleScope(capability: GoogleCapabilityKey): GoogleScopeDescriptor {
  const parsed = googleCapabilityKeySchema.parse(capability);
  const entry = registryByCapability.get(parsed);
  if (!entry) throw new Error(`Unregistered Google capability: ${parsed}`);
  return entry;
}
