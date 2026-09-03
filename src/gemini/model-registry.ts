export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export type GeminiModelDefinition = {
  id: string;
  name: string;
  family: '3.x' | '2.5';
  lifecycle: 'stable';
  inputTokenLimit: number;
  outputTokenLimit: number;
  thinkingLevels: ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel;
  thinkingSummaries: boolean;
  supportsMaxOutputTokens: boolean;
  supportsSeed: boolean;
  supportsStopSequences: boolean;
  notes?: string;
};

// Only stable production text-output Gemini models are surfaced here. Preview/
// experimental, image/audio/Live/embedding/robotics models are deliberately excluded.
export const GEMINI_MODELS: readonly GeminiModelDefinition[] = [
  {
    id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', family: '3.x', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['low', 'medium', 'high'], defaultThinkingLevel: 'medium',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
    notes: 'Stable. Minimal thinking is not supported; sampling controls are intentionally omitted on the current Gemini 3.x path.',
  },
  {
    id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', family: '3.x', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['low', 'medium', 'high'], defaultThinkingLevel: 'medium',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', family: '3.x', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'], defaultThinkingLevel: 'medium',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', family: '3.x', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'], defaultThinkingLevel: 'medium',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', family: '3.x', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'], defaultThinkingLevel: 'minimal',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', family: '3.x', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'], defaultThinkingLevel: 'minimal',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', family: '2.5', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['low', 'medium', 'high'], defaultThinkingLevel: 'medium',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', family: '2.5', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['low', 'medium', 'high'], defaultThinkingLevel: 'medium',
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
  },
  {
    id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', family: '2.5', lifecycle: 'stable',
    inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    thinkingLevels: ['low', 'medium', 'high'], defaultThinkingLevel: undefined,
    thinkingSummaries: true, supportsMaxOutputTokens: true, supportsSeed: true, supportsStopSequences: true,
    notes: 'Provider default is no thinking unless a level is explicitly selected.',
  },
] as const;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export function getGeminiModel(modelId: string): GeminiModelDefinition {
  return GEMINI_MODELS.find((model) => model.id === modelId) ?? GEMINI_MODELS[0];
}

export function isGeminiModelId(value: string): boolean {
  return GEMINI_MODELS.some((model) => model.id === value);
}
