import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MEMORY_BEHAVIOR,
  MEMORY_CATEGORY_KEYS,
  SENSITIVE_MEMORY_CATEGORY_KEYS,
  type MemoryBehaviorPreferences,
  type MemoryCategoryKey,
  type MemoryRecallStyle,
  type MemoryRememberingStyle,
} from '../../domain/preferences';
import { loadMemoryBehaviorPreferences, saveMemoryBehaviorPreferences } from '../../persistence/preferences';
import { ToggleSwitch } from './ToggleSwitch';
import './memory-continuity-settings.css';

const REMEMBERING_OPTIONS: ReadonlyArray<{
  id: MemoryRememberingStyle;
  label: string;
  description: string;
}> = [
  { id: 'explicit-only', label: 'Only when I ask', description: 'No automatic learning. “Remember this” still works through the normal confirmation step.' },
  { id: 'selective', label: 'Selective', description: 'Keep only clearly important, enduring details from enabled topics.' },
  { id: 'natural', label: 'Natural', description: 'Remember useful recurring personal context without trying to capture everything.' },
  { id: 'attentive', label: 'Attentive', description: 'Notice smaller recurring details, reflections, and patterns in the topics you allow.' },
];

const RECALL_OPTIONS: ReadonlyArray<{
  id: MemoryRecallStyle;
  label: string;
  description: string;
}> = [
  { id: 'direct-only', label: 'Only when I ask', description: 'Do not bring memories into ordinary turns automatically. Deliberate recall still works.' },
  { id: 'natural', label: 'Naturally', description: 'Use remembered context when it is relevant to what you are talking about now.' },
  { id: 'proactive', label: 'Make connections', description: 'Use relevant memories and, when helpful, one established non-sensitive continuity thread.' },
];

const CATEGORY_COPY: Readonly<Record<MemoryCategoryKey, { label: string; description: string }>> = {
  personal_facts: { label: 'Personal details', description: 'Stable things about you that help conversations stay grounded.' },
  likes_dislikes: { label: 'Likes & dislikes', description: 'Foods, music, aesthetics, favorites, annoyances, and preferences.' },
  people_relationships: { label: 'People & relationships', description: 'Friends, family, partners, and the relationships you talk about.' },
  pets: { label: 'Pets', description: 'Their names, personalities, routines, and the little stories around them.' },
  routines_daily_life: { label: 'Routines & everyday life', description: 'Habits, schedules, recurring chores, and how your days usually work.' },
  goals_plans_commitments: { label: 'Goals, plans & promises', description: 'Things you want to do, change, revisit, or follow through on.' },
  interests_hobbies_projects: { label: 'Interests, hobbies & projects', description: 'What you enjoy, build, collect, learn, or keep coming back to.' },
  work_study_practical_life: { label: 'Work, study & practical life', description: 'Ongoing work, learning, responsibilities, and useful day-to-day context.' },
  important_moments_shared_history: { label: 'Important moments & shared history', description: 'Events and conversations that may matter again later.' },
  feelings_vulnerabilities_reflections: { label: 'Feelings, vulnerabilities & reflections', description: 'Personal meanderings, worries, recurring emotional themes, and self-reflection.' },
  values_worldview: { label: 'Values & worldview', description: 'The principles, priorities, and outlook that shape how you think.' },
  health_wellbeing: { label: 'Health & wellbeing', description: 'Health, symptoms, treatment, therapy, fitness, and wellbeing.' },
  money_finances: { label: 'Money & finances', description: 'Income, debt, budgeting, financial worries, and other money context.' },
  intimacy_sexuality: { label: 'Intimacy & sexuality', description: 'Sexuality, intimate relationships, and private sexual-life context.' },
  religion_spirituality: { label: 'Religion & spirituality', description: 'Faith, spiritual practice, beliefs, and religious identity.' },
  politics_civics: { label: 'Politics & civic views', description: 'Political opinions, voting-related preferences, and civic beliefs.' },
  race_ethnicity: { label: 'Race & ethnicity', description: 'Race, ethnicity, cultural identity, and related personal background.' },
  legal_criminal_history: { label: 'Legal & criminal history', description: 'Arrests, convictions, legal history, probation, or similar matters.' },
  precise_location_home: { label: 'Exact home & location details', description: 'Precise home address or similarly identifying location details.' },
};

const SENSITIVE = new Set<MemoryCategoryKey>(SENSITIVE_MEMORY_CATEGORY_KEYS);
const EVERYDAY_CATEGORIES = MEMORY_CATEGORY_KEYS.filter((key) => !SENSITIVE.has(key));

export function MemoryContinuitySettings() {
  const [value, setValue] = useState<MemoryBehaviorPreferences>(DEFAULT_MEMORY_BEHAVIOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const valueRef = useRef<MemoryBehaviorPreferences>(DEFAULT_MEMORY_BEHAVIOR);
  const revisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    void loadMemoryBehaviorPreferences()
      .then((loaded) => {
        if (!mountedRef.current) return;
        valueRef.current = loaded;
        setValue(loaded);
        setError(null);
      })
      .catch((cause) => {
        if (!mountedRef.current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load memory preferences.');
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => { mountedRef.current = false; };
  }, []);

  function persist(next: MemoryBehaviorPreferences): void {
    const revision = ++revisionRef.current;
    setSaving(true);
    setError(null);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await saveMemoryBehaviorPreferences(next);
        if (!mountedRef.current || revision !== revisionRef.current) return;
        valueRef.current = saved;
        setValue(saved);
      })
      .catch((cause) => {
        if (!mountedRef.current || revision !== revisionRef.current) return;
        setError(cause instanceof Error ? cause.message : 'Could not save memory preferences.');
        void loadMemoryBehaviorPreferences().then((stored) => {
          if (!mountedRef.current || revision !== revisionRef.current) return;
          valueRef.current = stored;
          setValue(stored);
        }).catch(() => undefined);
      })
      .finally(() => {
        if (mountedRef.current && revision === revisionRef.current) setSaving(false);
      });
  }

  function apply(update: (current: MemoryBehaviorPreferences) => MemoryBehaviorPreferences): void {
    const next = update(valueRef.current);
    valueRef.current = next;
    setValue(next);
    persist(next);
  }

  function setCategory(key: MemoryCategoryKey, checked: boolean): void {
    apply((current) => ({
      ...current,
      categories: { ...current.categories, [key]: checked },
    }));
  }

  function renderCategory(key: MemoryCategoryKey) {
    const copy = CATEGORY_COPY[key];
    return (
      <div className="memory-continuity__category" key={key}>
        <div className="memory-continuity__category-copy">
          <strong id={`memory-category-${key}-label`}>{copy.label}</strong>
          <span id={`memory-category-${key}-hint`}>{copy.description}</span>
        </div>
        <ToggleSwitch
          checked={value.categories[key]}
          onCheckedChange={(checked) => setCategory(key, checked)}
          labelledBy={`memory-category-${key}-label`}
          describedBy={`memory-category-${key}-hint`}
          disabled={loading}
        />
      </div>
    );
  }

  return (
    <section className="memory-continuity" aria-busy={loading}>
      <div className="setting-card memory-continuity__master">
        <div className="memory-continuity__master-copy">
          <strong id="memory-behavior-master-label">Use memory in conversation</strong>
          <span id="memory-behavior-master-hint">
            {value.enabled
              ? 'Elara may recall and form durable memories according to the choices below.'
              : 'Conversational recall and automatic remembering are off. Existing memories stay in the Memory Bank, and the choices below are kept.'}
          </span>
        </div>
        <ToggleSwitch
          checked={value.enabled}
          onCheckedChange={(enabled) => apply((current) => ({ ...current, enabled }))}
          labelledBy="memory-behavior-master-label"
          describedBy="memory-behavior-master-hint"
          disabled={loading}
        />
      </div>

      <div className="memory-continuity__status" role="status" aria-live="polite">
        {loading ? 'Loading memory preferences…' : saving ? 'Saving…' : error ?? 'Changes save automatically.'}
      </div>

      <section className="memory-continuity__group" aria-labelledby="memory-remembering-heading">
        <div className="memory-continuity__heading">
          <div>
            <span className="memory-continuity__kicker">REMEMBERING</span>
            <strong id="memory-remembering-heading">How readily Elara remembers</strong>
          </div>
          <span>Automatic formation</span>
        </div>
        <p>Controls how readily new user-grounded observations become durable memory. It never turns incidental assistant prose into fact.</p>
        <div className="memory-continuity__options" role="radiogroup" aria-label="How readily Elara remembers">
          {REMEMBERING_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={value.rememberingStyle === option.id}
              className={`memory-continuity__option${value.rememberingStyle === option.id ? ' is-active' : ''}`}
              disabled={loading}
              onClick={() => apply((current) => ({ ...current, rememberingStyle: option.id }))}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="memory-continuity__group" aria-labelledby="memory-recall-heading">
        <div className="memory-continuity__heading">
          <div>
            <span className="memory-continuity__kicker">CONTINUITY</span>
            <strong id="memory-recall-heading">How Elara uses memories</strong>
          </div>
          <span>Conversational recall</span>
        </div>
        <p>Controls when existing durable memories are brought into a conversation. Relevance and security boundaries still apply in every mode.</p>
        <div className="memory-continuity__options memory-continuity__options--three" role="radiogroup" aria-label="How Elara uses memories">
          {RECALL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={value.recallStyle === option.id}
              className={`memory-continuity__option${value.recallStyle === option.id ? ' is-active' : ''}`}
              disabled={loading}
              onClick={() => apply((current) => ({ ...current, recallStyle: option.id }))}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="memory-continuity__group" aria-labelledby="memory-everyday-heading">
        <div className="memory-continuity__heading">
          <div>
            <span className="memory-continuity__kicker">EVERYDAY YOU</span>
            <strong id="memory-everyday-heading">What Elara may remember automatically</strong>
          </div>
          <span>Per-topic control</span>
        </div>
        <p>These switches affect organic remembering only. An explicit “remember this” request remains a separate, confirmed action.</p>
        <div className="memory-continuity__category-grid">
          {EVERYDAY_CATEGORIES.map(renderCategory)}
        </div>
      </section>

      <section className="memory-continuity__group memory-continuity__group--sensitive" aria-labelledby="memory-sensitive-heading">
        <div className="memory-continuity__heading">
          <div>
            <span className="memory-continuity__kicker">PRIVATE TOPICS</span>
            <strong id="memory-sensitive-heading">Sensitive things</strong>
          </div>
          <span>Default off</span>
        </div>
        <p>These are never remembered automatically unless you explicitly switch the individual topic on. Credentials, passwords, API keys, tokens, and financial account identifiers remain ineligible regardless of these settings.</p>
        <div className="memory-continuity__category-grid">
          {SENSITIVE_MEMORY_CATEGORY_KEYS.map(renderCategory)}
        </div>
      </section>
    </section>
  );
}
