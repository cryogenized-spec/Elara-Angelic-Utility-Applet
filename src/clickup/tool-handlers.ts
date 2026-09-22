import type { GoogleToolHandlers } from '../google/tools/executor';
import { CLICKUP_TOOL_NAMES, validateClickUpToolArguments } from './tool-schema';
import { callClickUpMcpTool } from './mcp-client';
import { uploadClickUpArtifact } from './attachment-upload';
import { isClickUpReplayTool, runClickUpMutationOnce } from './mutation-replay';

export const clickUpToolHandlers: GoogleToolHandlers = Object.fromEntries(
  CLICKUP_TOOL_NAMES.map((name) => [
    name,
    async ({
      arguments: raw,
      signal,
      callId,
      conversationId,
      messageId,
      generationId,
      isGenerationActive,
      providerGrantRevision,
      providerAuthorityBinding,
      clickupArtifactSnapshot,
    }) => {
      const args = validateClickUpToolArguments(name, raw);
      const admittedGrant = providerGrantRevision && providerAuthorityBinding
        ? { revision: providerGrantRevision, authorityBinding: providerAuthorityBinding }
        : undefined;

      const execute = () => name === 'clickup.attachArtifact'
        ? uploadClickUpArtifact(args, signal, admittedGrant, clickupArtifactSnapshot)
        : callClickUpMcpTool(name, args, signal, admittedGrant);

      if (!isClickUpReplayTool(name)) return execute();

      return runClickUpMutationOnce(
        {
          tool: name,
          callId,
          conversationId,
          messageId,
          generationId,
          signal,
          isGenerationActive,
        },
        {
          arguments: args,
          admittedGrant: admittedGrant
            ? {
                revision: admittedGrant.revision,
                authorityBinding: admittedGrant.authorityBinding,
              }
            : null,
        },
        execute,
        name === 'clickup.attachArtifact' ? clickupArtifactSnapshot : undefined,
      );
    },
  ]),
) as GoogleToolHandlers;
