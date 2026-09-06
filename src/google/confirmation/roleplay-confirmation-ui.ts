import type { WriteConfirmationRequest } from './policy';

let activeCleanup: (() => void) | null = null;

export function requestRoleplayConfirmation(request: WriteConfirmationRequest, signal?: AbortSignal): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);

  activeCleanup?.();

  return new Promise<boolean>((resolve) => {
    const host = document.createElement('div');
    host.setAttribute('data-elara-roleplay-confirmation', 'true');
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:16px;pointer-events:none;';

    const card = document.createElement('section');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Roleplay world change confirmation');
    card.style.cssText = [
      'pointer-events:auto', 'width:min(100%,560px)', 'box-sizing:border-box', 'padding:16px', 'border:1px solid rgba(255,255,255,.12)',
      'border-radius:18px', 'background:rgba(12,13,19,.97)', 'backdrop-filter:blur(18px)', '-webkit-backdrop-filter:blur(18px)',
      'box-shadow:0 18px 50px rgba(0,0,0,.45)', 'color:#f6f7fb', 'font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '✦  Elara proposes a world change';
    title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:10px;';

    const tool = document.createElement('code');
    tool.textContent = request.tool;
    tool.style.cssText = 'display:block;margin-bottom:9px;color:#b8c7ff;font-size:11px;word-break:break-word;';

    const summary = document.createElement('p');
    summary.textContent = request.resourceSummary;
    summary.style.cssText = 'margin:0 0 14px;color:#b9bcc7;font-size:13px;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';

    const decline = document.createElement('button');
    decline.type = 'button';
    decline.textContent = '✕  Decline';
    decline.style.cssText = 'min-height:46px;border:1px solid rgba(255,110,132,.3);border-radius:12px;background:rgba(255,70,95,.08);color:#ffb8c2;font-weight:700;cursor:pointer;';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.textContent = '✓  Accept';
    accept.style.cssText = 'min-height:46px;border:1px solid rgba(125,220,171,.34);border-radius:12px;background:rgba(93,203,146,.12);color:#c5f6dc;font-weight:700;cursor:pointer;';

    actions.append(decline, accept);
    card.append(title, tool, summary, actions);
    host.append(card);
    document.body.append(host);

    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(approved);
    };
    const onAbort = () => finish(false);
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      host.remove();
      if (activeCleanup === cleanup) activeCleanup = null;
    };

    activeCleanup = cleanup;
    decline.addEventListener('click', () => finish(false));
    accept.addEventListener('click', () => finish(true));
    signal?.addEventListener('abort', onAbort, { once: true });
    (accept.focus ? accept : decline).focus();
  });
}
