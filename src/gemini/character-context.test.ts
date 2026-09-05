import { describe, expect, it } from 'vitest';
import { buildCharacterInstruction } from './character-context';
import { DEFAULT_CHARACTER_PROFILE } from '../domain/character';
import { DEFAULT_ROLEPLAY } from '../domain/preferences';
import { ELARA_SYSTEM_INSTRUCTION, LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

describe('buildCharacterInstruction', () => {
  it('uses the canonical Elara system instruction by default and activates it at runtime', () => {
    const result = buildCharacterInstruction(DEFAULT_CHARACTER_PROFILE, DEFAULT_ROLEPLAY);
    expect(result).toContain(ELARA_SYSTEM_INSTRUCTION);
    expect(result).toContain('CHARACTER EXECUTION DIRECTIVE');
    expect(result).toContain('supplied master character protocol is active runtime behavior');
    expect(result).toContain('Default to responding as the configured character in character.');
    expect(result).toContain('IN-CHARACTER OUTPUT CONTRACT');
    expect(result).toContain('Every normal conversational response must be authored from the character’s established perspective and voice.');
    expect(result).toContain('Do not produce generic virtual-assistant greetings');
    expect(result).not.toContain('CREATIVE ROLEPLAY CONTEXT');
    expect(result).not.toContain('ROLEPLAY MODE DIRECTIVE');
  });

  it('upgrades the legacy placeholder to the canonical instruction', () => {
    const result = buildCharacterInstruction(
      { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: LEGACY_CHARACTER_SYSTEM_INSTRUCTION },
      DEFAULT_ROLEPLAY,
    );
    expect(result).toContain(ELARA_SYSTEM_INSTRUCTION);
    expect(result).toContain('CHARACTER EXECUTION DIRECTIVE');
  });

  it('preserves and activates an explicitly customized character instruction', () => {
    const custom = { ...DEFAULT_CHARACTER_PROFILE, systemInstruction: 'Always answer like a concise museum guide.' };
    const result = buildCharacterInstruction(custom, DEFAULT_ROLEPLAY);
    expect(result).toContain(custom.systemInstruction);
    expect(result).toContain('CHARACTER EXECUTION DIRECTIVE');
    expect(result).toContain('active runtime behavior');
    expect(result).toContain('IN-CHARACTER OUTPUT CONTRACT');
    expect(result).not.toContain(ELARA_SYSTEM_INSTRUCTION);
  });

  it('adds an explicit in-character roleplay directive when Roleplay Mode is enabled', () => {
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
    expect(result).toContain('CHARACTER EXECUTION DIRECTIVE');
    expect(result).toContain('IN-CHARACTER OUTPUT CONTRACT');
    expect(result).toContain('CREATIVE ROLEPLAY CONTEXT');
    expect(result).toContain('ROLEPLAY MODE DIRECTIVE');
    expect(result).toContain('in-character participant');
    expect(result).toContain('Treat the established fictional environment as the current scene context');
    expect(result).toContain('Do not break the fictional frame to announce that Roleplay Mode is enabled.');
    expect(result).toContain('The Moonlit Room');
    expect(result).toContain('A quiet room with low light.');
    expect(result).toContain('late evening');
    expect(result).toContain('rain outside');
    expect(result).toContain('intimate and calm');
    expect(result).toContain('italics for physical action');
  });
});
