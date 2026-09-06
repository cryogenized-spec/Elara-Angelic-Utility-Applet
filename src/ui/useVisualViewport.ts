import { useEffect } from 'react';

interface VisualViewportLike {
  height: number;
  offsetTop: number;
  addEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
  removeEventListener: (type: 'resize' | 'scroll', listener: () => void) => void;
}

interface NavigatorWithVirtualKeyboard extends Navigator {
  virtualKeyboard?: {
    overlaysContent: boolean;
    boundingRect: DOMRect;
    addEventListener: (type: 'geometrychange', listener: () => void) => void;
    removeEventListener: (type: 'geometrychange', listener: () => void) => void;
  };
}

function getVisualViewport(): VisualViewportLike | null {
  if (typeof window === 'undefined' || !window.visualViewport) return null;
  return window.visualViewport as VisualViewportLike;
}

function writeViewportMetrics() {
  const root = document.documentElement;
  const visualViewport = getVisualViewport();
  const visualHeight = visualViewport?.height ?? window.innerHeight;
  const offsetTop = visualViewport?.offsetTop ?? 0;
  const keyboardHeight = Math.max(0, window.innerHeight - visualHeight - offsetTop);

  root.style.setProperty('--elara-keyboard-height', `${Math.round(keyboardHeight)}px`);
}

export function useVisualViewport() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    writeViewportMetrics();
    const visualViewport = getVisualViewport();
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(writeViewportMetrics);
    };

    window.addEventListener('resize', update, { passive: true });
    visualViewport?.addEventListener('resize', update);
    visualViewport?.addEventListener('scroll', update);

    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
    virtualKeyboard?.addEventListener('geometrychange', update);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      visualViewport?.removeEventListener('resize', update);
      visualViewport?.removeEventListener('scroll', update);
      virtualKeyboard?.removeEventListener('geometrychange', update);
      document.documentElement.style.removeProperty('--elara-keyboard-height');
    };
  }, []);
}
