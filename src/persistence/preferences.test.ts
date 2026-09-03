import { describe, expect, it } from 'vitest';
import { normalizeChatAppearance, normalizeRoleplay } from './preferences';

const longString = 'x'.repeat(400);

describe('preference normalization', () => {
  it('clamps presentation values and canonicalises colours', () => {
    const value = normalizeChatAppearance({
      chatBackgroundOpacity: 4,
      chatBackgroundOverlay: -1,
      chatBackgroundBlur: 100,
      assistantTextColor: 'not-a-colour',
      userTextColor: '#abcDEF',
      userSurfaceColor: '#112233',
      userSurfaceOpacity: 0.01,
      userSurfaceStyle: 'invalid' as never,
    });

    expect(value.chatBackgroundOpacity).toBe(1);
    expect(value.chatBackgroundOverlay).toBe(0);
    expect(value.chatBackgroundBlur).toBe(24);
    expect(value.assistantTextColor).toBe('#F7F8FF');
    expect(value.userTextColor).toBe('#ABCDEF');
    expect(value.userSurfaceColor).toBe('#112233');
    expect(value.userSurfaceOpacity).toBe(0.2);
    expect(value.userSurfaceStyle).toBe('frosted');
  });

  it('normalizes roleplay text and rejects unknown environment presets', () => {
    const value = normalizeRoleplay({
      enabled: 1 as never,
      environmentPreset: 'unknown' as never,
      environmentName: `  ${longString}  `,
      environmentDescription: '  Scene  ',
    });

    expect(value.enabled).toBe(true);
    expect(value.environmentPreset).toBe('none');
    expect(value.environmentName).toHaveLength(160);
    expect(value.environmentName.startsWith('x')).toBe(true);
    expect(value.environmentDescription).toBe('Scene');
  });
});
