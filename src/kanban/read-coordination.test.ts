import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRead, emptySchedule, ownsRead, READ_LEASE_MS, releaseRead, waitForReader, type ReadSchedule } from './read-coordination';

let first: Dexie;
let second: Dexie;
let a: Table<ReadSchedule, string>;
let b: Table<ReadSchedule, string>;
beforeEach(() => {
  const name = `read-coordination-${crypto.randomUUID()}`;
  first = new Dexie(name); second = new Dexie(name);
  for (const db of [first, second]) db.version(1).stores({ schedules: '&account' });
  a = first.table('schedules'); b = second.table('schedules');
});
afterEach(async () => { vi.useRealTimers(); second.close(); await first.delete(); });

describe('same-origin read coordination', () => {
  it('elects exactly one reader across connections and isolates accounts', async () => {
    const claims = await Promise.all([claimRead(a, 'one', 'tab-a', Infinity, false), claimRead(b, 'one', 'tab-b', Infinity, false)]);
    expect(claims.map(({ kind }) => kind).sort()).toEqual(['acquired', 'waiting']);
    expect((await claimRead(b, 'two', 'tab-b', Infinity, false)).kind).toBe('acquired');
  });
  it('shares cooldowns and a paused budget, including across manual clicks', async () => {
    const until = Date.now() + 60000;
    await a.put({ ...emptySchedule('one'), failures: 5, paused: true, nextRetryAt: until, error: '429' });
    expect((await claimRead(b, 'one', 'b', Infinity, true)).kind).toBe('blocked');
    expect((await claimRead(b, 'one', 'b', Infinity, false, until + 1)).kind).toBe('blocked');
    const manual = await claimRead(b, 'one', 'b', Infinity, true, until + 1);
    expect(manual.kind).toBe('acquired'); expect(manual.schedule.failures).toBe(0);
  });
  it('coalesces fresh automatic reads but not explicit refresh or a pending failure', async () => {
    const now = Date.now();
    await a.put({ ...emptySchedule('one'), lastSuccessAt: now });
    expect((await claimRead(b, 'one', 'b', now - 1, false)).kind).toBe('fresh');
    expect((await claimRead(b, 'one', 'b', now - 1, true)).kind).toBe('acquired');
    await releaseRead(b, 'one', 'b', { failures: 1, nextRetryAt: now - 1 });
    expect((await claimRead(a, 'one', 'a', now - 1, false)).kind).toBe('acquired');
  });
  it('fences expired owners after suspension and never clears a replacement lease', async () => {
    await claimRead(a, 'one', 'old', Infinity, false);
    await a.update('one', { leaseUntil: Date.now() - 1 });
    expect(await ownsRead(a, 'one', 'old')).toBe(false);
    expect((await claimRead(b, 'one', 'new', Infinity, false)).kind).toBe('acquired');
    expect(await releaseRead(a, 'one', 'old', { failures: 5, paused: true })).toBe(false);
    expect((await b.get('one'))?.owner).toBe('new');
    expect((await b.get('one'))?.failures).toBe(0);
  });
  it('wakes a waiting tab from a database notification on normal release', async () => {
    const { schedule } = await claimRead(a, 'one', 'a', Infinity, false);
    const waiting = waitForReader(b, schedule, new AbortController().signal);
    await releaseRead(a, 'one', 'a');
    await waiting;
    expect((await claimRead(b, 'one', 'b', Infinity, false)).kind).toBe('acquired');
  });
  it('cancels a waiter without releasing another tab’s lease', async () => {
    const { schedule } = await claimRead(a, 'one', 'a', Infinity, false);
    const controller = new AbortController();
    const waiting = waitForReader(b, schedule, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    expect(await ownsRead(a, 'one', 'a')).toBe(true);
  });
  it('recovers a crashed tab at lease expiry without recurring polling', async () => {
    const { schedule } = await claimRead(a, 'one', 'a', Infinity, false);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const waiting = waitForReader(b, schedule, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(READ_LEASE_MS + 1);
    await waiting;
    expect((await claimRead(b, 'one', 'b', Infinity, false)).kind).toBe('acquired');
    expect(await releaseRead(a, 'one', 'a')).toBe(false);
  });
});
