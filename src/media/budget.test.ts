import { beforeEach, describe, expect, it } from 'vitest';
import {
  SEARCH_BUDGET_PER_SESSION,
  hasSearchBudget,
  releaseSearch,
  reserveSearch,
  resetSearchBudget,
  searchBudget,
} from './budget';

beforeEach(() => {
  resetSearchBudget();
});

describe('per-session search budget', () => {
  it('starts full', () => {
    expect(searchBudget()).toEqual({
      allowance: SEARCH_BUDGET_PER_SESSION,
      spent: 0,
      remaining: SEARCH_BUDGET_PER_SESSION,
    });
    expect(hasSearchBudget()).toBe(true);
  });

  it('spends exactly one per reservation', () => {
    expect(reserveSearch()).toBe(true);
    expect(reserveSearch()).toBe(true);
    expect(searchBudget().spent).toBe(2);
    expect(searchBudget().remaining).toBe(SEARCH_BUDGET_PER_SESSION - 2);
  });

  it('refuses to overspend and keeps refusing', () => {
    resetSearchBudget(2);
    expect(reserveSearch()).toBe(true);
    expect(reserveSearch()).toBe(true);
    expect(reserveSearch()).toBe(false);
    expect(reserveSearch()).toBe(false);
    expect(hasSearchBudget()).toBe(false);
    expect(searchBudget().remaining).toBe(0);
    // A refusal must not itself consume anything.
    expect(searchBudget().spent).toBe(2);
  });

  it('returns a reservation when the call never left the browser', () => {
    resetSearchBudget(1);
    expect(reserveSearch()).toBe(true);
    expect(reserveSearch()).toBe(false);
    releaseSearch();
    expect(reserveSearch()).toBe(true);
  });

  it('never lets release push spending below zero', () => {
    releaseSearch();
    releaseSearch();
    expect(searchBudget().spent).toBe(0);
    expect(searchBudget().remaining).toBe(SEARCH_BUDGET_PER_SESSION);
  });

  it('treats a zero allowance as fully spent', () => {
    resetSearchBudget(0);
    expect(hasSearchBudget()).toBe(false);
    expect(reserveSearch()).toBe(false);
  });

  it('hands out a frozen snapshot the caller cannot mutate', () => {
    const snapshot = searchBudget();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
