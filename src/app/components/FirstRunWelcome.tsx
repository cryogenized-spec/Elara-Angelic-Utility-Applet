import { useState } from 'react';
import type { CharacterProfile } from '../../domain/character';
import { Icon } from '../../ui/icons';
import './first-run-welcome.css';

type FirstRunWelcomeProps = {
  character: CharacterProfile;
  onSaveCharacter: (profile: CharacterProfile) => Promise<void>;
  onComplete: () => Promise<void>;
};

export function FirstRunWelcome({ character, onSaveCharacter, onComplete }: FirstRunWelcomeProps) {
  const [systemInstruction, setSystemInstruction] = useState(character.systemInstruction);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(usePrompt: boolean): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (usePrompt) {
        await onSaveCharacter({ ...character, systemInstruction });
      }
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not finish onboarding.');
      setSaving(false);
    }
  }

  return (
    <div className="first-run" role="presentation">
      <div className="first-run__backdrop" aria-hidden="true" />
      <section className="first-run__panel" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <div className="first-run__crest" aria-hidden="true"><Icon name="sparkles" size={22} /></div>
        <span className="first-run__eyebrow">FIRST AWAKENING</span>
        <h1 id="first-run-title">Welcome.</h1>
        <p className="first-run__intro">This is your space for conversation, character, and creative work. The Character Master is yours to define — nothing is added unless you choose it.</p>

        <label className="first-run__label" htmlFor="first-run-master-prompt">Your Master Prompt</label>
        <p className="first-run__hint">Optional. Add the character, personality, behaviour, or rules you want used when you chat. You can change it later in Settings → Character.</p>
        <textarea
          id="first-run-master-prompt"
          className="first-run__textarea"
          value={systemInstruction}
          onChange={(event) => setSystemInstruction(event.target.value)}
          placeholder="Write your own instructions here…"
          disabled={saving}
          spellCheck="true"
        />

        {error && <div className="first-run__error" role="alert">{error}</div>}

        <div className="first-run__actions">
          <button className="first-run__primary" type="button" onClick={() => void finish(true)} disabled={saving}>
            {saving ? 'Opening…' : 'Enter'}
          </button>
          <button className="first-run__secondary" type="button" onClick={() => void finish(false)} disabled={saving}>
            Start empty
          </button>
        </div>
      </section>
    </div>
  );
}
