import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_GENERATION_ACTIVITY_GLYPHS,
  GENERATION_ACTIVITY_GLYPH_KEYS,
  type GenerationActivityGlyphKey,
  type GenerationActivityGlyphs,
} from '../../domain/preferences';
import {
  GENERATION_ACTIVITY_GLYPH_LABELS,
  GENERATION_ACTIVITY_GLYPH_SUGGESTIONS,
  normalizeGenerationActivityGlyph,
} from '../../ui/activity-glyphs';
import { NOTO_EMOJI_PREVIEW_FAMILY, previewNotoEmoji } from '../../ui/noto-emoji';

const CUSTOM_VALUE = '__custom__';

function withGlyph(
  value: GenerationActivityGlyphs,
  key: GenerationActivityGlyphKey,
  glyph: string,
): GenerationActivityGlyphs {
  return { ...value, [key]: glyph };
}

export function GenerationActivityGlyphSettings({
  value,
  onChange,
}: {
  value: GenerationActivityGlyphs;
  onChange: (value: GenerationActivityGlyphs) => void;
}) {
  const [customKeys, setCustomKeys] = useState<ReadonlySet<GenerationActivityGlyphKey>>(() => new Set());
  const [customInputs, setCustomInputs] = useState<Partial<Record<GenerationActivityGlyphKey, string>>>({});
  const [invalidKey, setInvalidKey] = useState<GenerationActivityGlyphKey | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  const customByValue = useMemo(() => new Set(
    GENERATION_ACTIVITY_GLYPH_KEYS.filter(
      (key) => !GENERATION_ACTIVITY_GLYPH_SUGGESTIONS[key].includes(value[key]),
    ),
  ), [value]);

  useEffect(() => {
    let cancelled = false;
    setPreviewState('loading');
    const timer = window.setTimeout(() => {
      void previewNotoEmoji(value)
        .then((ready) => { if (!cancelled) setPreviewState(ready ? 'ready' : 'unavailable'); })
        .catch(() => { if (!cancelled) setPreviewState('unavailable'); });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value]);

  function choose(key: GenerationActivityGlyphKey, next: string): void {
    setInvalidKey(null);
    if (next === CUSTOM_VALUE) {
      setCustomKeys((current) => new Set([...current, key]));
      setCustomInputs((current) => ({ ...current, [key]: value[key] }));
      return;
    }
    setCustomKeys((current) => {
      const nextKeys = new Set(current);
      nextKeys.delete(key);
      return nextKeys;
    });
    onChange(withGlyph(value, key, next));
  }

  function enterCustom(key: GenerationActivityGlyphKey, raw: string): void {
    const normalized = normalizeGenerationActivityGlyph(raw, '');
    if (!normalized) {
      setCustomInputs((current) => ({ ...current, [key]: raw }));
      setInvalidKey(key);
      return;
    }
    setCustomInputs((current) => ({ ...current, [key]: normalized }));
    setInvalidKey(null);
    onChange(withGlyph(value, key, normalized));
  }

  function reset(): void {
    setCustomKeys(new Set());
    setCustomInputs({});
    setInvalidKey(null);
    onChange(DEFAULT_GENERATION_ACTIVITY_GLYPHS);
  }

  return (
    <div className="generation-glyph-settings">
      <div className="generation-glyph-settings__intro">
        <div>
          <strong>Activity icons</strong>
          <span>Noto Emoji Light 300 · monochrome shape only · colour follows Activity accent.</span>
        </div>
        <button type="button" onClick={reset}>Reset</button>
      </div>

      <div className="generation-glyph-settings__rows">
        {GENERATION_ACTIVITY_GLYPH_KEYS.map((key) => {
          const suggestions = GENERATION_ACTIVITY_GLYPH_SUGGESTIONS[key];
          const custom = customKeys.has(key) || customByValue.has(key);
          const selectValue = custom ? CUSTOM_VALUE : value[key];
          return (
            <div className="generation-glyph-setting" key={key}>
              <span
                className="generation-glyph-setting__preview"
                aria-hidden="true"
                style={{ fontFamily: `'${NOTO_EMOJI_PREVIEW_FAMILY}'` }}
              >
                {previewState === 'ready' ? value[key] : '·'}
              </span>
              <label htmlFor={`activity-glyph-${key}`}>{GENERATION_ACTIVITY_GLYPH_LABELS[key]}</label>
              <select
                id={`activity-glyph-${key}`}
                value={selectValue}
                onChange={(event) => choose(key, event.target.value)}
              >
                {suggestions.map((glyph) => <option value={glyph} key={glyph}>{glyph}</option>)}
                <option value={CUSTOM_VALUE}>Custom…</option>
              </select>
              {custom && (
                <input
                  className="generation-glyph-setting__custom"
                  aria-label={`Custom ${GENERATION_ACTIVITY_GLYPH_LABELS[key]} icon`}
                  aria-invalid={invalidKey === key}
                  value={customInputs[key] ?? value[key]}
                  maxLength={32}
                  onChange={(event) => enterCustom(key, event.target.value)}
                  onBlur={() => {
                    if (invalidKey === key) {
                      setCustomInputs((current) => ({ ...current, [key]: value[key] }));
                      setInvalidKey(null);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <small className="generation-glyph-settings__status" role="status">
        {previewState === 'loading' && 'Loading monochrome preview…'}
        {previewState === 'ready' && 'Preview uses the exact 14 px activity rendering size.'}
        {previewState === 'unavailable' && 'Noto preview is unavailable; the current Lucide fallback remains safe.'}
      </small>
      {invalidKey && <small className="generation-glyph-settings__error" role="alert">Use exactly one visible symbol or emoji.</small>}
    </div>
  );
}
