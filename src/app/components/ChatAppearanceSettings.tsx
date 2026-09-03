import { useRef } from 'react';
import type { ChatAppearancePreferences } from '../../domain/preferences';
import './chat-appearance-settings.css';

const GRADIENTS = [
  ['midnight', 'Midnight'],
  ['violet', 'Violet'],
  ['rose', 'Rose'],
] as const;

function normaliseHex(value: string, fallback: string): string { return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback; }

export function ChatAppearanceSettings({ value, onChange }: { value: ChatAppearancePreferences; onChange: (value: ChatAppearancePreferences) => void }) {
  const backgroundInput = useRef<HTMLInputElement>(null);
  function patch(patchValue: Partial<ChatAppearancePreferences>) { onChange({ ...value, ...patchValue }); }
  function handleBackground(file?: File) {
    if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') patch({ chatBackgroundMode: 'image', chatBackgroundValue: reader.result }); };
    reader.readAsDataURL(file);
  }
  return <div className="chat-appearance-settings">
    <div className="setting-card appearance-card">
      <strong>Chat background</strong><span>Independent of the character artwork. The presentation is designed around the 9:16 Android canvas.</span>
      <div className="appearance-segment" role="radiogroup" aria-label="Chat background mode">
        {(['solid','gradient','image'] as const).map((mode) => <button key={mode} type="button" className={value.chatBackgroundMode === mode ? 'is-active' : ''} role="radio" aria-checked={value.chatBackgroundMode === mode} onClick={() => patch({ chatBackgroundMode: mode })}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
      </div>
      {value.chatBackgroundMode === 'solid' && <label className="colour-field"><span>Background colour</span><div><input type="color" aria-label="Chat background colour" value={normaliseHex(value.chatBackgroundValue, '#050507')} onChange={(event) => patch({ chatBackgroundValue: event.target.value.toUpperCase() })}/><input value={value.chatBackgroundValue} maxLength={7} aria-label="Chat background hex" onChange={(event) => patch({ chatBackgroundValue: event.target.value })} onBlur={() => patch({ chatBackgroundValue: normaliseHex(value.chatBackgroundValue, '#050507') })}/></div></label>}
      {value.chatBackgroundMode === 'gradient' && <div className="gradient-options">{GRADIENTS.map(([id,label]) => <button key={id} type="button" className={value.chatBackgroundValue === id ? 'is-active' : ''} onClick={() => patch({ chatBackgroundValue: id })}>{label}</button>)}</div>}
      {value.chatBackgroundMode === 'image' && <><button className="upload-button" type="button" onClick={() => backgroundInput.current?.click()}>Choose background image</button><input ref={backgroundInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { handleBackground(event.target.files?.[0]); event.currentTarget.value = ''; }}/></>}
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
