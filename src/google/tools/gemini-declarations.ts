import { googleToolRegistry } from './registry';

export interface GeminiFunctionDeclaration {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Record<string, never>;
    readonly additionalProperties: true;
  };
}

export const googleGeminiFunctionDeclarations: readonly GeminiFunctionDeclaration[] = googleToolRegistry.map((descriptor) => ({
  type: 'function',
  name: descriptor.name,
  description: descriptor.description,
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: true,
  },
}));

export function googleGeminiFunctionNames(includeRoleplay = false): readonly string[] {
  return googleToolRegistry
    .filter((descriptor) => descriptor.risk === 'read' || (includeRoleplay && descriptor.name.startsWith('roleplay_setting.')))
    .map((tool) => tool.name);
}
