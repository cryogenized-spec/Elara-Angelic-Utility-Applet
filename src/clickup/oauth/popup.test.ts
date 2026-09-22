// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorityMocks = vi.hoisted(() => ({
  beginConnect: vi.fn(),
  completeConnect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('./authority', () => ({
  clickUpOAuthAuthority: {
    beginConnect: authorityMocks.beginConnect,
    completeConnect: authorityMocks.completeConnect,
    disconnect: authorityMocks.disconnect,
  },
}));

import { connectClickUpWithPopup, switchClickUpAccountWithPopup } from './popup';

const beginMock = authorityMocks.beginConnect;
const disconnectMock = authorityMocks.disconnect;

function popupStub() {
  const close = vi.fn();
  const replace = vi.fn();
  return {
    close,
    replace,
    window: {
      closed: false,
      close,
      location: { replace },
    } as unknown as Window,
  };
}

describe('ClickUp OAuth popup account switching', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('preserves the current grant when replacement OAuth cannot start', async () => {
    const popup = popupStub();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup.window);
    beginMock.mockRejectedValueOnce(new Error('start failed'));

    await expect(switchClickUpAccountWithPopup()).rejects.toThrow('start failed');

    expect(open).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('does not disconnect the current ClickUp grant if the browser blocks the popup', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(switchClickUpAccountWithPopup()).rejects.toThrow(/popup was blocked/i);

    expect(disconnectMock).not.toHaveBeenCalled();
    expect(beginMock).not.toHaveBeenCalled();
  });

  it('normal connect does not disconnect an existing grant as a side effect', async () => {
    const popup = popupStub();
    vi.spyOn(window, 'open').mockReturnValue(popup.window);
    beginMock.mockRejectedValueOnce(new Error('start failed'));

    await expect(connectClickUpWithPopup()).rejects.toThrow('start failed');

    expect(disconnectMock).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledTimes(1);
  });
});
