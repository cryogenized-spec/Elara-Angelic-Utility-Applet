import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_UI } from '../domain/preferences';
import type { MediaPlaybackPreference } from '../domain/playback';
import {
  loadAppUiPreferences,
  loadMediaPlaybackPreference,
  saveAppUiPreferences,
  saveMediaPlaybackPreference,
} from './preferences';

describe('Phase 2 media playback preference persistence', () => {
  beforeEach(async () => {
    await saveMediaPlaybackPreference('ask');
    await saveAppUiPreferences(DEFAULT_APP_UI);
  });

  it('round-trips every supported preference through the existing preferences database', async () => {
    for (const value of ['ask', 'embedded', 'external'] as const) {
      expect(await saveMediaPlaybackPreference(value)).toBe(value);
      expect(await loadMediaPlaybackPreference()).toBe(value);
    }
  });

  it('normalizes a corrupt/unknown value to the safe ask default before it becomes durable', async () => {
    expect(await saveMediaPlaybackPreference('unexpected' as MediaPlaybackPreference)).toBe('ask');
    expect(await loadMediaPlaybackPreference()).toBe('ask');
  });

  it('does not disturb unrelated preferences records', async () => {
    const customUi = { ...DEFAULT_APP_UI, enterToSend: false, chatTextSize: 19 };
    await saveAppUiPreferences(customUi);
    await saveMediaPlaybackPreference('external');
    expect(await loadAppUiPreferences()).toEqual(customUi);
  });
});
