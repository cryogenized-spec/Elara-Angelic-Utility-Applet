import { ELARA_SYSTEM_INSTRUCTION } from '../character/system-instruction';

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
  systemInstruction: ELARA_SYSTEM_INSTRUCTION,
  artworkMode: 'portrait',
  artwork: null,
  updatedAt: 0,
};
