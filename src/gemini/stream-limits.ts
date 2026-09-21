/**
 * Canonical live-stream resource ceilings for browser Gemini execution.
 *
 * These limits defend the live reducer/provider path before persistence
 * truncation can help. They are deliberately much larger than ordinary model
 * output, but finite so a malformed/pathological stream cannot grow memory
 * without bound.
 */
export const GEMINI_STREAM_LIMITS = {
  maxEvents: 50_000,
  maxTextChars: 1_000_000,
  maxThoughtChars: 64_000,
  maxFunctionArgumentChars: 100_000,
} as const;
