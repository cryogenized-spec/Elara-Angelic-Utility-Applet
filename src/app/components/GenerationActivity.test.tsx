import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GenerationActivity, formatActivityDuration } from './GenerationTrace';

describe('Generation Activity duration formatting', () => {
  it('uses elapsed whole milliseconds below one second', () => {
    expect(formatActivityDuration(0)).toBe('0 ms');
    expect(formatActivityDuration(438.4)).toBe('438 ms');
    expect(formatActivityDuration(999.9)).toBe('999 ms');
  });

  it('uses one decimal second from one second onward', () => {
    expect(formatActivityDuration(1000)).toBe('1.0 s');
    expect(formatActivityDuration(12749)).toBe('12.7 s');
  });

  it('never exposes a negative duration', () => {
    expect(formatActivityDuration(-25)).toBe('0 ms');
  });

  it('reports stages that occurred even when their measured duration is zero', () => {
    const markup = renderToStaticMarkup(<GenerationActivity record={{
      id: 'zero-duration-turn',
      durationMs: 0,
      steps: [
        { id: 'thinking', kind: 'thinking', state: 'done', durationMs: 0, label: 'Thinking' },
        { id: 'writing', kind: 'generation', state: 'done', durationMs: 0, label: 'Writing' },
      ],
    }} />);

    expect(markup).toContain('Thought for 0 ms');
    expect(markup).toContain('wrote in 0 ms');
    expect(markup).toContain('0 ms total');
  });
});
