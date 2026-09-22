import type { GoogleToolName } from '../google/tools/contracts';
import { googleGeminiFunctionNames } from '../google/tools/gemini-declarations';
import { clickupToolNameSchema } from './tool-schema';
import { loadStoredClickUpStatus } from './oauth/authority';

const ALL_GEMINI_TOOLS = Object.freeze(
  [...googleGeminiFunctionNames()] as GoogleToolName[],
);

const NON_CLICKUP_GEMINI_TOOLS = Object.freeze(
  ALL_GEMINI_TOOLS.filter((name) => !clickupToolNameSchema.safeParse(name).success),
);

export function defaultGeminiToolsForClickUpConnection(
  connected: boolean,
): readonly GoogleToolName[] {
  return connected ? ALL_GEMINI_TOOLS : NON_CLICKUP_GEMINI_TOOLS;
}

/**
 * Browser-side declaration election only.
 *
 * The cached status is non-authoritative and may be stale or user-modified.
 * A truthy value may expose ClickUp declarations but can never authorize an
 * operation; every execution still revalidates the paired Worker grant.
 */
export function defaultGeminiToolsForCurrentSession(): readonly GoogleToolName[] {
  return defaultGeminiToolsForClickUpConnection(loadStoredClickUpStatus()?.connected === true);
}
