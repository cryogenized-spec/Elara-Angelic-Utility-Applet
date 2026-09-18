import { useRef, useState } from 'react';
import { MEDIA_PLAYER_SURFACE_PRESETS, type ChatAppearancePreferences, type MediaPlayerSurfacePreset } from '../../domain/preferences';
import { HexColourField } from './HexColourField';
import './chat-appearance-settings.css';

const GRADIENTS = [
  ['midnight', 'Midnight'],
  ['violet', 'Violet'],
  ['rose', 'Rose'],
] as const;

const MEDIA_PLAYER_PRESET_LABELS: Record<MediaPlayerSurfacePreset, string> = {
  minimal: 'Minimal',
  glass: 'Glass',
  cinema: 'Cinema',
};

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ACCEPTED_IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|avif)$/i;
const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024;
const MAX_BACKGROUND_DIMENSION = 1920;
const MAX_BACKGROUND_DATA_URL_LENGTH = 5_800_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that image.'));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be decoded by this browser.'));
    image.src = dataUrl;
  });
}

async function prepareBackgroundImage(file: File): Promise<string> {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestSide > MAX_BACKGROUND_DIMENSION ? MAX_BACKGROUND_DIMENSION / longestSide : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare that image for the chat background.');
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.84, 0.74, 0.64, 0.54]) {
    const encoded = canvas.toDataURL('image/webp', quality);
    if (encoded.length <= MAX_BACKGROUND_DATA_URL_LENGTH) return encoded;
  }

  throw new Error('That image is too large to store safely. Please choose a smaller image.');
}

export function ChatAppearanceSettings({ value, onChange }: { value: ChatAppearancePreferences; onChange: (value: ChatAppearancePreferences) => void }) {
  const backgroundInput = useRef<HTMLInputElement>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  function patch(patchValue: Partial<ChatAppearancePreferences>) { onChange({ ...value, ...patchValue }); }

  async function handleBackground(file?: File) {
    setBackgroundError(null);
    if (!file) return;
    const typeSupported = file.type.startsWith('image/') || ACCEPTED_IMAGE_TYPES.has(file.type) || ACCEPTED_IMAGE_EXTENSIONS.test(file.name);
    if (!typeSupported) {
      setBackgroundError('Choose an image file from your device.');
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      setBackgroundError('Background images must be 12 MB or smaller.');
      return;
    }

    setBackgroundBusy(true);
    try {
      const dataUrl = await prepareBackgroundImage(file);
      patch({ chatBackgroundMode: 'image', chatBackgroundValue: dataUrl });
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : 'Could not load that image.');
    } finally {
      setBackgroundBusy(false);
    }
  }

  return <div className="chat-appearance-settings">
    <div className="setting-card appearance-card">
      <strong>Chat background</strong><span>Independent of the character artwork. The presentation is designed around the 9:16 Android canvas.</span>
      <div className="appearance-segment" role="radiogroup" aria-label="Chat background mode">
        {(['solid','gradient','image'] as const).map((mode) => <button key={mode} type="button" className={value.chatBackgroundMode === mode ? 'is-active' : ''} role="radio" aria-checked={value.chatBackgroundMode === mode} onClick={() => { setBackgroundError(null); patch({ chatBackgroundMode: mode }); }}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
      </div>
      {value.chatBackgroundMode === 'solid' && <HexColourField label="Background colour" colourAriaLabel="Chat background colour" hexAriaLabel="Chat background hex" value={value.chatBackgroundValue} fallback="#050507" onCommit={(chatBackgroundValue) => patch({ chatBackgroundValue })} />}
      {value.chatBackgroundMode === 'gradient' && <div className="gradient-options">{GRADIENTS.map(([id,label]) => <button key={id} type="button" className={value.chatBackgroundValue === id ? 'is-active' : ''} onClick={() => patch({ chatBackgroundValue: id })}>{label}</button>)}</div>}
      {value.chatBackgroundMode === 'image' && <>
        <button className="upload-button" type="button" disabled={backgroundBusy} onClick={() => backgroundInput.current?.click()}>{backgroundBusy ? 'Preparing background…' : 'Choose background image'}</button>
        <input ref={backgroundInput} hidden type="file" accept="image/*" onChange={(event) => { void handleBackground(event.target.files?.[0]); event.currentTarget.value = ''; }}/>
        {backgroundError && <small className="custom-font-error" role="alert">{backgroundError}</small>}
      </>}
      <label className="setting-range"><span>Background opacity</span><input aria-label="Background opacity" type="range" min={0} max={1} step={0.01} value={value.chatBackgroundOpacity} onChange={(event) => patch({ chatBackgroundOpacity: Number(event.target.value) })}/><output>{Math.round(value.chatBackgroundOpacity * 100)}%</output></label>
      <label className="setting-range"><span>Readability overlay</span><input aria-label="Readability overlay" type="range" min={0} max={0.9} step={0.01} value={value.chatBackgroundOverlay} onChange={(event) => patch({ chatBackgroundOverlay: Number(event.target.value) })}/><output>{Math.round(value.chatBackgroundOverlay * 100)}%</output></label>
      <label className="setting-range"><span>Background blur</span><input aria-label="Background blur" type="range" min={0} max={24} step={1} value={value.chatBackgroundBlur} onChange={(event) => patch({ chatBackgroundBlur: Number(event.target.value) })}/><output>{value.chatBackgroundBlur}px</output></label>
    </div>
    <div className="setting-card appearance-card">
      <strong>Elara messages</strong><span>Independent assistant text colour.</span>
      <HexColourField label="Text colour" colourAriaLabel="Elara text colour" hexAriaLabel="Elara text colour hex" value={value.assistantTextColor} fallback="#F7F8FF" onCommit={(assistantTextColor) => patch({ assistantTextColor })} />
      <label className="checkbox-line"><input type="checkbox" checked={value.assistantGlow} onChange={(event) => patch({ assistantGlow: event.target.checked })}/><span>Subtle assistant glow</span></label>
    </div>
    <div className="setting-card appearance-card">
      <strong>Generation activity</strong><span>Accent colour for Thinking, tools, timing and reasoning summaries.</span>
      <HexColourField label="Activity accent" colourAriaLabel="Generation activity accent colour" hexAriaLabel="Generation activity accent hex" value={value.generationActivityAccent} fallback="#6EA8FF" onCommit={(generationActivityAccent) => patch({ generationActivityAccent })} />
    </div>
    <div className="setting-card appearance-card">
      <strong>Media player</strong><span>Styles only Elara's shell around the official YouTube player. Native YouTube controls and the iframe remain untouched.</span>
      <div className="appearance-segment" role="radiogroup" aria-label="Media player surface preset">
        {MEDIA_PLAYER_SURFACE_PRESETS.map((preset) => <button key={preset} type="button" className={value.mediaPlayerSurfacePreset === preset ? 'is-active' : ''} role="radio" aria-checked={value.mediaPlayerSurfacePreset === preset} onClick={() => patch({ mediaPlayerSurfacePreset: preset })}>{MEDIA_PLAYER_PRESET_LABELS[preset]}</button>)}
      </div>
    </div>
    <div className="setting-card appearance-card">
      <strong>User messages</strong><span>Separate text and surface styling.</span>
      <HexColourField label="Text colour" colourAriaLabel="User text colour" hexAriaLabel="User text colour hex" value={value.userTextColor} fallback="#F7F8FF" onCommit={(userTextColor) => patch({ userTextColor })} />
      <HexColourField label="Surface colour" colourAriaLabel="User surface colour" hexAriaLabel="User surface colour hex" value={value.userSurfaceColor} fallback="#28344F" onCommit={(userSurfaceColor) => patch({ userSurfaceColor })} />
      <div className="appearance-segment" role="radiogroup" aria-label="User message surface style">{(['solid','frosted','gradient'] as const).map((style) => <button key={style} type="button" className={value.userSurfaceStyle === style ? 'is-active' : ''} role="radio" aria-checked={value.userSurfaceStyle === style} onClick={() => patch({ userSurfaceStyle: style })}>{style[0].toUpperCase() + style.slice(1)}</button>)}</div>
      <label className="setting-range"><span>Surface opacity</span><input aria-label="Surface opacity" type="range" min={0.2} max={1} step={0.01} value={value.userSurfaceOpacity} onChange={(event) => patch({ userSurfaceOpacity: Number(event.target.value) })}/><output>{Math.round(value.userSurfaceOpacity * 100)}%</output></label>
    </div>
  </div>;
}
