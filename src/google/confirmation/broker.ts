import type { WriteConfirmationRequest } from './policy';
import { confirmationToolPresentation } from './presentation';

const HOST_ID = 'elara-google-confirmation';
const EXPANDED_REVIEW_CHARS = 1_200;
const EXPANDED_BATCH_REVIEW_CHARS = 2_400;

function reviewSize(request: WriteConfirmationRequest): number {
  return (request.reviewText?.length ?? 0) + (request.attachmentReview?.previewText?.length ?? 0);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(bytes < 10 * 1_024 ? 1 : 0)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(bytes < 10 * 1_024 * 1_024 ? 1 : 0)} MB`;
}

function appendTextReview(body: HTMLElement, label: string, text: string, truncated = false): void {
  const review = document.createElement('span');
  review.className = 'google-confirmation-item__review';
  const reviewLabel = document.createElement('strong');
  reviewLabel.textContent = label;
  const reviewText = document.createElement('span');
  reviewText.className = 'google-confirmation-item__review-text';
  reviewText.textContent = text;
  review.append(reviewLabel, reviewText);
  if (truncated) {
    const note = document.createElement('span');
    note.className = 'google-confirmation-item__preview-note';
    note.textContent = 'Preview shortened. Approval still applies to the complete file shown above.';
    review.append(note);
  }
  body.append(review);
}
let pendingFinish: ((approved: boolean[]) => void) | null = null;

export function requestGoogleToolConfirmation(request: WriteConfirmationRequest, signal?: AbortSignal): Promise<boolean> {
  return requestGoogleToolConfirmations([request], signal).then((decisions) => decisions[0] ?? false);
}

export function requestGoogleToolConfirmations(requests: readonly WriteConfirmationRequest[], signal?: AbortSignal): Promise<boolean[]> {
  if (typeof document === 'undefined' || pendingFinish || requests.length === 0 || signal?.aborted) return Promise.resolve(requests.map(() => false));

  return new Promise((resolve) => {
    const host = document.createElement('section');
    host.id = HOST_ID;
    host.className = 'roleplay-confirmation roleplay-confirmation--broker roleplay-confirmation--batch';
    host.dataset.confirmationCount = String(requests.length);
    const totalReviewChars = requests.reduce((sum, request) => sum + reviewSize(request), 0);
    const expanded = requests.some((request) => reviewSize(request) >= EXPANDED_REVIEW_CHARS)
      || totalReviewChars >= EXPANDED_BATCH_REVIEW_CHARS;
    if (expanded) host.classList.add('roleplay-confirmation--expanded');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', requests.length === 1 ? 'Elara action confirmation' : 'Elara action confirmations');

    const heading = document.createElement('div');
    heading.className = 'roleplay-confirmation__heading';
    const mark = document.createElement('span');
    mark.textContent = '✦';
    const title = document.createElement('strong');
    title.textContent = requests.length === 1 ? 'Elara wants to make a change' : `Elara wants to make ${requests.length} changes`;
    heading.append(mark, title);

    const list = document.createElement('div');
    list.className = 'google-confirmation-list';
    requests.forEach((request, index) => {
      const presentation = confirmationToolPresentation(request.tool);
      const card = document.createElement('label');
      card.className = 'google-confirmation-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.confirmIndex = String(index);
      checkbox.checked = requests.length === 1 && request.untrustedContext !== true;
      checkbox.setAttribute('aria-label', `Approve ${presentation.provider}: ${presentation.action}`);
      if (requests.length === 1 && request.untrustedContext !== true) checkbox.className = 'google-confirmation-item__check--passive';

      const body = document.createElement('span');
      body.className = 'google-confirmation-item__body';

      const actionHeader = document.createElement('span');
      actionHeader.className = 'google-confirmation-item__header';
      const provider = document.createElement('span');
      provider.className = 'google-confirmation-item__provider';
      provider.textContent = presentation.provider;
      const action = document.createElement('strong');
      action.className = 'google-confirmation-item__action';
      action.textContent = presentation.action;
      actionHeader.append(provider, action);

      const summary = document.createElement('span');
      summary.className = 'google-confirmation-item__summary';
      summary.textContent = request.resourceSummary;
      body.append(actionHeader, summary);

      if (request.untrustedContext === true) {
        const warning = document.createElement('span');
        warning.className = 'google-confirmation-item__warning';
        warning.dataset.untrustedContext = 'true';
        warning.textContent = 'This action was suggested after Elara read external content. Check that it matches what you asked for before approving.';
        body.append(warning);
      }

      if (request.attachmentReview) {
        const attachment = document.createElement('span');
        attachment.className = 'google-confirmation-item__attachment';
        const attachmentName = document.createElement('strong');
        attachmentName.className = 'google-confirmation-item__attachment-name';
        attachmentName.textContent = request.attachmentReview.name;
        const attachmentMeta = document.createElement('span');
        attachmentMeta.className = 'google-confirmation-item__attachment-meta';
        attachmentMeta.textContent = `${request.attachmentReview.mimeType} · ${formatFileSize(request.attachmentReview.sizeBytes)}`;
        attachment.append(attachmentName, attachmentMeta);
        if (request.attachmentReview.uploadName !== request.attachmentReview.name) {
          const uploadAs = document.createElement('span');
          uploadAs.className = 'google-confirmation-item__attachment-upload-name';
          uploadAs.textContent = `Upload as “${request.attachmentReview.uploadName}”`;
          attachment.append(uploadAs);
        }
        body.append(attachment);
        if (request.attachmentReview.previewText) {
          appendTextReview(body, 'File preview', request.attachmentReview.previewText, request.attachmentReview.previewTruncated === true);
        } else {
          const previewUnavailable = document.createElement('span');
          previewUnavailable.className = 'google-confirmation-item__preview-note';
          previewUnavailable.textContent = 'No inline preview is available for this file type.';
          body.append(previewUnavailable);
        }
      }

      if (request.reviewText) appendTextReview(body, 'Content to review', request.reviewText);

      card.append(checkbox, body);
      list.appendChild(card);
    });

    const actions = document.createElement('div');
    actions.className = 'roleplay-confirmation__actions';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.dataset.decision = 'decline';
    decline.className = 'roleplay-confirmation__decline';
    decline.textContent = '✕ Decline';
    actions.appendChild(decline);

    const selected = document.createElement('button');
    selected.type = 'button';
    selected.dataset.decision = 'selected';
    selected.className = 'roleplay-confirmation__accept';
    const elevated = requests.some((request) => request.untrustedContext === true);
    selected.textContent = requests.length > 1 || elevated ? '✓ Approve selected' : '✓ Approve';
    actions.appendChild(selected);

    const checkboxes = Array.from(list.querySelectorAll<HTMLInputElement>('[data-confirm-index]'));
    const refreshApproveState = () => {
      selected.disabled = !checkboxes.some((checkbox) => checkbox.checked);
    };
    checkboxes.forEach((checkbox) => checkbox.addEventListener('change', refreshApproveState));
    refreshApproveState();

    host.append(heading, list, actions);

    let settled = false;
    const finish = (decisions: boolean[]) => {
      if (settled) return;
      settled = true;
      if (pendingFinish === finish) pendingFinish = null;
      signal?.removeEventListener('abort', onAbort);
      host.remove();
      resolve(decisions);
    };
    const onAbort = () => finish(requests.map(() => false));
    pendingFinish = finish;
    const decisionButtons = host.querySelectorAll<HTMLButtonElement>('[data-decision]');
    decisionButtons.forEach((button) => button.addEventListener('click', () => {
      const decision = button.dataset.decision;
      if (decision === 'decline') finish(requests.map(() => false));
      else {
        const decisions = requests.map((_, index) => host.querySelector<HTMLInputElement>(`[data-confirm-index="${index}"]`)?.checked ?? false);
        finish(decisions);
      }
    }, { once: true }));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { finish(requests.map(() => false)); return; }
    document.body.appendChild(host);
    selected.focus();
  });
}

export function dismissGoogleToolConfirmation(): void {
  if (!pendingFinish) return;
  const host = document.getElementById(HOST_ID);
  const count = host?.querySelectorAll('[data-confirm-index]').length ?? 0;
  pendingFinish(Array.from({ length: count }, () => false));
}
