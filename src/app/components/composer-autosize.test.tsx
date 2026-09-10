// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import {
  COMPOSER_VISIBLE_LINES,
  composerBounds,
  measureComposerMetrics,
  nextComposerHeight,
  supportsFieldSizing,
} from './composer-autosize';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Stubbed typography: 16px text at line-height 1.35 with 10px padding + 1px border. */
const LINE_HEIGHT = 21.6;
const BLOCK_EXTRA = 22;
const lines = (count: number) => count * LINE_HEIGHT + BLOCK_EXTRA;

function fakeStyle(): CSSStyleDeclaration {
  return {
    fontSize: '16px',
    lineHeight: '21.6px',
    paddingTop: '10px',
    paddingBottom: '10px',
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
  } as CSSStyleDeclaration;
}

function Harness({ initial = '' }: { initial?: string }) {
  const [draft, setDraft] = useState(initial);
  return <Composer draft={draft} status="idle" systemInstruction="" onDraftChange={setDraft} onSend={() => {}} onCancel={() => {}} />;
}

function mount(): HTMLTextAreaElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness />); });
  return container.querySelector('textarea.composer__input') as HTMLTextAreaElement;
}

/** jsdom has no layout: `scrollHeight` is stubbed per test to a content height. */
function stubScrollHeight(element: HTMLTextAreaElement, read: () => number, counter?: { count: number }): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get() { counter && (counter.count += 1); return read(); },
  });
}

function type(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue(fakeStyle());
  // jsdom claims support for everything: force the measured fallback path.
  vi.spyOn(CSS, 'supports').mockReturnValue(false);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('composer autosize measurements', () => {
  it('reads the real line-height and box extras from the editor typography', () => {
    const metrics = measureComposerMetrics(fakeStyle());
    expect(metrics.lineHeight).toBeCloseTo(LINE_HEIGHT, 5);
    expect(metrics.blockExtra).toBe(BLOCK_EXTRA);
  });

  it('falls back to 1.35em when the engine reports line-height: normal', () => {
    const metrics = measureComposerMetrics({ ...fakeStyle(), lineHeight: 'normal' } as CSSStyleDeclaration);
    expect(metrics.lineHeight).toBeCloseTo(16 * 1.35, 5);
  });

  it('derives the ~10 line cap from that typography instead of a pixel constant', () => {
    const bounds = composerBounds(measureComposerMetrics(fakeStyle()));
    expect(bounds.minHeight).toBe(Math.round(LINE_HEIGHT + BLOCK_EXTRA));
    expect(bounds.maxHeight).toBe(Math.round(COMPOSER_VISIBLE_LINES * LINE_HEIGHT + BLOCK_EXTRA));
    expect(bounds.maxHeight).toBeGreaterThan(bounds.minHeight * 4);
    // A larger text size must move the cap with it.
    const big = composerBounds(measureComposerMetrics({ ...fakeStyle(), fontSize: '20px', lineHeight: '27px' } as CSSStyleDeclaration));
    expect(big.maxHeight).toBeGreaterThan(bounds.maxHeight);
  });

  it('clamps content height between one line and the cap (no runaway growth)', () => {
    const bounds = composerBounds(measureComposerMetrics(fakeStyle()));
    expect(nextComposerHeight(lines(1), bounds)).toBe(bounds.minHeight);
    expect(nextComposerHeight(lines(5), bounds)).toBe(Math.round(lines(5)));
    expect(nextComposerHeight(lines(10), bounds)).toBe(bounds.maxHeight);
    expect(nextComposerHeight(lines(400), bounds)).toBe(bounds.maxHeight);
    expect(nextComposerHeight(0, bounds)).toBe(bounds.minHeight);
    expect(nextComposerHeight(Number.NaN, bounds)).toBe(bounds.minHeight);
  });
});

describe('composer autosize in the DOM', () => {
  it('keeps one line at the minimum and grows to the cap, then stops', () => {
    const textarea = mount();
    let content = lines(1);
    stubScrollHeight(textarea, () => content);
    const bounds = composerBounds(measureComposerMetrics(fakeStyle()));

    type(textarea, 'one line');
    expect(textarea.style.height).toBe(`${bounds.minHeight}px`);

    content = lines(5);
    type(textarea, 'a\n'.repeat(5));
    expect(textarea.style.height).toBe(`${Math.round(lines(5))}px`);

    content = lines(10);
    type(textarea, 'a\n'.repeat(10));
    expect(textarea.style.height).toBe(`${bounds.maxHeight}px`);

    // 11+ lines and a large paste both stop at the cap; the CSS `overflow-y`
    // rule (never rewritten per keystroke) makes the field scroll internally.
    content = lines(11);
    type(textarea, 'a\n'.repeat(11));
    expect(textarea.style.height).toBe(`${bounds.maxHeight}px`);

    content = lines(400);
    type(textarea, 'x'.repeat(20_000));
    expect(textarea.style.height).toBe(`${bounds.maxHeight}px`);
  });

  it('shrinks back down when text is deleted', () => {
    const textarea = mount();
    let content = lines(8);
    stubScrollHeight(textarea, () => content);
    type(textarea, 'a\n'.repeat(8));
    expect(textarea.style.height).toBe(`${Math.round(lines(8))}px`);

    content = lines(3);
    type(textarea, 'a\n'.repeat(3));
    expect(textarea.style.height).toBe(`${Math.round(lines(3))}px`);

    content = lines(1);
    type(textarea, '');
    expect(textarea.style.height).toBe(`${composerBounds(measureComposerMetrics(fakeStyle())).minHeight}px`);
  });

  it('never rewrites overflow-y while typing (no per-keystroke style thrash)', () => {
    const textarea = mount();
    let content = lines(12);
    stubScrollHeight(textarea, () => content);
    type(textarea, 'a\n'.repeat(12));
    expect(textarea.style.overflowY).toBe('');
    content = lines(2);
    type(textarea, 'short');
    expect(textarea.style.overflowY).toBe('');
  });

  it('reads scrollHeight at most once per draft change', () => {
    const textarea = mount();
    const reads = { count: 0 };
    let content = lines(4);
    stubScrollHeight(textarea, () => content, reads);
    type(textarea, 'abcd');
    expect(reads.count).toBeLessThanOrEqual(1);
    content = lines(6);
    type(textarea, 'abcdef');
    expect(reads.count).toBeLessThanOrEqual(2);
  });

  it('publishes the measured typography as CSS custom properties', () => {
    const textarea = mount();
    stubScrollHeight(textarea, () => lines(1));
    type(textarea, 'hi');
    expect(textarea.style.getPropertyValue('--composer-line-height')).toBe(`${LINE_HEIGHT}px`);
    expect(textarea.style.getPropertyValue('--composer-block-extra')).toBe(`${BLOCK_EXTRA}px`);
    expect(textarea.style.getPropertyValue('--composer-visible-lines')).toBe(String(COMPOSER_VISIBLE_LINES));
  });
});

describe('composer autosize with native field sizing', () => {
  it('performs no measurement on the typing path when the engine owns sizing', () => {
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
    expect(supportsFieldSizing()).toBe(true);
    const textarea = mount();
    const reads = { count: 0 };
    stubScrollHeight(textarea, () => lines(9), reads);
    type(textarea, 'typed text');
    expect(reads.count).toBe(0);
    expect(textarea.style.height).toBe('');
  });
});
