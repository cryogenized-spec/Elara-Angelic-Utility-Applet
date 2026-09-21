import type { GoogleToolHandlers } from '../google/tools/executor';
import { CLICKUP_TOOL_NAMES, validateClickUpToolArguments } from './tool-schema';
import { callClickUpMcpTool } from './mcp-client';
import { uploadClickUpArtifact } from './attachment-upload';

export const clickUpToolHandlers: GoogleToolHandlers = Object.fromEntries(
  CLICKUP_TOOL_NAMES.map((name) => [
    name,
    async ({ arguments: raw, signal, providerGrantRevision, providerAuthorityBinding }) => {
      const args = validateClickUpToolArguments(name, raw);
      const admittedGrant = providerGrantRevision && providerAuthorityBinding
        ? { revision: providerGrantRevision, authorityBinding: providerAuthorityBinding }
        : undefined;
      if (name === 'clickup.attachArtifact') return uploadClickUpArtifact(args, signal, admittedGrant);
      return callClickUpMcpTool(name, args, signal, admittedGrant);
    },
  ]),
) as GoogleToolHandlers;
