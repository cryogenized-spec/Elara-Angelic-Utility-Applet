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
 * Gemini sees the registered application capabilities directly.
 * Risk, authorization, confirmation, and execution remain application-side
 * implementation details and are never presented as a competing persona policy.
 */
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

export function googleGeminiFunctionNames(): readonly string[] {
  return googleGeminiFunctionDeclarations.map((tool) => tool.name);
}
