import { useEffect, useRef, useState } from 'react';
import {
  type MemoryBehaviorPreferences,
  type MemoryCategoryKey,
  type MemoryRecallStyle,
  type MemoryRememberingStyle,
} from '../../domain/preferences';
import { loadMemoryBehaviorPreferences, saveMemoryBehaviorPreferences } from '../../persistence/preferences';
import { ToggleSwitch } from './ToggleSwitch';
import './memory-continuity-settings.css';

type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
};

type CategoryOption = {
  key: MemoryCategoryKey;
  label: string;
  description: string;
};

const REMEMBERING_CHOICES: readonly Choice<MemoryRememberingStyle>[] = [
  { value: 'explicit-only', label: 'Only when I ask', description: 'Elara forms no memories automatically. Explicit “remember this” requests can still be confirmed and saved.' },
  { value: 'selective', label: 'Selective', description: 'Keep only clearly important, enduring things from everyday conversation.' },
  { value: 'natural', label: 'Natural', description: 'Remember durable things that naturally matter over time without trying to capture every detail.' },
  { value: 'attentive', label: 'Attentive', description: 'Also notice quieter recurring patterns, reflections, preferences, and personal context.' },
];

const RECALL_CHOICES: readonly Choice<MemoryRecallStyle>[] = [
  { value: 'direct-only', label: 'Deliberate recall', description: 'Nothing is automatically added to a turn. Elara can consciously search memory when the conversation calls for it.' },
  { value: 'natural', label: 'Natural', description: 'Bring back memories when they are relevant to what you are talking about now.' },
  { value: 'proactive', label: 'Proactive', description: 'Relevant memories come first, with room for one safe continuity thread that helps Elara keep a stronger sense of your shared history.' },
];

const EVERYDAY_CATEGORIES: readonly CategoryOption[] = [
  { key: 'personal_facts', label: 'Personal facts', description: 'Stable things about you that help conversations make sense.' },
  { key: 'likes_dislikes', label: 'Likes & dislikes', description: 'Foods, music, aesthetics, favourites, pet peeves, and preferences.' },
  { key: 'people_relationships', label: 'People & relationships', description: 'Who matters to you and the relationships you talk about.' },
  { key: 'pets', label: 'Pets', description: 'Names, habits, little stories, and details about the animals in your life.' },
  { key: 'routines_daily_life', label: 'Routines & everyday life', description: 'Habits, schedules, recurring situations, and how your days usually work.' },
  { key: 'goals_plans_commitments', label: 'Goals, plans & promises', description: 'Things you are trying to do, change, finish, or return to later.' },
  { key: 'interests_hobbies_projects', label: 'Interests, hobbies & projects', description: 'What you enjoy, build, learn, collect, play, read, or explore.' },
  { key: 'work_study_practical_life', label: 'Work, study & practical life', description: 'Useful everyday context around work, study, errands, home, and responsibilities.' },
  { key: 'important_moments_shared_history', label: 'Important moments & shared history', description: 'Events and conversations that feel meaningful enough to carry forward.' },
  { key: 'feelings_vulnerabilities_reflections', label: 'Feelings, vulnerabilities & reflections', description: 'Personal reflections, worries, emotional themes, and the meanderings that reveal something enduring.' },
  { key: 'values_worldview', label: 'Values & worldview', description: 'What matters to you and the principles or perspectives you return to.' },
];

const SENSITIVE_CATEGORIES: readonly CategoryOption[] = [
  { key: 'health_wellbeing', label: 'Health & wellbeing', description: 'Health, symptoms, treatment, therapy, and wellbeing context.' },
  { key: 'money_finances', label: 'Money & finances', description: 'Income, budgeting, debt, financial circumstances, and money concerns.' },
  { key: 'intimacy_sexuality', label: 'Intimacy & sexuality', description: 'Sexuality, intimate relationships, and private sexual-life context.' },
  { key: 'religion_spirituality', label: 'Religion & spirituality', description: 'Faith, spiritual practice, beliefs, and religious identity.' },
  { key: 'politics_civics', label: 'Politics & civic views', description: 'Political views, voting preferences, party affiliation, and civic identity.' },
  { key: 'race_ethnicity', label: 'Race & ethnicity', description: 'Racial or ethnic identity and background.' },
  { key: 'legal_criminal_history', label: 'Legal & criminal history', description: 'Arrests, charges, convictions, probation, or related legal history.' },
  { key: 'precise_location_home', label: 'Precise home & location details', description: 'Street-address or similarly precise home-location information.' },
];

type SaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

export function MemoryContinuitySettings() {
  const [value, setValue] = useState<MemoryBehaviorPreferences | null>(null);
  const valueRef = useRef<MemoryBehaviorPreferences | null>(null);
  const mountedRef = useRef(true);
  const saveTailRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const loaded = await loadMemoryBehaviorPreferences();
        if (cancelled) return;
        valueRef.current = loaded;
        setValue(loaded);
        setSaveState('idle');
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setSaveState('error');
        setError(cause instanceof Error ? cause.message : 'Memory preferences could not be loaded.');
      }
    };

    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  function scheduleSave(next: MemoryBehaviorPreferences, previous: MemoryBehaviorPreferences) {
    const revision = ++revisionRef.current;
    setSaveState('saving');
    setError(null);

    saveTailRef.current = saveTailRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await saveMemoryBehaviorPreferences(next);
        if (revision !== revisionRef.current) return;
        valueRef.current = saved;
        if (!mountedRef.current) return;
        setValue(saved);
        setSaveState('saved');
      })
      .catch((cause) => {
        if (revision !== revisionRef.current) return;
        valueRef.current = previous;
        if (!mountedRef.current) return;
        setValue(previous);
        setSaveState('error');
        setError(cause instanceof Error ? cause.message : 'Memory preferences could not be saved.');
      });
  }

  function update(transform: (current: MemoryBehaviorPreferences) => MemoryBehaviorPreferences) {
    const current = valueRef.current;
    if (!current) return;
    const next = transform(current);
    if (next === current) return;
    valueRef.current = next;
    setValue(next);
    scheduleSave(next, current);
  }

  function setCategory(key: MemoryCategoryKey, enabled: boolean) {
    update((current) => ({
      ...current,
      categories: { ...current.categories, [key]: enabled },
    }));
  }

  const enabled = value?.enabled ?? false;
  const controlsDisabled = !value || !enabled;

  return (
    <div className="memory-continuity-settings">
      <div className={`setting-card memory-continuity-master${enabled ? ' is-enabled' : ''}`}>
        <div className="memory-continuity-master__copy">
          <strong id="memory-enabled-label">Use memory</strong>
          <span id="memory-enabled-hint">
            {enabled
              ? 'Elara can use durable memory for conversational continuity and can learn within the choices below.'
              : 'Automatic recall and organic learning are off. Existing memories stay in the Memory Bank, and explicit remember requests still require confirmation.'}
          </span>
        </div>
        <ToggleSwitch
          checked={enabled}
          disabled={!value}
          onCheckedChange={(next) => update((current) => ({ ...current, enabled: next }))}
          labelledBy="memory-enabled-label"
          describedBy="memory-enabled-hint"
        />
      </div>

      {saveState === 'loading' && <div className="memory-continuity-status" role="status">Loading memory preferences…</div>}
      {error && <div className="memory-continuity-status is-error" role="alert">{error}</div>}

      {value && <>
        <section className={`setting-card memory-continuity-card${controlsDisabled ? ' is-disabled' : ''}`}>
          <div className="memory-continuity-heading">
            <div>
              <span className="memory-continuity-kicker">REMEMBERING</span>
              <strong>How readily should Elara remember things?</strong>
            </div>
            <span>{rememberingSummary(value.rememberingStyle)}</span>
          </div>
          <p className="memory-continuity-intro">This controls automatic learning from ordinary conversation. It never turns passwords, API keys, authentication tokens, or similar credentials into memories.</p>
          <div className="memory-choice-grid" role="radiogroup" aria-label="Remembering style">
            {REMEMBERING_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={value.rememberingStyle === choice.value}
                disabled={controlsDisabled}
                className={value.rememberingStyle === choice.value ? 'is-active' : ''}
                onClick={() => update((current) => ({ ...current, rememberingStyle: choice.value }))}
              >
                <strong>{choice.label}</strong>
                <span>{choice.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`setting-card memory-continuity-card${controlsDisabled ? ' is-disabled' : ''}`}>
          <div className="memory-continuity-heading">
            <div>
              <span className="memory-continuity-kicker">RECALL</span>
              <strong>How readily should Elara bring memories back?</strong>
            </div>
            <span>{recallSummary(value.recallStyle)}</span>
          </div>
          <p className="memory-continuity-intro">Remembering and recalling are separate. You can let Elara keep a rich history without having unrelated memories constantly drift into conversation.</p>
          <div className="memory-choice-grid memory-choice-grid--three" role="radiogroup" aria-label="Recall style">
            {RECALL_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={value.recallStyle === choice.value}
                disabled={controlsDisabled}
                className={value.recallStyle === choice.value ? 'is-active' : ''}
                onClick={() => update((current) => ({ ...current, recallStyle: choice.value }))}
              >
                <strong>{choice.label}</strong>
                <span>{choice.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`setting-card memory-continuity-card${controlsDisabled ? ' is-disabled' : ''}`}>
          <div className="memory-continuity-heading">
            <div>
              <span className="memory-continuity-kicker">EVERYDAY MEMORY</span>
              <strong>What may Elara pick up naturally?</strong>
            </div>
          </div>
          <p className="memory-continuity-intro">These categories apply to automatic remembering. An explicit “remember this” request is a separate confirmed action.</p>
          <CategoryChecklist options={EVERYDAY_CATEGORIES} value={value} disabled={controlsDisabled} onChange={setCategory} />
        </section>

        <section className={`setting-card memory-continuity-card memory-continuity-card--sensitive${controlsDisabled ? ' is-disabled' : ''}`}>
          <div className="memory-continuity-heading">
            <div>
              <span className="memory-continuity-kicker">SENSITIVE · OPT IN</span>
              <strong>Private topics</strong>
            </div>
            <span>Off by default</span>
          </div>
          <p className="memory-continuity-intro">Enable only the kinds of sensitive personal context you are comfortable with Elara learning automatically. Relevant memories you explicitly created can still be recalled normally.</p>
          <CategoryChecklist options={SENSITIVE_CATEGORIES} value={value} disabled={controlsDisabled} onChange={setCategory} sensitive />
        </section>

        <div className="memory-continuity-status" role="status" aria-live="polite">
          {saveState === 'saving' ? 'Saving memory preferences…' : saveState === 'saved' ? 'Memory preferences saved.' : 'Changes save automatically.'}
        </div>
      </>}
    </div>
  );
}

function CategoryChecklist({
  options,
  value,
  disabled,
  onChange,
  sensitive = false,
}: {
  options: readonly CategoryOption[];
  value: MemoryBehaviorPreferences;
  disabled: boolean;
  onChange: (key: MemoryCategoryKey, enabled: boolean) => void;
  sensitive?: boolean;
}) {
  return (
    <div className="memory-category-grid">
      {options.map((option) => {
        const checked = value.categories[option.key];
        const id = `memory-category-${option.key}`;
        return (
          <label key={option.key} className={`memory-category-option${checked ? ' is-checked' : ''}${sensitive ? ' is-sensitive' : ''}`} htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => onChange(option.key, event.target.checked)}
            />
            <span className="memory-category-option__copy">
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function rememberingSummary(value: MemoryRememberingStyle): string {
  switch (value) {
    case 'explicit-only': return 'Explicit only';
    case 'selective': return 'Selective';
    case 'natural': return 'Natural';
    case 'attentive': return 'Attentive';
  }
}

function recallSummary(value: MemoryRecallStyle): string {
  switch (value) {
    case 'direct-only': return 'Deliberate';
    case 'natural': return 'Natural';
    case 'proactive': return 'Proactive';
  }
}
