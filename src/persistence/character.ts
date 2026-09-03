import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHARACTER_PROFILE, type CharacterArtworkReference, type CharacterProfile } from '../domain/character';

const MAX_NAME_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 50_000;
const MAX_ARTWORK_DATA_URL_LENGTH = 8_000_000;

class CharacterDatabase extends Dexie {
  profiles!: Table<CharacterProfile, string>;
  constructor() {
    super('elara-character-profile');
    this.version(1).stores({ profiles: 'id, updatedAt' });
    this.version(2).stores({ profiles: 'id, updatedAt' }).upgrade((tx) => {
      return tx.table('profiles').toCollection().modify((record: CharacterProfile) => {
        Object.assign(record, normalizeCharacterProfile(record));
      });
    });
  }
}

const db = new CharacterDatabase();
const PRIMARY_ID = 'primary';

export function normalizeCharacterProfile(input: Partial<CharacterProfile> | null | undefined): CharacterProfile {
  const rawArtwork = input?.artwork;
  const artwork = rawArtwork && typeof rawArtwork === 'object' ? normalizeArtwork(rawArtwork as CharacterArtworkReference) : null;
  return {
    id: PRIMARY_ID,
    name: typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_CHARACTER_PROFILE.name : DEFAULT_CHARACTER_PROFILE.name,
    systemInstruction: typeof input?.systemInstruction === 'string' ? input.systemInstruction.slice(0, MAX_INSTRUCTION_LENGTH) : DEFAULT_CHARACTER_PROFILE.systemInstruction,
    artworkMode: input?.artworkMode === 'landscape' ? 'landscape' : 'portrait',
    artwork,
    updatedAt: typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : 0,
  };
}

function normalizeArtwork(value: CharacterArtworkReference): CharacterArtworkReference | null {
  if (!value.id || !value.mimeType || !value.name || typeof value.dataUrl !== 'string') return null;
  if (!value.dataUrl.startsWith('data:image/')) return null;
  if (value.dataUrl.length > MAX_ARTWORK_DATA_URL_LENGTH) return null;
  return {
    id: String(value.id),
    mimeType: value.mimeType,
    name: value.name.slice(0, 160),
    width: finiteDimension(value.width),
    height: finiteDimension(value.height),
    dataUrl: value.dataUrl,
    focalX: clampUnit(value.focalX),
    focalY: clampUnit(value.focalY),
  };
}

function finiteDimension(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function clampUnit(value: number | undefined): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? Number(value) : 0.5));
}

export async function loadCharacterProfile(): Promise<CharacterProfile> {
  const existing = await db.profiles.get(PRIMARY_ID);
  if (existing) return normalizeCharacterProfile(existing);
  const initial = normalizeCharacterProfile({ ...DEFAULT_CHARACTER_PROFILE, updatedAt: Date.now() });
  await db.profiles.put(initial);
  return initial;
}

export async function saveCharacterProfile(profile: CharacterProfile): Promise<CharacterProfile> {
  const next = normalizeCharacterProfile({ ...profile, id: PRIMARY_ID, updatedAt: Date.now() });
  await db.profiles.put(next);
  return next;
}
