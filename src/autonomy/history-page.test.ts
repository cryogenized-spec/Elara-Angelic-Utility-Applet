import { describe, expect, it } from 'vitest';
import { HISTORY_PAGE_SIZE, nextHistoryCursor, parseHistoryCursor } from './history-page';

describe('history keyset pagination', () => {
  it('parses afterAt/afterId/limit with defaults', () => {
    expect(parseHistoryCursor(new URLSearchParams())).toEqual({ cursor: { at: 0, id: '' }, limit: HISTORY_PAGE_SIZE });
    expect(parseHistoryCursor(new URLSearchParams('afterAt=9&afterId=run-a&limit=50'))).toEqual({ cursor: { at: 9, id: 'run-a' }, limit: 50 });
  });

  it('caps limit at HISTORY_PAGE_SIZE', () => {
    expect(parseHistoryCursor(new URLSearchParams('limit=9999')).limit).toBe(HISTORY_PAGE_SIZE);
  });

  it('returns a next cursor only for a full page', () => {
    const page = Array.from({ length: 3 }, (_, index) => ({ id: `id-${index}`, startedAt: 100 + index }));
    expect(nextHistoryCursor(page, (row) => row.startedAt, 3)).toEqual({ at: 102, id: 'id-2' });
    expect(nextHistoryCursor(page, (row) => row.startedAt, 4)).toBeNull();
    expect(nextHistoryCursor([], (row: { startedAt: number }) => row.startedAt, 3)).toBeNull();
  });
});
