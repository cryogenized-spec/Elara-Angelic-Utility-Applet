// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_ACTIVITY_GLYPHS, type GenerationActivityGlyphs } from '../../domain/preferences';
import { GenerationActivityGlyphSettings } from './GenerationActivityGlyphSettings';

const { previewNotoEmoji } = vi.hoisted(() => ({
  previewNotoEmoji: vi.fn<(value: unknown) => Promise<boolean>>(async () => true),
}));
vi.mock('../../ui/noto-emoji', () => ({
  NOTO_EMOJI_PREVIEW_FAMILY: 'Elara Noto Emoji Preview',
  previewNotoEmoji: (value: GenerationActivityGlyphs) => previewNotoEmoji(value),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const [value, setValue] = useState<GenerationActivityGlyphs>(DEFAULT_GENERATION_ACTIVITY_GLYPHS);
  return <GenerationActivityGlyphSettings value={value} onChange={setValue} />;
}

function changeInputValue(input: HTMLInputElement, value: string): void {
  act(() => {
    const applied = Reflect.set(HTMLInputElement.prototype, 'value', value, input);
    if (!applied) throw new Error('expected native input value setter');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  previewNotoEmoji.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness />); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

describe('Generation Activity glyph settings', () => {
  it('previews the current glyph set through the transient Noto loader', async () => {
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(previewNotoEmoji).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Preview uses the exact 14 px activity rendering size.');
  });

  it('supports a custom one-grapheme memory icon without persisting from the editor', () => {
    const select = container.querySelector<HTMLSelectElement>('#activity-glyph-memory');
    if (!select) throw new Error('expected Memory glyph selector');

    act(() => {
      select.value = '__custom__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Custom Memory icon"]');
    if (!input) throw new Error('expected Memory custom input');

    changeInputValue(input, '♥️');

    const preview = container.querySelector<HTMLElement>('.generation-glyph-setting:nth-child(3) .generation-glyph-setting__preview');
    expect(preview).not.toBeNull();
    expect(input.value).toBe('♥');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('flags multiple graphemes and restores defaults with Reset', () => {
    const select = container.querySelector<HTMLSelectElement>('#activity-glyph-reasoning');
    if (!select) throw new Error('expected Reasoning glyph selector');
    act(() => {
      select.value = '__custom__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Custom Reasoning icon"]');
    if (!input) throw new Error('expected custom input');
    changeInputValue(input, 'ab');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Use exactly one visible symbol or emoji.');

    const reset = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Reset');
    if (!reset) throw new Error('expected Reset button');
    act(() => { reset.click(); });
    expect(container.textContent).not.toContain('Use exactly one visible symbol or emoji.');
  });
});
