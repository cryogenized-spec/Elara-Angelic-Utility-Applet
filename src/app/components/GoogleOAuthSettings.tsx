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
  { id: 'calendar', name: 'Google Calendar', description: 'Events, scheduling, and calendar context.', readCapability: 'calendar.events.read', writeCapability: 'calendar.events.write' },
  { id: 'tasks', name: 'Google Tasks', description: 'Task lists, tasks, ordering, and completion.', readCapability: 'tasks.read', writeCapability: 'tasks.write' },
  { id: 'gmail', name: 'Gmail', description: 'Mailbox reading, organization, labels, and sending.', readCapability: 'gmail.read', writeCapability: 'gmail.modify', extraCapabilities: [{ capability: 'gmail.labels', label: 'Enable labels', readyLabel: 'Labels ready' }, { capability: 'gmail.send', label: 'Enable sending', readyLabel: 'Sending ready' }] },
  { id: 'drive', name: 'Google Drive', description: 'Files the app creates or the user explicitly selects.', readCapability: 'drive.files.read', writeCapability: 'drive.files.write' },
  { id: 'docs', name: 'Google Docs', description: 'Documents created or selected for Elara to work with.', readCapability: 'docs.read', writeCapability: 'docs.write' },
  { id: 'sheets', name: 'Google Sheets', description: 'Selected spreadsheets, ranges, rows, and updates.', readCapability: 'sheets.read', writeCapability: 'sheets.write' },
];

const stateLabels: Record<GoogleOAuthStatus['state'], string> = {
  disconnected: 'Not connected',
  connected: 'Connected',
  'needs-consent': 'Needs authorization',
  'token-recovery': 'Recovering session',
  'reauthorization-required': 'Reauthorization required',
  'partially-authorized': 'Partially authorized',
  revoked: 'Access revoked',
};

function hasCapability(granted: readonly GoogleCapabilityKey[], capability?: GoogleCapabilityKey): boolean {
  return !!capability && granted.includes(capability);
}

export function GoogleOAuthSettings() {
  const [status, setStatus] = useState<GoogleOAuthStatus>({ state: 'disconnected', grantedCapabilities: [] });
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
    void refresh();
  }, []);

  async function connect(capability: GoogleCapabilityKey) {
    setBusyCapability(capability);
    setError(null);
    try {
      await googleOAuthAuthority.authorize(capability);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google authorization could not be completed.');
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

  const summary = useMemo(() => {
    if (loading) return 'Checking Google authorization…';
    if (status.account?.email) return `${stateLabels[status.state]} · ${status.account.email}`;
    return stateLabels[status.state];
  }, [loading, status]);

  return (
    <div className="google-oauth-settings">
      <div className="google-oauth-settings__hero setting-card">
        <div>
          <span className="panel-kicker">GOOGLE</span>
          <strong>Google Workspace</strong>
          <span>Connect Google directly from Elara. Access is granted one capability at a time.</span>
        </div>
        <div className="google-oauth-settings__state" data-state={status.state}>
          <span className="google-oauth-settings__dot" aria-hidden="true" />
          <span role="status" aria-live="polite">{summary}</span>
        </div>
      </div>

      {error && <div className="google-oauth-settings__error" role="alert">{error}</div>}

      <div className="google-oauth-settings__actions">
        <button className="google-oauth-settings__button" type="button" onClick={() => void refresh()} disabled={loading || !!busyCapability}>
          {loading ? 'Checking…' : 'Refresh status'}
        </button>
        {status.state !== 'disconnected' && <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void disconnect()} disabled={loading || !!busyCapability}>Disconnect Google</button>}
      </div>

      <div className="google-oauth-settings__grid" aria-label="Google Workspace capabilities">
        {SERVICES.map((service) => {
          const readReady = hasCapability(status.grantedCapabilities, service.readCapability);
          const writeReady = hasCapability(status.grantedCapabilities, service.writeCapability);
          const activeCapability = !readReady ? service.readCapability : (service.writeCapability && !writeReady ? service.writeCapability : null);
          const actionLabel = !readReady ? 'Connect' : service.writeCapability && !writeReady ? 'Enable writes' : 'Authorized';

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
        <span>Elara stores only non-secret authorization metadata. Google access tokens stay in memory and are reacquired without a new consent screen whenever Google still has the grant.</span>
      </div>
    </div>
  );
}
