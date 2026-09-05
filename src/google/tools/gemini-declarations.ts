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

/**
 * The ordinary conversational surface contains only capabilities that have
 * concrete execution handlers today. Additional registered write/destructive
 * tools remain available to explicitly wired application workflows until their
 * handlers are complete.
 */
export function googleGeminiFunctionNames(): readonly string[] {
  return googleToolRegistry
    .filter((descriptor) => descriptor.risk === 'read')
    .map((tool) => tool.name);
}
