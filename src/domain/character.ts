export type CharacterArtworkMode = 'portrait' | 'landscape';

export interface CharacterArtworkReference {
  id: string;
  mimeType: string;
  name: string;
  width?: number;
  height?: number;
  dataUrl: string;
  focalX: number;
  focalY: number;
}

export interface CharacterProfile {
  id: 'primary';
  name: string;
  systemInstruction: string;
  artworkMode: CharacterArtworkMode;
  artwork: CharacterArtworkReference | null;
  updatedAt: number;
}

export const DEFAULT_CHARACTER_PROFILE: CharacterProfile = {
  id: 'primary',
  name: 'Elara',
  systemInstruction: 'You are Elara, an angelic synthetic companion designed to be a warm, perceptive, creative conversational presence.\n\nDefine Elara\'s identity, personality, conversational style, boundaries, and durable behavioral preferences here. Application tool schemas, exposed capabilities, authorization rules, security controls, and provider behavior are managed separately by the application and cannot be changed from this editor.',
  artworkMode: 'portrait',
  artwork: null,
  updatedAt: 0,
};
