// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_APPEARANCE, type MediaPlayerSurfacePreset } from '../../domain/preferences';
import { saveChatAppearance } from '../../persistence/preferences';
import {
  MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE,
  installMediaPlayerSurfacePresetBinding,
} from './surface-preset';

async function waitForAttribute(target: HTMLElement, expected: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE) !== expected) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for preset ${expected}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(async () => {
  document.documentElement.removeAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE);
  await saveChatAppearance(DEFAULT_CHAT_APPEARANCE);
});

afterEach(() => {
  document.documentElement.removeAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE);
});

describe('Phase 8 adversarial player preset projection', () => {
  it('converges on the last durable preset after a rapid burst of appearance writes', async () => {
    const target = document.createElement('div');
    const dispose = installMediaPlayerSurfacePresetBinding(target);
    const burst: MediaPlayerSurfacePreset[] = [
      'minimal', 'cinema', 'glass', 'minimal', 'cinema', 'minimal', 'glass', 'cinema',
    ];

    const writes = burst.map((mediaPlayerSurfacePreset) => saveChatAppearance({
      ...DEFAULT_CHAT_APPEARANCE,
      mediaPlayerSurfacePreset,
    }));
    await Promise.all(writes);
    await waitForAttribute(target, 'cinema');

    expect(target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE)).toBe('cinema');
    dispose();
  });

  it('stops observing after disposal so a stale binding cannot overwrite a later owner', async () => {
    const target = document.createElement('div');
    const dispose = installMediaPlayerSurfacePresetBinding(target);
    await saveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'minimal' });
    await waitForAttribute(target, 'minimal');

    dispose();
    target.setAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE, 'cinema');
    await saveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'glass' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE)).toBe('cinema');
  });
});
