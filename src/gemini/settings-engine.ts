import { z } from 'zod';
import { getGeminiModel, type GeminiModelDefinition, type ThinkingLevel } from './model-registry';

export const geminiSettingsSchema = z.object({
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  thinkingSummaries: z.boolean().default(true),
  maxOutputTokens: z.number().int().min(1).optional(),
  seed: z.number().int().min(0).optional(),
  stopSequences: z.array(z.string().min(1).max(128)).max(5).default([]),
});

export type GeminiSettings = z.infer<typeof geminiSettingsSchema>;

export const DEFAULT_GEMINI_SETTINGS: GeminiSettings = {
  thinkingSummaries: true,
  stopSequences: [],
};

export type EffectiveGeminiSettings = {
  thinkingLevel?: ThinkingLevel;
  thinkingSummaries?: 'auto' | 'none';
  maxOutputTokens?: number;
  seed?: number;
  stopSequences?: string[];
};

export function defaultsForModel(modelId: string): GeminiSettings {
  const model = getGeminiModel(modelId);
  return {
    thinkingLevel: model.defaultThinkingLevel,
    thinkingSummaries: model.thinkingSummaries,
    stopSequences: [],
  };
}

export function effectiveGeminiSettings(modelId: string, input: GeminiSettings): EffectiveGeminiSettings {
  const model: GeminiModelDefinition = getGeminiModel(modelId);
  const parsed = geminiSettingsSchema.parse(input);
  const result: EffectiveGeminiSettings = {};

  if (model.thinkingLevels.length > 0 && parsed.thinkingLevel && model.thinkingLevels.includes(parsed.thinkingLevel)) {
    result.thinkingLevel = parsed.thinkingLevel;
  }
  if (model.thinkingSummaries) result.thinkingSummaries = parsed.thinkingSummaries ? 'auto' : 'none';
  if (model.supportsMaxOutputTokens && parsed.maxOutputTokens !== undefined) {
    result.maxOutputTokens = Math.min(model.outputTokenLimit, Math.max(1, parsed.maxOutputTokens));
  }
  if (model.supportsSeed && parsed.seed !== undefined) result.seed = parsed.seed;
  if (model.supportsStopSequences && parsed.stopSequences.length > 0) result.stopSequences = parsed.stopSequences;

  return result;
}

export function normalizeGeminiSettings(modelId: string, input: GeminiSettings): GeminiSettings {
  const model = getGeminiModel(modelId);
  const effective = effectiveGeminiSettings(modelId, input);
  return {
    thinkingLevel: effective.thinkingLevel,
    thinkingSummaries: model.thinkingSummaries ? input.thinkingSummaries : false,
    maxOutputTokens: effective.maxOutputTokens,
    seed: effective.seed,
    stopSequences: effective.stopSequences ?? [],
  };
}
