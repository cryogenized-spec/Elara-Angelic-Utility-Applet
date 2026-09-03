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
