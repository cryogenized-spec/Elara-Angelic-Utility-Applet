import { describe, expect, it } from 'vitest';
import { normalizeCharacterProfile } from './character';

const validArtwork = {
  id: 'art-1',
  mimeType: 'image/png',
  name: 'Elara.png',
  width: 1200,
  height: 1500,
  dataUrl: 'data:image/png;base64,AAAA',
  focalX: 2,
  focalY: -1,
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
    expect(value.artwork?.focalX).toBe(1);
    expect(value.artwork?.focalY).toBe(0);
  });

  it('drops malformed artwork instead of persisting unsafe references', () => {
    const value = normalizeCharacterProfile({
      artworkMode: 'portrait',
      artwork: { ...validArtwork, dataUrl: 'https://example.com/image.png' },
    });

    expect(value.artwork).toBeNull();
    expect(value.artworkMode).toBe('portrait');
  });
});
