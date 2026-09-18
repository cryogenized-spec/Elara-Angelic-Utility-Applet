import type { WriteConfirmationRequest } from './policy';

const HOST_ID = 'elara-google-confirmation';
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
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', requests.length === 1 ? 'Google action confirmation' : 'Google action confirmations');

    const heading = document.createElement('div');
    heading.className = 'roleplay-confirmation__heading';
    const mark = document.createElement('span');
    mark.textContent = '✦';
    const title = document.createElement('strong');
    title.textContent = requests.length === 1 ? 'Elara proposes a change' : `Elara proposes ${requests.length} changes`;
    heading.append(mark, title);

    const list = document.createElement('div');
    list.className = 'google-confirmation-list';
    requests.forEach((request, index) => {
      const riskLabel = request.risk === 'send' ? 'Send' : request.risk === 'destructive' ? 'Destructive change' : 'Change';
      const card = document.createElement('label');
      card.className = 'google-confirmation-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.confirmIndex = String(index);
      checkbox.checked = true;
      checkbox.setAttribute('aria-label', `Approve ${request.tool}`);

      const body = document.createElement('span');
      body.className = 'google-confirmation-item__body';
      const strong = document.createElement('strong');
      strong.textContent = `${riskLabel} · ${request.tool}`;
      const summary = document.createElement('span');
      summary.textContent = request.resourceSummary;
      body.append(strong, summary);

      if (request.reviewText) {
        const review = document.createElement('span');
        review.className = 'google-confirmation-item__review';
        const reviewLabel = document.createElement('strong');
        reviewLabel.textContent = 'Full content to review before approval';
        const reviewText = document.createElement('span');
        reviewText.className = 'google-confirmation-item__review-text';
        reviewText.textContent = request.reviewText;
        reviewText.style.display = 'block';
        reviewText.style.whiteSpace = 'pre-wrap';
        reviewText.style.overflowWrap = 'anywhere';
        reviewText.style.maxHeight = '12rem';
        reviewText.style.overflow = 'auto';
        review.append(reviewLabel, reviewText);
        body.append(review);
      }

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
    selected.textContent = requests.length > 1 ? '✓ Approve selected' : '✓ Approve';
    actions.appendChild(selected);

    if (requests.length > 1) {
      const all = document.createElement('button');
      all.type = 'button';
      all.dataset.decision = 'all';
      all.className = 'roleplay-confirmation__accept';
      all.textContent = '✓ Approve all';
      actions.appendChild(all);
    }

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
      else if (decision === 'all') finish(requests.map(() => true));
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
