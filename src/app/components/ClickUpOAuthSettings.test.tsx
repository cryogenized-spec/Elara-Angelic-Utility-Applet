// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oauthMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getConnectionMethods: vi.fn(),
  connectPersonalToken: vi.fn(),
  disconnect: vi.fn(),
}));

const popupMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  switchAccount: vi.fn(),
}));

vi.mock('../../clickup/oauth/authority', () => ({
  clickUpOAuthAuthority: {
    getStatus: oauthMocks.getStatus,
    getConnectionMethods: oauthMocks.getConnectionMethods,
    connectPersonalToken: oauthMocks.connectPersonalToken,
    disconnect: oauthMocks.disconnect,
  },
}));

vi.mock('../../clickup/oauth/popup', () => ({
  connectClickUpWithPopup: popupMocks.connect,
  switchClickUpAccountWithPopup: popupMocks.switchAccount,
}));

import type { ClickUpOAuthStatus } from '../../clickup/oauth/contracts';
import { ClickUpOAuthSettings } from './ClickUpOAuthSettings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatusMock = oauthMocks.getStatus;
const getConnectionMethodsMock = oauthMocks.getConnectionMethods;
const connectMock = popupMocks.connect;
const personalTokenMock = oauthMocks.connectPersonalToken;
const switchMock = popupMocks.switchAccount;

const CONNECTED: ClickUpOAuthStatus = {
  connected: true,
  account: { id: '183', username: 'Gareth', email: 'company@example.com' },
  workspaces: [{ id: '999', name: 'Neon Sales' }],
  updatedAt: 123456,
};

let container: HTMLDivElement;
let root: Root;

async function renderSettings(): Promise<void> {
  await act(async () => {
    root.render(<ClickUpOAuthSettings />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(name: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent?.trim() === name);
  if (!match) throw new Error(`Expected button ${name}`);
  return match;
}

describe('ClickUpOAuthSettings', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getStatusMock.mockResolvedValue(CONNECTED);
    getConnectionMethodsMock.mockResolvedValue({ oauth: true, personalToken: false });
    connectMock.mockResolvedValue(CONNECTED);
    personalTokenMock.mockResolvedValue(CONNECTED);
    switchMock.mockResolvedValue(CONNECTED);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows ClickUp as an independent identity with explicit MCP and Workspace state', async () => {
    await renderSettings();

    expect(container.textContent).toContain('company@example.com');
    expect(container.textContent).toContain('MCP ready · 1 Workspace');
    expect(container.textContent).toContain('First-party ClickUp MCP is active');
    expect(container.textContent).toContain('Your Google accounts do not have to match');
    expect(container.textContent).toContain('Elara never reuses its Google Workspace token for ClickUp');
    expect(container.textContent).toContain('Neon Sales');
    expect(container.textContent).not.toContain('Workspace ID 999');
  });

  it('switches ClickUp identity through the dedicated replacement flow', async () => {
    const replacement: ClickUpOAuthStatus = {
      connected: true,
      account: { id: '200', username: 'Company User', email: 'other-company@example.com' },
      workspaces: [{ id: '1000', name: 'Company Workspace' }],
      updatedAt: 234567,
    };
    switchMock.mockResolvedValueOnce(replacement);

    await renderSettings();
    await act(async () => {
      button('Switch ClickUp account').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(switchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('other-company@example.com');
    expect(container.textContent).toContain('Company Workspace');
  });

  it('presents a provider-owned connect action when disconnected', async () => {
    getStatusMock.mockResolvedValueOnce({ connected: false, workspaces: [] });
    await renderSettings();

    expect(button('Continue to ClickUp')).toBeTruthy();
    expect(container.textContent).toContain('Your ClickUp identity is independent from the Google Workspace account connected to Elara');

    await act(async () => {
      button('Continue to ClickUp').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('uses a Worker-configured personal API token without opening ClickUp OAuth', async () => {
    const tokenReady: ClickUpOAuthStatus = {
      connected: false,
      workspaces: [],
    };
    const connected: ClickUpOAuthStatus = {
      ...CONNECTED,
    };
    getStatusMock.mockResolvedValueOnce(tokenReady);
    getConnectionMethodsMock.mockResolvedValueOnce({ oauth: false, personalToken: true });
    personalTokenMock.mockResolvedValueOnce(connected);

    await renderSettings();

    expect(button('Use configured API token')).toBeTruthy();
    expect(container.textContent).toContain('without exposing the token to this browser');
    expect(container.textContent).not.toContain('Continue to ClickUp');

    await act(async () => {
      button('Use configured API token').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(personalTokenMock).toHaveBeenCalledTimes(1);
    expect(connectMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('company@example.com');
    expect(container.textContent).not.toContain('Switch ClickUp account');
    expect(button('Reload configured API token')).toBeTruthy();
  });


  it('reconciles authoritative status after an ambiguous personal-token activation failure', async () => {
    const tokenReady: ClickUpOAuthStatus = {
      connected: false,
      workspaces: [],
    };
    const replacement: ClickUpOAuthStatus = {
      connected: true,
      account: { id: '200', username: 'Replacement', email: 'replacement@example.com' },
      workspaces: [{ id: '1000', name: 'Replacement Workspace' }],
      updatedAt: 234567,
    };
    getStatusMock.mockReset();
    getStatusMock.mockResolvedValueOnce(tokenReady).mockResolvedValueOnce(replacement);
    getConnectionMethodsMock.mockResolvedValueOnce({ oauth: false, personalToken: true });
    personalTokenMock.mockRejectedValueOnce(new Error('Connection timed out after Worker commit.'));

    await renderSettings();
    await act(async () => {
      button('Use configured API token').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getStatusMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('replacement@example.com');
    expect(container.textContent).toContain('Replacement Workspace');
    expect(container.textContent).not.toContain('Connection state unknown');
  });

  it('marks ClickUp authority unknown and hides mutation-prone connection actions when reconciliation fails', async () => {
    const tokenReady: ClickUpOAuthStatus = {
      connected: false,
      workspaces: [],
    };
    getStatusMock.mockReset();
    getStatusMock.mockResolvedValueOnce(tokenReady).mockRejectedValueOnce(new Error('Worker unreachable.'));
    getConnectionMethodsMock.mockResolvedValueOnce({ oauth: false, personalToken: true });
    personalTokenMock.mockRejectedValueOnce(new Error('Connection timed out.'));

    await renderSettings();
    await act(async () => {
      button('Use configured API token').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('ClickUp status unavailable');
    expect(container.textContent).toContain('Connection state unknown');
    expect(container.textContent).toContain('Refresh status before continuing');
    expect(Array.from(container.querySelectorAll('button')).some((entry) => entry.textContent?.trim() === 'Use configured API token')).toBe(false);
    expect(Array.from(container.querySelectorAll('button')).some((entry) => entry.textContent?.trim() === 'Continue to ClickUp')).toBe(false);
  });
});
