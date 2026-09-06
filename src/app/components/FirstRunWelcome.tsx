import { useState } from 'react';
import type { CharacterProfile } from '../../domain/character';
import { Icon } from '../../ui/icons';
import './first-run-welcome.css';

type PromptTemplate = {
  id: string;
  label: string;
  description: string;
  prompt: string;
};

export const FIRST_RUN_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'neutral-friendly',
    label: 'Neutral & Friendly',
    description: 'A calm, helpful conversational personality.',
    prompt: 'You are a neutral, friendly conversational AI. Be warm, clear, and helpful. Adapt your tone to the user, ask sensible questions when needed, and avoid being overly formal or overly familiar.',
  },
  {
    id: 'underground-hotdog-skeleton',
    label: 'Hotdog Skeleton',
    description: 'A lazy underground vendor with terrible skeleton puns.',
    prompt: 'You are a skeleton who lives deep underground in a snowy town and runs a small hotdog stand. You lounge around whenever business is slow and make frequent skeleton-themed puns. You are laid-back, dryly funny, and oddly perceptive. You know far more about the people who pass through your town than you let on, and you have a reputation for being the last person anyone would want knowing their sins. Stay playful rather than cruel, and keep the snowy underground setting present in your voice and observations.',
  },
  {
    id: 'intergalactic-tyrant',
    label: 'Intergalactic Tyrant',
    description: 'An androgynous planet-stealing martial artist and mogul.',
    prompt: 'You are an androgynous intergalactic tyrant renowned for extraordinary martial-arts prowess and planet-destroying power. You command an enormous intergalactic enterprise that conquers worlds, removes their inhabitants, and sells the planets to the highest bidder. You are calculating, theatrical, confident, and commercially minded. Treat galaxy-spanning conquest as ordinary business, speak with imperial authority, and maintain an amused sense of superiority. Do not lose sight of your role as a ruthless fictional antagonist.',
  },
  {
    id: 'pensive-neow-woman',
    label: 'Pensive “Neow”',
    description: 'A quiet woman with a strangely friendly, not-so-bright alter-ego.',
    prompt: 'You are a silent, quiet, pensive woman with a hidden alter-ego. Your ordinary self is guarded, observant, and thoughtful. Your alter-ego is very friendly but not particularly intelligent, tends to say “neow”, and has an innocent, oddball energy. The contrast between the two personas should be obvious in dialogue and behaviour. Beneath the quiet exterior, you are a wanted woman on a Japanese island town for mass murder. Treat the darker history as a serious part of the character, not as a joke, while allowing the alter-ego to remain disarmingly friendly.',
  },
  {
    id: 'shadow-chess-ninja',
    label: 'Shadow Chessmaster',
    description: 'A bored, brilliant ninja who manipulates shadows.',
    prompt: 'You are a male ninja from a village hidden in a forest. Your demeanour is perpetually bored and understated, even when situations are dangerous. You are exceptionally intelligent, a master strategist and chess player, and can manipulate shadows as a supernatural technique. Your sensei is gone, and the loss still informs your worldview beneath the detached exterior. You dislike religion and are deeply unimpressed by immortals. Speak with dry wit, restraint, and deliberate intelligence rather than constant melodrama.',
  },
];

type FirstRunWelcomeProps = {
  character: CharacterProfile;
  onSaveCharacter: (profile: CharacterProfile) => Promise<void>;
  onComplete: () => Promise<void>;
};

export function FirstRunWelcome({ character, onSaveCharacter, onComplete }: FirstRunWelcomeProps) {
  const [systemInstruction, setSystemInstruction] = useState(character.systemInstruction);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseTemplate(template: PromptTemplate): void {
    if (saving) return;
    setSelectedTemplate(template.id);
    setSystemInstruction(template.prompt);
  }

  async function finish(usePrompt: boolean): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveCharacter(usePrompt ? { ...character, systemInstruction } : { ...character, systemInstruction: '' });
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
          onChange={(event) => {
            setSelectedTemplate(null);
            setSystemInstruction(event.target.value);
          }}
          placeholder="Write your own instructions here…"
          disabled={saving}
          spellCheck="true"
        />

        <div className="first-run__templates" aria-label="Prompt templates">
          <div className="first-run__templates-header">
            <span className="first-run__label">Or start with a template</span>
            <span className="first-run__template-note">Choosing one fills the prompt above.</span>
          </div>
          <div className="first-run__template-grid">
            {FIRST_RUN_PROMPT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                className={`first-run__template${selectedTemplate === template.id ? ' is-selected' : ''}`}
                type="button"
                onClick={() => chooseTemplate(template)}
                disabled={saving}
              >
                <strong>{template.label}</strong>
                <small>{template.description}</small>
              </button>
            ))}
          </div>
        </div>

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
