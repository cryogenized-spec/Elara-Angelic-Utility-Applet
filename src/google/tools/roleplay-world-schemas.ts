import { z } from 'zod';

const entityId = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use a valid world entity id.');
const ref = z.string().trim().regex(/^[a-f0-9]{16}$/i, 'Use a 16-hex world reference.');
const text = z.string().trim().max(4_000);
const shortText = z.string().trim().min(1).max(120);
const type = z.enum(['building', 'room', 'outdoor', 'place', 'area', 'object', 'world']);

export const roleplayWorldToolArgumentSchemas = {
  'roleplay_setting.list': z.object({ parentId: entityId.nullish() }).strict(),
  'roleplay_setting.inspect': z.object({ id: entityId.optional(), ref: ref.optional() }).refine((value) => Boolean(value.id || value.ref), 'Provide an id or ref.').strict(),
  'roleplay_setting.create': z.object({
    type,
    name: shortText,
    description: text.default(''),
    parentId: entityId.nullish(),
  }).strict(),
  'roleplay_setting.update': z.object({
    id: entityId.optional(),
    ref: ref.optional(),
    name: shortText.optional(),
    description: text.optional(),
    parentId: entityId.nullish(),
    type: type.optional(),
  }).refine((value) => Boolean(value.id || value.ref), 'Provide an id or ref.').refine(
    (value) => value.name !== undefined || value.description !== undefined || value.parentId !== undefined || value.type !== undefined,
    'Provide at least one change.',
  ).strict(),
  'roleplay_setting.move': z.object({
    id: entityId.optional(),
    ref: ref.optional(),
    parentId: entityId.nullish(),
  }).refine((value) => Boolean(value.id || value.ref), 'Provide an id or ref.').strict(),
  'roleplay_setting.delete': z.object({ id: entityId.optional(), ref: ref.optional() }).refine((value) => Boolean(value.id || value.ref), 'Provide an id or ref.').strict(),
} as const;

export type RoleplayWorldToolName = keyof typeof roleplayWorldToolArgumentSchemas;

export function validateRoleplayWorldToolArguments<T extends RoleplayWorldToolName>(tool: T, value: unknown): z.infer<(typeof roleplayWorldToolArgumentSchemas)[T]> {
  return roleplayWorldToolArgumentSchemas[tool].parse(value) as z.infer<(typeof roleplayWorldToolArgumentSchemas)[T]>;
}
