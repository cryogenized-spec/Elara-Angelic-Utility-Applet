import { describe, expect, it } from 'vitest';
import {
  CLICKUP_TOOL_NAMES,
  clickupToolCatalog,
  clickUpGeminiFunctionDeclarations,
  clickUpMcpToolDefinitions,
  clickUpToolJsonSchema,
  validateClickUpToolArguments,
} from './tool-schema';

describe('ClickUp canonical model/MCP tool schemas', () => {
  it('has one catalog entry for every planned first-party tool', () => {
    expect(Object.keys(clickupToolCatalog).sort()).toEqual([...CLICKUP_TOOL_NAMES].sort());
  });

  it('derives strict object JSON Schemas from the same Zod runtime authority', () => {
    for (const name of CLICKUP_TOOL_NAMES) {
      const schema = clickUpToolJsonSchema(name);
      expect(schema.type, name).toBe('object');
      expect(schema.additionalProperties, name).toBe(false);
    }
  });

  it('keeps MCP tools/list and Gemini declarations in exact schema parity', () => {
    expect(clickUpMcpToolDefinitions).toHaveLength(CLICKUP_TOOL_NAMES.length);
    expect(clickUpGeminiFunctionDeclarations).toHaveLength(CLICKUP_TOOL_NAMES.length);

    for (const name of CLICKUP_TOOL_NAMES) {
      const mcp = clickUpMcpToolDefinitions.find((tool) => tool.name === name);
      const gemini = clickUpGeminiFunctionDeclarations.find((tool) => tool.name === name);
      expect(mcp, name).toBeDefined();
      expect(gemini, name).toBeDefined();
      expect(gemini?.type, name).toBe('function');
      expect(gemini?.description, name).toBe(mcp?.description);
      expect(gemini?.parameters, name).toEqual(mcp?.inputSchema);
    }
  });

  it('rejects arbitrary HTTP authority at the semantic tool boundary', () => {
    expect(() => validateClickUpToolArguments('clickup.getTask', {
      workspaceId: '999',
      taskId: '86abc',
      url: 'https://api.clickup.com/api/v2/task/86abc',
      method: 'DELETE',
      headers: { Authorization: 'secret' },
    })).toThrow();
  });

  it('keeps permanent task deletion outside the first-party surface', () => {
    expect(CLICKUP_TOOL_NAMES.some((name) => /deleteTask$/i.test(name))).toBe(false);
    expect(CLICKUP_TOOL_NAMES).toContain('clickup.updateTask');
    expect(validateClickUpToolArguments('clickup.updateTask', {
      workspaceId: '999',
      taskId: '86abc',
      archived: true,
    })).toEqual({ workspaceId: '999', taskId: '86abc', archived: true });
  });

  it('requires an actual mutation for updateTask', () => {
    expect(() => validateClickUpToolArguments('clickup.updateTask', {
      workspaceId: '999',
      taskId: '86abc',
    })).toThrow();
  });

  it('models Custom Field set and clear without exposing a raw provider payload', () => {
    expect(validateClickUpToolArguments('clickup.setCustomField', {
      workspaceId: '999',
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      fieldId: 'field-1',
      value: { add: ['123'], rem: ['456'] },
    })).toEqual({
      workspaceId: '999',
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      fieldId: 'field-1',
      value: { add: ['123'], rem: ['456'] },
    });
    expect(() => validateClickUpToolArguments('clickup.setCustomField', {
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      fieldId: 'field-1',
    })).toThrow();
    expect(validateClickUpToolArguments('clickup.setCustomField', {
      workspaceId: '999',
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      fieldId: 'field-1',
      mode: 'clear',
    })).toEqual({
      workspaceId: '999',
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      fieldId: 'field-1',
      mode: 'clear',
    });
  });

  it('uses decimal strings for provider numeric identifiers at the model boundary', () => {
    expect(validateClickUpToolArguments('clickup.resolveAssignees', {
      workspaceId: '12345678901234567890',
      names: ['Sue-Ann', 'Samir'],
    })).toMatchObject({ workspaceId: '12345678901234567890' });
    expect(() => validateClickUpToolArguments('clickup.resolveAssignees', {
      workspaceId: 123,
      names: ['Sue-Ann'],
    })).toThrow();
  });

  it('keeps artifact bytes and provider URLs out of attachArtifact arguments', () => {
    expect(validateClickUpToolArguments('clickup.attachArtifact', {
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      artifactId: 'artifact:repair-report',
      filename: 'repair-report.pdf',
    })).toEqual({
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      artifactId: 'artifact:repair-report',
      filename: 'repair-report.pdf',
    });
    expect(() => validateClickUpToolArguments('clickup.attachArtifact', {
      workspaceId: '999',
      workspaceId: '999',
      taskId: '86abc',
      artifactId: 'artifact:repair-report',
      data: 'base64...',
    })).toThrow();
  });
});
