import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_UI } from '../domain/preferences';
import { normalizeAppUiPreferences, normalizeChatAppearance, normalizeRoleplay } from './preferences';

const longString = 'x'.repeat(400);

describe('preference normalization', () => {
  it('normalizes persistent app UI settings and keeps the global font independent from chat text size', () => {
    const value = normalizeAppUiPreferences({
      font: { kind: 'built-in', family: 'Manrope' },
      chatTextSize: 99,
      portraitScale: 7 as never,
      portraitBackground: 'invalid' as never,
    });

    expect(value.font).toEqual({ kind: 'built-in', family: 'Manrope' });
    expect(value.chatTextSize).toBe(24);
    expect(value.portraitScale).toBe(DEFAULT_APP_UI.portraitScale);
    expect(value.portraitBackground).toBe(DEFAULT_APP_UI.portraitBackground);
  });

  it('falls back from an invalid persisted custom font', () => {
    const value = normalizeAppUiPreferences({
      font: { kind: 'custom', family: 'Inter', stylesheetUrl: 'https://example.com/font.css' },
    });

    expect(value.font).toEqual(DEFAULT_APP_UI.font);
  });

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
