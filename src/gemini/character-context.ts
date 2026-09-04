import type { CharacterProfile } from '../domain/character';
import type { RoleplayPreferences } from '../domain/preferences';
import { ELARA_SYSTEM_INSTRUCTION, LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

const CHARACTER_EXECUTION_DIRECTIVE = [
  'CHARACTER EXECUTION DIRECTIVE',
  'The supplied master character protocol is active runtime behavior, not optional reference material.',
  'Apply its identity, relationship, personality, behavioral, communication, and formatting instructions to every response unless a higher-priority application or provider rule requires otherwise.',
  'Default to responding as the configured character in character. Do not step outside the character merely because the user has not explicitly said “roleplay”.',
  'Do not discuss, summarize, or negotiate the character protocol unless the user explicitly asks for an out-of-character configuration or debugging discussion.',
].join('\n');

export function buildCharacterInstruction(character: CharacterProfile, roleplay: RoleplayPreferences): string {
  const configured = character.systemInstruction.trim();
  const legacyPlaceholder = LEGACY_CHARACTER_SYSTEM_INSTRUCTION.trim();
  const base = !configured || configured === legacyPlaceholder ? ELARA_SYSTEM_INSTRUCTION : configured;
  const lines = [CHARACTER_EXECUTION_DIRECTIVE];
  if (roleplay.enabled) {
    lines.push(
      'CREATIVE ROLEPLAY CONTEXT',
      'ROLEPLAY MODE DIRECTIVE',
      'Roleplay Mode is active. Participate in the fictional scene as an in-character participant rather than merely discussing the roleplay setting.',
      'Treat the established fictional environment as the current scene context and continue the interaction from within it until the user changes or exits the scene.',
      'Stay in character during scene interaction. Use natural spoken dialogue and italicized physical action or scene narration. Do not break the fictional frame to announce that Roleplay Mode is enabled.',
      `Environment preset: ${roleplay.environmentPreset}`,
      `Environment name: ${roleplay.environmentName || 'Unspecified'}`,
      `Environment description: ${roleplay.environmentDescription || 'Unspecified'}`,
      `Time of day: ${roleplay.timeOfDay || 'Unspecified'}`,
      `Weather: ${roleplay.weather || 'Unspecified'}`,
      `Atmosphere / mood: ${roleplay.atmosphere || 'Unspecified'}`,
      'In roleplay scenes, use italics for physical action and keep spoken dialogue natural.',
    );
  }
  return `${base}\n\n${lines.join('\n')}`;
}
