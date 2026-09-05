import { describe, expect, it } from 'vitest';
import {
  VTT_AUDIO_BITRATE,
  VTT_MAX_DURATION_MS,
  VTT_MIN_BLOB_BYTES,
  VTT_MIN_DURATION_MS,
  VTT_SILENCE_DURATION_MS,
  getSupportedVttMimeType,
  getVttSignalLevel,
  shouldDiscardVttCapture,
} from './recording';

describe('VTT recording contract', () => {
  it('uses the approved voice bitrate and bounded timing defaults', () => {
    expect(VTT_AUDIO_BITRATE).toBe(32_000);
    expect(VTT_MIN_BLOB_BYTES).toBe(2_048);
    expect(VTT_MIN_DURATION_MS).toBe(500);
    expect(VTT_SILENCE_DURATION_MS).toBe(4_000);
    expect(VTT_MAX_DURATION_MS).toBe(60_000);
  });

  it('selects the first browser-supported audio format', () => {
    const supported = new Set(['audio/ogg;codecs=opus']);
    const mediaRecorder = { isTypeSupported: (mimeType: string) => supported.has(mimeType) };
    expect(getSupportedVttMimeType(mediaRecorder)).toBe('audio/ogg;codecs=opus');
  });

  it('rejects recordings below the cheap pre-flight thresholds', () => {
    expect(shouldDiscardVttCapture(2_047, 1_000)).toBe(true);
    expect(shouldDiscardVttCapture(5_000, 499)).toBe(true);
    expect(shouldDiscardVttCapture(5_000, 500)).toBe(false);
  });

  it('maps RMS signal into deterministic visual levels', () => {
    expect(getVttSignalLevel(0)).toBe(0);
    expect(getVttSignalLevel(0.0179)).toBe(0);
    expect(getVttSignalLevel(0.018)).toBe(1);
    expect(getVttSignalLevel(0.0599)).toBe(1);
    expect(getVttSignalLevel(0.06)).toBe(2);
    expect(getVttSignalLevel(0.1599)).toBe(2);
    expect(getVttSignalLevel(0.16)).toBe(3);
  });

  it('fails format selection when no supported recorder MIME type exists', () => {
    const mediaRecorder = { isTypeSupported: () => false };
    expect(() => getSupportedVttMimeType(mediaRecorder)).toThrow(/supported microphone recording format/i);
  });
});
