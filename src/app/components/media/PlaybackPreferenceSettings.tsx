import { MEDIA_PLAYBACK_PREFERENCES, type MediaPlaybackPreference } from '../../../domain/playback';
import { usePlaybackAuthority } from '../../../media/playback/PlaybackProvider';
import './playback-preference-settings.css';

const OPTIONS: Readonly<Record<MediaPlaybackPreference, { label: string; description: string }>> = Object.freeze({
  ask: {
    label: 'Ask each time',
    description: 'Choose Play here or Open YouTube when you tap a media card.',
  },
  embedded: {
    label: 'Play here',
    description: 'Route eligible cards through Elara’s single embedded YouTube player.',
  },
  external: {
    label: 'Open YouTube',
    description: 'Keep media cards as ordinary validated YouTube handoff links.',
  },
});

export function PlaybackPreferenceSettings() {
  const playback = usePlaybackAuthority();
  const saving = playback.preferenceStatus === 'loading';

  function choose(value: MediaPlaybackPreference): void {
    if (saving || value === playback.preference) return;
    void playback.setPreference(value).catch(() => undefined);
  }

  return (
    <div className="setting-card playback-preference-setting">
      <strong>Media playback</strong>
      <span>Choose the default action for YouTube result cards. You can change this at any time.</span>
      <div className="playback-preference-options" role="radiogroup" aria-label="Default YouTube playback action">
        {MEDIA_PLAYBACK_PREFERENCES.map((value) => {
          const option = OPTIONS[value];
          const selected = playback.preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`playback-preference-option${selected ? ' is-active' : ''}`}
              disabled={saving}
              onClick={() => choose(value)}
            >
              <span className="playback-preference-option__label">{option.label}</span>
              <small>{option.description}</small>
            </button>
          );
        })}
      </div>
      {saving ? <small className="playback-preference-status" role="status">Saving playback preference…</small> : null}
      {playback.preferenceError ? <small className="playback-preference-error" role="alert">{playback.preferenceError}</small> : null}
    </div>
  );
}
