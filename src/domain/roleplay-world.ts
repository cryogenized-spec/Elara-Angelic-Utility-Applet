import { z } from 'zod';

export const roleplayWorldEntityTypeSchema = z.enum(['world', 'building', 'room', 'outdoor', 'place', 'area', 'object']);
export type RoleplayWorldEntityType = z.infer<typeof roleplayWorldEntityTypeSchema>;

export interface RoleplayWorldEntity {
  id: string;
  ref: string;
  type: RoleplayWorldEntityType;
  name: string;
  description: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoleplayWorld {
  version: 1;
  id: string;
  name: string;
  description: string;
  entities: RoleplayWorldEntity[];
  updatedAt: number;
}

export const DEFAULT_ROLEPLAY_WORLD: RoleplayWorld = {
  version: 1,
  id: 'world_01',
  name: 'Untitled World',
  description: '',
  entities: [],
  updatedAt: 0,
};

export function normalizeRoleplayWorld(value: Partial<RoleplayWorld> | null | undefined): RoleplayWorld {
  const merged = { ...DEFAULT_ROLEPLAY_WORLD, ...(value ?? {}) };
  const entities = Array.isArray(merged.entities) ? merged.entities : [];
  return {
    version: 1,
    id: safeId(merged.id, DEFAULT_ROLEPLAY_WORLD.id),
    name: safeText(merged.name, 120),
    description: safeText(merged.description, 4_000),
    entities: entities
      .map((entity) => normalizeEntity(entity))
      .filter((entity): entity is RoleplayWorldEntity => Boolean(entity)),
    updatedAt: Number.isFinite(merged.updatedAt) ? merged.updatedAt : 0,
  };
}

export function serializeRoleplayWorldYaml(world: RoleplayWorld): string {
  const lines = [
    'world:',
    `  id: ${yamlScalar(world.id)}`,
    `  name: ${yamlScalar(world.name)}`,
    `  description: ${yamlScalar(world.description)}`,
    '  locations:',
  ];
  const ordered = [...world.entities].sort((a, b) => a.id.localeCompare(b.id));
  if (!ordered.length) lines.push('    {}');
  for (const entity of ordered) {
    lines.push(`    ${entity.id}:`);
    lines.push(`      ref: ${yamlScalar(entity.ref)}`);
    lines.push(`      type: ${yamlScalar(entity.type)}`);
    lines.push(`      name: ${yamlScalar(entity.name)}`);
    lines.push(`      parent: ${yamlScalar(entity.parentId ?? '')}`);
    lines.push(`      description: ${yamlScalar(entity.description)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function childEntities(world: RoleplayWorld, parentId: string | null): RoleplayWorldEntity[] {
  return world.entities
    .filter((entity) => entity.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function normalizeEntity(value: unknown): RoleplayWorldEntity | null {
  if (!value || typeof value !== 'object') return null;
  const entity = value as Partial<RoleplayWorldEntity>;
  const id = safeId(entity.id, '');
  const ref = safeRef(entity.ref, '');
  if (!id || !ref) return null;
  return {
    id,
    ref,
    type: roleplayWorldEntityTypeSchema.safeParse(entity.type).success ? entity.type as RoleplayWorldEntityType : 'place',
    name: safeText(entity.name, 120),
    description: safeText(entity.description, 4_000),
    parentId: typeof entity.parentId === 'string' && entity.parentId.trim() ? entity.parentId.trim() : null,
    createdAt: Number.isFinite(entity.createdAt) ? entity.createdAt as number : Date.now(),
    updatedAt: Number.isFinite(entity.updatedAt) ? entity.updatedAt as number : Date.now(),
  };
}

function safeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return normalized || fallback;
}

function safeRef(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-f0-9]{16}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
