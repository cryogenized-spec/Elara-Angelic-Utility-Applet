import { useEffect, useMemo, useState } from 'react';
import { clickUpOAuthAuthority } from '../../clickup/oauth/authority';
import { connectClickUpWithPopup, switchClickUpAccountWithPopup } from '../../clickup/oauth/popup';
import type { ClickUpOAuthStatus } from '../../clickup/oauth/contracts';
import './google-oauth-settings.css';

const emptyStatus = (): ClickUpOAuthStatus => ({
  connected: false,
  workspaces: [],
});

type ClickUpBusyAction = 'connect' | 'personal-token' | 'switch' | 'disconnect' | null;

export function ClickUpOAuthSettings() {
  const [status, setStatus] = useState<ClickUpOAuthStatus>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<ClickUpBusyAction>(null);
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = busyAction !== null;

  async function reconcileStatusAfterFailure(): Promise<boolean> {
    try {
      setStatus(await clickUpOAuthAuthority.getStatus());
      setStatusUnknown(false);
      return true;
    } catch {
      setStatusUnknown(true);
      return false;
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await clickUpOAuthAuthority.getStatus());
      setStatusUnknown(false);
    } catch (cause) {
      setStatusUnknown(true);
      setError(cause instanceof Error ? cause.message : 'The ClickUp authorization state could not be read.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void clickUpOAuthAuthority.getStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      setStatusUnknown(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setStatusUnknown(true);
      setError(cause instanceof Error ? cause.message : 'The ClickUp authorization state could not be read.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function connect() {
    setBusyAction('connect');
    setError(null);
    try {
      setStatus(await connectClickUpWithPopup());
      setStatusUnknown(false);
    } catch (cause) {
      await reconcileStatusAfterFailure();
      setError(cause instanceof Error ? cause.message : 'ClickUp authorization could not be completed.');
    } finally {
      setBusyAction(null);
    }
  }

  async function connectPersonalToken() {
    setBusyAction('personal-token');
    setError(null);
    try {
      setStatus(await clickUpOAuthAuthority.connectPersonalToken());
      setStatusUnknown(false);
    } catch (cause) {
      await reconcileStatusAfterFailure();
      setError(cause instanceof Error ? cause.message : 'The configured ClickUp API token could not be connected.');
    } finally {
      setBusyAction(null);
    }
  }

  async function switchAccount() {
    setBusyAction('switch');
    setError(null);
    try {
      setStatus(await switchClickUpAccountWithPopup());
      setStatusUnknown(false);
    } catch (cause) {
      // A failed replacement may be ambiguous. Never fabricate "disconnected":
      // either reconcile the Worker or mark the visible state explicitly unknown.
      await reconcileStatusAfterFailure();
      setError(cause instanceof Error ? cause.message : 'The ClickUp account could not be switched.');
    } finally {
      setBusyAction(null);
    }
  }

  async function disconnect() {
    setBusyAction('disconnect');
    setError(null);
    try {
      await clickUpOAuthAuthority.disconnect();
      await reconcileStatusAfterFailure();
    } catch (cause) {
      await reconcileStatusAfterFailure();
      setError(cause instanceof Error ? cause.message : 'ClickUp could not be disconnected.');
    } finally {
      setBusyAction(null);
    }
  }

  const workspaceSummary = useMemo(() => {
    if (loading) return 'Checking ClickUp connection…';
    if (statusUnknown) return 'Connection state unknown';
    if (!status.connected) return 'Not connected';
    const workspaceCount = status.workspaces.length;
    return `MCP ready · ${workspaceCount} Workspace${workspaceCount === 1 ? '' : 's'}`;
  }, [loading, statusUnknown, status.connected, status.workspaces.length]);

  const confirmedConnected = status.connected && !statusUnknown;
  const identityLabel = status.account?.email || status.account?.username || 'Connected ClickUp account';
  const personalTokenAvailable = status.connectionMethods?.personalToken === true;
  // Older paired Workers predate capability advertisement and supported OAuth
  // only, so preserve that path until they are upgraded.
  const oauthAvailable = status.connectionMethods ? status.connectionMethods.oauth : true;

  return (
    <div className="google-oauth-settings clickup-oauth-settings">
      <section className={`google-oauth-account setting-card${confirmedConnected ? ' is-ready' : ''}`} aria-labelledby="clickup-account-title">
        <div className="google-oauth-account__copy">
          <span className="panel-kicker">CLICKUP IDENTITY</span>
          <strong id="clickup-account-title">{statusUnknown ? 'ClickUp status unavailable' : confirmedConnected ? 'ClickUp connected' : 'Connect ClickUp'}</strong>
          {statusUnknown && status.account && <span className="clickup-oauth-settings__identity">Last known: {identityLabel}</span>}
          {confirmedConnected && <span className="clickup-oauth-settings__identity">{identityLabel}</span>}
          {status.account?.username && status.account.email && <span className="google-oauth-account__email">{status.account.username}</span>}
          <p>
            {statusUnknown
              ? 'Elara could not verify the current ClickUp authority. Refresh status before connecting, switching, disconnecting, or using ClickUp.'
              : confirmedConnected
                ? 'This ClickUp identity is separate from the Google Workspace account connected to Elara. Elara can use only the ClickUp Workspaces authorized for this identity.'
                : personalTokenAvailable
                ? 'Your paired Worker has a personal ClickUp API token configured. Elara can validate it server-side and seal it in the encrypted ClickUp vault without exposing the token to this browser.'
                : oauthAvailable
                  ? 'Connect through ClickUp’s official authorization screen. Your ClickUp identity is independent from the Google Workspace account connected to Elara.'
                  : 'Configure a ClickUp personal API token or OAuth app credentials on your paired Worker to connect ClickUp.'}
          </p>
        </div>

        <div className="google-oauth-account__session" aria-live="polite">
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <strong>{workspaceSummary}</strong>
        </div>

        {statusUnknown ? (
          <div className="google-oauth-account__ready" role="status">Refresh status before continuing</div>
        ) : confirmedConnected ? (
          <div className="google-oauth-account__ready" role="status">First-party ClickUp MCP is active</div>
        ) : personalTokenAvailable ? (
          <button
            className="google-oauth-account__primary"
            type="button"
            onClick={() => void connectPersonalToken()}
            disabled={loading || busy}
          >
            {busyAction === 'personal-token' ? 'Connecting…' : 'Use configured API token'}
          </button>
        ) : oauthAvailable ? (
          <button
            className="google-oauth-account__primary"
            type="button"
            onClick={() => void connect()}
            disabled={loading || busy}
          >
            {busyAction === 'connect' ? 'Opening ClickUp…' : 'Continue to ClickUp'}
          </button>
        ) : (
          <div className="google-oauth-account__ready" role="status">Worker credentials required</div>
        )}

        <div className="google-oauth-account__utility">
          <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void refresh()} disabled={loading || busy}>
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
          {!statusUnknown && !confirmedConnected && personalTokenAvailable && oauthAvailable && (
            <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void connect()} disabled={loading || busy}>
              {busyAction === 'connect' ? 'Opening ClickUp…' : 'Use OAuth instead'}
            </button>
          )}
          {confirmedConnected && (
            <>
              {personalTokenAvailable && (
                <button className="google-oauth-settings__button" type="button" onClick={() => void connectPersonalToken()} disabled={loading || busy}>
                  {busyAction === 'personal-token' ? 'Connecting…' : 'Reload configured API token'}
                </button>
              )}
              {oauthAvailable && (
                <button className="google-oauth-settings__button" type="button" onClick={() => void switchAccount()} disabled={loading || busy}>
                  {busyAction === 'switch' ? 'Opening ClickUp…' : 'Switch ClickUp account'}
                </button>
              )}
              <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void disconnect()} disabled={loading || busy}>
                {busyAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect ClickUp'}
              </button>
            </>
          )}
        </div>
      </section>

      {error && <div className="google-oauth-settings__error" role="alert">{error}</div>}

      <div className="setting-card clickup-oauth-settings__account-note">
        <span className="panel-kicker">SEPARATE ACCOUNT</span>
        <strong>Your Google accounts do not have to match</strong>
        <span>
          Elara’s Google Workspace connection and ClickUp identity are independent. {personalTokenAvailable
            ? 'With a configured personal API token, ClickUp itself identifies the account behind that token; your Google Workspace login is not involved.'
            : 'If ClickUp offers “Continue with Google”, choose the Google account associated with the ClickUp account you want Elara to use.'} Elara never reuses its Google Workspace token for ClickUp.
        </span>
      </div>

      {confirmedConnected && (
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
        <div className={`clickup-oauth-settings__mcp-state${confirmedConnected ? ' is-ready' : ''}`} role="status">
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <strong>{statusUnknown ? 'Status unavailable · refresh before use' : confirmedConnected ? 'Active' : 'Connect ClickUp to activate'}</strong>
        </div>
      </div>
    </div>
  );
}
