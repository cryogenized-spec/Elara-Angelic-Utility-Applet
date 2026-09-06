import Dexie, { type Table } from 'dexie';
import { DEFAULT_ROLEPLAY_WORLD, normalizeRoleplayWorld, type RoleplayWorld } from '../domain/roleplay-world';
import type { RoleplayPreferences } from '../domain/preferences';

interface RoleplayWorldRecord {
  id: 'primary';
  value: RoleplayWorld;
  updatedAt: number;
}

class RoleplayWorldDatabase extends Dexie {
  worlds!: Table<RoleplayWorldRecord, string>;

  constructor() {
    super('elara-roleplay-world');
    this.version(1).stores({ worlds: 'id, updatedAt' });
  }
}

const db = new RoleplayWorldDatabase();

export async function loadRoleplayWorld(legacyRoleplay?: RoleplayPreferences): Promise<RoleplayWorld> {
  const record = await db.worlds.get('primary');
  if (record?.id === 'primary') return normalizeRoleplayWorld(record.value);

  const migrated = migrateLegacyRoleplay(legacyRoleplay);
  if (migrated.entities.length || migrated.name !== DEFAULT_ROLEPLAY_WORLD.name || migrated.description) {
    return saveRoleplayWorld(migrated);
  }
  return DEFAULT_ROLEPLAY_WORLD;
}

export async function saveRoleplayWorld(value: RoleplayWorld): Promise<RoleplayWorld> {
  const next = { ...normalizeRoleplayWorld(value), updatedAt: Date.now() };
  await db.worlds.put({ id: 'primary', value: next, updatedAt: next.updatedAt });
  return next;
}

export async function updateRoleplayWorld(mutator: (current: RoleplayWorld) => RoleplayWorld): Promise<RoleplayWorld> {
  const current = await loadRoleplayWorld();
  return saveRoleplayWorld(mutator(current));
}

function migrateLegacyRoleplay(value?: RoleplayPreferences): RoleplayWorld {
  if (!value) return DEFAULT_ROLEPLAY_WORLD;
  const name = value.environmentName?.trim();
  const description = value.environmentDescription?.trim();
  if (!name && !description) return DEFAULT_ROLEPLAY_WORLD;
  const now = Date.now();
  return {
    version: 1,
    id: 'world_01',
    name: name || 'Untitled World',
    description: description || '',
    entities: [{
      id: 'setting_01',
      ref: '0000000000000001',
      type: value.environmentPreset && value.environmentPreset !== 'none' ? 'place' : 'world',
      name: name || 'Setting',
      description: description || '',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    }],
    updatedAt: now,
  };
}
