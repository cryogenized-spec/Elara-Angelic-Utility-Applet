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

/**
 * The Gemini tool surface is derived directly from the hard-coded application registry.
 * Argument validation remains the responsibility of executeGoogleTool().
 */
export const googleGeminiFunctionDeclarations: readonly GeminiFunctionDeclaration[] = googleToolRegistry.map((descriptor) => ({
  type: 'function',
  name: descriptor.name,
  description: `${descriptor.description} Application tool risk: ${descriptor.risk}.`,
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: true,
  },
}));

export function googleGeminiFunctionNames(): readonly string[] {
  return googleGeminiFunctionDeclarations.map((tool) => tool.name);
}
