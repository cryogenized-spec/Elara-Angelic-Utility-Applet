import type { FontSelection } from '../ui/fontRegistry';

export interface AppUiPreferences {
  font: FontSelection;
  chatTextSize: number;
  portraitScale: 1 | 2 | 3;
  portraitBackground: 'midnight' | 'blue-hour' | 'violet' | 'rose';
  /** Composer: Enter sends (Shift+Enter newline) when true; Enter inserts a newline and Ctrl/Cmd+Enter sends when false. */
  enterToSend: boolean;
}

export const MEDIA_PLAYER_SURFACE_PRESETS = ['minimal', 'glass', 'cinema'] as const;
export type MediaPlayerSurfacePreset = (typeof MEDIA_PLAYER_SURFACE_PRESETS)[number];

export const GENERATION_ACTIVITY_GLYPH_KEYS = [
  'reasoning',
  'tool',
  'memory',
  'authorization',
  'confirmation',
  'calendar',
  'tasks',
  'gmail',
  'drive',
  'documents',
  'sheets',
  'generation',
] as const;
export type GenerationActivityGlyphKey = (typeof GENERATION_ACTIVITY_GLYPH_KEYS)[number];
export type GenerationActivityGlyphs = Readonly<Record<GenerationActivityGlyphKey, string>>;

export const DEFAULT_GENERATION_ACTIVITY_GLYPHS: GenerationActivityGlyphs = {
  reasoning: '🧠',
  tool: '⚙',
  memory: '📕',
  authorization: '🔐',
  confirmation: '✅',
  calendar: '📅',
  tasks: '☑',
  gmail: '✉',
  drive: '🗂',
  documents: '📄',
  sheets: '📊',
  generation: '✍',
};

export interface ChatAppearancePreferences {
  chatBackgroundMode: 'solid' | 'gradient' | 'image';
  chatBackgroundValue: string;
  chatBackgroundOpacity: number;
  chatBackgroundOverlay: number;
  chatBackgroundBlur: number;
  assistantTextColor: string;
  assistantGlow: boolean;
  userTextColor: string;
  userSurfaceColor: string;
  userSurfaceOpacity: number;
  userSurfaceStyle: 'solid' | 'frosted' | 'gradient';
  generationActivityAccent: string;
  generationActivityGlyphs: GenerationActivityGlyphs;
  mediaPlayerSurfacePreset: MediaPlayerSurfacePreset;
}

export interface RoleplayPreferences {
  enabled: boolean;
  environmentPreset: 'none' | 'house' | 'bedroom' | 'living-room' | 'office' | 'poolside' | 'outdoors' | 'custom';
  environmentName: string;
  environmentDescription: string;
  timeOfDay: string;
  weather: string;
  atmosphere: string;
}

export const MEMORY_CATEGORY_KEYS = [
  'personal_facts',
  'likes_dislikes',
  'people_relationships',
  'pets',
  'routines_daily_life',
  'goals_plans_commitments',
  'interests_hobbies_projects',
  'work_study_practical_life',
  'important_moments_shared_history',
  'feelings_vulnerabilities_reflections',
  'values_worldview',
  'health_wellbeing',
  'money_finances',
  'intimacy_sexuality',
  'religion_spirituality',
  'politics_civics',
  'race_ethnicity',
  'legal_criminal_history',
  'precise_location_home',
] as const;

export type MemoryCategoryKey = (typeof MEMORY_CATEGORY_KEYS)[number];

export const SENSITIVE_MEMORY_CATEGORY_KEYS = [
  'health_wellbeing',
  'money_finances',
  'intimacy_sexuality',
  'religion_spirituality',
  'politics_civics',
  'race_ethnicity',
  'legal_criminal_history',
  'precise_location_home',
] as const satisfies readonly MemoryCategoryKey[];

export type MemoryRememberingStyle = 'explicit-only' | 'selective' | 'natural' | 'attentive';
export type MemoryRecallStyle = 'direct-only' | 'natural' | 'proactive';

export interface MemoryBehaviorPreferences {
  /**
   * Master memory-behaviour switch. The Memory Bank remains human-manageable
   * even when conversational recall/organic formation are disabled.
   */
  enabled: boolean;
  /** Controls how readily future organic memory policy may retain user-grounded observations. */
  rememberingStyle: MemoryRememberingStyle;
  /** Controls how readily future conversational recall policy may surface durable memories. */
  recallStyle: MemoryRecallStyle;
  /**
   * Category permissions apply to automatic/organic remembering. Explicit,
   * confirmed user-directed memory remains a separate authority boundary.
   */
  categories: Readonly<Record<MemoryCategoryKey, boolean>>;
}

export const DEFAULT_MEMORY_CATEGORIES: Readonly<Record<MemoryCategoryKey, boolean>> = {
  personal_facts: true,
  likes_dislikes: true,
  people_relationships: true,
  pets: true,
  routines_daily_life: true,
  goals_plans_commitments: true,
  interests_hobbies_projects: true,
  work_study_practical_life: true,
  important_moments_shared_history: true,
  feelings_vulnerabilities_reflections: true,
  values_worldview: true,
  health_wellbeing: false,
  money_finances: false,
  intimacy_sexuality: false,
  religion_spirituality: false,
  politics_civics: false,
  race_ethnicity: false,
  legal_criminal_history: false,
  precise_location_home: false,
};

export const DEFAULT_MEMORY_BEHAVIOR: MemoryBehaviorPreferences = {
  enabled: true,
  rememberingStyle: 'natural',
  recallStyle: 'natural',
  categories: DEFAULT_MEMORY_CATEGORIES,
};

export const DEFAULT_APP_UI: AppUiPreferences = {
  font: { kind: 'built-in', family: 'Inter' },
  chatTextSize: 15,
  portraitScale: 2,
  portraitBackground: 'midnight',
  enterToSend: true,
};

export const DEFAULT_CHAT_APPEARANCE: ChatAppearancePreferences = {
  chatBackgroundMode: 'solid',
  chatBackgroundValue: '#050507',
  chatBackgroundOpacity: 1,
  chatBackgroundOverlay: 0.58,
  chatBackgroundBlur: 0,
  assistantTextColor: '#F7F8FF',
  assistantGlow: false,
  userTextColor: '#F7F8FF',
  userSurfaceColor: '#28344F',
  userSurfaceOpacity: 0.78,
  userSurfaceStyle: 'frosted',
  generationActivityAccent: '#6EA8FF',
  generationActivityGlyphs: DEFAULT_GENERATION_ACTIVITY_GLYPHS,
  mediaPlayerSurfacePreset: 'glass',
};

export const DEFAULT_ROLEPLAY: RoleplayPreferences = {
  enabled: false,
  environmentPreset: 'none',
  environmentName: '',
  environmentDescription: '',
  timeOfDay: '',
  weather: '',
  atmosphere: '',
};

export interface AutonomyPreferences {
  /** Master switch: when false, no autonomous execution of any kind. */
  enabled: boolean;
  /** Maximum AutonomousEvents per rolling 24 hours across all routines. */
  maxEventsPerDay: number;
}

export const DEFAULT_AUTONOMY: AutonomyPreferences = {
  enabled: false,
  maxEventsPerDay: 10,
};
