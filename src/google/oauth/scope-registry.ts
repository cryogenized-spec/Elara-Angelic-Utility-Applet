import { z } from 'zod';
import type { GoogleCapabilityKey } from './contracts';

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
  { capability: 'calendar.settings.read', scope: 'https://www.googleapis.com/auth/calendar.settings.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Calendar settings such as time-zone information.' },
  { capability: 'tasks.read', scope: 'https://www.googleapis.com/auth/tasks.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Google Tasks without mutation rights.' },
  { capability: 'tasks.write', scope: 'https://www.googleapis.com/auth/tasks', access: 'write', sensitivity: 'sensitive', rationale: 'Create, edit, organize, and delete Google Tasks.' },
  { capability: 'docs.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Prefer per-file access for documents the app uses.' },
  { capability: 'docs.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Prefer per-file access for documents created or selected through the app.' },
  { capability: 'chat.read', scope: 'https://www.googleapis.com/auth/chat.messages.readonly', access: 'read', sensitivity: 'sensitive', rationale: 'Read Google Chat messages only when the Chat feature is enabled.' },
  { capability: 'chat.write', scope: 'https://www.googleapis.com/auth/chat.spaces', access: 'write', sensitivity: 'sensitive', rationale: 'Use the narrowest current Chat write scope required by the exact operation; verify per method before implementation.' },
  { capability: 'gmail.read', scope: 'https://www.googleapis.com/auth/gmail.readonly', access: 'read', sensitivity: 'restricted', rationale: 'Read Gmail messages and settings; restricted data requires production verification/compliance.' },
  { capability: 'gmail.modify', scope: 'https://www.googleapis.com/auth/gmail.modify', access: 'write', sensitivity: 'restricted', rationale: 'Modify labels or trash state; keep separate from send-only access.' },
  { capability: 'gmail.send', scope: 'https://www.googleapis.com/auth/gmail.send', access: 'send', sensitivity: 'sensitive', rationale: 'Send email without granting mailbox modification rights.' },
  { capability: 'drive.files.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Per-file Drive access is preferred for files opened or created with the app.' },
  { capability: 'drive.files.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Per-file Drive access is preferred over broad Drive access.' },
  { capability: 'sheets.read', scope: 'https://www.googleapis.com/auth/drive.file', access: 'read', sensitivity: 'non-sensitive', rationale: 'Use per-file access for spreadsheets the app uses or the user explicitly selects.' },
  { capability: 'sheets.write', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write', sensitivity: 'non-sensitive', rationale: 'Use per-file access where the Sheets feature can operate on selected/created spreadsheets.' },
];

const registryByCapability = new Map(googleScopeRegistry.map((entry) => [entry.capability, entry]));

export function getGoogleScope(capability: GoogleCapabilityKey): GoogleScopeDescriptor {
  const parsed = z.string().parse(capability) as GoogleCapabilityKey;
  const entry = registryByCapability.get(parsed);
  if (!entry) throw new Error(`Unregistered Google capability: ${parsed}`);
  return entry;
}
