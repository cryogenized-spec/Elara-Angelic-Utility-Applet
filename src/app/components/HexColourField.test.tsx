// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalHexColour, HexColourField } from './HexColourField';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function changeInput(input: HTMLInputElement, value: string): void {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('HTMLInputElement value setter unavailable');
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(input: HTMLInputElement): void {
  act(() => {
    input.focus();
    input.blur();
  });
}

function key(input: HTMLInputElement, keyValue: string): void {
  act(() => {
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true }));
  });
}

const FIELD_PROPS = {
  label: 'Activity accent',
  colourAriaLabel: 'Generation activity accent colour',
  hexAriaLabel: 'Generation activity accent hex',
  fallback: '#6EA8FF',
} as const;

function ControlledField({ onCommit }: { onCommit: (value: string) => void }) {
  const [value, setValue] = useState('#A855F7');
  return <HexColourField
    {...FIELD_PROPS}
    value={value}
    onCommit={(next) => {
      onCommit(next);
      setValue(next);
    }}
  />;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('canonicalHexColour', () => {
  it('normalizes six-digit values with or without a hash', () => {
    expect(canonicalHexColour('#7c3aed')).toBe('#7C3AED');
    expect(canonicalHexColour('  34d399  ')).toBe('#34D399');
  });

  it('rejects partial, shorthand, oversized, and non-hex values', () => {
    for (const value of ['', '#', '#7C2', '#F0A', '#1234567', '#GG33AA']) {
      expect(canonicalHexColour(value)).toBeNull();
    }
  });
});

describe('HexColourField transactional editing', () => {
  function renderField(onCommit = vi.fn()) {
    act(() => { root.render(<ControlledField onCommit={onCommit} />); });
    const text = container.querySelector<HTMLInputElement>('input[aria-label="Generation activity accent hex"]');
    const picker = container.querySelector<HTMLInputElement>('input[aria-label="Generation activity accent colour"]');
    if (!text || !picker) throw new Error('expected both colour controls');
    return { onCommit, text, picker };
  }

  it('preserves the supplied accessible names exactly', () => {
    const { text, picker } = renderField();
    expect(text.getAttribute('aria-label')).toBe('Generation activity accent hex');
    expect(picker.getAttribute('aria-label')).toBe('Generation activity accent colour');
  });

  it('allows incomplete typing without mutating the committed colour', () => {
    const { onCommit, text, picker } = renderField();
    changeInput(text, '#A85');

    expect(text.value).toBe('#A85');
    expect(picker.value.toUpperCase()).toBe('#A855F7');
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('rejects an invalid blur, restores the last committed colour, and explains why', () => {
    const { onCommit, text, picker } = renderField();
    changeInput(text, '#A85');
    blur(text);

    expect(text.value).toBe('#A855F7');
    expect(picker.value.toUpperCase()).toBe('#A855F7');
    expect(onCommit).not.toHaveBeenCalled();
    expect(text.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Enter a 6-digit hex colour');
  });

  it('accepts pasted-style values without a hash and commits canonical uppercase on blur', () => {
    const { onCommit, text } = renderField();
    changeInput(text, ' 34d399 ');
    expect(onCommit).not.toHaveBeenCalled();
    blur(text);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#34D399');
    expect(text.value).toBe('#34D399');
  });

  it('commits a valid value with Enter and rejects no intermediate drafts', () => {
    const { onCommit, text } = renderField();
    changeInput(text, '#112233');
    key(text, 'Enter');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#112233');
    expect(text.value).toBe('#112233');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('abandons edits with Escape without flashing an error or committing', () => {
    const { onCommit, text } = renderField();
    changeInput(text, '#BAD');
    key(text, 'Escape');

    expect(text.value).toBe('#A855F7');
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('lets the native picker supersede a bad draft immediately', () => {
    const { onCommit, text, picker } = renderField();
    changeInput(text, '#BAD');
    changeInput(picker, '#22c55e');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#22C55E');
    expect(text.value).toBe('#22C55E');
    expect(picker.value.toUpperCase()).toBe('#22C55E');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('falls back to the newest committed colour when the parent changes during a bad draft', () => {
    const onCommit = vi.fn();
    act(() => {
      root.render(<HexColourField {...FIELD_PROPS} value="#A855F7" onCommit={onCommit} />);
    });
    const text = container.querySelector<HTMLInputElement>('input[aria-label="Generation activity accent hex"]');
    if (!text) throw new Error('expected hex input');

    changeInput(text, '#BAD');
    act(() => {
      root.render(<HexColourField {...FIELD_PROPS} value="#0EA5E9" onCommit={onCommit} />);
    });
    expect(text.value).toBe('#BAD');

    blur(text);
    expect(text.value).toBe('#0EA5E9');
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enter a 6-digit hex colour');
  });

  it('drops a stale validation warning automatically if the committed colour changes externally', () => {
    const onCommit = vi.fn();
    act(() => {
      root.render(<HexColourField {...FIELD_PROPS} value="#A855F7" onCommit={onCommit} />);
    });
    const text = container.querySelector<HTMLInputElement>('input[aria-label="Generation activity accent hex"]');
    if (!text) throw new Error('expected hex input');

    changeInput(text, '#BAD');
    blur(text);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    act(() => {
      root.render(<HexColourField {...FIELD_PROPS} value="#0EA5E9" onCommit={onCommit} />);
    });
    expect(text.value).toBe('#0EA5E9');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
