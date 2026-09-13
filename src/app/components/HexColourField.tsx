import { useId, useRef, useState } from 'react';

const HEX_ERROR = 'Enter a 6-digit hex colour, e.g. #7C3AED.';

export function canonicalHexColour(value: string): string | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : null;
}

export function HexColourField({
  label,
  ariaLabel,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  fallback: string;
  onCommit: (value: string) => void;
}) {
  const committed = canonicalHexColour(value) ?? canonicalHexColour(fallback) ?? '#000000';
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelNextBlur = useRef(false);
  const errorId = useId();
  const displayedValue = draft ?? committed;

  function commitDraft(): void {
    if (draft === null) return;
    const next = canonicalHexColour(draft);
    if (!next) {
      setDraft(null);
      setError(HEX_ERROR);
      return;
    }
    setDraft(null);
    setError(null);
    if (next !== committed) onCommit(next);
  }

  function handlePicker(nextValue: string): void {
    const next = canonicalHexColour(nextValue);
    if (!next) return;
    setDraft(null);
    setError(null);
    if (next !== committed) onCommit(next);
  }

  return <label className="colour-field">
    <span>{label}</span>
    <div>
      <input
        type="color"
        aria-label={`${ariaLabel} colour`}
        value={committed}
        onChange={(event) => handlePicker(event.target.value)}
      />
      <input
        aria-label={`${ariaLabel} hex`}
        value={displayedValue}
        maxLength={16}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (cancelNextBlur.current) {
            cancelNextBlur.current = false;
            return;
          }
          commitDraft();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelNextBlur.current = true;
            setDraft(null);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
    {error && <small id={errorId} className="colour-field__error" role="alert">{error}</small>}
  </label>;
}
