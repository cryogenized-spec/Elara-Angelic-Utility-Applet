import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptYouTubePolicy,
  clearYouTubePolicyConsent,
  hasAcceptedYouTubePolicy,
  loadYouTubePolicyConsent,
  YOUTUBE_POLICY_CONSENT_VERSION,
} from './preferences';

describe('Phase 9 YouTube policy consent', () => {
  beforeEach(async () => {
    await clearYouTubePolicyConsent();
  });

  it('fails closed until the current version is explicitly accepted', async () => {
    expect(await hasAcceptedYouTubePolicy()).toBe(false);
    expect(await loadYouTubePolicyConsent()).toBeNull();

    const accepted = await acceptYouTubePolicy(1_789_430_400_000);

    expect(accepted).toEqual({ version: YOUTUBE_POLICY_CONSENT_VERSION, acceptedAt: 1_789_430_400_000 });
    expect(await hasAcceptedYouTubePolicy()).toBe(true);
    expect(await loadYouTubePolicyConsent()).toEqual(accepted);
  });

  it('can be cleared so a future policy-version change returns to fail-closed', async () => {
    await acceptYouTubePolicy();
    expect(await hasAcceptedYouTubePolicy()).toBe(true);

    await clearYouTubePolicyConsent();

    expect(await hasAcceptedYouTubePolicy()).toBe(false);
  });

  it('rejects an invalid acceptance timestamp', async () => {
    await expect(acceptYouTubePolicy(Number.NaN)).rejects.toThrow(/timestamped safely/i);
    expect(await hasAcceptedYouTubePolicy()).toBe(false);
  });
});
