import { useEffect, useState } from 'react';
import { Icon } from '../../ui/icons';
import { ensureGoogleFont, fontFamilyForCss, GOOGLE_FONT_OPTIONS, type GoogleFontFamily } from '../../ui/fontLoader';

const settingsSections = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' as const },
  { id: 'typography', label: 'Typography', icon: 'type' as const },
  { id: 'security', label: 'API Lockbox', icon: 'shield' as const },
  { id: 'chat', label: 'Chat', icon: 'chat' as const },
] as const;

type SettingsSection = typeof settingsSections[number]['id'];

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [font, setFont] = useState<GoogleFontFamily>('Inter');

  useEffect(() => { void ensureGoogleFont(font); }, [font]);

  return (
    <main className="settings-screen">
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
            <div className="settings-copy"><span className="panel-kicker">SURFACE</span><h2>Appearance</h2><p>Control the ambient visual language without touching Elara's character definition.</p><div className="setting-card"><strong>Theme</strong><span>Dark · current design baseline</span></div></div>
          )}
          {section === 'typography' && (
            <div className="settings-copy"><span className="panel-kicker">TYPE</span><h2>Typography</h2><p>Fonts are loaded from Google's CSS2 web-font service and selected at runtime. The browser handles normal HTTP caching; a system fallback remains available during load.</p>
              <div className="font-options" role="radiogroup" aria-label="Font family">
                {(Object.values(GOOGLE_FONT_OPTIONS)).map((option) => (
                  <button key={option} className={`font-option${font === option ? ' is-active' : ''}`} type="button" role="radio" aria-checked={font === option} onClick={() => setFont(option)} style={{ fontFamily: fontFamilyForCss(option) }}>
                    <span>{option}</span><small>The quick brown fox jumps over the lazy dog.</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {section === 'security' && (
            <div className="settings-copy"><span className="panel-kicker">SECURITY</span><h2>API Lockbox</h2><p>The home for credential state and security diagnostics. Secrets remain outside presentation code and are never exposed through model-visible schemas.</p><div className="setting-card setting-card--security"><Icon name="shield" size={21}/><div><strong>Lockbox status</strong><span>Not configured in this UI foundation pass</span></div></div></div>
          )}
          {section === 'chat' && (
            <div className="settings-copy"><span className="panel-kicker">CONVERSATION</span><h2>Chat</h2><p>Startup behaviour, composer preferences, thread naming and conversation presentation will live here as their feature passes land.</p><div className="setting-card"><strong>Startup screen</strong><span>Chat / empty chat · last chat option planned</span></div></div>
          )}
        </section>
      </div>
    </main>
  );
}
