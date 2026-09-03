import { describe, expect, it } from 'vitest';
import { defaultsForModel, effectiveGeminiSettings, normalizeGeminiSettings } from './settings-engine';

describe('Gemini settings engine', () => {
  it('uses 3.8 Flash defaults and rejects unsupported minimal thinking', () => {
    expect(defaultsForModel('gemini-3.8-flash').thinkingLevel).toBe('medium');
    expect(effectiveGeminiSettings('gemini-3.8-flash', { thinkingLevel: 'minimal', thinkingSummaries: true, stopSequences: [] }).thinkingLevel).toBeUndefined();
  });

  it('preserves a valid thinking level for a model', () => {
    const effective = effectiveGeminiSettings('gemini-3.6-flash', { thinkingLevel: 'minimal', thinkingSummaries: true, maxOutputTokens: 999999, stopSequences: [] });
    expect(effective.thinkingLevel).toBe('minimal');
    expect(effective.maxOutputTokens).toBe(65_536);
  });

  it('normalizes unsupported max output and seed away when capability is absent', () => {
    const normalized = normalizeGeminiSettings('gemini-3.8-flash', { thinkingLevel: 'medium', thinkingSummaries: true, maxOutputTokens: 2048, seed: 7, stopSequences: ['END'] });
    expect(normalized.maxOutputTokens).toBe(2048);
    expect(normalized.seed).toBe(7);
    expect(normalized.stopSequences).toEqual(['END']);
  });
});
