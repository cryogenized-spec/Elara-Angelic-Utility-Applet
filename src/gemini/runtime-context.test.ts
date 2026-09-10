import { describe, expect, it } from 'vitest';
import { withRuntimeContext } from './runtime-context';

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

  it('describes the durable-memory capability as deliberate model judgment, not a keyword trigger', () => {
    const context = withRuntimeContext('Character Master');
    expect(context).toContain('DURABLE MEMORY');
    expect(context).toContain('memory.save');
    expect(context).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(context).toContain('never treat every statement as permanent memory');
    expect(context).toContain('must never produce a save');
    expect(context).not.toMatch(/includes\(\s*['"]remember/i);
  });
});
