import { useEffect, useMemo, useState } from 'react';
import { googleOAuthAuthority } from '../../google/oauth/authority';
import type { GoogleCapabilityKey, GoogleOAuthStatus } from '../../google/oauth/contracts';
import './google-oauth-settings.css';

type ServiceDefinition = {
  id: string;
  name: string;
  description: string;
  readCapability: GoogleCapabilityKey;
  writeCapability?: GoogleCapabilityKey;
  extraCapabilities?: readonly { capability: GoogleCapabilityKey; label: string; readyLabel: string }[];
};

const SERVICES: readonly ServiceDefinition[] = [
  {
    id: 'calendar',
    name: 'Google Calendar',
    description: 'Events, scheduling, calendar discovery, timezone context, and availability.',
    readCapability: 'calendar.events.read',
    writeCapability: 'calendar.events.write',
    extraCapabilities: [
      { capability: 'calendar.list.read', label: 'Enable calendar list', readyLabel: 'Calendar list ready' },
      { capability: 'calendar.settings.read', label: 'Enable settings', readyLabel: 'Settings ready' },
      { capability: 'calendar.freebusy.read', label: 'Enable availability', readyLabel: 'Availability ready' },
    ],
  },
  { id: 'tasks', name: 'Google Tasks', description: 'Task lists, tasks, ordering, and completion.', readCapability: 'tasks.read', writeCapability: 'tasks.write' },
  { id: 'gmail', name: 'Gmail', description: 'Mailbox reading, organization, labels, and sending.', readCapability: 'gmail.read', writeCapability: 'gmail.modify', extraCapabilities: [{ capability: 'gmail.labels', label: 'Enable labels', readyLabel: 'Labels ready' }, { capability: 'gmail.send', label: 'Enable sending', readyLabel: 'Sending ready' }] },
  { id: 'drive', name: 'Google Drive', description: 'App-created or admitted files, plus optional library search across your Drive.', readCapability: 'drive.files.app.read', writeCapability: 'drive.files.app.write', extraCapabilities: [{ capability: 'drive.library.read', label: 'Enable library search', readyLabel: 'Library search ready' }] },
  { id: 'docs', name: 'Google Docs', description: 'Documents created or admitted for Elara to work with.', readCapability: 'docs.read', writeCapability: 'docs.write' },
  { id: 'sheets', name: 'Google Sheets', description: 'Selected spreadsheets, ranges, rows, and updates.', readCapability: 'sheets.read', writeCapability: 'sheets.write' },
];

const stateLabels: Record<GoogleOAuthStatus['state'], string> = {
  disconnected: 'Not connected',
  connected: 'Workspace ready',
  'needs-consent': 'Needs authorization',
  'token-recovery': 'Authorization worker unavailable',
  'reauthorization-required': 'Reauthorization required',
  'partially-authorized': 'Partially authorized',
  revoked: 'Access revoked',
};

function hasCapability(granted: readonly GoogleCapabilityKey[], capability?: GoogleCapabilityKey): boolean {
  return !!capability && granted.includes(capability);
}

const emptyStatus = (): GoogleOAuthStatus => ({
  state: 'disconnected',
  grantedCapabilities: [],
  enabledCapabilities: [],
  grantedProviderScopes: [],
  sessionReady: false,
});

export function GoogleOAuthSettings() {
  const [status, setStatus] = useState<GoogleOAuthStatus>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [busyCapability, setBusyCapability] = useState<GoogleCapabilityKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await googleOAuthAuthority.getStatus());
    } catch {
      setError('The Google authorization state could not be read.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void googleOAuthAuthority.getStatus().then((nextStatus) => {
      if (!active) return;
      setStatus(nextStatus);
    }).catch(() => {
      if (active) setError('The Google authorization state could not be read.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function connect(capability: GoogleCapabilityKey) {
    setBusyCapability(capability);
    setError(null);
    try {
      await googleOAuthAuthority.authorize(capability);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google authorization could not be completed.');
    } finally {
      setBusyCapability(null);
    }
  }

  async function disconnect() {
    setBusyCapability(null);
    setError(null);
    try {
      await googleOAuthAuthority.disconnect();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google could not be disconnected.');
    }
  }

  const accountKnown = Boolean(status.account?.email)
    || hasCapability(status.grantedCapabilities, 'google.account')
    || hasCapability(status.enabledCapabilities, 'google.account');
  const sessionReady = status.sessionReady === true;
  const accountNeedsAuthorization = status.state === 'disconnected'
    || status.state === 'needs-consent'
    || status.state === 'reauthorization-required'
    || status.state === 'revoked'
    || !sessionReady;

  const accountActionLabel = useMemo(() => {
    if (busyCapability === 'google.account') return 'Opening Google…';
    if (status.state === 'reauthorization-required' || status.state === 'revoked') return 'Reauthorize Google';
    if (status.state === 'token-recovery') return 'Retry Google session';
    if (accountKnown) return 'Refresh Google session';
    return 'Connect Google account';
  }, [accountKnown, busyCapability, status.state]);

  const summary = useMemo(() => {
    if (loading) return 'Checking Workspace permissions…';
    const hasWorkspaceGrant = status.grantedCapabilities.some((capability) => capability !== 'google.account' && capability !== 'roleplay.world.local');
    const label = status.state === 'partially-authorized' && !hasWorkspaceGrant
      ? 'No Workspace permissions enabled yet'
      : stateLabels[status.state];
    if (status.account?.email) return `${label} · ${status.account.email}`;
    return label;
  }, [loading, status]);

  return (
    <div className="google-oauth-settings">
      <section className={`google-oauth-account setting-card${sessionReady ? ' is-ready' : ''}`} aria-labelledby="google-account-title">
        <div className="google-oauth-account__copy">
          <span className="panel-kicker">GOOGLE ACCOUNT</span>
          <strong id="google-account-title">{accountKnown ? 'Google account connected' : 'Connect Google before using Workspace'}</strong>
          {status.account?.displayName && <span className="google-oauth-account__name">{status.account.displayName}</span>}
          {status.account?.email && <span className="google-oauth-account__email">{status.account.email}</span>}
          <p>
            {sessionReady
              ? 'A live Google authorization session is ready. Workspace permissions remain separate and are granted only when you choose them below.'
              : 'Open Google’s secure account and authorization window to establish a fresh session. Elara never receives your Google password, and Workspace data permissions are requested separately.'}
          </p>
        </div>

        <div className="google-oauth-account__session" aria-live="polite">
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <strong>{sessionReady ? 'Session ready' : accountKnown ? 'Fresh session required' : 'Not signed in'}</strong>
        </div>

        {accountNeedsAuthorization ? (
          <button
            className="google-oauth-account__primary"
            type="button"
            onClick={() => void connect('google.account')}
            disabled={loading || !!busyCapability}
          >
            {accountActionLabel}
          </button>
        ) : (
          <div className="google-oauth-account__ready" role="status">Google authorization is live</div>
        )}

        <div className="google-oauth-account__utility">
          <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void refresh()} disabled={loading || !!busyCapability}>
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
          {accountKnown && (
            <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void disconnect()} disabled={loading || !!busyCapability}>
              Disconnect Google
            </button>
          )}
        </div>
      </section>

      {error && <div className="google-oauth-settings__error" role="alert">{error}</div>}

      {sessionReady ? (
        <>
          <div className="google-oauth-settings__hero setting-card">
            <div>
              <span className="panel-kicker">WORKSPACE ACCESS</span>
              <strong>Google Workspace permissions</strong>
              <span>Grant only the services Elara should use. Reads, writes, sending, and broader library access remain separate authorization choices.</span>
            </div>
            <div className="google-oauth-settings__state" data-state={status.state}>
              <span className="google-oauth-settings__dot" aria-hidden="true" />
              <span role="status" aria-live="polite">{summary}</span>
            </div>
          </div>

          <div className="google-oauth-settings__grid" aria-label="Google Workspace capabilities">
            {SERVICES.map((service) => {
              const readReady = hasCapability(status.grantedCapabilities, service.readCapability);
              const writeReady = hasCapability(status.grantedCapabilities, service.writeCapability);
              const activeCapability = !readReady ? service.readCapability : (service.writeCapability && !writeReady ? service.writeCapability : null);
              const actionLabel = !readReady ? 'Enable read access' : service.writeCapability && !writeReady ? 'Enable writes' : 'Authorized';

              return (
                <article className="google-oauth-service setting-card" key={service.id}>
                  <div className="google-oauth-service__copy">
                    <strong>{service.name}</strong>
                    <span>{service.description}</span>
                  </div>
                  <div className="google-oauth-service__status">
                    <span className={`google-oauth-service__badge${readReady ? ' is-ready' : ''}`}>{readReady ? 'Read ready' : 'Not authorized'}</span>
                    {writeReady && <span className="google-oauth-service__badge is-ready">Writes ready</span>}
                    {service.extraCapabilities?.map((extra) => hasCapability(status.grantedCapabilities, extra.capability)
                      ? <span className="google-oauth-service__badge is-ready" key={extra.capability}>{extra.readyLabel}</span>
                      : null)}
                  </div>
                  {activeCapability ? (
                    <button className="google-oauth-settings__button" type="button" onClick={() => void connect(activeCapability)} disabled={loading || !!busyCapability}>
                      {busyCapability === activeCapability ? 'Authorizing…' : actionLabel}
                    </button>
                  ) : (
                    <span className="google-oauth-service__authorized" aria-label={`${service.name} base access authorized`}>Ready</span>
                  )}
                  {service.extraCapabilities?.map((extra) => !hasCapability(status.grantedCapabilities, extra.capability)
                    ? <button className="google-oauth-settings__button google-oauth-settings__button--secondary" key={extra.capability} type="button" onClick={() => void connect(extra.capability)} disabled={loading || !!busyCapability}>{busyCapability === extra.capability ? 'Authorizing…' : extra.label}</button>
                    : null)}
                </article>
              );
            })}
          </div>

          <div className="setting-card google-oauth-settings__note">
            <strong>Stay connected</strong>
            <span>Elara is self-hosted. If this installation is paired to your own Worker, Google refresh credentials are encrypted in that Worker vault and the browser receives only short-lived access tokens. Without a paired Worker, Google remains interactive-only in the browser and a page reload can require the account-session button above again. Elara stores only non-secret authorization metadata locally. Workspace permissions remain incremental and can be expanded service by service.</span>
          </div>
        </>
      ) : (
        <div className="setting-card google-oauth-settings__locked">
          <strong>Workspace permissions unlock after account connection</strong>
          <span>Calendar, Tasks, Gmail, Drive, Docs, and Sheets stay unavailable here until a live Google authorization session is established.</span>
        </div>
      )}
    </div>
  );
}
