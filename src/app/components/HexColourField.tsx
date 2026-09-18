import { useId, useRef, useState } from 'react';

const HEX_ERROR = 'Enter a 6-digit hex colour, e.g. #7C3AED.';

export function canonicalHexColour(value: string): string | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : null;
}

export function HexColourField({
  label,
  colourAriaLabel,
  hexAriaLabel,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  colourAriaLabel: string;
  hexAriaLabel: string;
  value: string;
  fallback: string;
  onCommit: (value: string) => void;
}) {
  const committed = canonicalHexColour(value) ?? canonicalHexColour(fallback) ?? '#000000';
  const [draft, setDraft] = useState<string | null>(null);
  const [invalidAgainst, setInvalidAgainst] = useState<string | null>(null);
  const cancelNextBlur = useRef(false);
  const errorId = useId();
  const displayedValue = draft ?? committed;
  const hasError = invalidAgainst === committed;

  function commitDraft(): void {
    if (draft === null) return;
    const next = canonicalHexColour(draft);
    if (!next) {
      setDraft(null);
      setInvalidAgainst(committed);
      return;
    }
    setDraft(null);
    setInvalidAgainst(null);
    if (next !== committed) onCommit(next);
  }

  function handlePicker(nextValue: string): void {
    const next = canonicalHexColour(nextValue);
    if (!next) return;
    setDraft(null);
    setInvalidAgainst(null);
    if (next !== committed) onCommit(next);
  }

  return <label className="colour-field">
    <span>{label}</span>
    <div>
      <input
        type="color"
        aria-label={colourAriaLabel}
        value={committed}
        onChange={(event) => handlePicker(event.target.value)}
      />
      <input
        aria-label={hexAriaLabel}
        value={displayedValue}
        maxLength={16}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={hasError ? 'true' : undefined}
        aria-describedby={hasError ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalidAgainst(null);
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
            setInvalidAgainst(null);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
    {hasError && <small id={errorId} className="colour-field__error" role="alert">{HEX_ERROR}</small>}
  </label>;
}
