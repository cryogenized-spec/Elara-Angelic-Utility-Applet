import type { WriteConfirmationRequest } from './policy';

const HOST_ID = 'elara-roleplay-confirmation';
let pendingResolve: ((approved: boolean) => void) | null = null;

export function requestRoleplayConfirmation(request: WriteConfirmationRequest, signal?: AbortSignal): Promise<boolean> {
  if (typeof document === 'undefined' || pendingResolve) return Promise.resolve(false);

  return new Promise((resolve) => {
    pendingResolve = resolve;
    const host = document.createElement('section');
    host.id = HOST_ID;
    host.className = 'roleplay-confirmation roleplay-confirmation--broker';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Roleplay world change confirmation');
    host.innerHTML = `
      <div class="roleplay-confirmation__heading"><span>✦</span><strong>Elara proposes a world change</strong></div>
      <code>${escapeHtml(request.tool)}</code>
      <p>${escapeHtml(request.resourceSummary)}</p>
      <div class="roleplay-confirmation__actions">
        <button type="button" data-decision="decline" class="roleplay-confirmation__decline">✕ Decline</button>
        <button type="button" data-decision="accept" class="roleplay-confirmation__accept">✓ Accept</button>
      </div>`;

    const finish = (approved: boolean) => {
      const currentResolve = pendingResolve;
      pendingResolve = null;
      signal?.removeEventListener('abort', onAbort);
      host.remove();
      currentResolve?.(approved);
    };
    const onAbort = () => finish(false);

    host.querySelector('[data-decision="decline"]')?.addEventListener('click', () => finish(false), { once: true });
    host.querySelector('[data-decision="accept"]')?.addEventListener('click', () => finish(true), { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    document.body.appendChild(host);
    (host.querySelector('[data-decision="accept"]') as HTMLButtonElement | null)?.focus();
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character] ?? character));
}
