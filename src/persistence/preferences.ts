import Dexie, { type Table } from 'dexie';
import { BUILT_IN_FONTS, googleFontFamilyFromCss2Url, type FontSelection } from '../ui/fontRegistry';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_AUTONOMY, DEFAULT_ROLEPLAY, MEDIA_PLAYER_SURFACE_PRESETS, type AppUiPreferences, type AutonomyPreferences, type ChatAppearancePreferences, type RoleplayPreferences } from '../domain/preferences';
import { DEFAULT_MEDIA_PLAYBACK_PREFERENCE, normalizeMediaPlaybackPreference, type MediaPlaybackPreference } from '../domain/playback';
import { normalizeGenerationActivityGlyphs } from '../ui/activity-glyphs';

export const YOUTUBE_POLICY_CONSENT_VERSION = 1 as const;
export interface YouTubePolicyConsent {
  readonly version: typeof YOUTUBE_POLICY_CONSENT_VERSION;
  readonly acceptedAt: number;
}

type PreferenceRecord =
  | { id: 'app-ui'; value: AppUiPreferences; updatedAt: number }
  | { id: 'chat-appearance'; value: ChatAppearancePreferences; updatedAt: number }
  | { id: 'roleplay'; value: RoleplayPreferences; updatedAt: number }
  | { id: 'autonomy'; value: AutonomyPreferences; updatedAt: number }
  | { id: 'media-playback'; value: MediaPlaybackPreference; updatedAt: number }
  | { id: 'youtube-policy-consent'; value: YouTubePolicyConsent; updatedAt: number }
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
    enterToSend: typeof merged.enterToSend === 'boolean' ? merged.enterToSend : DEFAULT_APP_UI.enterToSend,
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
  const mediaPlayerSurfacePreset = (MEDIA_PLAYER_SURFACE_PRESETS as readonly string[]).includes(merged.mediaPlayerSurfacePreset)
    ? merged.mediaPlayerSurfacePreset
    : DEFAULT_CHAT_APPEARANCE.mediaPlayerSurfacePreset;
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
    generationActivityAccent: safeHex(merged.generationActivityAccent, DEFAULT_CHAT_APPEARANCE.generationActivityAccent),
    generationActivityGlyphs: normalizeGenerationActivityGlyphs(merged.generationActivityGlyphs),
    mediaPlayerSurfacePreset,
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

export function normalizeAutonomy(value: Partial<AutonomyPreferences> | null | undefined): AutonomyPreferences {
  const merged = { ...DEFAULT_AUTONOMY, ...(value ?? {}) };
  const cap = Number.isFinite(merged.maxEventsPerDay) ? Math.round(merged.maxEventsPerDay) : DEFAULT_AUTONOMY.maxEventsPerDay;
  return {
    enabled: merged.enabled === true,
    maxEventsPerDay: Math.max(1, Math.min(50, cap)),
  };
}

export async function loadAutonomyPreferences(): Promise<AutonomyPreferences> {
  const record = await db.preferences.get('autonomy');
  return record?.id === 'autonomy' ? normalizeAutonomy(record.value) : DEFAULT_AUTONOMY;
}

export async function saveAutonomyPreferences(value: AutonomyPreferences): Promise<AutonomyPreferences> {
  const nextValue = normalizeAutonomy(value);
  await db.preferences.put({ id: 'autonomy', value: nextValue, updatedAt: Date.now() });
  return nextValue;
}

export async function loadMediaPlaybackPreference(): Promise<MediaPlaybackPreference> {
  const record = await db.preferences.get('media-playback');
  return record?.id === 'media-playback'
    ? normalizeMediaPlaybackPreference(record.value)
    : DEFAULT_MEDIA_PLAYBACK_PREFERENCE;
}

export async function saveMediaPlaybackPreference(value: MediaPlaybackPreference): Promise<MediaPlaybackPreference> {
  const nextValue = normalizeMediaPlaybackPreference(value);
  await db.preferences.put({ id: 'media-playback', value: nextValue, updatedAt: Date.now() });
  return nextValue;
}

/**
 * YouTube policy consent is versioned durable compliance state in the existing
 * preferences database. It is intentionally separate from the encrypted API
 * credential: accepting policy never decrypts or rewrites the key, and a future
 * material policy change can require a new version without creating a new store.
 */
export async function loadYouTubePolicyConsent(): Promise<YouTubePolicyConsent | null> {
  const record = await db.preferences.get('youtube-policy-consent');
  if (record?.id !== 'youtube-policy-consent') return null;
  const value = record.value;
  return value.version === YOUTUBE_POLICY_CONSENT_VERSION
    && Number.isFinite(value.acceptedAt)
    && value.acceptedAt > 0
    ? value
    : null;
}

export async function hasAcceptedYouTubePolicy(): Promise<boolean> {
  return (await loadYouTubePolicyConsent()) !== null;
}

export async function acceptYouTubePolicy(now: number = Date.now()): Promise<YouTubePolicyConsent> {
  if (!Number.isFinite(now) || now <= 0) throw new Error('YouTube policy acceptance could not be timestamped safely.');
  const value: YouTubePolicyConsent = { version: YOUTUBE_POLICY_CONSENT_VERSION, acceptedAt: now };
  await db.preferences.put({ id: 'youtube-policy-consent', value, updatedAt: now });
  return value;
}

/** Test/admin seam for a future material policy-version change. */
export async function clearYouTubePolicyConsent(): Promise<void> {
  await db.preferences.delete('youtube-policy-consent');
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
