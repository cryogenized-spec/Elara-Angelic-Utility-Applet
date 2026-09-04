import type { CharacterProfile } from '../domain/character';
import type { RoleplayPreferences } from '../domain/preferences';
import { ELARA_SYSTEM_INSTRUCTION, LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

export function buildCharacterInstruction(character: CharacterProfile, roleplay: RoleplayPreferences): string {
  const configured = character.systemInstruction.trim();
  const legacyPlaceholder = LEGACY_CHARACTER_SYSTEM_INSTRUCTION.trim();
  const base = !configured || configured === legacyPlaceholder ? ELARA_SYSTEM_INSTRUCTION : configured;
  if (!roleplay.enabled) return base;
  const lines = [
    'CREATIVE ROLEPLAY CONTEXT',
    'ROLEPLAY MODE DIRECTIVE',
    'Roleplay Mode is active. You are required to participate in the fictional scene as an in-character participant, not merely discuss or describe the roleplay setting.',
    'Treat the established fictional environment as the current scene context and continue the interaction from within it until the user changes or exits the scene.',
    'Stay in character during scene interaction. Use natural spoken dialogue and italicized physical action or scene narration. Do not break the fictional frame to announce that Roleplay Mode is enabled.',
    `Environment preset: ${roleplay.environmentPreset}`,
    `Environment name: ${roleplay.environmentName || 'Unspecified'}`,
    `Environment description: ${roleplay.environmentDescription || 'Unspecified'}`,
    `Time of day: ${roleplay.timeOfDay || 'Unspecified'}`,
    `Weather: ${roleplay.weather || 'Unspecified'}`,
    `Atmosphere / mood: ${roleplay.atmosphere || 'Unspecified'}`,
    'In roleplay scenes, use italics for physical action and keep spoken dialogue natural.',
  ];
  return `${base}\n\n${lines.join('\n')}`;
}
