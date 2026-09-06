import { describe, expect, it } from 'vitest';
import { ELARA_SYSTEM_INSTRUCTION, hasMasterCharacterInstruction, resolveMasterCharacterInstruction } from './system-instruction';

describe('character system instruction', () => {
  it('ships with an empty default master instruction', () => {
    expect(ELARA_SYSTEM_INSTRUCTION).toBe('');
    expect(resolveMasterCharacterInstruction('')).toBe('');
  });

  it('treats whitespace-only instructions as empty', () => {
    expect(hasMasterCharacterInstruction('   \n\t  ')).toBe(false);
    expect(hasMasterCharacterInstruction('')).toBe(false);
    expect(hasMasterCharacterInstruction(null)).toBe(false);
    expect(hasMasterCharacterInstruction(undefined)).toBe(false);
    expect(resolveMasterCharacterInstruction('   \n\t  ')).toBe('');
  });

  it('recognizes visible prompt content', () => {
    expect(hasMasterCharacterInstruction(' Be kind and concise. ')).toBe(true);
  });

  it('preserves a configured master instruction exactly', () => {
    const configured = 'PERSONA PROTOCOL: ELARA\n\nYou are Elara.\nAnswer as Elara.';
    expect(resolveMasterCharacterInstruction(configured)).toBe(configured);
  });
});
