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
  { capability: 'docs.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Per-file access is sufficient for documents the app creates or explicitly uses.' },
  { capability: 'docs.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Per-file access is sufficient for documents the app creates or explicitly uses.' },
  { capability: 'chat.read', scope: 'https://www.googleapis.com/auth/chat.messages.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Google Chat messages only when Chat is enabled.' },
  { capability: 'chat.write', scope: 'https://www.googleapis.com/auth/chat.messages', access: 'write', sensitivity: 'sensitive', rationale: 'Create, update, and delete user-authenticated Google Chat messages without granting unrelated space administration.' },
  { capability: 'gmail.read', scope: 'https://www.googleapis.com/auth/gmail.readonly', access: 'read', sensitivity: 'restricted', rationale: 'Read Gmail data; restricted user-data access requires production verification/compliance planning.' },
  { capability: 'gmail.modify', scope: 'https://www.googleapis.com/auth/gmail.modify', access: 'write', sensitivity: 'restricted', rationale: 'Modify message/thread labels and trash state.' },
  { capability: 'gmail.labels', scope: 'https://www.googleapis.com/auth/gmail.labels', access: 'write', sensitivity: 'restricted', rationale: 'Manage mailbox labels without using the broader message-modification capability for label administration.' },
  { capability: 'gmail.send', scope: 'https://www.googleapis.com/auth/gmail.send', access: 'send', sensitivity: 'sensitive', rationale: 'Send mail without granting mailbox modification rights.' },
  { capability: 'drive.files.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Per-file Drive access is preferred for files opened or created with the app.' },
  { capability: 'drive.files.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Per-file Drive access is preferred over broad Drive access.' },
  { capability: 'sheets.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Per-file access is preferred for explicitly selected or app-created spreadsheets.' },
  { capability: 'sheets.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Per-file access is preferred for explicitly selected or app-created spreadsheets.' },
  { capability: 'roleplay.world.local', scope: '', access: 'write', sensitivity: 'non-sensitive', rationale: 'Application-local Roleplay World Canvas; no Google OAuth scope is required.' },
];

const registryByCapability = new Map(googleScopeRegistry.map((entry) => [entry.capability, entry]));

export function getGoogleScope(capability: GoogleCapabilityKey): GoogleScopeDescriptor {
  const parsed = googleCapabilityKeySchema.parse(capability);
  const entry = registryByCapability.get(parsed);
  if (!entry) throw new Error(`Unregistered Google capability: ${parsed}`);
  return entry;
}
