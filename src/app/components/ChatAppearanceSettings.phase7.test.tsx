// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_APPEARANCE, type ChatAppearancePreferences } from '../../domain/preferences';
import { ChatAppearanceSettings } from './ChatAppearanceSettings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Could not find ${text} button.`);
  return button;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Phase 7 Chat appearance player presets', () => {
  it('shows Glass as the default selected preset and emits only the appearance patch', () => {
    const changes: ChatAppearancePreferences[] = [];
    act(() => {
      root.render(<ChatAppearanceSettings value={DEFAULT_CHAT_APPEARANCE} onChange={(value) => changes.push(value)} activityGlyphs={DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs} onActivityGlyphsChange={() => undefined} />);
    });

    expect(buttonByText('Glass').getAttribute('aria-checked')).toBe('true');
    expect(buttonByText('Minimal').getAttribute('aria-checked')).toBe('false');
    expect(buttonByText('Cinema').getAttribute('aria-checked')).toBe('false');

    act(() => buttonByText('Cinema').click());

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'cinema' });
  });

  it('describes the preset as an outer-shell change rather than a YouTube control replacement', () => {
    act(() => {
      root.render(<ChatAppearanceSettings value={{ ...DEFAULT_CHAT_APPEARANCE, mediaPlayerSurfacePreset: 'minimal' }} onChange={() => undefined} activityGlyphs={DEFAULT_CHAT_APPEARANCE.generationActivityGlyphs} onActivityGlyphsChange={() => undefined} />);
    });

    const text = container.textContent ?? '';
    expect(text).toContain("Styles only Elara's shell around the official YouTube player.");
    expect(text).toContain('Native YouTube controls and the iframe remain untouched.');
  });
});
