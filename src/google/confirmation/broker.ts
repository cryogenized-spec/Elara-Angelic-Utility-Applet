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

    const cards = requests.map((request, index) => {
      const riskLabel = request.risk === 'send' ? 'Send' : request.risk === 'destructive' ? 'Destructive change' : 'Change';
      return `<label class="google-confirmation-item">
        <input type="checkbox" data-confirm-index="${index}" checked aria-label="Approve ${escapeHtml(request.tool)}" />
        <span class="google-confirmation-item__body">
          <strong>${escapeHtml(riskLabel)} · ${escapeHtml(request.tool)}</strong>
          <span>${escapeHtml(request.resourceSummary)}</span>
        </span>
      </label>`;
    }).join('');

    host.innerHTML = `
      <div class="roleplay-confirmation__heading"><span>✦</span><strong>${requests.length === 1 ? 'Elara proposes a change' : `Elara proposes ${requests.length} changes`}</strong></div>
      <div class="google-confirmation-list">${cards}</div>
      <div class="roleplay-confirmation__actions">
        <button type="button" data-decision="decline" class="roleplay-confirmation__decline">✕ Decline</button>
        ${requests.length > 1 ? '<button type="button" data-decision="selected" class="roleplay-confirmation__accept">✓ Approve selected</button><button type="button" data-decision="all" class="roleplay-confirmation__accept">✓ Approve all</button>' : '<button type="button" data-decision="selected" class="roleplay-confirmation__accept">✓ Approve</button>'}
      </div>`;

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
    (host.querySelector('[data-decision="selected"]') as HTMLButtonElement | null)?.focus();
  });
}

export function dismissGoogleToolConfirmation(): void {
  if (!pendingFinish) return;
  const host = document.getElementById(HOST_ID);
  const count = host?.querySelectorAll('[data-confirm-index]').length ?? 0;
  pendingFinish(Array.from({ length: count }, () => false));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}
