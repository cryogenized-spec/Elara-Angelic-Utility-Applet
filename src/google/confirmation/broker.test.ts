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
    expect(warning?.textContent).toContain('suggested after Elara read external content');

    if (!checkbox) throw new Error('expected elevated confirmation checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(approve?.disabled).toBe(false);
    approve?.click();
    await expect(pending).resolves.toEqual([true]);
  });


  it('renders provider and action labels without exposing raw tool identifiers', async () => {
    const pending = requestGoogleToolConfirmations([request('clickup.createTaskComment')]);
    const dialog = document.getElementById('elara-google-confirmation');
    expect(dialog?.getAttribute('aria-label')).toBe('Elara action confirmation');
    expect(dialog?.textContent).toContain('ClickUp');
    expect(dialog?.textContent).toContain('Post comment');
    expect(dialog?.textContent).not.toContain('clickup.createTaskComment');
    expect(dialog?.textContent).not.toContain('{');
    expect(dialog?.textContent).not.toContain('workspaceId');

    dismissGoogleToolConfirmation();
    await expect(pending).resolves.toEqual([false]);
  });

  it('keeps short confirmations compact', async () => {
    const pending = requestGoogleToolConfirmations([{
      ...request('clickup.createTaskComment'),
      reviewText: 'Short comment.',
    }]);
    const dialog = document.getElementById('elara-google-confirmation');
    expect(dialog?.classList.contains('roleplay-confirmation--expanded')).toBe(false);

    dismissGoogleToolConfirmation();
    await expect(pending).resolves.toEqual([false]);
  });

  it('renders attachment metadata and bounded text previews without exposing security bindings', async () => {
    const pending = requestGoogleToolConfirmations([{
      ...request('clickup.attachArtifact'),
      resourceSummary: 'Attach the approved file below to the selected ClickUp task.',
      attachmentReview: {
        name: 'repair-notes.txt',
        uploadName: 'repair-notes-final.txt',
        mimeType: 'text/plain',
        sizeBytes: 2_048,
        previewText: 'Repair complete. Pressure holding.',
        previewTruncated: true,
      },
    }]);
    const dialog = document.getElementById('elara-google-confirmation');
    expect(dialog?.textContent).toContain('repair-notes.txt');
    expect(dialog?.textContent).toContain('2.0 KB');
    expect(dialog?.textContent).toContain('Upload as “repair-notes-final.txt”');
    expect(dialog?.textContent).toContain('Repair complete. Pressure holding.');
    expect(dialog?.textContent).toContain('Preview shortened');
    expect(dialog?.textContent).not.toContain('SHA-256');
    expect(dialog?.textContent).not.toContain('artifactId');

    dismissGoogleToolConfirmation();
    await expect(pending).resolves.toEqual([false]);
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
    const dialog = document.getElementById('elara-google-confirmation');
    expect(dialog?.classList.contains('roleplay-confirmation--expanded')).toBe(true);
    expect(dialog?.dataset.confirmationCount).toBe('1');
    expect(review?.style.maxHeight).toBe('');
    expect(review?.style.overflow).toBe('');

    dismissGoogleToolConfirmation();
    await expect(pending).resolves.toEqual([false]);
  });
});
