import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHARACTER_PROFILE, type CharacterProfile } from '../domain/character';

class CharacterDatabase extends Dexie {
  profiles!: Table<CharacterProfile, string>;
  constructor() {
    super('elara-character-profile');
    this.version(1).stores({ profiles: 'id, updatedAt' });
  }
}

const db = new CharacterDatabase();
const PRIMARY_ID = 'primary';

export async function loadCharacterProfile(): Promise<CharacterProfile> {
  const existing = await db.profiles.get(PRIMARY_ID);
  if (existing) return existing;
  const initial: CharacterProfile = { ...DEFAULT_CHARACTER_PROFILE, updatedAt: Date.now() };
  await db.profiles.put(initial);
  return initial;
}

export async function saveCharacterProfile(profile: CharacterProfile): Promise<CharacterProfile> {
  const next: CharacterProfile = {
    ...profile,
    id: PRIMARY_ID,
    name: profile.name.trim().slice(0, 80) || DEFAULT_CHARACTER_PROFILE.name,
    systemInstruction: profile.systemInstruction.slice(0, 50000),
    updatedAt: Date.now(),
  };
  await db.profiles.put(next);
  return next;
}
