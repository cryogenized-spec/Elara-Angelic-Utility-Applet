// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_APPEARANCE } from '../../domain/preferences';
import { saveChatAppearance } from '../../persistence/preferences';
import {
  MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE,
  bindMediaPlayerSurfacePreset,
  installMediaPlayerSurfacePresetBinding,
} from './surface-preset';

async function waitForAttribute(target: HTMLElement, expected: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE) !== expected) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE}=${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  document.documentElement.removeAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE);
  await saveChatAppearance(DEFAULT_CHAT_APPEARANCE);
});

afterEach(() => {
  document.documentElement.removeAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE);
});

describe('Phase 7 media player surface appearance binding', () => {
  it('projects a preset without owning playback state and cleanup cannot erase a newer projection', () => {
    const target = document.createElement('div');
    const cleanup = bindMediaPlayerSurfacePreset(target, 'minimal');
    expect(target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE)).toBe('minimal');

    target.setAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE, 'cinema');
    cleanup();
    expect(target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE)).toBe('cinema');
  });

  it('reacts to the existing durable chat-appearance record with Glass as the safe startup default', async () => {
    const target = document.createElement('div');
    const dispose = installMediaPlayerSurfacePresetBinding(target);

    expect(target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE)).toBe('glass');
    await waitForAttribute(target, 'glass');

    await saveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'cinema' });
    await waitForAttribute(target, 'cinema');

    await saveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'minimal' });
    await waitForAttribute(target, 'minimal');

    dispose();
  });
});
