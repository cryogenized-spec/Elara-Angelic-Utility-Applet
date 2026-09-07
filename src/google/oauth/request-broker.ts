import type { GoogleCapabilityKey } from './contracts';
import { CAPABILITY_CONSENT_COPY } from './capability-policy';
import { googleOAuthAuthority } from './authority';

const HOST_ID = 'elara-google-capability-request';
let pendingResolve: ((granted: boolean) => void) | null = null;
let pendingHost: HTMLElement | null = null;

export function requestGoogleCapabilityGrant(capability: GoogleCapabilityKey, signal?: AbortSignal): Promise<boolean> {
  if (typeof document === 'undefined' || pendingResolve) return Promise.resolve(false);

  return new Promise((resolve) => {
    pendingResolve = resolve;
    const host = document.createElement('section');
    pendingHost = host;
    host.id = HOST_ID;
    host.className = 'roleplay-confirmation roleplay-confirmation--broker';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Google permission request');
    const copy = escapeHtml(CAPABILITY_CONSENT_COPY[capability] ?? 'Elara needs an additional Google permission to continue.');
    host.innerHTML = `
      <div class="roleplay-confirmation__heading"><span>✦</span><strong>Elara needs Google access</strong></div>
      <p class="google-capability-request__copy">${copy}</p>
      <div class="roleplay-confirmation__actions">
        <button type="button" data-decision="dismiss" class="roleplay-confirmation__decline">Not now</button>
        <button type="button" data-decision="authorize" class="roleplay-confirmation__accept">Authorize</button>
      </div>`;

    const finish = (granted: boolean) => {
      const currentResolve = pendingResolve;
      pendingResolve = null;
      pendingHost = null;
      signal?.removeEventListener('abort', onAbort);
      host.remove();
      currentResolve?.(granted);
    };
    const onAbort = () => finish(false);
    host.querySelector('[data-decision="dismiss"]')?.addEventListener('click', () => finish(false), { once: true });
    host.querySelector('[data-decision="authorize"]')?.addEventListener('click', () => {
      void googleOAuthAuthority.authorize(capability).then(() => finish(true)).catch(() => finish(false));
    }, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    document.body.appendChild(host);
    (host.querySelector('[data-decision="authorize"]') as HTMLButtonElement | null)?.focus();
  });
}

export function dismissGoogleCapabilityGrant(): void {
  if (!pendingResolve) return;
  const currentResolve = pendingResolve;
  pendingResolve = null;
  pendingHost?.remove();
  pendingHost = null;
  currentResolve(false);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}
