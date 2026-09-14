import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SEARCH_BUDGET_PER_DEVICE_DAY,
  SEARCH_BUDGET_PER_SESSION,
  dailySearchBudget,
  hasSearchBudget,
  releaseSearch,
  reserveSearch,
  resetDailySearchBudget,
  resetSearchBudget,
  searchBudget,
  youtubeQuotaDay,
} from './budget';
import { mediaDb } from './storage';

const NOW = Date.parse('2026-09-14T12:00:00Z');

beforeEach(async () => {
  resetSearchBudget();
  await resetDailySearchBudget();
});

describe('YouTube search budget', () => {
  it('starts with a full session and device-day allowance', async () => {
    expect(searchBudget()).toEqual({
      allowance: SEARCH_BUDGET_PER_SESSION,
      spent: 0,
      remaining: SEARCH_BUDGET_PER_SESSION,
    });
    expect(hasSearchBudget()).toBe(true);

    expect(await dailySearchBudget(NOW)).toEqual({
      quotaDay: youtubeQuotaDay(NOW),
      allowance: SEARCH_BUDGET_PER_DEVICE_DAY,
      spent: 0,
      remaining: SEARCH_BUDGET_PER_DEVICE_DAY,
    });
  });

  it('spends one session slot and one persistent daily slot per reservation', async () => {
    expect((await reserveSearch(NOW)).granted).toBe(true);
    expect((await reserveSearch(NOW)).granted).toBe(true);

    expect(searchBudget().spent).toBe(2);
    expect(searchBudget().remaining).toBe(SEARCH_BUDGET_PER_SESSION - 2);
    expect((await dailySearchBudget(NOW)).spent).toBe(2);
  });

  it('refuses to overspend the per-session ceiling without consuming the daily ledger', async () => {
    resetSearchBudget(2);
    expect((await reserveSearch(NOW)).granted).toBe(true);
    expect((await reserveSearch(NOW)).granted).toBe(true);
    expect(await reserveSearch(NOW)).toEqual({ granted: false, scope: 'session' });
    expect(await reserveSearch(NOW)).toEqual({ granted: false, scope: 'session' });

    expect(hasSearchBudget()).toBe(false);
    expect(searchBudget().spent).toBe(2);
    expect((await dailySearchBudget(NOW)).spent).toBe(2);
  });

  it('does not let a page reload reset the persistent device-day ceiling', async () => {
    await resetDailySearchBudget(2);
    resetSearchBudget(8);
    expect((await reserveSearch(NOW)).granted).toBe(true);
    expect((await reserveSearch(NOW)).granted).toBe(true);

    // A reload creates a fresh module/session budget, but the IndexedDB row is
    // still authoritative for the provider quota day.
    resetSearchBudget(8);
    expect(await reserveSearch(NOW)).toEqual({ granted: false, scope: 'daily' });
    expect(searchBudget().spent).toBe(0);
    expect((await dailySearchBudget(NOW)).spent).toBe(2);
  });

  it('serializes concurrent reservations so sibling tabs cannot overspend the shared row', async () => {
    await resetDailySearchBudget(2);
    resetSearchBudget(10);

    const reservations = await Promise.all([
      reserveSearch(NOW),
      reserveSearch(NOW),
      reserveSearch(NOW),
    ]);

    expect(reservations.filter((entry) => entry.granted)).toHaveLength(2);
    expect(reservations.filter((entry) => !entry.granted)).toEqual([{ granted: false, scope: 'daily' }]);
    expect((await dailySearchBudget(NOW)).spent).toBe(2);
    expect(searchBudget().spent).toBe(2);
  });

  it('treats a corrupt same-day persistent counter as exhausted rather than granting quota', async () => {
    await mediaDb.dailySearchBudget.put({
      id: 'youtube-search',
      quotaDay: youtubeQuotaDay(NOW),
      spent: -999,
      updatedAt: NOW,
    });

    const observed = await dailySearchBudget(NOW);
    expect(observed.spent).toBe(SEARCH_BUDGET_PER_DEVICE_DAY);
    expect(observed.remaining).toBe(0);
    expect(await reserveSearch(NOW)).toEqual({ granted: false, scope: 'daily' });
    expect(searchBudget().spent).toBe(0);
  });

  it('ignores even malformed spending from an old quota day when the provider day rolls over', async () => {
    await mediaDb.dailySearchBudget.put({
      id: 'youtube-search',
      quotaDay: '2026-09-13',
      spent: -999,
      updatedAt: NOW - 86_400_000,
    });

    expect((await reserveSearch(NOW)).granted).toBe(true);
    expect((await dailySearchBudget(NOW)).spent).toBe(1);
  });

  it('refunds both ledgers when a provider request provably never left the browser', async () => {
    await resetDailySearchBudget(1);
    resetSearchBudget(1);
    const reservation = await reserveSearch(NOW);
    expect(reservation.granted).toBe(true);

    await releaseSearch(reservation, NOW + 10);

    expect(searchBudget().spent).toBe(0);
    expect((await dailySearchBudget(NOW + 10)).spent).toBe(0);
    expect((await reserveSearch(NOW + 20)).granted).toBe(true);
  });

  it('rolls the persistent allowance over at midnight Pacific rather than local/UTC midnight', async () => {
    await resetDailySearchBudget(1);
    resetSearchBudget(8);
    const beforePacificMidnight = Date.parse('2026-09-14T06:59:00Z');
    const afterPacificMidnight = Date.parse('2026-09-14T07:01:00Z');

    expect(youtubeQuotaDay(beforePacificMidnight)).toBe('2026-09-13');
    expect(youtubeQuotaDay(afterPacificMidnight)).toBe('2026-09-14');
    expect((await reserveSearch(beforePacificMidnight)).granted).toBe(true);
    expect(await reserveSearch(beforePacificMidnight)).toEqual({ granted: false, scope: 'daily' });
    expect((await reserveSearch(afterPacificMidnight)).granted).toBe(true);
    expect((await dailySearchBudget(afterPacificMidnight)).spent).toBe(1);
  });

  it('never lets a session-only release push spending below zero', async () => {
    await releaseSearch();
    await releaseSearch();
    expect(searchBudget().spent).toBe(0);
    expect(searchBudget().remaining).toBe(SEARCH_BUDGET_PER_SESSION);
  });

  it('treats a zero session allowance as fully spent without touching IndexedDB', async () => {
    resetSearchBudget(0);
    expect(hasSearchBudget()).toBe(false);
    expect(await reserveSearch(NOW)).toEqual({ granted: false, scope: 'session' });
    expect((await dailySearchBudget(NOW)).spent).toBe(0);
  });

  it('hands out a frozen session snapshot the caller cannot mutate', () => {
    const snapshot = searchBudget();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
