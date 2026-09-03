import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY } from './preferences';

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
});
