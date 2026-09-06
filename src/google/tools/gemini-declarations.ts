import { googleToolRegistry } from './registry';

export interface GeminiFunctionDeclaration { readonly type: 'function'; readonly name: string; readonly description: string; readonly parameters: { readonly type: 'object'; readonly properties: Record<string, unknown>; readonly additionalProperties: boolean; readonly required?: readonly string[]; }; }

const roleplayProperties: Record<string, unknown> = {
  'roleplay_setting.list': { parentId: { type: 'string', description: 'Optional parent entity id.' } },
  'roleplay_setting.inspect': { id: { type: 'string' }, ref: { type: 'string', description: 'Opaque 16-hex world reference.' } },
  'roleplay_setting.create': { type: { type: 'string', enum: ['building','room','outdoor','place','area','object','world'] }, name: { type: 'string' }, description: { type: 'string' }, parentId: { type: 'string', description: 'Optional parent entity id.' } },
  'roleplay_setting.update': { id: { type: 'string' }, ref: { type: 'string', description: 'Opaque 16-hex world reference.' }, name: { type: 'string' }, description: { type: 'string' }, parentId: { type: 'string', description: 'Set a parent entity id; omit to preserve the current parent.' }, type: { type: 'string', enum: ['building','room','outdoor','place','area','object','world'] } },
  'roleplay_setting.move': { id: { type: 'string' }, ref: { type: 'string', description: 'Opaque 16-hex world reference.' }, parentId: { type: 'string', description: 'Destination parent entity id; omit for world root.' } },
  'roleplay_setting.delete': { id: { type: 'string' }, ref: { type: 'string', description: 'Opaque 16-hex world reference.' } },
};

export const googleGeminiFunctionDeclarations: readonly GeminiFunctionDeclaration[] = googleToolRegistry.map((descriptor) => {
  const properties = roleplayProperties[descriptor.name] ?? {};
  const required = descriptor.name === 'roleplay_setting.create' ? ['type', 'name'] : undefined;
  return { type: 'function', name: descriptor.name, description: descriptor.description, parameters: { type: 'object', properties, additionalProperties: descriptor.name.startsWith('roleplay_setting.') ? false : true, ...(required ? { required } : {}) } };
});

export function googleGeminiFunctionNames(): readonly string[] {
  return googleToolRegistry.filter((descriptor) => descriptor.risk === 'read' || descriptor.name.startsWith('roleplay_setting.')).map((tool) => tool.name);
}
