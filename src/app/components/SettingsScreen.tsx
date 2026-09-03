import { useState } from 'react';
import { z } from 'zod';
import { Icon } from '../../ui/icons';
import { BUILT_IN_FONTS, fontFamilyForCss, googleFontFamilyFromCss2Url, type FontSelection } from '../../ui/fontRegistry';
import { RangeSlider } from './RangeSlider';
import type { PortraitBackground, PortraitScale } from './PortraitBanner';
import type { GeminiSettings } from '../../gemini/settings-engine';
import { getGeminiModel } from '../../gemini/model-registry';
import { GEMINI_MODELS } from '../../gemini/model-registry';
import { WorkerHealthPanel } from './WorkerHealthPanel';
import './model-settings.css';
import './settings-fixes.css';

const settingsSections = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' as const },
  { id: 'typography', label: 'Typography', icon: 'type' as const },
  { id: 'model', label: 'Gemini', icon: 'chat' as const },
  { id: 'chat', label: 'Chat', icon: 'chat' as const },
  { id: 'security', label: 'Lockbox', icon: 'shield' as const },
] as const;
type SettingsSection = typeof settingsSections[number]['id'];

const css2UrlSchema = z.string().url().refine((value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2'; }
  catch { return false; }
}, 'Use a Google Fonts CSS2 URL from fonts.googleapis.com.');

const portraitBackgrounds: Array<{ id: PortraitBackground; label: string; description: string }> = [
  { id: 'midnight', label: 'Midnight', description: 'Balanced blue/pink ambient glow.' },
  { id: 'blue-hour', label: 'Blue Hour', description: 'Cooler blue atmospheric emphasis.' },
  { id: 'violet', label: 'Violet', description: 'Deeper violet with pink highlights.' },
  { id: 'rose', label: 'Rose', description: 'Warmer rose and soft amber glow.' },
];

function loadCustomGoogleFont(stylesheetUrl: string) {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-elara-custom-font="${stylesheetUrl}"]`);
  if (existing) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = stylesheetUrl; link.dataset.elaraCustomFont = stylesheetUrl; document.head.appendChild(link);
}

export function SettingsScreen({
  font, onFontChange, fontSize, onFontSizeChange, portraitScale, onPortraitScaleChange, portraitBackground, onPortraitBackgroundChange,
  selectedModel, geminiSettings, onModelChange, onGeminiSettingsChange, onResetGeminiSettings, onBack,
}: {
  font: FontSelection; onFontChange: (font: FontSelection) => void;
  fontSize: number; onFontSizeChange: (fontSize: number) => void;
  portraitScale: PortraitScale; onPortraitScaleChange: (scale: PortraitScale) => void;
  portraitBackground: PortraitBackground; onPortraitBackgroundChange: (background: PortraitBackground) => void;
  selectedModel: string; geminiSettings: GeminiSettings;
  onModelChange: (model: string) => void; onGeminiSettingsChange: (settings: GeminiSettings) => void; onResetGeminiSettings: () => void;
  onBack: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const model = getGeminiModel(selectedModel);

  function applyCustomFont() {
    setCustomError(null);
    const parsed = css2UrlSchema.safeParse(customUrl.trim());
    if (!parsed.success) { setCustomError('Paste a valid Google Fonts CSS2 URL.'); return; }
    const family = googleFontFamilyFromCss2Url(parsed.data);
    if (!family) { setCustomError('That link does not contain a readable Google font family.'); return; }
    loadCustomGoogleFont(parsed.data); onFontChange({ kind: 'custom', family, stylesheetUrl: parsed.data });
  }

  function updateSetting(patch: Partial<GeminiSettings>) {
    onGeminiSettingsChange({ ...geminiSettings, ...patch });
  }

  return (
    <main className="settings-screen" style={{ fontFamily: fontFamilyForCss(font), '--body-font-size': `${fontSize}px` } as React.CSSProperties}>
      <header className="settings-header"><button className="icon-button" type="button" aria-label="Back to chat" onClick={onBack}><Icon name="chevron" /></button><div><div className="eyebrow">ELARA</div><h1>Settings</h1></div></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map((item) => <button className={`settings-nav__item${section === item.id ? ' is-active' : ''}`} key={item.id} type="button" onClick={() => setSection(item.id)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
        </nav>
        <section className="settings-panel" aria-live="polite">
          {section === 'appearance' && <div className="settings-copy"><span className="panel-kicker">PRESENCE</span><h2>Elara presentation</h2><p>The portrait is a presentation layer. Its scale and ambient treatment are independent of Elara's character definition.</p><RangeSlider id="portrait-scale" label="Portrait scale" min={1} max={3} value={portraitScale} valueLabel={`${portraitScale}×`} minLabel="1×" maxLabel="3×" onChange={(value) => onPortraitScaleChange(Math.min(3, Math.max(1, value)) as PortraitScale)} /><div className="background-picker"><div className="background-picker__header"><strong>Banner background</strong><span>Ambient backdrop only · does not change the portrait asset.</span></div><div className="background-options" role="radiogroup" aria-label="Portrait background">{portraitBackgrounds.map((option) => { const active = portraitBackground === option.id; return <button key={option.id} type="button" role="radio" aria-checked={active} className={`background-option background-option--${option.id}${active ? ' is-active' : ''}`} onClick={() => onPortraitBackgroundChange(option.id)}><span>{option.label}</span><small>{option.description}</small></button>; })}</div></div></div>}

          {section === 'typography' && <div className="settings-copy"><span className="panel-kicker">TYPE</span><h2>Typography</h2><p>Built-in fonts are shipped as locally hosted, Latin-subset WOFF2 assets. Custom Google Fonts remain an explicit opt-in link.</p><div className="typography-preview" style={{ fontFamily: fontFamilyForCss(font), fontSize: `${fontSize}px` }}><span className="typography-preview__label">LIVE PREVIEW</span><p>The quick brown fox jumps over the lazy dog.</p><p>0123456789 · Aa Bb Cc · crisp, readable, and ready for chat.</p></div><RangeSlider id="font-size" label="Text size" min={10} max={20} value={fontSize} valueLabel={`${fontSize}px`} onChange={onFontSizeChange} /><div className="font-options" role="radiogroup" aria-label="Font family">{BUILT_IN_FONTS.map((option) => { const active = font.kind === 'built-in' && font.family === option.family; return <button key={option.family} className={`font-option${active ? ' is-active' : ''}`} type="button" role="radio" aria-checked={active} onClick={() => onFontChange({ kind: 'built-in', family: option.family })} style={{ fontFamily: fontFamilyForCss(option.family) }}><span>{option.family}</span><small>The quick brown fox jumps over the lazy dog.</small></button>; })}{font.kind === 'custom' && <button className="font-option is-active" type="button" role="radio" aria-checked="true" style={{ fontFamily: fontFamilyForCss(font) }}><span>{font.family}</span><small>Custom Google font · loaded from your CSS2 link.</small></button>}</div><div className="custom-font-card"><div><strong>Add a Google font</strong><span>Paste the CSS2 stylesheet URL generated by Google Fonts.</span></div><input className="custom-font-input" value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setCustomError(null); }} placeholder="https://fonts.googleapis.com/css2?family=..." inputMode="url" aria-label="Google Fonts CSS2 URL"/><button className="custom-font-button" type="button" onClick={applyCustomFont}>Load font</button>{customError && <small className="custom-font-error" role="alert">{customError}</small>}</div></div>}

          {section === 'model' && <div className="settings-copy"><span className="panel-kicker">GEMINI</span><h2>Model & generation</h2><p>The selected production model controls which generation settings are valid. Changes save automatically.</p><div className="model-settings"><div className="model-settings__field"><label htmlFor="gemini-model">Model</label><select id="gemini-model" className="model-settings__select" value={selectedModel} onChange={(event) => onModelChange(event.target.value)}>{GEMINI_MODELS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><span className="model-settings__hint">{model.id} · {model.inputTokenLimit.toLocaleString()} input · {model.outputTokenLimit.toLocaleString()} output tokens</span></div><div className="model-settings__field"><span>Thinking level</span><div className="model-settings__chips" role="radiogroup" aria-label="Thinking level">{model.thinkingLevels.map((level) => <button key={level} type="button" className={`model-settings__chip${geminiSettings.thinkingLevel === level ? ' is-active' : ''}`} role="radio" aria-checked={geminiSettings.thinkingLevel === level} onClick={() => updateSetting({ thinkingLevel: level })}>{level}</button>)}{!geminiSettings.thinkingLevel && <button type="button" className="model-settings__chip is-active" role="radio" aria-checked="true" onClick={() => updateSetting({ thinkingLevel: undefined })}>Provider default</button>}</div><span className="model-settings__hint">Supported levels only; switching models removes incompatible choices.</span></div><div className="model-settings__field"><label htmlFor="gemini-max-output">Max output tokens</label><input id="gemini-max-output" className="model-settings__input" type="number" min={1} max={model.outputTokenLimit} value={geminiSettings.maxOutputTokens ?? ''} placeholder="Provider default" onChange={(event) => updateSetting({ maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })}/><span className="model-settings__hint">Capped automatically at {model.outputTokenLimit.toLocaleString()} for this model.</span></div><div className="model-settings__row"><div className="model-settings__field"><label htmlFor="gemini-seed">Seed</label><input id="gemini-seed" className="model-settings__input" type="number" min={0} step={1} value={geminiSettings.seed ?? ''} placeholder="Provider default" onChange={(event) => updateSetting({ seed: event.target.value ? Number(event.target.value) : undefined })}/></div><div className="model-settings__field"><label htmlFor="gemini-stop">Stop sequences</label><textarea id="gemini-stop" className="model-settings__textarea" value={geminiSettings.stopSequences.join('\n')} placeholder="One sequence per line" onChange={(event) => updateSetting({ stopSequences: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean).slice(0, 5) })}/></div></div><div className="model-settings__field"><span>Thinking summaries</span><div className="model-settings__chips" role="radiogroup" aria-label="Thinking summaries"><button type="button" className={`model-settings__chip${geminiSettings.thinkingSummaries ? ' is-active' : ''}`} role="radio" aria-checked={geminiSettings.thinkingSummaries} onClick={() => updateSetting({ thinkingSummaries: true })}>Auto</button><button type="button" className={`model-settings__chip${!geminiSettings.thinkingSummaries ? ' is-active' : ''}`} role="radio" aria-checked={!geminiSettings.thinkingSummaries} onClick={() => updateSetting({ thinkingSummaries: false })}>Off</button></div></div><div className="model-settings__unsupported">Temperature, top-p and top-k are intentionally not offered here: the current Gemini 3 production guidance recommends removing those sampling controls, and the Interactions generation contract used by Elara does not expose them as model controls.</div>{model.notes && <div className="model-settings__hint">{model.notes}</div>}<div className="model-settings__actions"><button className="model-settings__button model-settings__button--reset" type="button" onClick={() => onResetGeminiSettings()}>Reset to {model.name} defaults</button></div><div className="model-settings__status" role="status">Settings save automatically.</div></div></div>}

          {section === 'chat' && <div className="settings-copy"><span className="panel-kicker">CONVERSATION</span><h2>Chat</h2><p>Startup behaviour, composer preferences, thread naming and conversation presentation will live here as their feature passes land.</p><div className="setting-card"><strong>Gemini transport</strong><span>Protected Worker boundary · provider credential remains server-side</span></div><div className="setting-card"><strong>Startup screen</strong><span>Chat / empty chat · last chat option planned</span></div></div>}

          {section === 'security' && <div className="settings-copy"><span className="panel-kicker">SECURITY</span><h2>API Lockbox</h2><p>The Lockbox is the app's protected configuration boundary. Secrets stay outside the browser UI; this surface reports only safe configuration and service health.</p><WorkerHealthPanel /></div>}
        </section>
      </div>
    </main>
  );
}
