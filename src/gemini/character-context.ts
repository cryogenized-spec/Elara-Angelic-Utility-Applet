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
