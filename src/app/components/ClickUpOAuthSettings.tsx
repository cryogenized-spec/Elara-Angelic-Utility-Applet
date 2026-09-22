import { useEffect, useMemo, useState } from 'react';
import { clickUpOAuthAuthority } from '../../clickup/oauth/authority';
import { connectClickUpWithPopup, switchClickUpAccountWithPopup } from '../../clickup/oauth/popup';
import type { ClickUpOAuthStatus } from '../../clickup/oauth/contracts';
import './google-oauth-settings.css';

const emptyStatus = (): ClickUpOAuthStatus => ({
  connected: false,
  workspaces: [],
});

type ClickUpBusyAction = 'connect' | 'switch' | 'disconnect' | null;

export function ClickUpOAuthSettings() {
  const [status, setStatus] = useState<ClickUpOAuthStatus>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<ClickUpBusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = busyAction !== null;

  async function readCurrentStatus(): Promise<ClickUpOAuthStatus> {
    try {
      return await clickUpOAuthAuthority.getStatus();
    } catch {
      return emptyStatus();
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    setNotice(null);
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
    setBusyAction('connect');
    setError(null);
    setNotice(null);
    try {
      setStatus(await connectClickUpWithPopup());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ClickUp authorization could not be completed.');
    } finally {
      setBusyAction(null);
    }
  }

  async function switchAccount() {
    setBusyAction('switch');
    setError(null);
    setNotice(null);
    const previousAccountId = status.account?.id;
    try {
      const replacement = await switchClickUpAccountWithPopup();
      setStatus(replacement);
      if (previousAccountId && replacement.account?.id === previousAccountId) {
        setNotice('ClickUp reauthorized the same account. If you meant to use a different Google/ClickUp identity, sign out of ClickUp in your browser first and try again.');
      } else {
        setNotice('ClickUp connection replaced successfully.');
      }
    } catch (cause) {
      // Replacement OAuth is non-destructive. Re-read the authoritative
      // Worker state so a cancelled/failed popup leaves the existing grant and
      // identity visible rather than pretending the connection was lost.
      setStatus(await readCurrentStatus());
      setError(cause instanceof Error ? cause.message : 'The ClickUp account could not be switched.');
    } finally {
      setBusyAction(null);
    }
  }

  async function disconnect() {
    setBusyAction('disconnect');
    setError(null);
    setNotice(null);
    try {
      await clickUpOAuthAuthority.disconnect();
      setStatus(emptyStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ClickUp could not be disconnected.');
    } finally {
      setBusyAction(null);
    }
  }

  const workspaceSummary = useMemo(() => {
    if (loading) return 'Checking ClickUp connection…';
    if (!status.connected) return 'Not connected';
    const workspaceCount = status.workspaces.length;
    return `MCP ready · ${workspaceCount} Workspace${workspaceCount === 1 ? '' : 's'}`;
  }, [loading, status.connected, status.workspaces.length]);

  const identityLabel = status.account?.email || status.account?.username || 'Connected ClickUp account';

  return (
    <div className="google-oauth-settings clickup-oauth-settings">
      <section className={`google-oauth-account setting-card${status.connected ? ' is-ready' : ''}`} aria-labelledby="clickup-account-title">
        <div className="google-oauth-account__copy">
          <span className="panel-kicker">CLICKUP IDENTITY</span>
          <strong id="clickup-account-title">{status.connected ? 'ClickUp connected' : 'Connect ClickUp'}</strong>
          {status.connected && <span className="clickup-oauth-settings__identity">{identityLabel}</span>}
          {status.account?.username && status.account.email && <span className="google-oauth-account__email">{status.account.username}</span>}
          <p>
            {status.connected
              ? 'This ClickUp identity is separate from the Google Workspace account connected to Elara. Elara can use only the ClickUp Workspaces authorized for this identity.'
              : 'Connect through ClickUp’s official authorization screen. Your ClickUp identity is independent from the Google Workspace account connected to Elara.'}
          </p>
        </div>

        <div className="google-oauth-account__session" aria-live="polite">
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <strong>{workspaceSummary}</strong>
        </div>

        {status.connected ? (
          <div className="google-oauth-account__ready" role="status">First-party ClickUp MCP is active</div>
        ) : (
          <button
            className="google-oauth-account__primary"
            type="button"
            onClick={() => void connect()}
            disabled={loading || busy}
          >
            {busyAction === 'connect' ? 'Opening ClickUp…' : 'Continue to ClickUp'}
          </button>
        )}

        <div className="google-oauth-account__utility">
          <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void refresh()} disabled={loading || busy}>
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
          {status.connected && (
            <>
              <button className="google-oauth-settings__button" type="button" onClick={() => void switchAccount()} disabled={loading || busy}>
                {busyAction === 'switch' ? 'Opening ClickUp…' : 'Switch ClickUp account'}
              </button>
              <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void disconnect()} disabled={loading || busy}>
                {busyAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect ClickUp'}
              </button>
            </>
          )}
        </div>
      </section>

      {error && <div className="google-oauth-settings__error" role="alert">{error}</div>}
      {notice && <div className="google-oauth-settings__notice" role="status">{notice}</div>}

      <div className="setting-card clickup-oauth-settings__account-note">
        <span className="panel-kicker">SEPARATE ACCOUNT</span>
        <strong>Your Google accounts do not have to match</strong>
        <span>
          Elara’s Google Workspace connection and ClickUp authorization are independent. ClickUp owns its own sign-in session and may reuse an account already signed into ClickUp. To deliberately use another Google/ClickUp identity, sign out of ClickUp in your browser first, then choose Switch ClickUp account. Elara never reuses its Google Workspace token for ClickUp.
        </span>
      </div>

      {status.connected && (
        <section aria-labelledby="clickup-workspaces-title">
          <div className="clickup-oauth-settings__section-heading">
            <div>
              <span className="panel-kicker">AUTHORIZED WORKSPACES</span>
              <strong id="clickup-workspaces-title">{status.workspaces.length === 1 ? '1 Workspace available' : `${status.workspaces.length} Workspaces available`}</strong>
            </div>
            <span className="google-oauth-service__badge is-ready">Authorized</span>
          </div>
          <div className="google-oauth-settings__grid" aria-label="Authorized ClickUp Workspaces">
            {status.workspaces.map((workspace) => (
              <article className="google-oauth-service setting-card" key={workspace.id}>
                <div className="google-oauth-service__copy">
                  <strong>{workspace.name}</strong>
                  <span>Available to Elara through the current ClickUp grant.</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="setting-card clickup-oauth-settings__mcp-card">
        <div>
          <span className="panel-kicker">FIRST-PARTY MCP</span>
          <strong>ClickUp MCP</strong>
          <span>
            Elara uses its own reviewed ClickUp MCP path through your paired Worker. Chat remains the working interface; a separate ClickUp task-management screen is not required.
          </span>
        </div>
        <div className={`clickup-oauth-settings__mcp-state${status.connected ? ' is-ready' : ''}`} role="status">
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <strong>{status.connected ? 'Active' : 'Connect ClickUp to activate'}</strong>
        </div>
      </div>
    </div>
  );
}
