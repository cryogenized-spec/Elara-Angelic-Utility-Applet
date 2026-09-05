import { useState } from 'react';
import { RangeSlider } from './RangeSlider';
import type { GeminiSettings } from '../../gemini/settings-engine';
import type { GeminiModelDefinition } from '../../gemini/model-registry';

type GeminiGenerationControlsProps = {
  model: GeminiModelDefinition;
  settings: GeminiSettings;
  onChange: (settings: GeminiSettings) => void;
};

export function GeminiGenerationControls({ model, settings, onChange }: GeminiGenerationControlsProps) {
  const [addingStopSequence, setAddingStopSequence] = useState(false);
  const [draftStopSequence, setDraftStopSequence] = useState('');

  function update(patch: Partial<GeminiSettings>) {
    onChange({ ...settings, ...patch });
  }

  const maxOutputValue = settings.maxOutputTokens ?? model.outputTokenLimit;
  const maxOutputLabel = settings.maxOutputTokens === undefined
    ? 'Provider default'
    : `${settings.maxOutputTokens.toLocaleString()} tokens`;

  const seedValue = settings.seed ?? 0;
  const seedLabel = settings.seed === undefined ? 'Provider default' : settings.seed.toLocaleString();

  function addStopSequence() {
    const value = draftStopSequence.trim();
    if (!value || settings.stopSequences.length >= 5) return;
    if (settings.stopSequences.includes(value)) {
      setDraftStopSequence('');
      setAddingStopSequence(false);
      return;
    }
    update({ stopSequences: [...settings.stopSequences, value.slice(0, 128)] });
    setDraftStopSequence('');
    setAddingStopSequence(false);
  }

  function removeStopSequence(index: number) {
    update({ stopSequences: settings.stopSequences.filter((_, itemIndex) => itemIndex !== index) });
  }

  return (
    <div className="model-settings__controls">
      <div className="model-settings__field">
        <span>Thinking level</span>
        <div className="model-settings__chips" role="radiogroup" aria-label="Thinking level">
          {model.thinkingLevels.map((level) => (
            <button
              key={level}
              type="button"
              className={`model-settings__chip${settings.thinkingLevel === level ? ' is-active' : ''}`}
              role="radio"
              aria-checked={settings.thinkingLevel === level}
              onClick={() => update({ thinkingLevel: level })}
            >
              {level}
            </button>
          ))}
          {!settings.thinkingLevel && (
            <button
              type="button"
              className="model-settings__chip is-active"
              role="radio"
              aria-checked="true"
              onClick={() => update({ thinkingLevel: undefined })}
            >
              Provider default
            </button>
          )}
        </div>
      </div>

      {model.supportsMaxOutputTokens && (
        <div className="model-settings__setting-card">
          <RangeSlider
            id="gemini-max-output"
            label="Max output tokens"
            min={256}
            max={model.outputTokenLimit}
            step={256}
            value={maxOutputValue}
            valueLabel={maxOutputLabel}
            minLabel="256"
            maxLabel={`${model.outputTokenLimit.toLocaleString()}`}
            onChange={(value) => update({ maxOutputTokens: value })}
          />
          <button
            type="button"
            className={`model-settings__default-toggle${settings.maxOutputTokens === undefined ? ' is-active' : ''}`}
            onClick={() => update({ maxOutputTokens: undefined })}
            aria-pressed={settings.maxOutputTokens === undefined}
          >
            Use provider default
          </button>
        </div>
      )}

      {model.supportsSeed && (
        <div className="model-settings__setting-card">
          <RangeSlider
            id="gemini-seed"
            label="Seed"
            min={0}
            max={1_000_000}
            step={1}
            value={seedValue}
            valueLabel={seedLabel}
            minLabel="0"
            maxLabel="1,000,000"
            onChange={(value) => update({ seed: value })}
          />
          <button
            type="button"
            className={`model-settings__default-toggle${settings.seed === undefined ? ' is-active' : ''}`}
            onClick={() => update({ seed: undefined })}
            aria-pressed={settings.seed === undefined}
          >
            Use provider default
          </button>
        </div>
      )}

      {model.supportsStopSequences && (
        <div className="model-settings__field">
          <div className="model-settings__field-header">
            <span>Stop sequences</span>
            <small>{settings.stopSequences.length}/5</small>
          </div>
          {settings.stopSequences.length > 0 ? (
            <div className="model-settings__stop-list" aria-label="Configured stop sequences">
              {settings.stopSequences.map((sequence, index) => (
                <span className="model-settings__stop-chip" key={`${sequence}-${index}`}>
                  <span>{sequence}</span>
                  <button type="button" aria-label={`Remove stop sequence ${sequence}`} onClick={() => removeStopSequence(index)}>×</button>
                </span>
              ))}
            </div>
          ) : (
            <p className="model-settings__empty-copy">None configured. Gemini will use its normal stopping behaviour.</p>
          )}
          {addingStopSequence ? (
            <div className="model-settings__add-row">
              <input
                className="model-settings__compact-input"
                type="text"
                maxLength={128}
                value={draftStopSequence}
                autoFocus
                placeholder="e.g. END"
                aria-label="New stop sequence"
                onChange={(event) => setDraftStopSequence(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addStopSequence();
                  if (event.key === 'Escape') {
                    setDraftStopSequence('');
                    setAddingStopSequence(false);
                  }
                }}
              />
              <button type="button" className="model-settings__small-button is-primary" onClick={addStopSequence}>Add</button>
              <button type="button" className="model-settings__small-button" onClick={() => { setDraftStopSequence(''); setAddingStopSequence(false); }}>Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              className="model-settings__add-button"
              onClick={() => setAddingStopSequence(true)}
              disabled={settings.stopSequences.length >= 5}
            >
              + Add stop sequence
            </button>
          )}
        </div>
      )}

      {model.thinkingSummaries && (
        <div className="model-settings__field">
          <span>Thinking summaries</span>
          <div className="model-settings__chips" role="radiogroup" aria-label="Thinking summaries">
            <button
              type="button"
              className={`model-settings__chip${settings.thinkingSummaries ? ' is-active' : ''}`}
              role="radio"
              aria-checked={settings.thinkingSummaries}
              onClick={() => update({ thinkingSummaries: true })}
            >
              Auto
            </button>
            <button
              type="button"
              className={`model-settings__chip${!settings.thinkingSummaries ? ' is-active' : ''}`}
              role="radio"
              aria-checked={!settings.thinkingSummaries}
              onClick={() => update({ thinkingSummaries: false })}
            >
              Off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
