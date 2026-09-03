import { describe, expect, it } from 'vitest';
import { demoThreadTitlePort } from './thread-title-port';

describe('thread title generation contract', () => {
  it('returns a short 3–10 word title for a meaningful first message', async () => {
    const title = await demoThreadTitlePort.generateTitle('Please plan my weekend trip around Durban and Ballito');
    const wordCount = title.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(3);
    expect(wordCount).toBeLessThanOrEqual(10);
  });

  it('never blocks the turn on empty input', async () => {
    await expect(demoThreadTitlePort.generateTitle('')).resolves.toBe('New conversation');
  });
});
