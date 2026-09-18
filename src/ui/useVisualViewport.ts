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

/** Visual-height delta treated as an open software keyboard (not browser chrome). */
const KEYBOARD_OPEN_THRESHOLD_PX = 100;

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

  root.style.setProperty('--elara-visual-viewport-height', `${Math.round(visualHeight)}px`);
  root.style.setProperty('--elara-keyboard-height', `${Math.round(keyboardHeight)}px`);
  root.classList.toggle('keyboard-open', keyboardHeight > KEYBOARD_OPEN_THRESHOLD_PX);
}

export function useVisualViewport() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    writeViewportMetrics();
    const visualViewport = getVisualViewport();
    let frame = 0;
    let settleFrame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(writeViewportMetrics);
    };
    // App resume (background -> foreground, bfcache restore, window refocus)
    // does not reliably fire resize-class events, and when it does the first
    // event often precedes settled visualViewport/innerHeight geometry. So
    // resume reconciles through the SAME write path twice: once on the next
    // frame, plus one bounded post-settle confirmation. Identical values are
    // style-write no-ops, and resume signals are infrequent — no layout churn.
    const reconcileAfterResume = () => {
      update();
      window.cancelAnimationFrame(settleFrame);
      settleFrame = window.requestAnimationFrame(() => {
        settleFrame = window.requestAnimationFrame(writeViewportMetrics);
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') reconcileAfterResume();
    };

    window.addEventListener('resize', update, { passive: true });
    visualViewport?.addEventListener('resize', update);
    visualViewport?.addEventListener('scroll', update);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', reconcileAfterResume);
    window.addEventListener('focus', reconcileAfterResume);

    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
    virtualKeyboard?.addEventListener('geometrychange', update);

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      window.removeEventListener('resize', update);
      visualViewport?.removeEventListener('resize', update);
      visualViewport?.removeEventListener('scroll', update);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', reconcileAfterResume);
      window.removeEventListener('focus', reconcileAfterResume);
      virtualKeyboard?.removeEventListener('geometrychange', update);
      document.documentElement.style.removeProperty('--elara-visual-viewport-height');
      document.documentElement.style.removeProperty('--elara-keyboard-height');
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);
}
