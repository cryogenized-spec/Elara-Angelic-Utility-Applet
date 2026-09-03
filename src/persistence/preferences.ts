import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY, type ChatAppearancePreferences, type RoleplayPreferences } from '../domain/preferences';

type PreferenceRecord =
  | { id: 'chat-appearance'; value: ChatAppearancePreferences; updatedAt: number }
  | { id: 'roleplay'; value: RoleplayPreferences; updatedAt: number };

class PreferencesDatabase extends Dexie {
  preferences!: Table<PreferenceRecord, string>;
  constructor() {
    super('elara-preferences');
    this.version(1).stores({ preferences: 'id, updatedAt' });
  }
}

const db = new PreferencesDatabase();

export async function loadChatAppearance(): Promise<ChatAppearancePreferences> {
  const record = await db.preferences.get('chat-appearance');
  return record?.id === 'chat-appearance' ? record.value : DEFAULT_CHAT_APPEARANCE;
}

export async function saveChatAppearance(value: ChatAppearancePreferences): Promise<ChatAppearancePreferences> {
  const next = { ...DEFAULT_CHAT_APPEARANCE, ...value, updatedAt: Date.now() } as PreferenceRecord;
  await db.preferences.put({ id: 'chat-appearance', value: nextValue(next, DEFAULT_CHAT_APPEARANCE), updatedAt: next.updatedAt });
  return nextValue(next, DEFAULT_CHAT_APPEARANCE);
}

export async function loadRoleplayPreferences(): Promise<RoleplayPreferences> {
  const record = await db.preferences.get('roleplay');
  return record?.id === 'roleplay' ? record.value : DEFAULT_ROLEPLAY;
}

export async function saveRoleplayPreferences(value: RoleplayPreferences): Promise<RoleplayPreferences> {
  const next = { ...DEFAULT_ROLEPLAY, ...value, updatedAt: Date.now() } as PreferenceRecord;
  await db.preferences.put({ id: 'roleplay', value: nextValue(next, DEFAULT_ROLEPLAY), updatedAt: next.updatedAt });
  return nextValue(next, DEFAULT_ROLEPLAY);
}

function nextValue<T>(record: PreferenceRecord, defaults: T): T {
  return record.value ? { ...defaults, ...record.value } : defaults;
}
