import { describe, expect, it } from 'vitest';
import { googleToolRegistry } from '../google/tools/registry';

/** Prevent later work from casually widening model memory authority. */
describe('Pass 1 memory authority sentinel', () => {
  it('keeps the model-visible mutation surface to deliberate save only', () => {
    const modelMemoryMutations = googleToolRegistry
      .filter((tool) => tool.exposure === 'gemini' && tool.name.startsWith('memory.') && tool.risk !== 'read')
      .map((tool) => tool.name);
    expect(modelMemoryMutations).toEqual(['memory.save']);
  });
});
