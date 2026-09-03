import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY } from './preferences';
import { normalizeChatAppearance } from '../persistence/preferences';

describe('presentation preference defaults', () => {
  it('starts with a conservative 9:16-friendly chat presentation', () => {
    expect(DEFAULT_CHAT_APPEARANCE.chatBackgroundMode).toBe('solid');
    expect(DEFAULT_CHAT_APPEARANCE.chatBackgroundOpacity).toBe(1);
    expect(DEFAULT_CHAT_APPEARANCE.chatBackgroundBlur).toBe(0);
    expect(DEFAULT_CHAT_APPEARANCE.userSurfaceStyle).toBe('frosted');
  });

  it('keeps roleplay opt-in and environment fields empty by default', () => {
    expect(DEFAULT_ROLEPLAY.enabled).toBe(false);
    expect(DEFAULT_ROLEPLAY.environmentPreset).toBe('none');
    expect(DEFAULT_ROLEPLAY.environmentName).toBe('');
    expect(DEFAULT_ROLEPLAY.environmentDescription).toBe('');
  });

  it('normalizes background sources to the supported presentation vocabulary', () => {
    expect(normalizeChatAppearance({ chatBackgroundMode: 'gradient', chatBackgroundValue: 'not-a-gradient' }).chatBackgroundValue).toBe('midnight');
    expect(normalizeChatAppearance({ chatBackgroundMode: 'image', chatBackgroundValue: 'url(javascript:alert(1))' }).chatBackgroundValue).toBe('');
    expect(normalizeChatAppearance({ chatBackgroundMode: 'image', chatBackgroundValue: 'data:image/png;base64,AAAA' }).chatBackgroundValue).toBe('data:image/png;base64,AAAA');
  });
});
