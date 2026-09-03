import type { CharacterProfile } from '../domain/character';
import type { RoleplayPreferences } from '../domain/preferences';

export function buildCharacterInstruction(character: CharacterProfile, roleplay: RoleplayPreferences): string {
  const base = character.systemInstruction.trim();
  if (!roleplay.enabled) return base;
  const environment = [
    roleplay.environmentName.trim() && `Environment: ${roleplay.environmentName.trim()}`,
    roleplay.environmentDescription.trim() && `Environment description: ${roleplay.environmentDescription.trim()}`,
    roleplay.timeOfDay.trim() && `Time: ${roleplay.timeOfDay.trim()}`,
    roleplay.weather.trim() && `Weather: ${roleplay.weather.trim()}`,
    roleplay.atmosphere.trim() && `Atmosphere: ${roleplay.atmosphere.trim()}`,
  ].filter(Boolean).join('\n');
  return [
    base,
    '',
    'CREATIVE ROLEPLAY CONTEXT',
    'This interaction is taking place within a fictional or creative roleplay frame chosen by the user. Continue the established fictional context naturally while remaining truthful about the application as an actual software system.',
    'Presentation convention: use italics for physical action, scene narration, and non-dialogue roleplay description. Use ordinary text for spoken dialogue.',
    environment ? `Current environment:\n${environment}` : '',
  ].filter(Boolean).join('\n');
}
