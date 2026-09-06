import { useState } from 'react';
import { z } from 'zod';
import { Icon } from '../../ui/icons';
import { BUILT_IN_FONTS, fontFamilyForCss, googleFontFamilyFromCss2Url, type FontSelection } from '../../ui/fontRegistry';
import { RangeSlider } from './RangeSlider';
import { GeminiGenerationControls } from './GeminiGenerationControls';
import type { PortraitBackground, PortraitScale } from './PortraitBanner';
import type { GeminiSettings } from '../../gemini/settings-engine';
import { getGeminiModel, GEMINI_MODELS } from '../../gemini/model-registry';
import { GeminiApiLockbox } from './GeminiApiLockbox';
import { CharacterSettings } from './CharacterSettings';
import { RoleplaySettings } from './RoleplaySettings';
import { ChatAppearanceSettings } from './ChatAppearanceSettings';
import { GoogleOAuthSettings } from './GoogleOAuthSettings';
import { WorkspaceShortcutSettings } from './WorkspaceShortcutSettings';
import type { CharacterProfile } from '../../domain/character';
import type { ChatAppearancePreferences, RoleplayPreferences } from '../../domain/preferences';
import './model-settings.css';
import './character-settings.css';
import './roleplay-settings.css';
import './chat-appearance-settings.css';
import './google-oauth-settings.css';
import './settings-fixes.css';
import './workspace-shortcut-settings.css';

const settingsSections = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' as const },
  { id: 'character', label: 'Character', icon: 'sparkles' as const },
  { id: 'typography', label: 'Typography', icon: 'type' as const },
  { id: 'model', label: 'Gemini', icon: 'bot' as const },
  { id: 'google', label: 'Google', icon: 'shield' as const },
  { id: 'chat', label: 'Chat', icon: 'message-circle' as const },
  { id: 'roleplay', label: 'Roleplay', icon: 'wand-sparkles' as const },
  { id: 'security', label: 'Lockbox', icon: 'lock-keyhole' as const },
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
  selectedModel,
  geminiSettings,
  onModelChange,
  onGeminiSettingsChange,
  onResetGeminiSettings,
  character,
  onCharacterChange,
  chatAppearance,
  onChatAppearanceChange,
  roleplay,
  onRoleplayChange,
  onBack,
}: {
  font: FontSelection;
  onFontChange: (font: FontSelection) => void;
  fontSize: number;
  onFontSizeChange: (fontSize: number) => void;
  portraitScale: PortraitScale;
  onPortraitScaleChange: ((scale: PortraitScale) => void) | ((scale: 1 | 2 | 3) => void);
  portraitBackground: PortraitBackground;
  onPortraitBackgroundChange: (background: PortraitBackground) => void;
  selectedModel: string;
  geminiSettings: GeminiSettings;
  onModelChange: (model: string) => void;
  onGeminiSettingsChange: (settings: GeminiSettings) => void;
  onResetGeminiSettings: () => void;
  character: CharacterProfile;
  onCharacterChange: (profile: CharacterProfile) => void;
  chatAppearance: ChatAppearancePreferences;
  onChatAppearanceChange: (value: ChatAppearancePreferences) => void;
  roleplay: RoleplayPreferences;
  onRoleplayChange: (value: RoleplayPreferences) => void;
  onBack: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const model = getGeminiModel(selectedModel);
  const applyPortraitScale = onPortraitScaleChange as (scale: PortraitScale) => void;

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

  return (
    <main
      className="settings-screen"
      style={{ fontFamily: fontFamilyForCss(font), '--body-font-size': `${fontSize}px` } as React.CSSProperties}
    >
      <header className="settings-header">
        <button className="icon-button" type="button" aria-label="Back to chat" onClick={onBack}>
          <Icon name="chevron" />
        </button>
        <div>
          <div className="eyebrow">{character.name}</div>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map((item) => (
            <button
              className={`settings-nav__item${section === item.id ? ' is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="settings-panel" aria-live="polite">
          {section === 'appearance' && (
            <div className="settings-copy">
              <span className="panel-kicker">PRESENCE</span>
              <h2>Appearance</h2>
              <p>Character presentation and the independent Android chat backdrop live here.</p>
              <RangeSlider
                id="portrait-scale"
                label="Character presentation scale"
                min={1}
                max={3}
                step={0.5}
                value={portraitScale}
                valueLabel={`${portraitScale}×`}
                minLabel="1×"
                maxLabel="3×"
                onChange={(value) => applyPortraitScale(Math.min(3, Math.max(1, value)) as PortraitScale)}
              />
              <div className="background-picker">
                <div className="background-picker__header">
                  <strong>Character banner ambience</strong>
                  <span>Presentation layer only.</span>
                </div>
                <div className="background-options" role="radiogroup" aria-label="Character banner background">
                  {portraitBackgrounds.map((option) => {
                    const active = portraitBackground === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`background-option background-option--${option.id}${active ? ' is-active' : ''}`}
                        onClick={() => onPortraitBackgroundChange(option.id)}
                      >
                        <span>{option.label}</span>
                        <small>{option.description}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <ChatAppearanceSettings value={chatAppearance} onChange={onChatAppearanceChange} />
            </div>
          )}

          {section === 'character' && (
            <div className="settings-copy">
              <span className="panel-kicker">IDENTITY</span>
              <h2>Character</h2>
              <p>Define the AI identity and soft-coded master behaviour. Tool schemas and application capabilities remain hard-coded and separate.</p>
              <CharacterSettings profile={character} onChange={onCharacterChange} />
            </div>
          )}

          {section === 'typography' && (
            <div className="settings-copy">
              <span className="panel-kicker">TYPE</span>
              <h2>Typography</h2>
              <p>Built-in fonts are locally hosted. Custom Google Fonts remain an explicit opt-in.</p>
              <div className="typography-preview" style={{ fontFamily: fontFamilyForCss(font), fontSize: `${fontSize}px` }}>
                <span className="typography-preview__label">LIVE PREVIEW</span>
                <p>The quick brown fox jumps over the lazy dog.</p>
                <p>0123456789 · Aa Bb Cc · crisp, readable, and ready for chat.</p>
              </div>
              <RangeSlider id="font-size" label="Text size" min={10} max={20} value={fontSize} valueLabel={`${fontSize}px`} onChange={onFontSizeChange} />
              <div className="font-options" role="radiogroup" aria-label="Font family">
                {BUILT_IN_FONTS.map((option) => {
                  const active = font.kind === 'built-in' && font.family === option.family;
                  return (
                    <button
                      key={option.family}
                      className={`font-option${active ? ' is-active' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onFontChange({ kind: 'built-in', family: option.family })}
                      style={{ fontFamily: fontFamilyForCss(option.family) }}
                    >
                      <span>{option.family}</span>
                      <small>The quick brown fox jumps over the lazy dog.</small>
                    </button>
                  );
                })}
                {font.kind === 'custom' && (
                  <button className="font-option is-active" type="button" role="radio" aria-checked="true" style={{ fontFamily: fontFamilyForCss(font) }}>
                    <span>{font.family}</span>
                    <small>Custom Google font · loaded from your CSS2 link.</small>
                  </button>
                )}
              </div>
              <div className="custom-font-card">
                <div>
                  <strong>Add a Google font</strong>
                  <span>Paste the CSS2 stylesheet URL generated by Google Fonts.</span>
                </div>
                <input
                  className="custom-font-input"
                  value={customUrl}
                  onChange={(event) => {
                    setCustomUrl(event.target.value);
                    setCustomError(null);
                  }}
                  placeholder="https://fonts.googleapis.com/css2?family=..."
                  inputMode="url"
                  aria-label="Google Fonts CSS2 URL"
                />
                <button className="custom-font-button" type="button" onClick={applyCustomFont}>Load font</button>
                {customError && <small className="custom-font-error" role="alert">{customError}</small>}
              </div>
            </div>
          )}

          {section === 'model' && (
            <div className="settings-copy">
              <span className="panel-kicker">GEMINI</span>
              <h2>Model & generation</h2>
              <p>The selected production model controls which generation settings are valid. Changes save automatically.</p>
              <div className="model-settings">
                <div className="model-settings__field">
                  <label htmlFor="gemini-model">Model</label>
                  <select id="gemini-model" className="model-settings__select" value={selectedModel} onChange={(event) => onModelChange(event.target.value)}>
                    {GEMINI_MODELS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                  <span className="model-settings__hint">{model.id} · {model.inputTokenLimit.toLocaleString()} input · {model.outputTokenLimit.toLocaleString()} output tokens</span>
                </div>

                <GeminiGenerationControls model={model} settings={geminiSettings} onChange={onGeminiSettingsChange} />

                <div className="model-settings__unsupported">Temperature, top-p and top-k are intentionally not offered here.</div>
                <div className="model-settings__actions">
                  <button className="model-settings__button model-settings__button--reset" type="button" onClick={onResetGeminiSettings}>
                    Reset to {model.name} defaults
                  </button>
                </div>
                <div className="model-settings__status" role="status">Settings save automatically.</div>
              </div>
            </div>
          )}

          {section === 'google' && (
            <div className="settings-copy">
              <span className="panel-kicker">AUTHORIZATION</span>
              <h2>Google</h2>
              <p>Connect Workspace capabilities independently. Authorization state and secrets remain owned by the protected OAuth authority.</p>
              <GoogleOAuthSettings />
              <WorkspaceShortcutSettings />
            </div>
          )}

          {section === 'chat' && (
            <div className="settings-copy">
              <span className="panel-kicker">CONVERSATION</span>
              <h2>Chat</h2>
              <p>Conversation-specific preferences live here as the application grows. Speaker colour and surface controls are in Appearance.</p>
              <div className="setting-card"><strong>Gemini transport</strong><span>Direct browser connection · API key supplied by the local Lockbox</span></div>
              <div className="setting-card"><strong>Startup screen</strong><span>Chat / empty chat · last chat option planned</span></div>
            </div>
          )}

          {section === 'roleplay' && (
            <div className="settings-copy">
              <span className="panel-kicker">CREATIVE CONTEXT</span>
              <h2>Roleplay</h2>
              <p>Roleplay is an explicit fictional/creative context. Its controls are hidden while disabled.</p>
              <RoleplaySettings value={roleplay} onChange={onRoleplayChange} />
            </div>
          )}

          {section === 'security' && (
            <div className="settings-copy">
              <span className="panel-kicker">SECURITY</span>
              <h2>API Lockbox</h2>
              <p>The Gemini API key is encrypted locally with a Lockbox password. It must be unlocked before Gemini can use it.</p>
              <GeminiApiLockbox />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
