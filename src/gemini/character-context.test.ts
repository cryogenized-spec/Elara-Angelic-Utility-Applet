import { describe, expect, it } from 'vitest';
import { buildCharacterInstruction } from './character-context';
import { DEFAULT_CHARACTER_PROFILE } from '../domain/character';
import { DEFAULT_ROLEPLAY } from '../domain/preferences';
import { ELARA_SYSTEM_INSTRUCTION, LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

describe('buildCharacterInstruction', () => {
  it('uses the canonical Elara system instruction by default', () => {
    const result = buildCharacterInstruction(DEFAULT_CHARACTER_PROFILE, DEFAULT_ROLEPLAY);
    expect(result).toBe(ELARA_SYSTEM_INSTRUCTION);
    expect(result).not.toContain('CREATIVE ROLEPLAY CONTEXT');
  });

  it('upgrades the legacy placeholder to the canonical instruction', () => {
    const legacy = { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: LEGACY_CHARACTER_SYSTEM_INSTRUCTION };
    expect(buildCharacterInstruction(legacy, DEFAULT_ROLEPLAY)).toBe(ELARA_SYSTEM_INSTRUCTION);
  });

  it('preserves an explicitly customized character instruction', () => {
    const custom = { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: 'Always answer like a concise museum guide.' };
    expect(buildCharacterInstruction(custom, DEFAULT_ROLEPLAY)).toBe(custom.systemInstruction);
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

    expect(result).toContain(ELARA_SYSTEM_INSTRUCTION);
    expect(result).toContain('CREATIVE ROLEPLAY CONTEXT');
    expect(result).toContain('The Moonlit Room');
    expect(result).toContain('A quiet room with low light.');
    expect(result).toContain('late evening');
    expect(result).toContain('rain outside');
    expect(result).toContain('intimate and calm');
    expect(result).toContain('italics for physical action');
  });
});
