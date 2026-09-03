import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHARACTER_PROFILE, type CharacterArtworkReference, type CharacterProfile } from '../domain/character';

const MAX_NAME_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 50_000;
const MAX_ARTWORK_DATA_URL_LENGTH = 8_000_000;
const SAFE_ARTWORK_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const SAFE_ARTWORK_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
    this.version(3).stores({ profiles: 'id, updatedAt' }).upgrade((tx) => {
      return tx.table('profiles').toCollection().modify((record: CharacterProfile) => {
        if (!record.artwork) return;
        record.artwork = {
          ...record.artwork,
          focalX: migrateLegacyFocal(record.artwork.focalX),
          focalY: migrateLegacyFocal(record.artwork.focalY),
        };
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
  if (!value.id || !value.name || !SAFE_ARTWORK_MIME_TYPES.has(value.mimeType)) return null;
  if (typeof value.dataUrl !== 'string' || value.dataUrl.length > MAX_ARTWORK_DATA_URL_LENGTH || !SAFE_ARTWORK_DATA_URL.test(value.dataUrl)) return null;
  return {
    id: String(value.id),
    mimeType: value.mimeType,
    name: value.name.slice(0, 160),
    width: finiteDimension(value.width),
    height: finiteDimension(value.height),
    dataUrl: value.dataUrl,
    focalX: clampPercent(value.focalX),
    focalY: clampPercent(value.focalY),
  };
}

function finiteDimension(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function clampPercent(value: number | undefined): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Number(value) : 50));
}

function migrateLegacyFocal(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  if (value === 1) return 50;
  return Math.max(0, Math.min(100, Number(value)));
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
