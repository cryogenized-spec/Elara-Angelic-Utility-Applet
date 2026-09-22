// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./authority', () => ({
  clickUpOAuthAuthority: {
    beginConnect: vi.fn(),
    completeConnect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

import { clickUpOAuthAuthority } from './authority';
import { connectClickUpWithPopup, switchClickUpAccountWithPopup } from './popup';

const beginMock = vi.mocked(clickUpOAuthAuthority.beginConnect);
const disconnectMock = vi.mocked(clickUpOAuthAuthority.disconnect);

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

  it('opens the replacement popup before awaiting disconnect', async () => {
    const popup = popupStub();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup.window);
    disconnectMock.mockRejectedValueOnce(new Error('disconnect failed'));

    await expect(switchClickUpAccountWithPopup()).rejects.toThrow('disconnect failed');

    expect(open).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(disconnectMock.mock.invocationCallOrder[0]);
    expect(beginMock).not.toHaveBeenCalled();
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
