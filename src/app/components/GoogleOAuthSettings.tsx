import { useEffect, useMemo, useState } from 'react';
import { authorizeGoogleWorkspace, googleDrivePickerAuthority, googleOAuthAuthority } from '../../google/oauth/authority';
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
      { capability: 'calendar.list.read', label: 'Calendar list' },
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
  const [authorizationBusy, setAuthorizationBusy] = useState(false);
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

  async function connectWorkspace() {
    setAuthorizationBusy(true);
    setError(null);
    try {
      setStatus(await authorizeGoogleWorkspace());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Workspace authorization could not be completed.');
    } finally {
      setAuthorizationBusy(false);
    }
  }

  async function disconnect() {
    setAuthorizationBusy(false);
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
  const allWorkspaceReady = GOOGLE_WORKSPACE_ONBOARDING_CAPABILITIES.every((capability) =>
    hasCapability(status.grantedCapabilities, capability),
  );
  const accountNeedsAuthorization = status.state === 'disconnected'
    || status.state === 'needs-consent'
    || status.state === 'reauthorization-required'
    || status.state === 'revoked'
    || !sessionReady
    || !allWorkspaceReady;

  const accountActionLabel = useMemo(() => {
    if (authorizationBusy) return 'Opening Google…';
    if (status.state === 'reauthorization-required' || status.state === 'revoked') return 'Reauthorize Google Workspace';
    if (status.state === 'token-recovery') return 'Retry Google Workspace';
    if (accountKnown && !sessionReady) return 'Refresh Google Workspace';
    if (accountKnown) return 'Review Google permissions';
    return 'Connect Google Workspace';
  }, [accountKnown, authorizationBusy, sessionReady, status.state]);

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
              ? allWorkspaceReady
                ? 'A live Google authorization session is ready with the current Workspace permission bundle.'
                : 'Your Google session is live, but some Workspace permissions were not granted. Review Google permissions to update access.'
              : 'Open Google’s secure authorization window once to review the current Workspace permission bundle. Google keeps granular control over every permission you approve.'}
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
            onClick={() => void connectWorkspace()}
            disabled={loading || authorizationBusy}
          >
            {accountActionLabel}
          </button>
        ) : (
          <div className="google-oauth-account__ready" role="status">Google Workspace authorization is live</div>
        )}

        <div className="google-oauth-account__utility">
          <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void refresh()} disabled={loading || authorizationBusy}>
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
          {accountKnown && (
            <button className="google-oauth-settings__button google-oauth-settings__button--quiet" type="button" onClick={() => void disconnect()} disabled={loading || authorizationBusy}>
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
              <span>One Google consent screen requests the current Calendar, Tasks, Gmail, Drive, Docs, and Sheets bundle. Google still lets you approve or decline individual permissions there.</span>
            </div>
            <div className="google-oauth-settings__state" data-state={status.state}>
              <span className="google-oauth-settings__dot" aria-hidden="true" />
              <span role="status" aria-live="polite">{summary}</span>
            </div>
          </div>

          <div className="google-oauth-settings__grid" aria-label="Google Workspace capabilities">
            {SERVICES.map((service) => {
              const readReady = hasCapability(status.grantedCapabilities, service.readCapability);
              const writeReady = !service.writeCapability || hasCapability(status.grantedCapabilities, service.writeCapability);
              const extrasReady = service.extraCapabilities?.every((extra) => hasCapability(status.grantedCapabilities, extra.capability)) ?? true;
              const serviceReady = readReady && writeReady && extrasReady;

              return (
                <article className="google-oauth-service setting-card" key={service.id}>
                  <div className="google-oauth-service__copy">
                    <strong>{service.name}</strong>
                    <span>{service.description}</span>
                  </div>
                  <div className="google-oauth-service__status">
                    <span className={`google-oauth-service__badge ${readReady ? 'is-ready' : 'is-missing'}`} aria-label={`${service.name} read ${readReady ? 'granted' : 'not granted'}`}>Read</span>
                    {service.writeCapability && <span className={`google-oauth-service__badge ${writeReady ? 'is-ready' : 'is-missing'}`} aria-label={`${service.name} write ${writeReady ? 'granted' : 'not granted'}`}>Write</span>}
                    {service.extraCapabilities?.map((extra) => {
                      const ready = hasCapability(status.grantedCapabilities, extra.capability);
                      return <span className={`google-oauth-service__badge ${ready ? 'is-ready' : 'is-missing'}`} key={extra.capability} aria-label={`${extra.label} ${ready ? 'granted' : 'not granted'}`}>{extra.label}</span>;
                    })}
                  </div>
                  <span className={`google-oauth-service__authorized${serviceReady ? ' is-ready' : ' is-partial'}`} aria-label={`${service.name} permission status`}>
                    {serviceReady ? 'Ready' : 'Some permissions not granted'}
                  </span>
                  {service.id === 'drive' && readReady && (
                    <div className="google-oauth-picker" aria-label="Google Picker admissions">
                      <button
                        className="google-oauth-settings__button google-oauth-settings__button--secondary"
                        type="button"
                        onClick={() => void chooseDriveFiles()}
                        disabled={loading || authorizationBusy || pickerBusy || !googleDrivePickerAuthority.configured}
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
            <span>Elara is self-hosted. If this installation is paired to your own Worker, Google refresh credentials are encrypted in that Worker vault and the browser receives only short-lived access tokens. Without a paired Worker, Google remains interactive-only in the browser and a page reload can require the Workspace button above again. Elara stores only non-secret authorization metadata locally. If you change Google permissions later, use Review Google permissions to reopen the same bundled consent flow.</span>
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
