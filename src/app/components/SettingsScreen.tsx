import { useState } from 'react';
import { z } from 'zod';
import { Icon } from '../../ui/icons';
import { BUILT_IN_FONTS, fontFamilyForCss, googleFontFamilyFromCss2Url, type FontSelection } from '../../ui/fontRegistry';
import { RangeSlider } from './RangeSlider';
import type { PortraitBackground, PortraitScale } from './PortraitBanner';

const settingsSections = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' as const },
  { id: 'typography', label: 'Typography', icon: 'type' as const },
  { id: 'security', label: 'API Lockbox', icon: 'shield' as const },
  { id: 'chat', label: 'Chat', icon: 'chat' as const },
] as const;

type SettingsSection = typeof settingsSections[number]['id'];

const css2UrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2';
  } catch {
    return false;
  }
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
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheetUrl;
  link.dataset.elaraCustomFont = stylesheetUrl;
  document.head.appendChild(link);
}

export function SettingsScreen({
  font,
  onFontChange,
  fontSize,
  onFontSizeChange,
  portraitScale,
  onPortraitScaleChange,
  portraitBackground,
  onPortraitBackgroundChange,
  geminiApiConfigured,
  onSaveGeminiApiKey,
  onClearGeminiApiKey,
  onBack,
}: {
  font: FontSelection;
  onFontChange: (font: FontSelection) => void;
  fontSize: number;
  onFontSizeChange: (fontSize: number) => void;
  portraitScale: PortraitScale;
  onPortraitScaleChange: (scale: PortraitScale) => void;
  portraitBackground: PortraitBackground;
  onPortraitBackgroundChange: (background: PortraitBackground) => void;
  geminiApiConfigured: boolean;
  onSaveGeminiApiKey: (apiKey: string) => Promise<void>;
  onClearGeminiApiKey: () => Promise<void>;
  onBack: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [lockboxBusy, setLockboxBusy] = useState(false);
  const [lockboxMessage, setLockboxMessage] = useState<string | null>(null);

  function applyCustomFont() {
    setCustomError(null);
    const parsed = css2UrlSchema.safeParse(customUrl.trim());
    if (!parsed.success) {
      setCustomError('Paste a valid Google Fonts CSS2 URL.');
      return;
    }

    const family = googleFontFamilyFromCss2Url(parsed.data);
    if (!family) {
      setCustomError('That link does not contain a readable Google font family.');
      return;
    }

    loadCustomGoogleFont(parsed.data);
    onFontChange({ kind: 'custom', family, stylesheetUrl: parsed.data });
  }

  async function saveKey() {
    setLockboxMessage(null);
    if (!geminiApiKey.trim()) {
      setLockboxMessage('Enter a Gemini API key first.');
      return;
    }
    setLockboxBusy(true);
    try {
      await onSaveGeminiApiKey(geminiApiKey);
      setGeminiApiKey('');
      setLockboxMessage('Gemini API key saved to the local Lockbox.');
    } catch (cause) {
      setLockboxMessage(cause instanceof Error ? cause.message : 'Could not save the Gemini API key.');
    } finally {
      setLockboxBusy(false);
    }
  }

  async function clearKey() {
    setLockboxMessage(null);
    setLockboxBusy(true);
    try {
      await onClearGeminiApiKey();
      setGeminiApiKey('');
      setLockboxMessage('Gemini API key removed from the local Lockbox.');
    } catch (cause) {
      setLockboxMessage(cause instanceof Error ? cause.message : 'Could not clear the Gemini API key.');
    } finally {
      setLockboxBusy(false);
    }
  }

  return (
    <main className="settings-screen" style={{ fontFamily: fontFamilyForCss(font), '--body-font-size': `${fontSize}px` } as React.CSSProperties}>
      <header className="settings-header">
        <button className="icon-button" type="button" aria-label="Back to chat" onClick={onBack}><Icon name="chevron" /></button>
        <div><div className="eyebrow">ELARA</div><h1>Settings</h1></div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map((item) => (
            <button className={`settings-nav__item${section === item.id ? ' is-active' : ''}`} key={item.id} type="button" onClick={() => setSection(item.id)}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="settings-panel" aria-live="polite">
          {section === 'appearance' && (
            <div className="settings-copy">
              <span className="panel-kicker">PRESENCE</span>
              <h2>Elara presentation</h2>
              <p>The portrait is a presentation layer. Its scale and ambient treatment are independent of Elara's character definition.</p>
              <RangeSlider id="portrait-scale" label="Portrait scale" min={1} max={3} value={portraitScale} valueLabel={`${portraitScale}×`} minLabel="1×" maxLabel="3×" onChange={(value) => onPortraitScaleChange(Math.min(3, Math.max(1, value)) as PortraitScale)} />
              <div className="background-picker">
                <div className="background-picker__header"><strong>Banner background</strong><span>Ambient backdrop only · does not change the portrait asset.</span></div>
                <div className="background-options" role="radiogroup" aria-label="Portrait background">
                  {portraitBackgrounds.map((option) => {
                    const active = portraitBackground === option.id;
                    return <button key={option.id} type="button" role="radio" aria-checked={active} className={`background-option background-option--${option.id}${active ? ' is-active' : ''}`} onClick={() => onPortraitBackgroundChange(option.id)}><span>{option.label}</span><small>{option.description}</small></button>;
                  })}
                </div>
              </div>
            </div>
          )}

          {section === 'typography' && (
            <div className="settings-copy">
              <span className="panel-kicker">TYPE</span>
              <h2>Typography</h2>
              <p>Built-in fonts are shipped as locally hosted, Latin-subset WOFF2 assets. Custom Google Fonts remain an explicit opt-in link and are loaded only when you add one.</p>
              <div className="typography-preview" style={{ fontFamily: fontFamilyForCss(font), fontSize: `${fontSize}px` }}><span className="typography-preview__label">LIVE PREVIEW</span><p>The quick brown fox jumps over the lazy dog.</p><p>0123456789 · Aa Bb Cc · crisp, readable, and ready for chat.</p></div>
              <RangeSlider id="font-size" label="Text size" min={10} max={20} value={fontSize} valueLabel={`${fontSize}px`} onChange={onFontSizeChange} />
              <div className="font-options" role="radiogroup" aria-label="Font family">
                {BUILT_IN_FONTS.map((option) => { const active = font.kind === 'built-in' && font.family === option.family; return <button key={option.family} className={`font-option${active ? ' is-active' : ''}`} type="button" role="radio" aria-checked={active} onClick={() => onFontChange({ kind: 'built-in', family: option.family })} style={{ fontFamily: fontFamilyForCss(option.family) }}><span>{option.family}</span><small>The quick brown fox jumps over the lazy dog.</small></button>; })}
                {font.kind === 'custom' && <button className="font-option is-active" type="button" role="radio" aria-checked="true" style={{ fontFamily: fontFamilyForCss(font) }}><span>{font.family}</span><small>Custom Google font · loaded from your CSS2 link.</small></button>}
              </div>
              <div className="custom-font-card"><div><strong>Add a Google font</strong><span>Paste the CSS2 stylesheet URL generated by Google Fonts.</span></div><input className="custom-font-input" value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setCustomError(null); }} placeholder="https://fonts.googleapis.com/css2?family=..." inputMode="url" aria-label="Google Fonts CSS2 URL"/><button className="custom-font-button" type="button" onClick={applyCustomFont}>Load font</button>{customError && <small className="custom-font-error" role="alert">{customError}</small>}</div>
            </div>
          )}

          {section === 'security' && (
            <div className="settings-copy">
              <span className="panel-kicker">SECURITY</span>
              <h2>API Lockbox</h2>
              <p>Your Gemini key is stored locally in an encrypted IndexedDB record and is never rendered into ordinary chat state, diagnostics, or model-visible data. This is a user-supplied BYOK credential; the future Worker boundary can replace the transport without changing this UI.</p>
              <div className="setting-card setting-card--security">
                <Icon name="shield" size={21}/>
                <div><strong>{geminiApiConfigured ? 'Gemini key configured' : 'Gemini key not configured'}</strong><span>{geminiApiConfigured ? 'A key is present in the local Lockbox.' : 'Add a key below to enable live Gemini chat.'}</span></div>
              </div>
              <div className="lockbox-form">
                <label htmlFor="gemini-api-key">Gemini API key</label>
                <input id="gemini-api-key" className="custom-font-input" type="password" value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder={geminiApiConfigured ? 'Enter a replacement key' : 'Paste your Gemini API key'} autoComplete="off" spellCheck={false} />
                <div className="lockbox-actions"><button className="custom-font-button" type="button" onClick={() => void saveKey()} disabled={lockboxBusy}>{lockboxBusy ? 'Saving…' : 'Save key'}</button>{geminiApiConfigured && <button className="lockbox-clear" type="button" onClick={() => void clearKey()} disabled={lockboxBusy}>Clear key</button>}</div>
                {lockboxMessage && <small className="custom-font-error" role="status">{lockboxMessage}</small>}
              </div>
            </div>
          )}

          {section === 'chat' && (
            <div className="settings-copy"><span className="panel-kicker">CONVERSATION</span><h2>Chat</h2><p>Startup behaviour, composer preferences, thread naming and conversation presentation will live here as their feature passes land.</p><div className="setting-card"><strong>Startup screen</strong><span>Chat / empty chat · last chat option planned</span></div></div>
          )}
        </section>
      </div>
    </main>
  );
}
