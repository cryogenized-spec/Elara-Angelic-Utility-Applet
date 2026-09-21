import { useEffect, useMemo, useState } from 'react';
import { clickUpOAuthAuthority } from '../../clickup/oauth/authority';
import { connectClickUpWithPopup } from '../../clickup/oauth/popup';
import type { ClickUpOAuthStatus } from '../../clickup/oauth/contracts';
import './google-oauth-settings.css';

const emptyStatus = (): ClickUpOAuthStatus => ({
  connected: false,
  workspaces: [],
});

export function ClickUpOAuthSettings() {
  const [status, setStatus] = useState<ClickUpOAuthStatus>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await clickUpOAuthAuthority.getStatus());
    } catch (cause) {
      setStatus(emptyStatus());
      setError(cause instanceof Error ? cause.message : 'The ClickUp authorization state could not be read.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void clickUpOAuthAuthority.getStatus().then((next) => {
      if (active) setStatus(next);
    }).catch((cause: unknown) => {
      if (!active) return;
      setStatus(emptyStatus());
      setError(cause instanceof Error ? cause.message : 'The ClickUp authorization state could not be read.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await connectClickUpWithPopup());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ClickUp authorization could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await clickUpOAuthAuthority.disconnect();
      setStatus(emptyStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ClickUp could not be disconnected.');
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    if (loading) return 'Checking ClickUp connection…';
    if (!status.connected) return 'Not connected';
    const workspaceCount = status.workspaces.length;
    return `Connected · ${workspaceCount} Workspace${workspaceCount === 1 ? '' : 's'} authorized`;
  }, [loading, status]);

  return (
    <div className="google-oauth-settings">
      <section className={`google-oauth-account setting-card${status.connected ? ' is-ready' : ''}`} aria-labelledby="clickup-account-title">
        <div className="google-oauth-account__copy">
          <span className="panel-kicker">CLICKUP ACCOUNT</span>
          <strong id="clickup-account-title">{status.connected ? 'ClickUp connected' : 'Connect ClickUp'}</strong>
          {status.account?.username && <span className="google-oauth-account__name">{status.account.username}</span>}
          {status.account?.email && <span className="google-oauth-account__email">{status.account.email}</span>}
          <p>
            {status.connected
              ? 'Elara can use the Workspaces you authorized through ClickUp’s official OAuth screen. Provider authorization does not approve task changes: model-initiated mutations still require Elara’s normal human confirmation.'
              : 'Authorize one or more ClickUp Workspaces through ClickUp’s official OAuth screen. The access token and app secret stay inside your paired Worker.'}
          </p>
        </div>

        <div className="google-oauth-account__session" aria-live="polite">
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <strong>{summary}</strong>
        </div>

        <button
          className="google-oauth-account__primary"
          type="button"
          onClick={() => void connect()}
          disabled={loading || busy}
        >
          {busy ? 'Opening ClickUp…' : status.connected ? 'Review ClickUp Workspaces' : 'Connect ClickUp'}
        </button>

        <div className="google-oauth-account__utility">
          <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void refresh()} disabled={loading || busy}>
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
          {status.connected && (
            <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void disconnect()} disabled={loading || busy}>
              Disconnect ClickUp
            </button>
          )}
        </div>
      </section>

      {error && <div className="google-oauth-settings__error" role="alert">{error}</div>}

      {status.connected && (
        <div className="google-oauth-settings__grid" aria-label="Authorized ClickUp Workspaces">
          {status.workspaces.map((workspace) => (
            <article className="google-oauth-service setting-card" key={workspace.id}>
              <div className="google-oauth-service__copy">
                <strong>{workspace.name}</strong>
                <span>Workspace ID {workspace.id}</span>
              </div>
              <div className="google-oauth-service__status">
                <span className="google-oauth-service__badge is-ready">Authorized</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="setting-card">
        <strong>First-party ClickUp MCP</strong>
        <span>Gemini → Elara tool authority → browser MCP client → your Worker → ClickUp REST API. ClickUp’s vendor-hosted MCP is not used for normal Elara ClickUp work.</span>
      </div>
    </div>
  );
}
