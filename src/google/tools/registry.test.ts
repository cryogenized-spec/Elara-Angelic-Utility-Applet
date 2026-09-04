import { describe, expect, it } from 'vitest';
import { googleToolRegistry } from './registry';

const PASS_5_TOOLS = [
  'drive.searchFiles',
  'drive.getFile',
  'drive.downloadFile',
  'drive.createFile',
  'drive.updateFile',
  'drive.moveFile',
  'sheets.getSpreadsheet',
  'sheets.readRange',
  'sheets.writeRange',
  'sheets.appendRows',
  'sheets.batchUpdate',
] as const;

describe('Google tool registry', () => {
  it('registers every Pass 5 Drive and Sheets tool exactly once', () => {
    const matches = googleToolRegistry.filter((descriptor) => PASS_5_TOOLS.includes(descriptor.name as (typeof PASS_5_TOOLS)[number]));
    expect(matches.map((descriptor) => descriptor.name)).toEqual([...PASS_5_TOOLS]);
  });

  it('keeps Drive reads separate from Drive writes', () => {
    expect(googleToolRegistry.find((tool) => tool.name === 'drive.searchFiles')).toMatchObject({ risk: 'read', capability: 'drive.files.read' });
    expect(googleToolRegistry.find((tool) => tool.name === 'drive.updateFile')).toMatchObject({ risk: 'write', capability: 'drive.files.write' });
  });

  it('keeps Sheets reads separate from Sheets writes', () => {
    expect(googleToolRegistry.find((tool) => tool.name === 'sheets.readRange')).toMatchObject({ risk: 'read', capability: 'sheets.read' });
    expect(googleToolRegistry.find((tool) => tool.name === 'sheets.writeRange')).toMatchObject({ risk: 'write', capability: 'sheets.write' });
  });

  it('does not expose an arbitrary Google HTTP tool', () => {
    const registeredToolNames: readonly string[] = googleToolRegistry.map((tool) => tool.name);
    expect(registeredToolNames.includes('google.request')).toBe(false);
  });
});
