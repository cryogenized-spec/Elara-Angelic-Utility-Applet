import { describe, expect, it } from 'vitest';
import { isEventsIdentityUniqueConflict } from '../src/autonomy/store';

describe('isEventsIdentityUniqueConflict', () => {
  it('accepts only the events.runKey and events.id unique constraints', () => {
    expect(isEventsIdentityUniqueConflict(new Error('UNIQUE constraint failed: events.runKey'))).toBe(true);
    expect(isEventsIdentityUniqueConflict(new Error('UNIQUE constraint failed: events.id'))).toBe(true);
  });

  it('does not treat other SQLITE_CONSTRAINT failures as duplicates', () => {
    expect(isEventsIdentityUniqueConflict(new Error('UNIQUE constraint failed: events.routineId'))).toBe(false);
    expect(isEventsIdentityUniqueConflict(new Error('CHECK constraint failed: events'))).toBe(false);
    expect(isEventsIdentityUniqueConflict(new Error('NOT NULL constraint failed: events.record'))).toBe(false);
    expect(isEventsIdentityUniqueConflict(new Error('SQLITE_CONSTRAINT'))).toBe(false);
  });
});
