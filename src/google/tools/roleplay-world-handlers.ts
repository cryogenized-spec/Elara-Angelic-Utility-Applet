import { validateRoleplayWorldToolArguments, type RoleplayWorldToolName } from './roleplay-world-schemas';
import { loadRoleplayWorld, saveRoleplayWorld } from '../../persistence/roleplay-world';
import type { RoleplayWorld, RoleplayWorldEntity } from '../../domain/roleplay-world';
import type { GoogleToolHandlers } from './executor';

export const ROLEPLAY_WORLD_TOOL_NAMES: readonly RoleplayWorldToolName[] = [
  'roleplay_setting.list',
  'roleplay_setting.inspect',
  'roleplay_setting.create',
  'roleplay_setting.update',
  'roleplay_setting.move',
  'roleplay_setting.delete',
];

export const roleplayWorldToolHandlers: GoogleToolHandlers = {
  'roleplay_setting.list': async ({ arguments: raw }) => {
    const args = validateRoleplayWorldToolArguments('roleplay_setting.list', raw);
    const world = await loadRoleplayWorld();
    return { worldId: world.id, worldName: world.name, entities: world.entities.filter((entity) => entity.parentId === (args.parentId ?? null)).map(publicEntity) };
  },
  'roleplay_setting.inspect': async ({ arguments: raw }) => {
    const args = validateRoleplayWorldToolArguments('roleplay_setting.inspect', raw);
    const world = await loadRoleplayWorld();
    const entity = resolveEntity(world, args.id, args.ref);
    return entity ? publicEntity(entity) : { found: false };
  },
  'roleplay_setting.create': async ({ arguments: raw }) => {
    const args = validateRoleplayWorldToolArguments('roleplay_setting.create', raw);
    const world = await loadRoleplayWorld();
    const now = Date.now();
    const entity: RoleplayWorldEntity = {
      id: nextEntityId(world.entities, slug(args.name)),
      ref: await makeRef(),
      type: args.type,
      name: args.name,
      description: args.description,
      parentId: args.parentId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const next = await saveRoleplayWorld({ ...world, entities: [...world.entities, entity] });
    return { created: publicEntity(next.entities.find((item) => item.ref === entity.ref) ?? entity) };
  },
  'roleplay_setting.update': async ({ arguments: raw }) => {
    const args = validateRoleplayWorldToolArguments('roleplay_setting.update', raw);
    return mutateEntity(args.id, args.ref, (entity) => ({
      ...entity,
      name: args.name ?? entity.name,
      description: args.description ?? entity.description,
      parentId: args.parentId !== undefined ? args.parentId ?? null : entity.parentId,
      type: args.type ?? entity.type,
      updatedAt: Date.now(),
    }));
  },
  'roleplay_setting.move': async ({ arguments: raw }) => {
    const args = validateRoleplayWorldToolArguments('roleplay_setting.move', raw);
    return mutateEntity(args.id, args.ref, (entity) => ({ ...entity, parentId: args.parentId ?? null, updatedAt: Date.now() }));
  },
  'roleplay_setting.delete': async ({ arguments: raw }) => {
    const args = validateRoleplayWorldToolArguments('roleplay_setting.delete', raw);
    const world = await loadRoleplayWorld();
    const entity = resolveEntity(world, args.id, args.ref);
    if (!entity) return { deleted: false, found: false };
    const removeIds = new Set([entity.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of world.entities) {
        if (item.parentId && removeIds.has(item.parentId) && !removeIds.has(item.id)) { removeIds.add(item.id); changed = true; }
      }
    }
    const next = await saveRoleplayWorld({ ...world, entities: world.entities.filter((item) => !removeIds.has(item.id)) });
    return { deleted: true, entity: publicEntity(entity), removedDescendants: Math.max(0, removeIds.size - 1), worldUpdatedAt: next.updatedAt };
  },
};

async function mutateEntity(id: string | undefined, ref: string | undefined, updater: (entity: RoleplayWorldEntity) => RoleplayWorldEntity): Promise<unknown> {
  const world = await loadRoleplayWorld();
  const target = resolveEntity(world, id, ref);
  if (!target) return { updated: false, found: false };
  const next = await saveRoleplayWorld({ ...world, entities: world.entities.map((entity) => entity.id === target.id ? updater(entity) : entity) });
  const updated = next.entities.find((entity) => entity.id === target.id) ?? target;
  return { updated: true, entity: publicEntity(updated) };
}

function resolveEntity(world: RoleplayWorld, id?: string, ref?: string): RoleplayWorldEntity | undefined {
  return (ref ? world.entities.find((entity) => entity.ref === ref) : undefined) ?? (id ? world.entities.find((entity) => entity.id === id) : undefined);
}

function publicEntity(entity: RoleplayWorldEntity) {
  return { id: entity.id, ref: entity.ref, type: entity.type, name: entity.name, description: entity.description, parentId: entity.parentId, createdAt: entity.createdAt, updatedAt: entity.updatedAt };
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'location';
}

function nextEntityId(entities: readonly RoleplayWorldEntity[], base: string): string {
  let index = 1;
  let id = `${base}_01`;
  const ids = new Set(entities.map((entity) => entity.id));
  while (ids.has(id)) { index += 1; id = `${base}_${String(index).padStart(2, '0')}`; }
  return id;
}

async function makeRef(): Promise<string> {
  const seed = `${crypto.randomUUID()}:${Date.now()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
