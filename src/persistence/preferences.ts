import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY, type ChatAppearancePreferences, type RoleplayPreferences } from '../domain/preferences';

type PreferenceRecord =
  | { id: 'chat-appearance'; value: ChatAppearancePreferences; updatedAt: number }
  | { id: 'roleplay'; value: RoleplayPreferences; updatedAt: number }
  | { id: 'onboarding'; value: { completed: boolean }; updatedAt: number };

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
  }
}

const db = new PreferencesDatabase();

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

export async function loadChatAppearance(): Promise<ChatAppearancePreferences> {
  const record = await db.preferences.get('chat-appearance');
  return record?.id === 'chat-appearance' ? normalizeChatAppearance(record.value) : DEFAULT_CHAT_APPEARANCE;
}

export async function saveChatAppearance(value: ChatAppearancePreferences): Promise<ChatAppearancePreferences> {
  const nextValue = normalizeChatAppearance(value);
  await db.preferences.put({ id: 'chat-appearance', value: nextValue, updatedAt: Date.now() });
  return nextValue;
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
  const record = await db.preferences.get('onboarding');
  return record?.id === 'onboarding' && record.value.completed === true;
}

export async function completeOnboarding(): Promise<void> {
  await db.preferences.put({ id: 'onboarding', value: { completed: true }, updatedAt: Date.now() });
}

function normalizeBackgroundValue(mode: ChatAppearancePreferences['chatBackgroundMode'], value: string): string {
  if (mode === 'solid') return safeHex(value, DEFAULT_CHAT_APPEARANCE.chatBackgroundValue);
  if (mode === 'gradient') return value === 'violet' || value === 'rose' || value === 'midnight' ? value : 'midnight';
  if (typeof value !== 'string' || value.length > 6_000_000) return '';
  if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)) return '';
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
