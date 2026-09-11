import { describe, expect, it } from 'vitest';
import { RUNTIME_CONTEXT_STALE_AFTER_MS, shouldRefreshRuntimeContext, withRuntimeContext } from './runtime-context';

describe('runtime context', () => {
  it('adds live local date/time and Roleplay guidance without storing state', () => {
    const context = withRuntimeContext('Character Master');
    expect(context).toContain('Character Master');
    expect(context).toContain('Application runtime context:');
    expect(context).toContain('Current local date:');
    expect(context).toContain('Current local time:');
    expect(context).toContain('Current weekday:');
    expect(context).toContain('Local timezone:');
    expect(context).toContain('persistent World Canvas');
    expect(context).toContain('Persistent world mutations require user confirmation');
    expect(context).toContain('Always establish or mention a physical setting');
    expect(context).toContain('Physical action and scene narration use italics');
  });

  it('formats an injectable clock reading without touching the live clock', () => {
    const context = withRuntimeContext('Character Master', {
      now: new Date('2026-01-15T12:34:56Z'),
      timeZone: 'UTC',
    });
    expect(context).toContain('Current local date: January 15, 2026');
    expect(context).toContain('Current local time: 12:34:56');
    expect(context).toContain('Current weekday: Thursday');
    expect(context).toContain('Local timezone: UTC');
  });

  it('omits only the volatile clock on existing-thread turns, keeping stable guidance', () => {
    const context = withRuntimeContext('Character Master', { includeClock: false });
    expect(context).toContain('Character Master');
    expect(context).not.toContain('Application runtime context:');
    expect(context).not.toContain('Current local date:');
    expect(context).not.toContain('Current local time:');
    expect(context).not.toContain('Current weekday:');
    expect(context).not.toContain('Local timezone:');
    // Stable framing — including the confirmation requirement — never depends
    // on clock freshness.
    expect(context).toContain('When Roleplay Mode is active:');
    expect(context).toContain('Persistent world mutations require user confirmation');
    expect(context).toContain('Physical action and scene narration use italics');
  });

  it('keeps the default output byte-identical to the canonical decorator', () => {
    const now = new Date('2026-03-02T03:04:05Z');
    const fresh = withRuntimeContext('Base instruction', { now, timeZone: 'UTC' });
    expect(fresh).toBe(
      [
        'Base instruction',
        '',
        'Application runtime context:',
        '- Current local date: March 2, 2026',
        '- Current local time: 03:04:05',
        '- Current weekday: Monday',
        '- Local timezone: UTC',
        '',
        'When Roleplay Mode is active:',
        '- Treat the persistent World Canvas as authoritative setting context.',
        '- Use roleplay_setting tools to inspect or change persistent world entities when appropriate.',
        '- Persistent world mutations require user confirmation before they are committed.',
        '- Do not store current date, time, weekday, or timezone as persistent world facts.',
        '- Always establish or mention a physical setting when roleplaying.',
        '- Use the current runtime time as dynamic context and use initiative to choose a logical existing location when the narrative calls for one.',
        '- Physical action and scene narration use italics; spoken dialogue uses ordinary text.',
      ].join('\n'),
    );
  });
});

describe('runtime context freshness boundary', () => {
  const NOW = 1_786_000_000_000;

  it('sets the freshness boundary at 30 minutes since the last refresh', () => {
    expect(RUNTIME_CONTEXT_STALE_AFTER_MS).toBe(30 * 60 * 1000);
  });

  it('refreshes when no runtime-context refresh was ever recorded', () => {
    expect(shouldRefreshRuntimeContext(null, NOW)).toBe(true);
    expect(shouldRefreshRuntimeContext(undefined, NOW)).toBe(true);
    expect(shouldRefreshRuntimeContext(Number.NaN, NOW)).toBe(true);
  });

  it('does not refresh normal consecutive turns inside the window', () => {
    expect(shouldRefreshRuntimeContext(NOW, NOW)).toBe(false);
    expect(shouldRefreshRuntimeContext(NOW - 60_000, NOW)).toBe(false);
    expect(shouldRefreshRuntimeContext(NOW - (29 * 60 * 1000 + 59_999), NOW)).toBe(false);
  });

  it('refreshes on the first invocation at or past exactly 30 minutes since the last refresh', () => {
    expect(shouldRefreshRuntimeContext(NOW - RUNTIME_CONTEXT_STALE_AFTER_MS, NOW)).toBe(true);
    expect(shouldRefreshRuntimeContext(NOW - RUNTIME_CONTEXT_STALE_AFTER_MS - 1, NOW)).toBe(true);
    expect(shouldRefreshRuntimeContext(NOW - 3_600_000, NOW)).toBe(true);
  });

  it('never forces a refresh when the clock moved backwards', () => {
    expect(shouldRefreshRuntimeContext(NOW + 1_000, NOW)).toBe(false);
  });
});
