import { describe, expect, it } from 'vitest';
import { buildCharacterInstruction } from './character-context';
import { DEFAULT_CHARACTER_PROFILE } from '../domain/character';
import { DEFAULT_ROLEPLAY } from '../domain/preferences';

describe('buildCharacterInstruction', () => {
  it('returns only the character master instruction when roleplay is disabled', () => {
    const result = buildCharacterInstruction(DEFAULT_CHARACTER_PROFILE, DEFAULT_ROLEPLAY);
    expect(result).toBe(DEFAULT_CHARACTER_PROFILE.systemInstruction.trim());
    expect(result).not.toContain('CREATIVE ROLEPLAY CONTEXT');
  });

  it('adds structured creative context without turning it into chat content', () => {
    const result = buildCharacterInstruction(DEFAULT_CHARACTER_PROFILE, {
      ...DEFAULT_ROLEPLAY,
      enabled: true,
      environmentPreset: 'bedroom',
      environmentName: 'The Moonlit Room',
      environmentDescription: 'A quiet room with low light.',
      timeOfDay: 'late evening',
      weather: 'rain outside',
      atmosphere: 'intimate and calm',
    });

    expect(result).toContain(DEFAULT_CHARACTER_PROFILE.systemInstruction.trim());
    expect(result).toContain('CREATIVE ROLEPLAY CONTEXT');
    expect(result).toContain('The Moonlit Room');
    expect(result).toContain('A quiet room with low light.');
    expect(result).toContain('late evening');
    expect(result).toContain('rain outside');
    expect(result).toContain('intimate and calm');
    expect(result).toContain('italics for physical action');
  });
});
