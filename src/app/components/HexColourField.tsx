import { useId, useRef, useState } from 'react';

const HEX_ERROR = 'Enter a 6-digit hex colour, e.g. #7C3AED.';
const INVISIBLE_TEXT_FORMATTING = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const DECORATED_HEX_TOKEN = /(?:^|[^0-9a-fA-F])#?([0-9a-fA-F]{6})(?=$|[^0-9a-fA-F])/;

/**
 * Reduce text-field input to the plain textual colour candidate the user meant.
 * Rich-text clipboard styling never belongs in the preference value; this also
 * removes normal/non-breaking whitespace, zero-width formatting and bidi marks.
 *
 * When a pasted label/bullet contains one complete six-digit hex token, extract
 * that token directly (for example "• Colour: #34 D3 99" -> "#34D399").
 */
export function sanitizeHexColourInput(value: string): string {
  const compact = value
    .normalize('NFKC')
    .replace(INVISIBLE_TEXT_FORMATTING, '')
    .replace(/\s+/g, '');

  const token = compact.match(DECORATED_HEX_TOKEN);
  return token ? `#${token[1].toUpperCase()}` : compact;
}

export function canonicalHexColour(value: string): string | null {
  const sanitized = sanitizeHexColourInput(value);
  const candidate = sanitized.startsWith('#') ? sanitized : `#${sanitized}`;
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

  function applyTextCandidate(rawValue: string): void {
    const cleaned = sanitizeHexColourInput(rawValue);
    const next = canonicalHexColour(cleaned);
    setInvalidAgainst(null);

    // A complete valid value should feel instant: update the owning preference
    // immediately and let persistence finish in the background.
    if (next) {
      setDraft(null);
      if (next !== committed) onCommit(next);
      return;
    }

    // Incomplete typing remains transactional, but whitespace/formatting debris
    // is removed as it is entered rather than waiting for blur.
    setDraft(cleaned);
  }

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
        maxLength={32}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={hasError ? 'true' : undefined}
        aria-describedby={hasError ? errorId : undefined}
        onChange={(event) => applyTextCandidate(event.target.value)}
        onPaste={(event) => {
          // Read only the clipboard's plain-text projection. A complete colour
          // replaces the field regardless of rich-text bullets/spacing around it.
          const clipboardText = event.clipboardData.getData('text/plain');
          const pastedHex = canonicalHexColour(clipboardText);
          if (pastedHex) {
            event.preventDefault();
            applyTextCandidate(pastedHex);
            return;
          }

          // For incomplete clipboard text, preserve normal selection semantics,
          // then sanitize the combined textual candidate.
          event.preventDefault();
          const start = event.currentTarget.selectionStart ?? 0;
          const end = event.currentTarget.selectionEnd ?? start;
          applyTextCandidate(
            displayedValue.slice(0, start)
              + clipboardText
              + displayedValue.slice(end),
          );
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
