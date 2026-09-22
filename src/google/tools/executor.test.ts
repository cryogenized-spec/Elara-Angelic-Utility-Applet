import { describe, expect, it, vi } from 'vitest';
import { confirmationRequestForCall, executeGoogleTool, type GoogleToolExecutionContext } from './executor';
import type { GoogleCapabilityKey, GoogleOAuthAuthority } from '../oauth/contracts';

function oauthFor(...capabilities: GoogleCapabilityKey[]): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: async () => new Response('{}', { status: 200 }) }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: capabilities, enabledCapabilities: capabilities, grantedProviderScopes: [] }),
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
      { tool: 'drive.updateFile', arguments: { fileId: 'file-1', etag: '"etag-1"', patch: { name: 'Renamed' } } },
      { oauth: oauthFor('drive.files.app.write'), handlers: { 'drive.updateFile': handler }, confirm, now: () => new Date('2026-09-04T06:00:00.000Z') },
    );
    expect(result).toMatchObject({ ok: false, code: 'USER_DECLINED', confirmation: { tool: 'drive.updateFile', risk: 'write' } });
    expect(confirm).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs a write only after a fresh approval', async () => {
    const handler = vi.fn(async ({ arguments: args }: GoogleToolExecutionContext) => args);
    const confirm = vi.fn(async () => true);
    const result = await executeGoogleTool(
      { tool: 'sheets.writeRange', arguments: { spreadsheetId: 'sheet-1', range: 'Sheet1!A1', values: [['x']] } },
      { oauth: oauthFor('sheets.write'), handlers: { 'sheets.writeRange': handler }, confirm, now: () => new Date('2026-09-04T06:00:00.000Z') },
    );
    expect(result.ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ risk: 'write' }));
  });

  it('shows exact validated Sheets rows before approval', () => {
    const confirmation = confirmationRequestForCall(
      { tool: 'sheets.writeRange', arguments: { spreadsheetId: 'sheet-1', range: 'Sheet1!A1:B2', values: [['item', 'count'], ['sample', 42]] } },
      new Date('2026-09-04T06:00:00.000Z'),
    );

    expect(confirmation?.reviewText).toContain('Range: “Sheet1!A1:B2”');
    expect(confirmation?.reviewText).toContain('Row 2:');
    expect(confirmation?.reviewText).toContain('Cell 1: “sample”');
    expect(confirmation?.reviewText).toContain('Cell 2: 42');
    expect(confirmation?.reviewText).not.toContain('{');
    expect(confirmation?.reviewText).not.toContain('"range"');
  });

  it('fails closed when the Google account/grant changes while confirmation is open', async () => {
    const handler = vi.fn(async () => ({ sent: true }));
    let account = 'one@example.com';
    const grant = () => ({
      accountEmail: account,
      authorityBinding: 'browser#https://app.example',
      authorityFingerprint: `account:${account}`,
    });
    const oauth: GoogleOAuthAuthority = {
      ...oauthFor('gmail.send'),
      getExecutionGrant: async () => grant(),
      assertExecutionGrant: async (expected) => {
        const current = grant();
        if (
          expected.accountEmail !== current.accountEmail
          || expected.authorityBinding !== current.authorityBinding
          || expected.authorityFingerprint !== current.authorityFingerprint
        ) throw new Error('grant changed');
      },
    };

    const result = await executeGoogleTool(
      { tool: 'gmail.sendMessage', arguments: { to: ['bob@example.com'], subject: 'Hello', body: 'Approved body' } },
      {
        oauth,
        handlers: { 'gmail.sendMessage': handler },
        confirm: async () => {
          account = 'two@example.com';
          return true;
        },
      },
    );

    expect(result).toMatchObject({ ok: false, code: 'AUTHORIZATION_REQUIRED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('carries a stable Google execution grant into the approved handler context', async () => {
    const stableGrant = {
      accountEmail: 'one@example.com',
      authorityBinding: 'browser#https://app.example',
      authorityFingerprint: 'stable-authority',
    };
    const oauth: GoogleOAuthAuthority = {
      ...oauthFor('sheets.write'),
      getExecutionGrant: async () => stableGrant,
      assertExecutionGrant: async (expected) => {
        expect(expected).toEqual(stableGrant);
      },
    };
    const handler = vi.fn(async (context: GoogleToolExecutionContext) => context.googleExecutionGrant);

    const result = await executeGoogleTool(
      { tool: 'sheets.writeRange', arguments: { spreadsheetId: 'sheet-1', range: 'Sheet1!A1', values: [['x']] } },
      { oauth, handlers: { 'sheets.writeRange': handler }, confirm: async () => true },
    );

    expect(result).toMatchObject({ ok: true, result: stableGrant });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ googleExecutionGrant: stableGrant }));
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
      { oauth: oauthFor('drive.files.app.read'), handlers: { 'drive.getFile': handler } },
    );
    expect(result).toMatchObject({ ok: false, code: 'EXECUTION_FAILED', failure: { kind: 'provider' } });
    if (!result.ok) expect(result.failure.message).not.toContain('ABC123');
  });

  it('authorizes a Docs read when only Drive library search is effective', async () => {
    const handler = vi.fn(async () => ({ documentId: 'doc-1', blocks: [] }));
    const result = await executeGoogleTool(
      { tool: 'docs.inspectDocument', arguments: { documentId: 'doc-1' } },
      { oauth: oauthFor('drive.library.read'), handlers: { 'docs.inspectDocument': handler } },
    );
    expect(result.ok).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not authorize a Docs write from a library-read grant', async () => {
    const handler = vi.fn(async () => ({}));
    const result = await executeGoogleTool(
      { tool: 'docs.appendParagraph', arguments: { documentId: 'doc-1', tabId: 'tab-1', revisionId: 'rev-1', text: 'Hello' } },
      { oauth: oauthFor('drive.library.read'), handlers: { 'docs.appendParagraph': handler }, confirm: async () => true },
    );
    expect(result).toMatchObject({ ok: false, code: 'AUTHORIZATION_REQUIRED', requiredCapability: 'docs.write' });
    expect(handler).not.toHaveBeenCalled();
  });
});


describe('kanban tool trust boundary', () => {
  it('blocks malformed deletions before confirmation', async () => {
    const handler = vi.fn(); const confirm = vi.fn(async () => true);
    const result = await executeGoogleTool({ tool: 'tasks.deleteTaskList', arguments: { taskListId: '' } }, { oauth: oauthFor('tasks.write'), handlers: { 'tasks.deleteTaskList': handler }, confirm });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TOOL_CALL' });
    expect(confirm).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
  });
  it('makes the list-wide destructive effect explicit and honors rejection', async () => {
    const handler = vi.fn(); const confirm = vi.fn(async () => false);
    const result = await executeGoogleTool({ tool: 'tasks.deleteTaskList', arguments: { taskListId: 'work' } }, { oauth: oauthFor('tasks.write'), handlers: { 'tasks.deleteTaskList': handler }, confirm });
    expect(result).toMatchObject({ ok: false, code: 'USER_DECLINED' });
    expect(confirm.mock.calls).toHaveLength(1);
    expect(handler).not.toHaveBeenCalled();
  });
  it('rejects obsolete raw-resource task updates', async () => {
    const result = await executeGoogleTool({ tool: 'tasks.updateTask', arguments: { taskListId: 'work', taskId: 't', patch: { title: 'Next' } } }, { oauth: oauthFor('tasks.write'), handlers: {} });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TOOL_CALL' });
  });
});
