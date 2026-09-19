import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWorkspaceCreateReplayForTests, runWorkspaceCreateOnce } from './workspace-create-replay';

describe('Workspace create replay fence', () => {
  beforeEach(() => resetWorkspaceCreateReplayForTests());

  it('executes an exact create call once for the elected turn', async () => {
    const operation = vi.fn(async () => ({ id: 'created-1' }));
    const context = {
      tool: 'sheets.createSpreadsheet' as const,
      callId: 'call-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      isGenerationActive: () => true,
    };
    const first = runWorkspaceCreateOnce(context, { title: 'Budget' }, operation);
    const second = runWorkspaceCreateOnce(context, { title: 'Budget' }, operation);
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 'created-1' }, { id: 'created-1' }]);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('fails closed when the same tool call id changes create arguments', async () => {
    const operation = vi.fn(async () => ({ id: 'created-1' }));
    const context = {
      tool: 'docs.createDocument' as const,
      callId: 'call-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      isGenerationActive: () => true,
    };
    await runWorkspaceCreateOnce(context, { title: 'One' }, operation);
    await expect(runWorkspaceCreateOnce(context, { title: 'Two' }, operation)).rejects.toThrow(/changed arguments/i);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not begin a create after its generation loses authority', async () => {
    const operation = vi.fn(async () => ({ id: 'created-1' }));
    await expect(runWorkspaceCreateOnce({
      tool: 'sheets.addSheet',
      callId: 'call-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      isGenerationActive: () => false,
    }, { spreadsheetId: 'sheet-1', title: 'Summary' }, operation)).rejects.toThrow(/lost turn authority/i);
    expect(operation).not.toHaveBeenCalled();
  });
});
