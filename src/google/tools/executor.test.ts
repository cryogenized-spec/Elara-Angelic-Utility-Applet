import { describe, expect, it, vi } from 'vitest';
import { executeGoogleTool } from './executor';
import type { GoogleCapabilityKey, GoogleOAuthAuthority } from '../oauth/contracts';

function oauthFor(...capabilities: GoogleCapabilityKey[]): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: async () => new Response('{}', { status: 200 }) }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: capabilities }),
    disconnect: async () => undefined,
  };
}

describe('executeGoogleTool', () => {
  it('executes an authorized read without confirmation', async () => {
    const handler = vi.fn(async () => ({ events: [] }));
    const result = await executeGoogleTool(
      { tool: 'calendar.listEvents', arguments: {} },
      { oauth: oauthFor('calendar.events.read'), handlers: { 'calendar.listEvents': handler } },
    );
    expect(result.ok).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('blocks an unauthorized capability before handler execution', async () => {
    const handler = vi.fn(async () => ({}));
    const result = await executeGoogleTool(
      { tool: 'drive.getFile', arguments: { fileId: 'file-1' } },
      { oauth: oauthFor(), handlers: { 'drive.getFile': handler } },
    );
    expect(result).toMatchObject({ ok: false, code: 'AUTHORIZATION_REQUIRED', failure: { requiresUserAction: true } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a declined result when the explicit confirmation hook rejects a write', async () => {
    const handler = vi.fn(async () => ({ id: 'file-1' }));
    const confirm = vi.fn(async () => false);
    const result = await executeGoogleTool(
      { tool: 'drive.updateFile', arguments: { fileId: 'file-1', patch: { name: 'Renamed' } } },
      { oauth: oauthFor('drive.files.write'), handlers: { 'drive.updateFile': handler }, confirm, now: () => new Date('2026-09-04T06:00:00.000Z') },
    );
    expect(result).toMatchObject({ ok: false, code: 'USER_DECLINED', confirmation: { tool: 'drive.updateFile', risk: 'write' } });
    expect(confirm).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs a write only after a fresh approval', async () => {
    const handler = vi.fn(async ({ arguments: args }) => args);
    const confirm = vi.fn(async () => true);
    const result = await executeGoogleTool(
      { tool: 'sheets.writeRange', arguments: { spreadsheetId: 'sheet-1', range: 'Sheet1!A1', values: [['x']] } },
      { oauth: oauthFor('sheets.write'), handlers: { 'sheets.writeRange': handler }, confirm, now: () => new Date('2026-09-04T06:00:00.000Z') },
    );
    expect(result.ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ risk: 'write' }));
  });

  it('rejects invalid Drive/Sheets arguments at the trust boundary', async () => {
    const handler = vi.fn(async () => ({}));
    const result = await executeGoogleTool(
      { tool: 'sheets.writeRange', arguments: { spreadsheetId: '', range: 'Sheet1!A1', values: [] } },
      { oauth: oauthFor('sheets.write'), handlers: { 'sheets.writeRange': handler } },
    );
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TOOL_CALL', failure: { kind: 'validation' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not leak handler/provider exception details', async () => {
    const handler = vi.fn(async () => { throw new Error('Bearer token ABC123 leaked'); });
    const result = await executeGoogleTool(
      { tool: 'drive.getFile', arguments: { fileId: 'file-1' } },
      { oauth: oauthFor('drive.files.read'), handlers: { 'drive.getFile': handler } },
    );
    expect(result).toMatchObject({ ok: false, code: 'EXECUTION_FAILED', failure: { kind: 'provider' } });
    if (!result.ok) expect(result.failure.message).not.toContain('ABC123');
  });
});
