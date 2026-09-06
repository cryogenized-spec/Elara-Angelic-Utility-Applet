import { describe, expect, it } from 'vitest';
import { ELARA_SYSTEM_INSTRUCTION, hasMasterCharacterInstruction } from './system-instruction';

describe('character system instruction', () => {
  it('ships with an empty default master instruction', () => {
    expect(ELARA_SYSTEM_INSTRUCTION).toBe('');
  });

  it('treats whitespace-only instructions as empty', () => {
    expect(hasMasterCharacterInstruction('   \n\t  ')).toBe(false);
    expect(hasMasterCharacterInstruction('')).toBe(false);
    expect(hasMasterCharacterInstruction(null)).toBe(false);
    expect(hasMasterCharacterInstruction(undefined)).toBe(false);
  });

  it('recognizes visible prompt content', () => {
    expect(hasMasterCharacterInstruction(' Be kind and concise. ')).toBe(true);
  });
});
