import { useRef } from 'react';
import type { CharacterArtworkMode, CharacterProfile } from '../../domain/character';
import { DurableMemorySettings } from './DurableMemorySettings';
import './character-settings.css';

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;
const CONTAINER_RATIOS: Record<CharacterArtworkMode, number> = {
  portrait: 4 / 5,
  landscape: 16 / 6,
};

async function readImage(file: File): Promise<CharacterProfile['artwork']> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error('Use a JPG, PNG, or WebP image.');
  if (file.size > MAX_BYTES) throw new Error('Character artwork must be 8 MB or smaller.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that image.'));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('That file is not a readable image.'));
    image.src = dataUrl;
  });
  return { id: crypto.randomUUID(), mimeType: file.type, name: file.name, width: dimensions.width, height: dimensions.height, dataUrl, focalX: 50, focalY: 50 };
}

function focusAvailability(artwork: NonNullable<CharacterProfile['artwork']>, mode: CharacterArtworkMode) {
  if (!artwork.width || !artwork.height) return { horizontal: true, vertical: true };
  const imageRatio = artwork.width / artwork.height;
  const containerRatio = CONTAINER_RATIOS[mode];
  const tolerance = 0.005;
  return {
    horizontal: imageRatio > containerRatio + tolerance,
    vertical: imageRatio < containerRatio - tolerance,
  };
}

export function CharacterSettings({ profile, onChange }: { profile: CharacterProfile; onChange: (profile: CharacterProfile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      onChange({ ...profile, artwork: await readImage(file) });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not load that image.');
    }
  }

  function setMode(mode: CharacterArtworkMode) {
    onChange({ ...profile, artworkMode: mode, artwork: profile.artwork ? { ...profile.artwork, focalX: 50, focalY: 50 } : null });
  }

  const availability = profile.artwork ? focusAvailability(profile.artwork, profile.artworkMode) : { horizontal: true, vertical: true };
  const previewObjectPosition = profile.artwork
    ? `${availability.horizontal ? profile.artwork.focalX : 50}% ${availability.vertical ? profile.artwork.focalY : 50}%`
    : undefined;

  return <div className="character-settings">
    <div className="setting-card character-card">
      <label className="character-field"><span>Name</span><input value={profile.name} maxLength={80} aria-label="AI character name" onChange={(event) => onChange({ ...profile, name: event.target.value })} /></label>
      <p className="character-hint">This is the character identity presented in the app. It does not change which tools the application exposes.</p>
    </div>

    <div className="setting-card character-card">
      <div className="character-card__heading"><div><strong>Master system prompt</strong><span>Soft-coded character behavior only.</span></div></div>
      <textarea className="character-prompt" value={profile.systemInstruction} aria-label="Master system prompt" spellCheck={false} onChange={(event) => onChange({ ...profile, systemInstruction: event.target.value })} />
      <p className="character-hint">This editor controls identity, personality, style, and durable character guidance. Tool schemas, exposed capabilities, tool-use rules, authorization, confirmation, provider transport, and security remain application-owned code.</p>
    </div>

    <div className="setting-card character-card">
      <div className="character-card__heading"><div><strong>Character artwork</strong><span>Choose one primary presentation mode.</span></div></div>
      <div className="art-mode-switch" role="radiogroup" aria-label="Character artwork mode">
        {(['portrait', 'landscape'] as CharacterArtworkMode[]).map((mode) => <button key={mode} type="button" role="radio" aria-checked={profile.artworkMode === mode} className={profile.artworkMode === mode ? 'is-active' : ''} onClick={() => setMode(mode)}>{mode === 'portrait' ? 'Portrait · 4:5' : 'Landscape · 16:6'}</button>)}
      </div>
      <div className={`artwork-preview artwork-preview--${profile.artworkMode}`}>
        {profile.artwork ? <img src={profile.artwork.dataUrl} alt="Current character artwork" style={{ objectPosition: previewObjectPosition }} /> : <div className="artwork-empty"><span>No artwork selected</span><small>{profile.artworkMode === 'portrait' ? 'Best for compact character/avatar presentation.' : 'Best for the full-width upper banner.'}</small></div>}
      </div>
      <div className="artwork-actions">
        <button type="button" onClick={() => inputRef.current?.click()}>{profile.artwork ? 'Replace image' : 'Upload image'}</button>
        {profile.artwork && <button type="button" className="secondary" onClick={() => onChange({ ...profile, artwork: null })}>Remove</button>}
      </div>
      <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      {profile.artwork && <div className="focal-controls">
        <label className={!availability.horizontal ? 'is-disabled' : undefined}>
          <span>Horizontal focus <strong>{availability.horizontal ? `${profile.artwork.focalX}%` : 'Centered'}</strong></span>
          <input aria-label="Horizontal focus" type="range" min={0} max={100} value={availability.horizontal ? profile.artwork.focalX : 50} disabled={!availability.horizontal} onChange={(event) => onChange({ ...profile, artwork: { ...profile.artwork!, focalX: Number(event.target.value) } })} />
        </label>
        <label className={!availability.vertical ? 'is-disabled' : undefined}>
          <span>Vertical focus <strong>{availability.vertical ? `${profile.artwork.focalY}%` : 'Centered'}</strong></span>
          <input aria-label="Vertical focus" type="range" min={0} max={100} value={availability.vertical ? profile.artwork.focalY : 50} disabled={!availability.vertical} onChange={(event) => onChange({ ...profile, artwork: { ...profile.artwork!, focalY: Number(event.target.value) } })} />
        </label>
      </div>}
      <p className="character-hint">Focus controls follow the source-image and presentation aspect ratios. A centered, disabled control is shown when the image cannot move along that axis.</p>
    </div>

    <div className="setting-card character-card">
      <div className="character-card__heading"><div><strong>Durable memory</strong><span>User-owned notes, separate from conversation history and the Master Prompt.</span></div></div>
      <DurableMemorySettings />
    </div>
  </div>;
}
