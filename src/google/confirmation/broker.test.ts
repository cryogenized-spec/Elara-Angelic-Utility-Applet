import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WriteConfirmationRequest } from './policy';
import { dismissGoogleToolConfirmation, requestGoogleToolConfirmations } from './broker';

function request(tool = 'tasks.createTask'): WriteConfirmationRequest {
  return {
    tool,
    risk: 'write',
    resourceSummary: 'Create a test task.',
    requestedAt: new Date().toISOString(),
  };
}

describe('Google confirmation broker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    dismissGoogleToolConfirmation();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('fails closed outside the browser for every requested mutation', async () => {
    vi.stubGlobal('document', undefined);
    await expect(requestGoogleToolConfirmations([request(), request('calendar.createEvent')])).resolves.toEqual([false, false]);
  });

  it('declines immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(requestGoogleToolConfirmations([request()], controller.signal)).resolves.toEqual([false]);
    expect(document.getElementById('elara-google-confirmation')).toBeNull();
  });

  it('settles a pending request exactly once when cancellation arrives', async () => {
    const controller = new AbortController();
    const pending = requestGoogleToolConfirmations([request()], controller.signal);
    expect(document.getElementById('elara-google-confirmation')).not.toBeNull();

    controller.abort();
    await expect(pending).resolves.toEqual([false]);
    expect(document.getElementById('elara-google-confirmation')).toBeNull();

    // A late dismissal is inert and cannot affect the next broker owner.
    dismissGoogleToolConfirmation();
    const next = requestGoogleToolConfirmations([request('calendar.createEvent')]);
    expect(document.getElementById('elara-google-confirmation')).not.toBeNull();
    dismissGoogleToolConfirmation();
    await expect(next).resolves.toEqual([false]);
  });
});
