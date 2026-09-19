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

  it('leaves grouped mutations unselected and exposes no approve-all shortcut', async () => {
    const pending = requestGoogleToolConfirmations([request(), request('calendar.createEvent')]);
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-confirm-index]'));
    const approve = document.querySelector<HTMLButtonElement>('[data-decision="selected"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.checked === false)).toBe(true);
    expect(document.querySelector('[data-decision="all"]')).toBeNull();
    expect(approve?.disabled).toBe(true);

    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change'));
    expect(approve?.disabled).toBe(false);
    approve?.click();
    await expect(pending).resolves.toEqual([true, false]);
  });

  it('requires explicit selection when external content influenced a single proposed mutation', async () => {
    const elevated: WriteConfirmationRequest = {
      ...request('tasks.createTask'),
      untrustedContext: true,
      reviewText: '{ "title": "Review me carefully" }',
    };
    const pending = requestGoogleToolConfirmations([elevated]);
    const checkbox = document.querySelector<HTMLInputElement>('[data-confirm-index="0"]');
    const approve = document.querySelector<HTMLButtonElement>('[data-decision="selected"]');
    const warning = document.querySelector<HTMLElement>('[data-untrusted-context="true"]');

    expect(checkbox?.checked).toBe(false);
    expect(approve?.disabled).toBe(true);
    expect(approve?.textContent).toContain('Approve selected');
    expect(warning?.textContent).toContain('External provider content was read');

    if (!checkbox) throw new Error('expected elevated confirmation checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(approve?.disabled).toBe(false);
    approve?.click();
    await expect(pending).resolves.toEqual([true]);
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
