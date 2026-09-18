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
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
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

  it('renders the entire durable-memory review text before approval', async () => {
    const fullBody = `Persist this exact durable content.\n${'z'.repeat(4_000)}`;
    const memoryRequest: WriteConfirmationRequest = {
      ...request('memory.save'),
      resourceSummary: 'Save durable memory “Long review”. Review the full proposed body below before approving.',
      reviewText: fullBody,
    };

    const pending = requestGoogleToolConfirmations([memoryRequest]);
    const review = document.querySelector<HTMLElement>('.google-confirmation-item__review-text');
    expect(review).not.toBeNull();
    expect(review?.textContent).toBe(fullBody);
    expect(review?.style.maxHeight).toBe('12rem');
    expect(review?.style.overflow).toBe('auto');

    dismissGoogleToolConfirmation();
    await expect(pending).resolves.toEqual([false]);
  });
});
