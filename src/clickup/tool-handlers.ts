import type { GoogleToolHandlers } from '../google/tools/executor';
import { CLICKUP_TOOL_NAMES, validateClickUpToolArguments } from './tool-schema';
import { callClickUpMcpTool } from './mcp-client';
import { uploadClickUpArtifact } from './attachment-upload';

export const clickUpToolHandlers: GoogleToolHandlers = Object.fromEntries(
  CLICKUP_TOOL_NAMES.map((name) => [
    name,
    async ({ arguments: raw, signal }) => {
      const args = validateClickUpToolArguments(name, raw);
      if (name === 'clickup.attachArtifact') return uploadClickUpArtifact(args, signal);
      return callClickUpMcpTool(name, args, signal);
    },
  ]),
) as GoogleToolHandlers;
