import { describe, expect, it } from 'vitest';
import { buildCharacterInstruction } from './character-context';
import { DEFAULT_CHARACTER_PROFILE } from '../domain/character';
import { DEFAULT_ROLEPLAY } from '../domain/preferences';
import { ELARA_SYSTEM_INSTRUCTION, LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

describe('buildCharacterInstruction', () => {
  it('uses the canonical Elara system instruction unchanged when roleplay scene context is disabled', () => {
    expect(buildCharacterInstruction(DEFAULT_CHARACTER_PROFILE, DEFAULT_ROLEPLAY)).toBe(ELARA_SYSTEM_INSTRUCTION.replaceAll('[[user]]', 'the user'));
  });

  it('upgrades the legacy placeholder to the canonical instruction', () => {
    expect(buildCharacterInstruction({ ...DEFAULT_CHARACTER_PROFILE, systemInstruction: LEGACY_CHARACTER_SYSTEM_INSTRUCTION }, DEFAULT_ROLEPLAY))
      .toBe(ELARA_SYSTEM_INSTRUCTION.replaceAll('[[user]]', 'the user'));
  });

  it('preserves an explicitly customized master prompt without appending a competing generic roleplay policy', () => {
    const custom = { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: 'PERSONA PROTOCOL: ELARA\nDefault to being in character.\nRoleplay at all times.' };
    expect(buildCharacterInstruction(custom, DEFAULT_ROLEPLAY)).toBe(custom.systemInstruction);
    expect(buildCharacterInstruction(custom, DEFAULT_ROLEPLAY)).not.toContain('CHARACTER EXECUTION DIRECTIVE');
    expect(buildCharacterInstruction(custom, DEFAULT_ROLEPLAY)).not.toContain('IN-CHARACTER OUTPUT CONTRACT');
  });

  it('resolves the legacy [[user]] placeholder without changing other prompt content', () => {
    const custom = { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: 'Stay close to [[user]] and speak directly to [[user]].' };
    expect(buildCharacterInstruction(custom, DEFAULT_ROLEPLAY)).toBe('Stay close to the user and speak directly to the user.');
  });

  it('adds only scene context when Roleplay Mode is enabled', () => {
    const custom = { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: 'PERSONA PROTOCOL: ELARA\nRoleplay at all times.' };
    const result = buildCharacterInstruction(custom, {
      ...DEFAULT_ROLEPLAY,
      enabled: true,
      environmentPreset: 'bedroom',
      environmentName: 'The Moonlit Room',
      environmentDescription: 'A quiet room with low light.',
      timeOfDay: 'late evening',
      weather: 'rain outside',
      atmosphere: 'intimate and calm',
    });

    expect(result).toContain('PERSONA PROTOCOL: ELARA');
    expect(result).toContain('CREATIVE ROLEPLAY SCENE CONTEXT');
    expect(result).toContain('The character protocol above remains the authoritative roleplay behavior.');
    expect(result).toContain('The Moonlit Room');
    expect(result).toContain('A quiet room with low light.');
    expect(result).toContain('late evening');
    expect(result).toContain('rain outside');
    expect(result).toContain('intimate and calm');
    expect(result).not.toContain('ROLEPLAY MODE DIRECTIVE');
    expect(result).not.toContain('CHARACTER EXECUTION DIRECTIVE');
  });
});
