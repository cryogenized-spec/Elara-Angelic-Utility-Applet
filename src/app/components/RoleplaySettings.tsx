import type { RoleplayPreferences } from '../../domain/preferences';
import './roleplay-settings.css';

const PRESETS: Array<{ id: RoleplayPreferences['environmentPreset']; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'house', label: 'House' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'living-room', label: 'Living room' },
  { id: 'office', label: 'Office' },
  { id: 'poolside', label: 'Poolside' },
  { id: 'outdoors', label: 'Outdoors' },
  { id: 'custom', label: 'Custom' },
];

export function RoleplaySettings({ value, onChange }: { value: RoleplayPreferences; onChange: (value: RoleplayPreferences) => void }) {
  return <div className="roleplay-settings">
    <div className="setting-card roleplay-toggle-card">
      <div><strong>Roleplay Mode</strong><span>Creative/fictional context with explicit scene-format conventions.</span></div>
      <button type="button" className={`toggle-switch${value.enabled ? ' is-on' : ''}`} role="switch" aria-checked={value.enabled} onClick={() => onChange({ ...value, enabled: !value.enabled })}>
        <span className="toggle-switch__knob" />
        <span className="sr-only">{value.enabled ? 'Roleplay mode on' : 'Roleplay mode off'}</span>
      </button>
    </div>

    {value.enabled && <div className="roleplay-detail">
      <div className="roleplay-notice">Roleplay is treated as a creative fictional context. It does not alter the application's hard-coded tools, authorization, security controls, or provider safety enforcement.</div>
      <div className="setting-card">
        <label className="roleplay-field"><span>Environment</span><select value={value.environmentPreset} onChange={(event) => onChange({ ...value, environmentPreset: event.target.value as RoleplayPreferences['environmentPreset'] })}>{PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <label className="roleplay-field"><span>Environment name</span><input value={value.environmentName} maxLength={120} placeholder="e.g. Sunset poolside villa" onChange={(event) => onChange({ ...value, environmentName: event.target.value })} /></label>
        <label className="roleplay-field"><span>Environment description</span><textarea value={value.environmentDescription} maxLength={4000} placeholder="Describe the scene, surroundings, and persistent details." onChange={(event) => onChange({ ...value, environmentDescription: event.target.value })} /></label>
        <div className="roleplay-grid">
          <label className="roleplay-field"><span>Time of day</span><input value={value.timeOfDay} maxLength={80} placeholder="Late afternoon" onChange={(event) => onChange({ ...value, timeOfDay: event.target.value })} /></label>
          <label className="roleplay-field"><span>Weather</span><input value={value.weather} maxLength={80} placeholder="Warm and clear" onChange={(event) => onChange({ ...value, weather: event.target.value })} /></label>
        </div>
        <label className="roleplay-field"><span>Atmosphere / mood</span><input value={value.atmosphere} maxLength={120} placeholder="Quiet, intimate, cinematic" onChange={(event) => onChange({ ...value, atmosphere: event.target.value })} /></label>
      </div>
      <div className="setting-card roleplay-format"><strong>Formatting</strong><span><em>Italic text</em> is used for physical action and scene narration. Ordinary text is used for spoken dialogue.</span></div>
    </div>}
  </div>;
}
