import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type StoredGeminiQuotaLedger } from '../persistence/conversation';
import {
  estimateSerializedInputTokens,
  finalizeGeminiQuotaReservation,
  geminiQuotaSnapshot,
  reserveGeminiQuota,
  resetGeminiQuotaLedgerForTests,
} from './quota-ledger';

const T0 = 1_800_000_000_000;

describe('Gemini rolling quota ledger', () => {
  beforeEach(async () => {
    await resetGeminiQuotaLedgerForTests();
  });

  it('does not mistake inline image transport bytes for prompt-text tokens', () => {
    const encodedImage = 'A'.repeat(1_000_000);
    const imageEstimate = estimateSerializedInputTokens({
      input: [{ type: 'image', mime_type: 'image/png', data: encodedImage }],
    });
    const textEstimate = estimateSerializedInputTokens({
      input: [{ type: 'text', text: encodedImage }],
    });

    expect(imageEstimate).toBeGreaterThanOrEqual(12_000);
    expect(imageEstimate).toBeLessThan(20_000);
    expect(textEstimate).toBeGreaterThan(200_000);
  });

  it('reserves for remote image inputs even when only a provider URI is present', () => {
    const estimate = estimateSerializedInputTokens({
      input: [{ type: 'image', mime_type: 'image/png', uri: 'https://example.test/provider-file' }],
    });
    expect(estimate).toBeGreaterThanOrEqual(12_000);
  });

  it('reserves conservatively before provider dispatch and replaces the estimate with provider truth', async () => {
    const first = await reserveGeminiQuota(undefined, T0, 200_000);
    expect(first).toMatchObject({ granted: true, reservedInputTokens: 30_000, rollingInputTokens: 30_000 });
    if (!first.granted) throw new Error('Expected reservation.');

    await finalizeGeminiQuotaReservation(first, 42_000, T0 + 1_000, 200_000);
    expect(await geminiQuotaSnapshot(T0 + 1_000, 200_000)).toMatchObject({
      rollingInputTokens: 42_000,
      entries: 1,
    });

    const second = await reserveGeminiQuota(undefined, T0 + 2_000, 200_000);
    expect(second).toMatchObject({
      granted: true,
      // 42k recent truth + 15% safety margin.
      reservedInputTokens: 48_300,
      rollingInputTokens: 90_300,
    });
  });

  it('serializes concurrent reservations across the authoritative IndexedDB row', async () => {
    const [left, right] = await Promise.all([
      reserveGeminiQuota(50_000, T0, 80_000),
      reserveGeminiQuota(50_000, T0, 80_000),
    ]);
    expect([left.granted, right.granted].sort()).toEqual([false, true]);
    const denied = left.granted ? right : left;
    expect(denied).toMatchObject({ granted: false, reason: 'rolling-budget' });
    expect(await geminiQuotaSnapshot(T0, 80_000)).toMatchObject({ rollingInputTokens: 50_000, entries: 1 });
  });

  it('keeps an unfinished request charged at its reservation so failed calls are not free', async () => {
    const reservation = await reserveGeminiQuota(45_000, T0, 100_000);
    expect(reservation.granted).toBe(true);
    expect(await geminiQuotaSnapshot(T0 + 1_000, 100_000)).toMatchObject({ rollingInputTokens: 45_000 });
  });

  it('expires old usage after the rolling sixty-second window', async () => {
    const reservation = await reserveGeminiQuota(70_000, T0, 100_000);
    expect(reservation.granted).toBe(true);
    expect((await reserveGeminiQuota(40_000, T0 + 10_000, 100_000)).granted).toBe(false);
    expect((await reserveGeminiQuota(40_000, T0 + 60_001, 100_000)).granted).toBe(true);
  });

  it('does not delete stale corruption from a snapshot read before a transactional reservation replaces it', async () => {
    await db.settings.put({
      id: 'gemini-quota-ledger-v1',
      entries: [{ id: 'bad', startedAt: 'not-a-number', reservedInputTokens: -1 }],
      updatedAt: T0 - 60_001,
    } as unknown as StoredGeminiQuotaLedger);

    expect(await geminiQuotaSnapshot(T0, 200_000)).toMatchObject({ rollingInputTokens: 0, entries: 0 });
    expect(await db.settings.get('gemini-quota-ledger-v1')).toBeDefined();

    const recovered = await reserveGeminiQuota(20_000, T0, 200_000);
    expect(recovered.granted).toBe(true);
    expect(await geminiQuotaSnapshot(T0, 200_000)).toMatchObject({ rollingInputTokens: 30_000, entries: 1 });
  });

  it('recovers transactionally from malformed quota rows that cannot prove a live timestamp', async () => {
    await db.settings.put({
      id: 'gemini-quota-ledger-v1',
      entries: [],
      updatedAt: 'broken',
    } as unknown as StoredGeminiQuotaLedger);

    const recovered = await reserveGeminiQuota(20_000, T0, 200_000);
    expect(recovered.granted).toBe(true);
  });

  it('fails closed on a recent malformed ledger row but recovers after its window has aged out', async () => {
    await db.settings.put({
      id: 'gemini-quota-ledger-v1',
      entries: [{ id: 'bad', startedAt: 'not-a-number', reservedInputTokens: -1 }],
      updatedAt: T0,
    } as unknown as StoredGeminiQuotaLedger);

    const recent = await reserveGeminiQuota(20_000, T0 + 1_000, 200_000);
    expect(recent).toMatchObject({ granted: false, reason: 'ledger-unavailable' });

    const recovered = await reserveGeminiQuota(20_000, T0 + 60_001, 200_000);
    expect(recovered.granted).toBe(true);
  });
});
