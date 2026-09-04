import { describe, expect, it } from 'vitest';
import { insertTranscriptAtSelection, normalizeSelection } from './draft-insertion';

describe('VTT draft insertion', () => {
  it('inserts at a collapsed cursor with spacing', () => {
    expect(insertTranscriptAtSelection('Hello world', { start: 6, end: 6 }, 'beautiful')).toEqual({ value: 'Hello beautiful world', cursor: 15 });
  });

  it('replaces a selected range', () => {
    expect(insertTranscriptAtSelection('Hello bad world', { start: 6, end: 9 }, 'beautiful')).toEqual({ value: 'Hello beautiful world', cursor: 16 });
  });

  it('does not add a space before punctuation', () => {
    expect(insertTranscriptAtSelection('Hello ', { start: 0, end: 5 }, ',world')).toEqual({ value: ',world ', cursor: 6 });
  });

  it('preserves existing whitespace boundaries', () => {
    expect(insertTranscriptAtSelection('Hello\nworld', { start: 6, end: 6 }, 'new')).toEqual({ value: 'Hello\nnew world', cursor: 9 });
  });

  it('normalizes selections to the draft bounds', () => {
    expect(normalizeSelection({ start: -5, end: 99 }, 10)).toEqual({ start: 0, end: 10 });
    expect(normalizeSelection({ start: 8, end: 2 }, 10)).toEqual({ start: 8, end: 8 });
  });

  it('returns the original draft for an empty transcript', () => {
    expect(insertTranscriptAtSelection('Hello', { start: 2, end: 2 }, '   ')).toEqual({ value: 'Hello', cursor: 2 });
  });
});
