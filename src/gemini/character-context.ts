import type { CharacterProfile } from '../domain/character';
import type { RoleplayPreferences } from '../domain/preferences';
import { ELARA_SYSTEM_INSTRUCTION, LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

const LEGACY_DEFAULT_MARKER = 'You are Elara, an angelic synthetic companion designed to be a warm, perceptive, creative conversational presence.\n\nIDENTITY\n';
const LEGACY_ROLEPLAY_MARKER = '\nROLEPLAY\nYou may participate fully in fictional settings and character-driven scenes.';

export function buildCharacterInstruction(character: CharacterProfile, roleplay: RoleplayPreferences): string {
  const configured = character.systemInstruction.trim();
  const base = !configured || configured === LEGACY_CHARACTER_SYSTEM_INSTRUCTION.trim()
    ? ELARA_SYSTEM_INSTRUCTION
    : configured;
  const resolvedBase = base.replaceAll('[[user]]', 'the user');
  if (!roleplay.enabled) return resolvedBase;
  const lines = [
    'CREATIVE ROLEPLAY SCENE CONTEXT',
    'The character protocol above remains the authoritative roleplay behavior. The following fields describe the current fictional scene only.',
    `Environment preset: ${roleplay.environmentPreset}`,
    `Environment name: ${roleplay.environmentName || 'Unspecified'}`,
    `Environment description: ${roleplay.environmentDescription || 'Unspecified'}`,
    `Time of day: ${roleplay.timeOfDay || 'Unspecified'}`,
    `Weather: ${roleplay.weather || 'Unspecified'}`,
    `Atmosphere / mood: ${roleplay.atmosphere || 'Unspecified'}`,
  ];
  return `${resolvedBase}\n\n${lines.join('\n')}`;
}

export function isLegacyDefaultCharacterInstruction(value: string): boolean {
  const normalized = value.trim();
  return normalized === LEGACY_CHARACTER_SYSTEM_INSTRUCTION.trim()
    || (normalized.startsWith(LEGACY_DEFAULT_MARKER) && normalized.includes(LEGACY_ROLEPLAY_MARKER));
}
