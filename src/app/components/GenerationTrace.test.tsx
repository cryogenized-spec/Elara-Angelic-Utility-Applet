import { describe, expect, it } from 'vitest';
import { formatActivityDuration } from './GenerationTrace';

describe('Generation Activity duration formatting', () => {
  it('uses integer milliseconds below one second', () => {
    expect(formatActivityDuration(0)).toBe('0 ms');
    expect(formatActivityDuration(438.4)).toBe('438 ms');
    expect(formatActivityDuration(999.4)).toBe('999 ms');
  });

  it('uses one decimal second from one second onward', () => {
    expect(formatActivityDuration(1000)).toBe('1.0 s');
    expect(formatActivityDuration(12749)).toBe('12.7 s');
  });

  it('never exposes a negative duration', () => {
    expect(formatActivityDuration(-25)).toBe('0 ms');
  });
});
