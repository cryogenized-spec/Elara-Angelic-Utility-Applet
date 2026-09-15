import { useEffect, useState } from 'react';
import {
  acceptYouTubePolicy,
  hasAcceptedYouTubePolicy,
  YOUTUBE_POLICY_CONSENT_VERSION,
} from '../../../persistence/preferences';

const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY_URL = 'https://policies.google.com/privacy';

export function YouTubePolicyConsent() {
  const [status, setStatus] = useState<'loading' | 'required' | 'accepted'>('loading');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const privacyUrl = `${import.meta.env.BASE_URL}privacy.html`;
  const termsUrl = `${import.meta.env.BASE_URL}terms.html`;

  useEffect(() => {
    let active = true;
    void hasAcceptedYouTubePolicy()
      .then((accepted) => { if (active) setStatus(accepted ? 'accepted' : 'required'); })
      .catch(() => { if (active) setStatus('required'); });
    return () => { active = false; };
  }, []);

  async function accept(): Promise<void> {
    if (!checked || status === 'accepted') return;
    setError(null);
    try {
      await acceptYouTubePolicy();
      setStatus('accepted');
      setChecked(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save YouTube policy acceptance.');
    }
  }

  return (
    <div className="setting-card" aria-label="YouTube privacy and terms">
      <strong>YouTube privacy & terms</strong>
      <span>
        Elara uses YouTube API Services only after the current policy notice has been accepted.
        Search, key validation and internal playback readiness stay disabled until then.
      </span>
      <p>
        <a href={privacyUrl} target="_blank" rel="noreferrer noopener">Elara Privacy Notice</a>
        {' · '}
        <a href={termsUrl} target="_blank" rel="noreferrer noopener">Elara Terms of Use</a>
        {' · '}
        <a aria-label="Official YouTube service terms" href={YOUTUBE_TERMS_URL} target="_blank" rel="noreferrer noopener">YouTube Terms</a>
        {' · '}
        <a aria-label="Official Google privacy statement" href={GOOGLE_PRIVACY_URL} target="_blank" rel="noreferrer noopener">Google Privacy Policy</a>
      </p>
      {status === 'accepted' ? (
        <span role="status">Accepted · policy version {YOUTUBE_POLICY_CONSENT_VERSION}</span>
      ) : status === 'loading' ? (
        <span role="status">Checking policy acceptance…</span>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              aria-label="Agree to Elara YouTube privacy and terms"
            />
            <span>
              I agree to the Elara Privacy Notice and Elara Terms of Use, including that using Elara’s YouTube features means agreeing to be bound by the YouTube Terms of Service.
            </span>
          </label>
          <div className="model-settings__actions">
            <button
              className="model-settings__button worker-health__button"
              type="button"
              disabled={!checked}
              onClick={() => void accept()}
            >
              Enable YouTube features
            </button>
          </div>
        </>
      )}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
