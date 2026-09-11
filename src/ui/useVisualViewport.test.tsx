// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisualViewport } from './useVisualViewport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useVisualViewport();
  return null;
}

interface MockVisualViewport {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function mockVisualViewport(height: number, offsetTop = 0): MockVisualViewport {
  return { height, offsetTop, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

function createRafStub() {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  return {
    requestAnimationFrame: (callback: FrameRequestCallback): number => {
      const id = nextId;
      nextId += 1;
      queue.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number): void => { queue.delete(id); },
    flush: (): void => {
      const pending = [...queue.values()];
      queue.clear();
      for (const callback of pending) callback(performance.now());
    },
    get pending(): number { return queue.size; },
  };
}

let container: HTMLDivElement;
let root: Root;
let raf: ReturnType<typeof createRafStub>;
let visualViewport: MockVisualViewport;
let originalRaf: typeof window.requestAnimationFrame;
let originalCancelRaf: typeof window.cancelAnimationFrame;
let originalInnerHeight: number;
let originalVisibilityState: string;

function viewportHeight(): string | null {
  return document.documentElement.style.getPropertyValue('--elara-visual-viewport-height') || null;
}

function keyboardHeight(): string | null {
  return document.documentElement.style.getPropertyValue('--elara-keyboard-height') || null;
}

function keyboardOpen(): boolean {
  return document.documentElement.classList.contains('keyboard-open');
}

function setViewportGeometry(innerHeight: number, visualHeight: number, offsetTop = 0): void {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  visualViewport.height = visualHeight;
  visualViewport.offsetTop = offsetTop;
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness />); });
}

function unmount(): void {
  act(() => { root.unmount(); });
  container.remove();
}

beforeEach(() => {
  originalRaf = window.requestAnimationFrame;
  originalCancelRaf = window.cancelAnimationFrame;
  originalInnerHeight = window.innerHeight;
  originalVisibilityState = document.visibilityState;
  raf = createRafStub();
  window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;
  visualViewport = mockVisualViewport(800);
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  setVisibility('visible');
});

afterEach(() => {
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCancelRaf;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: originalVisibilityState });
  document.documentElement.style.removeProperty('--elara-visual-viewport-height');
  document.documentElement.style.removeProperty('--elara-keyboard-height');
  document.documentElement.classList.remove('keyboard-open');
  vi.restoreAllMocks();
});

describe('useVisualViewport', () => {
  it('writes the initial viewport metrics on mount', () => {
    mount();
    expect(viewportHeight()).toBe('800px');
    expect(keyboardHeight()).toBe('0px');
    expect(keyboardOpen()).toBe(false);
    unmount();
  });

  it('recomputes metrics through the shared update path on resize', () => {
    mount();
    setViewportGeometry(800, 500);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(raf.pending).toBe(1);
    act(() => { raf.flush(); });
    expect(viewportHeight()).toBe('500px');
    expect(keyboardHeight()).toBe('300px');
    expect(keyboardOpen()).toBe(true);
    unmount();
  });

  it('reconciles stale metrics when the app becomes visible again', () => {
    mount();
    // Keyboard was open before the app was backgrounded.
    setViewportGeometry(800, 500);
    act(() => { window.dispatchEvent(new Event('resize')); });
    act(() => { raf.flush(); });
    expect(viewportHeight()).toBe('500px');
    expect(keyboardOpen()).toBe(true);
    // The OS dismissed it while backgrounded, but no resize-class event
    // fired on foreground — the written metrics are now stale.
    setViewportGeometry(800, 800);
    expect(viewportHeight()).toBe('500px');
    expect(keyboardOpen()).toBe(true);

    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { raf.flush(); raf.flush(); });
    expect(viewportHeight()).toBe('800px');
    expect(keyboardHeight()).toBe('0px');
    expect(keyboardOpen()).toBe(false);
    unmount();
  });

  it('reconciles on pageshow and window focus without a resize event', () => {
    mount();
    setViewportGeometry(900, 900);
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    act(() => { raf.flush(); raf.flush(); });
    expect(viewportHeight()).toBe('900px');

    setViewportGeometry(900, 620);
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { raf.flush(); raf.flush(); });
    expect(viewportHeight()).toBe('620px');
    expect(keyboardHeight()).toBe('280px');
    expect(keyboardOpen()).toBe(true);
    unmount();
  });

  it('confirms resume geometry after layout settles instead of keeping a pre-settle capture', () => {
    mount();
    // Resume signal fires while geometry still reports the old values; the
    // browser settles on the new values before the confirmation pass.
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { raf.flush(); });
    expect(viewportHeight()).toBe('800px');
    setViewportGeometry(800, 560);
    act(() => { raf.flush(); });
    expect(viewportHeight()).toBe('560px');
    expect(keyboardHeight()).toBe('240px');
    expect(keyboardOpen()).toBe(true);
    unmount();
  });

  it('ignores visibility loss and cleans up listeners and metrics on unmount', () => {
    mount();
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');

    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(raf.pending).toBe(0);

    unmount();
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('pageshow', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(viewportHeight()).toBeNull();
    expect(keyboardHeight()).toBeNull();
    expect(keyboardOpen()).toBe(false);
  });
});
