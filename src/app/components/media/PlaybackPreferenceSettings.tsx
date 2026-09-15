import { MEDIA_PLAYBACK_PREFERENCES, type MediaPlaybackPreference } from '../../../domain/playback';
import { usePlaybackAuthority } from '../../../media/playback/PlaybackProvider';
import { MEDIA_PLAYBACK_ROUTE_PRESENTATION } from '../../../media/playback/presentation';
import './playback-preference-settings.css';

export function PlaybackPreferenceSettings() {
  const playback = usePlaybackAuthority();
  const busy = playback.preferenceStatus === 'loading' || playback.preferenceStatus === 'saving';

  function choose(value: MediaPlaybackPreference): void {
    if (busy || value === playback.preference) return;
    void playback.setPreference(value).catch(() => undefined);
  }

  return (
    <div className="setting-card playback-preference-setting">
      <strong>Media playback</strong>
      <span>Choose the default action for YouTube result cards. You can change this at any time.</span>
      <div className="playback-preference-options" role="radiogroup" aria-label="Default YouTube playback action">
        {MEDIA_PLAYBACK_PREFERENCES.map((value) => {
          const option = MEDIA_PLAYBACK_ROUTE_PRESENTATION[value];
          const selected = playback.preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`playback-preference-option${selected ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => choose(value)}
            >
              <span className="playback-preference-option__label">{option.label}</span>
              <small>{option.description}</small>
            </button>
          );
        })}
      </div>
      {playback.preferenceStatus === 'loading' ? (
        <small className="playback-preference-status" role="status">Loading playback preference…</small>
      ) : null}
      {playback.preferenceStatus === 'saving' ? (
        <small className="playback-preference-status" role="status">Saving playback preference…</small>
      ) : null}
      {playback.preferenceError ? <small className="playback-preference-error" role="alert">{playback.preferenceError}</small> : null}
    </div>
  );
}
