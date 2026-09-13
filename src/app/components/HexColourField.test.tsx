// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalHexColour, HexColourField } from './HexColourField';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function changeInput(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('HTMLInputElement value setter unavailable');
    setter.call(input, value);
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
    act(() => {
      root.render(<HexColourField
        label="Activity accent"
        ariaLabel="Generation activity accent"
        value="#A855F7"
        fallback="#6EA8FF"
        onCommit={onCommit}
      />);
    });
    const text = container.querySelector<HTMLInputElement>('input[aria-label="Generation activity accent hex"]');
    const picker = container.querySelector<HTMLInputElement>('input[aria-label="Generation activity accent colour"]');
    if (!text || !picker) throw new Error('expected both colour controls');
    return { onCommit, text, picker };
  }

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
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
