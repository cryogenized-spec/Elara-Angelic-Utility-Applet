import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_MEMORY_BEHAVIOR, DEFAULT_MEMORY_CATEGORIES, SENSITIVE_MEMORY_CATEGORY_KEYS } from '../domain/preferences';
import {
  loadAppUiPreferences,
  loadChatAppearance,
  loadMemoryBehaviorPreferences,
  normalizeAppUiPreferences,
  normalizeChatAppearance,
  normalizeMemoryBehaviorPreferences,
  normalizeRoleplay,
  saveAppUiPreferences,
  saveChatAppearance,
  saveMemoryBehaviorPreferences,
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
      generationActivityAccent: '#34d399',
    });

    expect(value.chatBackgroundOpacity).toBe(1);
    expect(value.chatBackgroundOverlay).toBe(0);
    expect(value.chatBackgroundBlur).toBe(24);
    expect(value.assistantTextColor).toBe('#F7F8FF');
    expect(value.userTextColor).toBe('#ABCDEF');
    expect(value.userSurfaceColor).toBe('#112233');
    expect(value.userSurfaceOpacity).toBe(0.2);
    expect(value.userSurfaceStyle).toBe('frosted');
    expect(value.generationActivityAccent).toBe('#34D399');
    expect(value.mediaPlayerSurfacePreset).toBe('glass');
  });

  it('defaults old or invalid player appearance rows to Glass', () => {
    expect(normalizeChatAppearance({}).mediaPlayerSurfacePreset).toBe('glass');
    expect(normalizeChatAppearance({ mediaPlayerSurfacePreset: 'unknown' as never }).mediaPlayerSurfacePreset).toBe('glass');
    expect(normalizeChatAppearance({ mediaPlayerSurfacePreset: 'minimal' }).mediaPlayerSurfacePreset).toBe('minimal');
    expect(normalizeChatAppearance({ mediaPlayerSurfacePreset: 'cinema' }).mediaPlayerSurfacePreset).toBe('cinema');
  });

  it('rejects malformed Generation Activity accent values', () => {
    expect(normalizeChatAppearance({ generationActivityAccent: 'green' }).generationActivityAccent).toBe(DEFAULT_CHAT_APPEARANCE.generationActivityAccent);
    expect(normalizeChatAppearance({ generationActivityAccent: '#12345' }).generationActivityAccent).toBe(DEFAULT_CHAT_APPEARANCE.generationActivityAccent);
    expect(normalizeChatAppearance({ generationActivityAccent: '#1234567' }).generationActivityAccent).toBe(DEFAULT_CHAT_APPEARANCE.generationActivityAccent);
  });

  it('normalizes Generation Activity glyphs while preserving missing defaults', () => {
    const value = normalizeChatAppearance({
      generationActivityGlyphs: {
        ...DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs,
        memory: '♥️',
        calendar: 'two icons',
      },
    });
    expect(value.generationActivityGlyphs.memory).toBe('♥');
    expect(value.generationActivityGlyphs.calendar).toBe(DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs.calendar);
    expect(normalizeChatAppearance({}).generationActivityGlyphs).toEqual(DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs);
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

describe('Generation Activity appearance persistence', () => {
  beforeEach(async () => {
    await saveChatAppearance(DEFAULT_CHAT_APPEARANCE);
  });

  it('saves and reloads the normalized activity accent through the existing chat-appearance record', async () => {
    const saved = await saveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, generationActivityAccent: '#34d399' });
    expect(saved.generationActivityAccent).toBe('#34D399');

    const loaded = await loadChatAppearance();
    expect(loaded.generationActivityAccent).toBe('#34D399');
    expect(loaded.assistantTextColor).toBe(DEFAULT_CHAT_APPEARANCE.assistantTextColor);
    expect(loaded.userSurfaceColor).toBe(DEFAULT_CHAT_APPEARANCE.userSurfaceColor);
  });

  it('stores customized glyphs in the existing chat-appearance record', async () => {
    const saved = await saveChatAppearance({
      ...DEFAULT_CHAT_APPEARANCE,
      generationActivityGlyphs: { ...DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs, memory: '♥️' },
    });
    expect(saved.generationActivityGlyphs.memory).toBe('♥');

    const loaded = await loadChatAppearance();
    expect(loaded.generationActivityGlyphs.memory).toBe('♥');
    expect(loaded.generationActivityGlyphs.reasoning).toBe(DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs.reasoning);
  });

  it('persists the player surface preset in that same appearance record', async () => {
    const saved = await saveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'cinema' });
    expect(saved.mediaPlayerSurfacePreset).toBe('cinema');

    const loaded = await loadChatAppearance();
    expect(loaded.mediaPlayerSurfacePreset).toBe('cinema');
    expect(loaded.generationActivityAccent).toBe(DEFAULT_CHAT_APPEARANCE.generationActivityAccent);
    expect(loaded.userSurfaceStyle).toBe(DEFAULT_CHAT_APPEARANCE.userSurfaceStyle);
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


describe('companion memory behavior preferences', () => {
  beforeEach(async () => {
    await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
  });

  it('preserves current memory behavior by default while keeping sensitive automatic categories off', () => {
    const value = normalizeMemoryBehaviorPreferences(undefined);

    expect(value.enabled).toBe(true);
    expect(value.rememberingStyle).toBe('natural');
    expect(value.recallStyle).toBe('natural');
    expect(value.categories.likes_dislikes).toBe(true);
    expect(value.categories.people_relationships).toBe(true);
    expect(value.categories.pets).toBe(true);
    expect(value.categories.feelings_vulnerabilities_reflections).toBe(true);
    for (const category of SENSITIVE_MEMORY_CATEGORY_KEYS) {
      expect(value.categories[category]).toBe(false);
    }
  });

  it('normalizes invalid styles and category values without widening sensitive defaults', () => {
    const value = normalizeMemoryBehaviorPreferences({
      enabled: 'yes' as never,
      rememberingStyle: 'memorize-everything' as never,
      recallStyle: 'constantly' as never,
      categories: {
        ...DEFAULT_MEMORY_CATEGORIES,
        health_wellbeing: 'yes' as never,
        pets: false,
      },
    });

    expect(value.rememberingStyle).toBe(DEFAULT_MEMORY_BEHAVIOR.rememberingStyle);
    expect(value.recallStyle).toBe(DEFAULT_MEMORY_BEHAVIOR.recallStyle);
    expect(value.enabled).toBe(false);
    expect(value.categories.health_wellbeing).toBe(false);
    expect(value.categories.pets).toBe(false);
  });

  it('persists the master switch, behavioral styles, and per-category choices in the existing preferences store', async () => {
    const saved = await saveMemoryBehaviorPreferences({
      enabled: false,
      rememberingStyle: 'attentive',
      recallStyle: 'proactive',
      categories: {
        ...DEFAULT_MEMORY_CATEGORIES,
        people_relationships: false,
        health_wellbeing: true,
        religion_spirituality: true,
      },
    });

    expect(saved.enabled).toBe(false);
    expect(saved.rememberingStyle).toBe('attentive');
    expect(saved.recallStyle).toBe('proactive');
    expect(saved.categories.people_relationships).toBe(false);
    expect(saved.categories.health_wellbeing).toBe(true);
    expect(saved.categories.religion_spirituality).toBe(true);

    const loaded = await loadMemoryBehaviorPreferences();
    expect(loaded).toEqual(saved);
  });

  it('fills newly introduced categories from safe defaults when loading an older partial preference shape', () => {
    const value = normalizeMemoryBehaviorPreferences({
      enabled: true,
      rememberingStyle: 'selective',
      recallStyle: 'direct-only',
      categories: {
        likes_dislikes: false,
        health_wellbeing: true,
      } as never,
    });

    expect(value.categories.likes_dislikes).toBe(false);
    expect(value.categories.health_wellbeing).toBe(true);
    expect(value.categories.pets).toBe(DEFAULT_MEMORY_CATEGORIES.pets);
    expect(value.categories.race_ethnicity).toBe(false);
    expect(value.categories.legal_criminal_history).toBe(false);
    expect(value.categories.precise_location_home).toBe(DEFAULT_MEMORY_CATEGORIES.precise_location_home);
  });
  it('keeps a missing legacy master switch compatible but fails a present malformed switch closed', () => {
    expect(normalizeMemoryBehaviorPreferences({ categories: {} } as never).enabled).toBe(true);
    expect(normalizeMemoryBehaviorPreferences({ enabled: 'corrupt' as never }).enabled).toBe(false);
    expect(normalizeMemoryBehaviorPreferences({ enabled: 1 as never }).enabled).toBe(false);
  });

});
