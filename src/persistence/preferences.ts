import Dexie, { type Table } from 'dexie';
import { BUILT_IN_FONTS, googleFontFamilyFromCss2Url, type FontSelection } from '../ui/fontRegistry';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY, type AppUiPreferences, type ChatAppearancePreferences, type RoleplayPreferences } from '../domain/preferences';

type PreferenceRecord =
  | { id: 'app-ui'; value: AppUiPreferences; updatedAt: number }
  | { id: 'chat-appearance'; value: ChatAppearancePreferences; updatedAt: number }
  | { id: 'roleplay'; value: RoleplayPreferences; updatedAt: number }
  | { id: 'onboarding'; value: { completed: boolean }; updatedAt: number };

const ONBOARDING_STORAGE_KEY = 'elara.onboarding.completed';

class PreferencesDatabase extends Dexie {
  preferences!: Table<PreferenceRecord, string>;
  constructor() {
    super('elara-preferences');
    this.version(1).stores({ preferences: 'id, updatedAt' });
    this.version(2).stores({ preferences: 'id, updatedAt' }).upgrade((tx) => {
      return tx.table('preferences').toCollection().modify((record: PreferenceRecord) => {
        if (record.id === 'chat-appearance') record.value = normalizeChatAppearance(record.value);
        if (record.id === 'roleplay') record.value = normalizeRoleplay(record.value);
      });
    });
    this.version(3).stores({ preferences: 'id, updatedAt' }).upgrade(async (tx) => {
      const existing = await tx.table('preferences').toArray() as PreferenceRecord[];
      if (existing.some((record) => record.id !== 'onboarding')) {
        await tx.table('preferences').put({ id: 'onboarding', value: { completed: true }, updatedAt: Date.now() });
      }
    });
    this.version(4).stores({ preferences: 'id, updatedAt' });
  }
}

const db = new PreferencesDatabase();

export function normalizeAppUiPreferences(value: Partial<AppUiPreferences> | null | undefined): AppUiPreferences {
  const merged = { ...DEFAULT_APP_UI, ...(value ?? {}) };
  return {
    font: normalizeFont(merged.font),
    chatTextSize: clamp(merged.chatTextSize, 10, 24, DEFAULT_APP_UI.chatTextSize),
    portraitScale: merged.portraitScale === 1 || merged.portraitScale === 3 ? merged.portraitScale : 2,
    portraitBackground: merged.portraitBackground === 'blue-hour' || merged.portraitBackground === 'violet' || merged.portraitBackground === 'rose' ? merged.portraitBackground : 'midnight',
  };
}

export async function loadAppUiPreferences(): Promise<AppUiPreferences> {
  const record = await db.preferences.get('app-ui');
  return record?.id === 'app-ui' ? normalizeAppUiPreferences(record.value) : DEFAULT_APP_UI;
}

export async function saveAppUiPreferences(value: AppUiPreferences): Promise<AppUiPreferences> {
  const nextValue = normalizeAppUiPreferences(value);
  await db.preferences.put({ id: 'app-ui', value: nextValue, updatedAt: Date.now() });
  return nextValue;
}

export function normalizeChatAppearance(value: Partial<ChatAppearancePreferences> | null | undefined): ChatAppearancePreferences {
  const merged = { ...DEFAULT_CHAT_APPEARANCE, ...(value ?? {}) };
  const backgroundMode: ChatAppearancePreferences['chatBackgroundMode'] = merged.chatBackgroundMode === 'gradient' || merged.chatBackgroundMode === 'image' ? merged.chatBackgroundMode : 'solid';
  return {
    ...merged,
    chatBackgroundMode: backgroundMode,
    chatBackgroundValue: normalizeBackgroundValue(backgroundMode, merged.chatBackgroundValue),
    chatBackgroundOpacity: clamp(merged.chatBackgroundOpacity, 0, 1, DEFAULT_CHAT_APPEARANCE.chatBackgroundOpacity),
    chatBackgroundOverlay: clamp(merged.chatBackgroundOverlay, 0, 0.9, DEFAULT_CHAT_APPEARANCE.chatBackgroundOverlay),
    chatBackgroundBlur: clamp(merged.chatBackgroundBlur, 0, 24, DEFAULT_CHAT_APPEARANCE.chatBackgroundBlur),
    assistantTextColor: safeHex(merged.assistantTextColor, DEFAULT_CHAT_APPEARANCE.assistantTextColor),
    assistantGlow: Boolean(merged.assistantGlow),
    userTextColor: safeHex(merged.userTextColor, DEFAULT_CHAT_APPEARANCE.userTextColor),
    userSurfaceColor: safeHex(merged.userSurfaceColor, DEFAULT_CHAT_APPEARANCE.userSurfaceColor),
    userSurfaceOpacity: clamp(merged.userSurfaceOpacity, 0.2, 1, DEFAULT_CHAT_APPEARANCE.userSurfaceOpacity),
    userSurfaceStyle: merged.userSurfaceStyle === 'solid' || merged.userSurfaceStyle === 'gradient' ? merged.userSurfaceStyle : 'frosted',
  };
}

export async function loadChatAppearance(): Promise<ChatAppearancePreferences> {
  const record = await db.preferences.get('chat-appearance');
  return record?.id === 'chat-appearance' ? normalizeChatAppearance(record.value) : DEFAULT_CHAT_APPEARANCE;
}

export async function saveChatAppearance(value: ChatAppearancePreferences): Promise<ChatAppearancePreferences> {
  const nextValue = normalizeChatAppearance(value);
  await db.preferences.put({ id: 'chat-appearance', value: nextValue, updatedAt: Date.now() });
  return nextValue;
}

export function normalizeRoleplay(value: Partial<RoleplayPreferences> | null | undefined): RoleplayPreferences {
  const merged = { ...DEFAULT_ROLEPLAY, ...(value ?? {}) };
  const allowedPresets: RoleplayPreferences['environmentPreset'][] = ['none', 'house', 'bedroom', 'living-room', 'office', 'poolside', 'outdoors', 'custom'];
  return {
    enabled: Boolean(merged.enabled),
    environmentPreset: allowedPresets.includes(merged.environmentPreset) ? merged.environmentPreset : 'none',
    environmentName: safeText(merged.environmentName, 160),
    environmentDescription: safeText(merged.environmentDescription, 2_000),
    timeOfDay: safeText(merged.timeOfDay, 120),
    weather: safeText(merged.weather, 160),
    atmosphere: safeText(merged.atmosphere, 240),
  };
}

export async function loadRoleplayPreferences(): Promise<RoleplayPreferences> {
  const record = await db.preferences.get('roleplay');
  return record?.id === 'roleplay' ? normalizeRoleplay(record.value) : DEFAULT_ROLEPLAY;
}

export async function saveRoleplayPreferences(value: RoleplayPreferences): Promise<RoleplayPreferences> {
  const nextValue = normalizeRoleplay(value);
  await db.preferences.put({ id: 'roleplay', value: nextValue, updatedAt: Date.now() });
  return nextValue;
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true') return true;
  const record = await db.preferences.get('onboarding');
  if (record?.id === 'onboarding' && record.value.completed === true) {
    if (typeof window !== 'undefined') window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    return true;
  }
  return false;
}

export async function completeOnboarding(): Promise<void> {
  if (typeof window !== 'undefined') window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  await db.preferences.put({ id: 'onboarding', value: { completed: true }, updatedAt: Date.now() });
}

function normalizeFont(value: FontSelection | undefined): FontSelection {
  if (!value || typeof value !== 'object') return DEFAULT_APP_UI.font;
  if (value.kind === 'built-in' && BUILT_IN_FONTS.some((font) => font.family === value.family)) return value;
  if (value.kind === 'custom' && typeof value.family === 'string' && value.family.trim() && typeof value.stylesheetUrl === 'string' && googleFontFamilyFromCss2Url(value.stylesheetUrl) === value.family.trim()) {
    return { kind: 'custom', family: value.family.trim(), stylesheetUrl: value.stylesheetUrl };
  }
  return DEFAULT_APP_UI.font;
}

function normalizeBackgroundValue(mode: ChatAppearancePreferences['chatBackgroundMode'], value: string): string {
  if (mode === 'solid') return safeHex(value, DEFAULT_CHAT_APPEARANCE.chatBackgroundValue);
  if (mode === 'gradient') return value === 'violet' || value === 'rose' || value === 'midnight' ? value : 'midnight';
  if (typeof value !== 'string' || value.length > 6_000_000) return '';
  if (!/^data:image\/(?:jpeg|png|webp|avif);base64,[a-z0-9+/=]+$/i.test(value)) return '';
  return value;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function safeText(value: string, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
