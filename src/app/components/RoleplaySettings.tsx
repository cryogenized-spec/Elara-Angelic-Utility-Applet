import type { RoleplayPreferences } from '../../domain/preferences';
import './roleplay-settings.css';

export function RoleplaySettings({ value, onChange }: { value: RoleplayPreferences; onChange: (value: RoleplayPreferences) => void }) {
  return <div className="roleplay-settings">
    <div
      className={`setting-card roleplay-toggle-card${value.enabled ? ' is-enabled' : ''}`}
      onClick={() => onChange({ ...value, enabled: !value.enabled })}
    >
      <div className="roleplay-toggle-card__copy">
        <strong>Roleplay Mode</strong>
        <span>Creative/fictional context with explicit scene-format conventions.</span>
      </div>
      <button
        type="button"
        className={`toggle-switch${value.enabled ? ' is-on' : ''}`}
        role="switch"
        aria-label={value.enabled ? 'Roleplay mode on' : 'Roleplay mode off'}
        aria-checked={value.enabled}
        onClick={(event) => {
          event.stopPropagation();
          onChange({ ...value, enabled: !value.enabled });
        }}
      >
        <span className="toggle-switch__knob" aria-hidden="true" />
      </button>
    </div>

    {value.enabled && <div className="roleplay-detail">
      <div className="roleplay-notice">Roleplay is treated as a creative fictional context. It does not alter the application's hard-coded tools, authorization, security controls, or provider safety enforcement.</div>

      <div className="setting-card roleplay-canvas-card">
        <div className="roleplay-section-heading">
          <div>
            <span className="roleplay-section-kicker">WORLD CANVAS</span>
            <strong>Setting</strong>
          </div>
          <span className="roleplay-section-hint">Editable context</span>
        </div>
        <label className="roleplay-field">
          <span>Setting name</span>
          <input
            value={value.environmentName}
            maxLength={120}
            placeholder="e.g. The old house on the hill"
            onChange={(event) => onChange({ ...value, environmentName: event.target.value })}
          />
        </label>
        <label className="roleplay-field">
          <span>World notes</span>
          <textarea
            value={value.environmentDescription}
            maxLength={4000}
            placeholder="Describe the place, important locations, people, rules, history, and persistent details. This is a living canvas rather than a fixed template."
            onChange={(event) => onChange({ ...value, environmentDescription: event.target.value })}
          />
        </label>
        <label className="roleplay-field">
          <span>Atmosphere</span>
          <input
            value={value.atmosphere}
            maxLength={120}
            placeholder="Quiet, intimate, cinematic"
            onChange={(event) => onChange({ ...value, atmosphere: event.target.value })}
          />
        </label>
        <div className="roleplay-assist">
          <div>
            <strong>AI-assisted setting</strong>
            <span>Keep the canvas authoritative; let Elara help expand or reorganize it rather than relying on rigid presets.</span>
          </div>
          <span className="roleplay-assist__badge">PLANNED</span>
        </div>
      </div>

      <div className="setting-card roleplay-format">
        <strong>Formatting</strong>
        <span><em>Italic text</em> is used for physical action and scene narration. Ordinary text is used for spoken dialogue.</span>
      </div>
    </div>}
  </div>;
}
