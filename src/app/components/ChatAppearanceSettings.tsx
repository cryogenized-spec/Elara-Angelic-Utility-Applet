import { useRef, useState } from 'react';
import type { ChatAppearancePreferences } from '../../domain/preferences';
import './chat-appearance-settings.css';

const GRADIENTS = [
  ['midnight', 'Midnight'],
  ['violet', 'Violet'],
  ['rose', 'Rose'],
] as const;

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ACCEPTED_IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|avif)$/i;
const MAX_BACKGROUND_BYTES = 4 * 1024 * 1024;

function normaliseHex(value: string, fallback: string): string { return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback; }

export function ChatAppearanceSettings({ value, onChange }: { value: ChatAppearancePreferences; onChange: (value: ChatAppearancePreferences) => void }) {
  const backgroundInput = useRef<HTMLInputElement>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  function patch(patchValue: Partial<ChatAppearancePreferences>) { onChange({ ...value, ...patchValue }); }

  function handleBackground(file?: File) {
    setBackgroundError(null);
    if (!file) return;
    const typeSupported = ACCEPTED_IMAGE_TYPES.has(file.type) || (!file.type && ACCEPTED_IMAGE_EXTENSIONS.test(file.name));
    if (!typeSupported) {
      setBackgroundError('Use a JPG, PNG, WebP, or AVIF image.');
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      setBackgroundError('Background images must be 4 MB or smaller.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
        setBackgroundError('Could not read that image. Please choose another file.');
        return;
      }
      patch({ chatBackgroundMode: 'image', chatBackgroundValue: reader.result });
    };
    reader.onerror = () => setBackgroundError('Could not read that image. Please choose another file.');
    reader.readAsDataURL(file);
  }

  return <div className="chat-appearance-settings">
    <div className="setting-card appearance-card">
      <strong>Chat background</strong><span>Independent of the character artwork. The presentation is designed around the 9:16 Android canvas.</span>
      <div className="appearance-segment" role="radiogroup" aria-label="Chat background mode">
        {(['solid','gradient','image'] as const).map((mode) => <button key={mode} type="button" className={value.chatBackgroundMode === mode ? 'is-active' : ''} role="radio" aria-checked={value.chatBackgroundMode === mode} onClick={() => { setBackgroundError(null); patch({ chatBackgroundMode: mode }); }}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
      </div>
      {value.chatBackgroundMode === 'solid' && <label className="colour-field"><span>Background colour</span><div><input type="color" aria-label="Chat background colour" value={normaliseHex(value.chatBackgroundValue, '#050507')} onChange={(event) => patch({ chatBackgroundValue: event.target.value.toUpperCase() })}/><input value={value.chatBackgroundValue} maxLength={7} aria-label="Chat background hex" onChange={(event) => patch({ chatBackgroundValue: event.target.value })} onBlur={() => patch({ chatBackgroundValue: normaliseHex(value.chatBackgroundValue, '#050507') })}/></div></label>}
      {value.chatBackgroundMode === 'gradient' && <div className="gradient-options">{GRADIENTS.map(([id,label]) => <button key={id} type="button" className={value.chatBackgroundValue === id ? 'is-active' : ''} onClick={() => patch({ chatBackgroundValue: id })}>{label}</button>)}</div>}
      {value.chatBackgroundMode === 'image' && <>
        <button className="upload-button" type="button" onClick={() => backgroundInput.current?.click()}>Choose background image</button>
        <input ref={backgroundInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => { handleBackground(event.target.files?.[0]); event.currentTarget.value = ''; }}/>
        {backgroundError && <small className="custom-font-error" role="alert">{backgroundError}</small>}
      </>}
      <label className="setting-range"><span>Background opacity</span><input aria-label="Background opacity" type="range" min={0} max={1} step={0.01} value={value.chatBackgroundOpacity} onChange={(event) => patch({ chatBackgroundOpacity: Number(event.target.value) })}/><output>{Math.round(value.chatBackgroundOpacity * 100)}%</output></label>
      <label className="setting-range"><span>Readability overlay</span><input aria-label="Readability overlay" type="range" min={0} max={0.9} step={0.01} value={value.chatBackgroundOverlay} onChange={(event) => patch({ chatBackgroundOverlay: Number(event.target.value) })}/><output>{Math.round(value.chatBackgroundOverlay * 100)}%</output></label>
      <label className="setting-range"><span>Background blur</span><input aria-label="Background blur" type="range" min={0} max={24} step={1} value={value.chatBackgroundBlur} onChange={(event) => patch({ chatBackgroundBlur: Number(event.target.value) })}/><output>{value.chatBackgroundBlur}px</output></label>
    </div>
    <div className="setting-card appearance-card">
      <strong>Elara messages</strong><span>Independent assistant text colour.</span>
      <label className="colour-field"><span>Text colour</span><div><input type="color" aria-label="Elara text colour" value={normaliseHex(value.assistantTextColor, '#F7F8FF')} onChange={(event) => patch({ assistantTextColor: event.target.value.toUpperCase() })}/><input aria-label="Elara text colour hex" value={value.assistantTextColor} maxLength={7} onChange={(event) => patch({ assistantTextColor: event.target.value })} onBlur={() => patch({ assistantTextColor: normaliseHex(value.assistantTextColor, '#F7F8FF') })}/></div></label>
      <label className="checkbox-line"><input type="checkbox" checked={value.assistantGlow} onChange={(event) => patch({ assistantGlow: event.target.checked })}/><span>Subtle assistant glow</span></label>
    </div>
    <div className="setting-card appearance-card">
      <strong>User messages</strong><span>Separate text and surface styling.</span>
      <label className="colour-field"><span>Text colour</span><div><input type="color" aria-label="User text colour" value={normaliseHex(value.userTextColor, '#F7F8FF')} onChange={(event) => patch({ userTextColor: event.target.value.toUpperCase() })}/><input aria-label="User text colour hex" value={value.userTextColor} maxLength={7} onChange={(event) => patch({ userTextColor: event.target.value })} onBlur={() => patch({ userTextColor: normaliseHex(value.userTextColor, '#F7F8FF') })}/></div></label>
      <label className="colour-field"><span>Surface colour</span><div><input type="color" aria-label="User surface colour" value={normaliseHex(value.userSurfaceColor, '#28344F')} onChange={(event) => patch({ userSurfaceColor: event.target.value.toUpperCase() })}/><input aria-label="User surface colour hex" value={value.userSurfaceColor} maxLength={7} onChange={(event) => patch({ userSurfaceColor: event.target.value })} onBlur={() => patch({ userSurfaceColor: normaliseHex(value.userSurfaceColor, '#28344F') })}/></div></label>
      <div className="appearance-segment" role="radiogroup" aria-label="User message surface style">{(['solid','frosted','gradient'] as const).map((style) => <button key={style} type="button" className={value.userSurfaceStyle === style ? 'is-active' : ''} role="radio" aria-checked={value.userSurfaceStyle === style} onClick={() => patch({ userSurfaceStyle: style })}>{style[0].toUpperCase() + style.slice(1)}</button>)}</div>
      <label className="setting-range"><span>Surface opacity</span><input aria-label="Surface opacity" type="range" min={0.2} max={1} step={0.01} value={value.userSurfaceOpacity} onChange={(event) => patch({ userSurfaceOpacity: Number(event.target.value) })}/><output>{Math.round(value.userSurfaceOpacity * 100)}%</output></label>
    </div>
  </div>;
}
