import type { WriteConfirmationRequest } from './policy';

const HOST_ID = 'elara-roleplay-confirmation';
let pending = false;

export function requestRoleplayConfirmation(request: WriteConfirmationRequest): Promise<boolean> {
  if (typeof document === 'undefined' || pending) return Promise.resolve(false);
  pending = true;
  return new Promise((resolve) => {
    const host = document.createElement('section');
    host.id = HOST_ID;
    host.className = 'roleplay-confirmation roleplay-confirmation--broker';
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
      host.remove();
      pending = false;
      resolve(approved);
    };
    host.querySelector('[data-decision="decline"]')?.addEventListener('click', () => finish(false), { once: true });
    host.querySelector('[data-decision="accept"]')?.addEventListener('click', () => finish(true), { once: true });
    document.body.appendChild(host);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character] ?? character));
}
