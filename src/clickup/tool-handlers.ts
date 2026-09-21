import type { GoogleToolHandlers } from '../google/tools/executor';
import { CLICKUP_TOOL_NAMES, validateClickUpToolArguments } from './tool-schema';
import { callClickUpMcpTool } from './mcp-client';

export const clickUpToolHandlers: GoogleToolHandlers = Object.fromEntries(
  CLICKUP_TOOL_NAMES.map((name) => [
    name,
    async ({ arguments: raw, signal }) => callClickUpMcpTool(name, validateClickUpToolArguments(name, raw), signal),
  ]),
) as GoogleToolHandlers;
