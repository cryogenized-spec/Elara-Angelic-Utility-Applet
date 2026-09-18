import type { GoogleCapabilityKey } from './contracts';
import { CAPABILITY_CONSENT_COPY } from './capability-policy';
import { googleOAuthAuthority } from './authority';

const HOST_ID = 'elara-google-capability-request';
let pendingFinish: ((granted: boolean) => void) | null = null;

export function requestGoogleCapabilityGrant(capability: GoogleCapabilityKey, signal?: AbortSignal): Promise<boolean> {
  if (typeof document === 'undefined' || pendingFinish || signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    const host = document.createElement('section');
    host.id = HOST_ID;
    host.className = 'roleplay-confirmation roleplay-confirmation--broker';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Google permission request');

    const heading = document.createElement('div');
    heading.className = 'roleplay-confirmation__heading';
    const mark = document.createElement('span');
    mark.textContent = '✦';
    const title = document.createElement('strong');
    title.textContent = 'Elara needs Google access';
    heading.append(mark, title);

    const copy = document.createElement('p');
    copy.className = 'google-capability-request__copy';
    copy.textContent = CAPABILITY_CONSENT_COPY[capability] ?? 'Elara needs an additional Google permission to continue.';

    const actions = document.createElement('div');
    actions.className = 'roleplay-confirmation__actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.dataset.decision = 'dismiss';
    dismiss.className = 'roleplay-confirmation__decline';
    dismiss.textContent = 'Not now';
    const authorize = document.createElement('button');
    authorize.type = 'button';
    authorize.dataset.decision = 'authorize';
    authorize.className = 'roleplay-confirmation__accept';
    authorize.textContent = 'Authorize';
    actions.append(dismiss, authorize);
    host.append(heading, copy, actions);

    let settled = false;
    const finish = (granted: boolean) => {
      if (settled) return;
      settled = true;
      if (pendingFinish === finish) pendingFinish = null;
      signal?.removeEventListener('abort', onAbort);
      host.remove();
      resolve(granted);
    };
    const onAbort = () => finish(false);
    pendingFinish = finish;
    dismiss.addEventListener('click', () => finish(false), { once: true });
    authorize.addEventListener('click', () => {
      void googleOAuthAuthority.authorize(capability).then(() => finish(true)).catch(() => finish(false));
    }, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { finish(false); return; }
    document.body.appendChild(host);
    authorize.focus();
  });
}

export function dismissGoogleCapabilityGrant(): void {
  pendingFinish?.(false);
}
