import { describe, expect, it } from 'vitest';
import { googleToolRegistry } from './registry';

const PASS_4_FILE_TOOLS = [
  'drive.searchFiles',
  'drive.searchLibrary',
  'drive.getFile',
  'drive.downloadFile',
  'drive.createFile',
  'drive.updateFile',
  'drive.moveFile',
  'docs.inspectDocument',
  'docs.exportDocument',
  'docs.createDocument',
  'docs.insertText',
  'docs.appendParagraph',
  'docs.replaceText',
  'sheets.getSpreadsheet',
  'sheets.readRange',
  'sheets.exportSpreadsheet',
  'sheets.createSpreadsheet',
  'sheets.addSheet',
  'sheets.writeRange',
  'sheets.appendRows',
  'sheets.updateCell',
  'sheets.insertRows',
  'sheets.batchUpdate',
] as const;

describe('Google tool registry', () => {
  it('registers the Pass 4 Drive, Docs and Sheets file surface exactly once', () => {
    const matches = googleToolRegistry.filter((descriptor) => PASS_4_FILE_TOOLS.includes(descriptor.name as (typeof PASS_4_FILE_TOOLS)[number]));
    const names = matches.map((descriptor) => descriptor.name);
    expect(new Set(names).size).toBe(PASS_4_FILE_TOOLS.length);
    expect([...names].sort()).toEqual([...PASS_4_FILE_TOOLS].sort());
  });

  it('keeps Drive reads separate from Drive writes', () => {
    expect(googleToolRegistry.find((tool) => tool.name === 'drive.searchFiles')).toMatchObject({ risk: 'read', capability: 'drive.files.app.read', exposure: 'gemini' });
    expect(googleToolRegistry.find((tool) => tool.name === 'drive.searchLibrary')).toMatchObject({ risk: 'read', capability: 'drive.library.read', exposure: 'gemini' });
    expect(googleToolRegistry.find((tool) => tool.name === 'drive.updateFile')).toMatchObject({ risk: 'write', capability: 'drive.files.app.write' });
  });

  it('keeps Sheets reads separate from Sheets writes', () => {
    expect(googleToolRegistry.find((tool) => tool.name === 'sheets.readRange')).toMatchObject({ risk: 'read', capability: 'sheets.read' });
    expect(googleToolRegistry.find((tool) => tool.name === 'sheets.writeRange')).toMatchObject({ risk: 'write', capability: 'sheets.write' });
  });

  it('does not expose an arbitrary Google HTTP tool', () => {
    const registeredToolNames: readonly string[] = googleToolRegistry.map((tool) => tool.name);
    expect(registeredToolNames.includes('google.request')).toBe(false);
  });

  it('hides Chat and raw batchUpdate primitives from Gemini', () => {
    expect(googleToolRegistry.find((tool) => tool.name === 'docs.batchUpdate')?.exposure).toBe('internal');
    expect(googleToolRegistry.find((tool) => tool.name === 'sheets.batchUpdate')?.exposure).toBe('internal');
    expect(googleToolRegistry.find((tool) => tool.name === 'chat.listMessages')?.exposure).toBe('internal');
    expect(googleToolRegistry.find((tool) => tool.name === 'docs.inspectDocument')?.exposure).toBe('gemini');
  });
});
