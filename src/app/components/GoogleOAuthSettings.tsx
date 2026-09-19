import { useEffect, useMemo, useState } from 'react';
import { googleDrivePickerAuthority, googleOAuthAuthority, reviewGoogleWorkspacePermissions } from '../../google/oauth/authority';
import { GOOGLE_WORKSPACE_ONBOARDING_CAPABILITIES } from '../../google/oauth/capability-policy';
import { admitGooglePickerFiles, clearGooglePickerAdmissions, loadGooglePickerAdmissions, revokeGooglePickerFile } from '../../persistence/google-picker-admissions';
import type { GooglePickerAdmission } from '../../google/picker/contracts';
import type { GoogleCapabilityKey, GoogleOAuthStatus } from '../../google/oauth/contracts';
import './google-oauth-settings.css';

type ServiceDefinition = {
  id: string;
  name: string;
  description: string;
  readCapability: GoogleCapabilityKey;
  writeCapability?: GoogleCapabilityKey;
  extraCapabilities?: readonly { capability: GoogleCapabilityKey; label: string }[];
};

const SERVICES: readonly ServiceDefinition[] = [
  {
    id: 'calendar',
    name: 'Google Calendar',
    description: 'Events, scheduling, calendar discovery, timezone context, and availability.',
    readCapability: 'calendar.events.read',
    writeCapability: 'calendar.events.write',
    extraCapabilities: [
      { capability: 'calendar.list.read', label: 'Calendars' },
      { capability: 'calendar.settings.read', label: 'Settings' },
      { capability: 'calendar.freebusy.read', label: 'Availability' },
    ],
  },
  { id: 'tasks', name: 'Google Tasks', description: 'Task lists, tasks, ordering, and completion.', readCapability: 'tasks.read', writeCapability: 'tasks.write' },
  { id: 'gmail', name: 'Gmail', description: 'Mailbox reading, organization, labels, and sending.', readCapability: 'gmail.read', writeCapability: 'gmail.modify', extraCapabilities: [{ capability: 'gmail.labels', label: 'Labels' }, { capability: 'gmail.send', label: 'Send' }] },
  { id: 'drive', name: 'Google Drive', description: 'App-created or admitted files, plus optional library search across your Drive.', readCapability: 'drive.files.app.read', writeCapability: 'drive.files.app.write', extraCapabilities: [{ capability: 'drive.library.read', label: 'Library search' }] },
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

function serviceCapabilities(service: ServiceDefinition): readonly { capability: GoogleCapabilityKey; label: string }[] {
  return [
    { capability: service.readCapability, label: 'Read' },
    ...(service.writeCapability ? [{ capability: service.writeCapability, label: 'Write' }] : []),
    ...(service.extraCapabilities ?? []),
  ];
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
  const [pickerFiles, setPickerFiles] = useState<readonly GooglePickerAdmission[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);

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
    void Promise.all([googleOAuthAuthority.getStatus(), loadGooglePickerAdmissions()]).then(([nextStatus, admissions]) => {
      if (!active) return;
      setStatus(nextStatus);
      setPickerFiles(admissions.files);
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

  async function reviewPermissions() {
    setBusyCapability('google.account');
    setError(null);
    try {
      await reviewGoogleWorkspacePermissions();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google permissions could not be reviewed.');
    } finally {
      setBusyCapability(null);
    }
  }

  async function disconnect() {
    setBusyCapability(null);
    setError(null);
    try {
      await googleOAuthAuthority.disconnect();
      const admissions = await clearGooglePickerAdmissions();
      setPickerFiles(admissions.files);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google could not be disconnected.');
    }
  }

  async function chooseDriveFiles() {
    setPickerBusy(true);
    setError(null);
    try {
      const selected = await googleDrivePickerAuthority.pick({ multiselect: true });
      if (!selected.length) return;
      const admissions = await admitGooglePickerFiles(selected);
      setPickerFiles(admissions.files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Picker could not be opened.');
    } finally {
      setPickerBusy(false);
    }
  }

  async function revokeDriveFile(fileId: string) {
    setPickerBusy(true);
    setError(null);
    try {
      const admissions = await revokeGooglePickerFile(fileId);
      setPickerFiles(admissions.files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected Drive file could not be removed from Elara.');
    } finally {
      setPickerBusy(false);
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
  const workspaceCapabilities = GOOGLE_WORKSPACE_ONBOARDING_CAPABILITIES.filter((capability) => capability !== 'google.account');
  const missingWorkspaceCapabilities = workspaceCapabilities.filter((capability) => !hasCapability(status.grantedCapabilities, capability));
  const workspaceComplete = missingWorkspaceCapabilities.length === 0;

  const accountActionLabel = useMemo(() => {
    if (busyCapability === 'google.account') return 'Opening Google…';
    if (status.state === 'reauthorization-required' || status.state === 'revoked') return 'Reauthorize Google Workspace';
    if (status.state === 'token-recovery') return 'Retry Google Workspace session';
    if (accountKnown) return 'Refresh Google Workspace session';
    return 'Connect Google Workspace';
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
          <strong id="google-account-title">{accountKnown ? 'Google Workspace connected' : 'Connect Google Workspace'}</strong>
          {status.account?.displayName && <span className="google-oauth-account__name">{status.account.displayName}</span>}
          {status.account?.email && <span className="google-oauth-account__email">{status.account.email}</span>}
          <p>
            {sessionReady
              ? 'A live Google authorization session is ready. Elara requests its reviewed Workspace permissions together in Google’s consent screen; the status below reflects what Google actually granted.'
              : 'Open Google’s secure authorization window. Calendar, Tasks, Gmail, Drive, Docs, and Sheets permissions are presented together there, and Google remains the source of truth for the permissions you approve.'}
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
              <span>Permissions are requested together through Google Identity Services rather than activated one by one in Elara. Google’s granular consent screen lets you approve the full set or leave individual permissions ungranted.</span>
            </div>
            <div className="google-oauth-settings__hero-status">
              <div className="google-oauth-settings__state" data-state={status.state}>
                <span className="google-oauth-settings__dot" aria-hidden="true" />
                <span role="status" aria-live="polite">{summary}</span>
              </div>
              {!workspaceComplete && (
                <button
                  className="google-oauth-settings__button google-oauth-settings__button--review"
                  type="button"
                  onClick={() => void reviewPermissions()}
                  disabled={loading || !!busyCapability}
                >
                  {busyCapability === 'google.account' ? 'Opening Google…' : `Review Google permissions · ${missingWorkspaceCapabilities.length} missing`}
                </button>
              )}
            </div>
          </div>

          <div className="google-oauth-settings__grid" aria-label="Google Workspace capabilities">
            {SERVICES.map((service) => {
              const capabilities = serviceCapabilities(service);
              const grantedCount = capabilities.filter((entry) => hasCapability(status.grantedCapabilities, entry.capability)).length;
              const readReady = hasCapability(status.grantedCapabilities, service.readCapability);
              const serviceState = grantedCount === capabilities.length ? 'ready' : grantedCount > 0 ? 'limited' : 'missing';

              return (
                <article className="google-oauth-service setting-card" key={service.id}>
                  <div className="google-oauth-service__copy">
                    <strong>{service.name}</strong>
                    <span>{service.description}</span>
                  </div>
                  <div className="google-oauth-service__status" aria-label={`${service.name} permission status`}>
                    {capabilities.map((entry) => {
                      const granted = hasCapability(status.grantedCapabilities, entry.capability);
                      return (
                        <span
                          className={`google-oauth-service__badge${granted ? ' is-ready' : ' is-missing'}`}
                          aria-label={`${entry.label} permission ${granted ? 'granted' : 'not granted'}`}
                          key={entry.capability}
                        >
                          {entry.label}
                        </span>
                      );
                    })}
                  </div>
                  <span className="google-oauth-service__authorized" data-state={serviceState}>
                    {serviceState === 'ready' ? 'Ready' : serviceState === 'limited' ? 'Limited access' : 'Not granted'}
                  </span>
                  {service.id === 'drive' && readReady && (
                    <div className="google-oauth-picker" aria-label="Google Picker admissions">
                      <button
                        className="google-oauth-settings__button google-oauth-settings__button--secondary"
                        type="button"
                        onClick={() => void chooseDriveFiles()}
                        disabled={loading || !!busyCapability || pickerBusy || !googleDrivePickerAuthority.configured}
                      >
                        {pickerBusy ? 'Opening Picker…' : 'Choose files with Google Picker'}
                      </button>
                      {!googleDrivePickerAuthority.configured && <small>Picker needs this installation’s public, origin-restricted API key and Cloud project number.</small>}
                      {pickerFiles.length > 0 && (
                        <div className="google-oauth-picker__files">
                          {pickerFiles.map((file) => (
                            <div className="google-oauth-picker__file" key={file.id}>
                              <span><strong>{file.name}</strong>{file.mimeType && <small>{file.mimeType}</small>}</span>
                              <button type="button" onClick={() => void revokeDriveFile(file.id)} disabled={pickerBusy}>Remove from Elara</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <small>Removing a file blocks Elara’s Drive, Docs, and Sheets tools locally. Choose it again to re-admit it.</small>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="setting-card google-oauth-settings__note">
            <strong>Stay connected</strong>
            <span>Elara is self-hosted. If this installation is paired to your own Worker, Google refresh credentials are encrypted in that Worker vault and the browser receives only short-lived access tokens. Without a paired Worker, Google remains interactive-only in the browser and a page reload can require the account-session button above again. Elara stores only non-secret authorization metadata locally. Google’s returned scope set remains authoritative, including when you approve only part of the bundled request.</span>
          </div>
        </>
      ) : (
        <div className="setting-card google-oauth-settings__locked">
          <strong>Workspace permissions are granted in Google</strong>
          <span>Connect Google Workspace once to open Google’s consent screen for Calendar, Tasks, Gmail, Drive, Docs, and Sheets together.</span>
        </div>
      )}
    </div>
  );
}
