import { describe, expect, it } from 'vitest';
import { normalizeCharacterProfile } from './character';
import { DEFAULT_CHARACTER_PROFILE } from '../domain/character';
import { LEGACY_CHARACTER_SYSTEM_INSTRUCTION } from '../character/system-instruction';

const validArtwork = {
  id: 'art-1',
  mimeType: 'image/png',
  name: 'Elara.png',
  width: 1200,
  height: 1500,
  dataUrl: 'data:image/png;base64,AAAA',
  focalX: 200,
  focalY: -50,
};

describe('character profile normalization', () => {
  it('keeps exactly one active artwork mode and clamps focal position', () => {
    const value = normalizeCharacterProfile({
      id: 'primary',
      name: '  Elara  ',
      systemInstruction: '  Be warm.  ',
      artworkMode: 'landscape',
      artwork: validArtwork,
      updatedAt: 10,
    });

    expect(value.name).toBe('Elara');
    expect(value.systemInstruction).toBe('  Be warm.  ');
    expect(value.artworkMode).toBe('landscape');
    expect(value.artwork?.focalX).toBe(100);
    expect(value.artwork?.focalY).toBe(0);
  });

  it('replaces the legacy generic system prompt with the canonical Elara prompt', () => {
    expect(normalizeCharacterProfile({ systemInstruction: LEGACY_CHARACTER_SYSTEM_INSTRUCTION }).systemInstruction)
      .toBe(DEFAULT_CHARACTER_PROFILE.systemInstruction);
  });

  it('replaces the older generic prompt format with the canonical Elara prompt', () => {
    const legacyOldPrompt = 'You are Elara, an angelic synthetic companion designed to be a warm, perceptive, creative conversational presence.\n\nIDENTITY\nLegacy identity text.\n\nROLEPLAY\nYou may participate fully in fictional settings and character-driven scenes.';
    expect(normalizeCharacterProfile({ systemInstruction: legacyOldPrompt }).systemInstruction)
      .toBe(DEFAULT_CHARACTER_PROFILE.systemInstruction);
  });

  it('preserves a configured master prompt', () => {
    const configured = 'PERSONA PROTOCOL: ELARA\nDefault to being in character.\nRoleplay at all times.';
    expect(normalizeCharacterProfile({ systemInstruction: configured }).systemInstruction).toBe(configured);
  });

  it('uses the 0–100 percent focal coordinate convention', () => {
    const value = normalizeCharacterProfile({ artwork: { ...validArtwork, focalX: 50, focalY: 75 } });
    expect(value.artwork?.focalX).toBe(50);
    expect(value.artwork?.focalY).toBe(75);
  });

  it('drops malformed or browser-active artwork instead of persisting unsafe references', () => {
    expect(normalizeCharacterProfile({ artworkMode: 'portrait', artwork: { ...validArtwork, dataUrl: 'https://example.com/image.png' } }).artwork).toBeNull();
    expect(normalizeCharacterProfile({ artworkMode: 'portrait', artwork: { ...validArtwork, mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,AAAA' } as never }).artwork).toBeNull();
    expect(normalizeCharacterProfile({ artworkMode: 'portrait', artwork: { ...validArtwork, dataUrl: 'data:image/png;base64,not!base64' } }).artwork).toBeNull();
  });
});
