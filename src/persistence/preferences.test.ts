import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_UI } from '../domain/preferences';
import {
  loadAppUiPreferences,
  normalizeAppUiPreferences,
  normalizeChatAppearance,
  normalizeRoleplay,
  saveAppUiPreferences,
} from './preferences';

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

  it('defaults enterToSend to true and only accepts booleans', () => {
    expect(normalizeAppUiPreferences({}).enterToSend).toBe(true);
    expect(normalizeAppUiPreferences({ enterToSend: false }).enterToSend).toBe(false);
    expect(normalizeAppUiPreferences({ enterToSend: 'no' as never }).enterToSend).toBe(true);
    expect(DEFAULT_APP_UI.enterToSend).toBe(true);
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

describe('enterToSend persistence', () => {
  beforeEach(async () => {
    await saveAppUiPreferences(DEFAULT_APP_UI);
  });

  it('persists the preference under the existing app-ui record', async () => {
    await saveAppUiPreferences({ ...DEFAULT_APP_UI, enterToSend: false });
    const loaded = await loadAppUiPreferences();
    expect(loaded.enterToSend).toBe(false);
    // Nothing else about the app-ui record is disturbed.
    expect(loaded.font).toEqual(DEFAULT_APP_UI.font);
    expect(loaded.chatTextSize).toBe(DEFAULT_APP_UI.chatTextSize);
    expect(loaded.portraitScale).toBe(DEFAULT_APP_UI.portraitScale);
    expect(loaded.portraitBackground).toBe(DEFAULT_APP_UI.portraitBackground);
  });

  it('defaults to Enter = Send when nothing has been stored', async () => {
    const loaded = normalizeAppUiPreferences(await loadAppUiPreferences());
    expect(loaded.enterToSend).toBe(true);
  });

  it('survives a save/load round trip in both directions', async () => {
    for (const value of [false, true, false]) {
      const saved = await saveAppUiPreferences({ ...DEFAULT_APP_UI, enterToSend: value });
      expect(saved.enterToSend).toBe(value);
      expect((await loadAppUiPreferences()).enterToSend).toBe(value);
    }
  });
});
