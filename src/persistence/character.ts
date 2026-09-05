import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHARACTER_PROFILE, type CharacterArtworkReference, type CharacterProfile } from '../domain/character';
import { LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

const MAX_NAME_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 50_000;
const MAX_ARTWORK_DATA_URL_LENGTH = 8_000_000;
const SAFE_ARTWORK_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const SAFE_ARTWORK_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LEGACY_DEFAULT_MARKER = 'You are Elara, an angelic synthetic companion designed to be a warm, perceptive, creative conversational presence.\n\nIDENTITY\n';
const LEGACY_ROLEPLAY_MARKER = '\nROLEPLAY\nYou may participate fully in fictional settings and character-driven scenes.';

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

function normalizeSystemInstruction(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CHARACTER_PROFILE.systemInstruction;
  const normalized = value.slice(0, MAX_INSTRUCTION_LENGTH);
  const trimmed = normalized.trim();
  if (!trimmed || trimmed === LEGACY_CHARACTER_SYSTEM_INSTRUCTION.trim()) return DEFAULT_CHARACTER_PROFILE.systemInstruction;
  if (trimmed.startsWith(LEGACY_DEFAULT_MARKER) && trimmed.includes(LEGACY_ROLEPLAY_MARKER)) return DEFAULT_CHARACTER_PROFILE.systemInstruction;
  return normalized;
}

export function normalizeCharacterProfile(input: Partial<CharacterProfile> | null | undefined): CharacterProfile {
  const rawArtwork = input?.artwork;
  const artwork = rawArtwork && typeof rawArtwork === 'object' ? normalizeArtwork(rawArtwork as CharacterArtworkReference) : null;
  return {
    id: PRIMARY_ID,
    name: typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_CHARACTER_PROFILE.name : DEFAULT_CHARACTER_PROFILE.name,
    systemInstruction: normalizeSystemInstruction(input?.systemInstruction),
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
  if (existing) {
    const normalized = normalizeCharacterProfile(existing);
    if (normalized.systemInstruction !== existing.systemInstruction || normalized.name !== existing.name || normalized.artworkMode !== existing.artworkMode) await db.profiles.put(normalized);
    return normalized;
  }
  const initial = normalizeCharacterProfile({ ...DEFAULT_CHARACTER_PROFILE, updatedAt: Date.now() });
  await db.profiles.put(initial);
  return initial;
}

export async function saveCharacterProfile(profile: CharacterProfile): Promise<CharacterProfile> {
  const next = normalizeCharacterProfile({ ...profile, id: PRIMARY_ID, updatedAt: Date.now() });
  await db.profiles.put(next);
  return next;
}
