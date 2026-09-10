import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Composer autosize contract.
 *
 * The compact composer grows with the draft and switches to internal scrolling
 * once it reaches `COMPOSER_VISIBLE_LINES` lines. The bound is derived from the
 * editor's own typography (computed `line-height` + vertical padding/border) so
 * it keeps working when the text size or font changes, instead of being a
 * hardcoded pixel constant.
 *
 * Two paths, one contract:
 *  - Chromium (`field-sizing: content`) sizes the textarea natively: the typing
 *    path performs no DOM measurement or style writes.
 *  - Everywhere else a single `scrollHeight` read per draft change (the previous
 *    implementation forced two synchronous layouts and two style writes per
 *    keystroke, even when the height had not changed).
 */
export const COMPOSER_VISIBLE_LINES = 10;

/** Fallback for engines that report `line-height: normal`. Matches the stylesheet. */
const FALLBACK_LINE_HEIGHT_RATIO = 1.35;
const FALLBACK_FONT_SIZE = 16;

export interface ComposerMetrics {
  lineHeight: number;
  /** Vertical padding + borders: everything the content box does not own. */
  blockExtra: number;
}

export interface ComposerBounds {
  minHeight: number;
  maxHeight: number;
}

function px(value: string | undefined | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads the editor's real typography from a computed style. */
export function measureComposerMetrics(style: CSSStyleDeclaration): ComposerMetrics {
  const fontSize = px(style.fontSize, FALLBACK_FONT_SIZE) || FALLBACK_FONT_SIZE;
  const declared = style.lineHeight;
  const ratioLineHeight = fontSize * FALLBACK_LINE_HEIGHT_RATIO;
  const lineHeight = !declared || declared === 'normal' ? ratioLineHeight : px(declared, ratioLineHeight);
  const blockExtra =
    px(style.paddingTop, 0) +
    px(style.paddingBottom, 0) +
    px(style.borderTopWidth, 0) +
    px(style.borderBottomWidth, 0);
  return { lineHeight: lineHeight > 0 ? lineHeight : ratioLineHeight, blockExtra };
}

/** One line and `lines` lines, in pixels, including padding and borders. */
export function composerBounds(metrics: ComposerMetrics, lines: number = COMPOSER_VISIBLE_LINES): ComposerBounds {
  const lineHeight = metrics.lineHeight > 0 ? metrics.lineHeight : FALLBACK_FONT_SIZE * FALLBACK_LINE_HEIGHT_RATIO;
  return {
    minHeight: Math.round(lineHeight + metrics.blockExtra),
    maxHeight: Math.round(lineHeight * lines + metrics.blockExtra),
  };
}

/** Clamped height for a measured content height. Never grows past the cap. */
export function nextComposerHeight(contentHeight: number, bounds: ComposerBounds): number {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return bounds.minHeight;
  return Math.min(bounds.maxHeight, Math.max(bounds.minHeight, Math.round(contentHeight)));
}

export function supportsFieldSizing(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('field-sizing', 'content');
}

function publishMetrics(
  element: HTMLTextAreaElement,
  metrics: ComposerMetrics,
  lines: number,
  publishedRef: { current: string | null },
): void {
  const signature = `${metrics.lineHeight}|${metrics.blockExtra}|${lines}`;
  if (publishedRef.current === signature) return;
  publishedRef.current = signature;
  element.style.setProperty('--composer-line-height', `${metrics.lineHeight}px`);
  element.style.setProperty('--composer-block-extra', `${metrics.blockExtra}px`);
  element.style.setProperty('--composer-visible-lines', String(lines));
}

/**
 * Sizes the textarea to its draft, capped at `lines` visible lines.
 * Returns the applied height (0 when the engine owns sizing).
 */
function syncHeight(
  element: HTMLTextAreaElement,
  metrics: ComposerMetrics,
  lines: number,
  publishedRef: { current: string | null },
  fieldSizingRef: { current: boolean | null },
): number {
  const bounds = composerBounds(metrics, lines);
  publishMetrics(element, metrics, lines, publishedRef);
  if (fieldSizingRef.current === null) fieldSizingRef.current = supportsFieldSizing();
  if (fieldSizingRef.current) return 0;
  element.style.height = 'auto';
  const next = nextComposerHeight(element.scrollHeight, bounds);
  element.style.height = `${next}px`;
  return next;
}

export interface ComposerAutosizeOptions {
  /** Skip all work while another editor (e.g. the expanded composer) is active. */
  enabled: boolean;
  lines?: number;
}

/**
 * Keeps a textarea sized to its content between one and `lines` lines.
 * Measurement is cached: typography is re-read only on mount, when fonts finish
 * loading, or when the element's width actually changes. Published CSS variables
 * and field-sizing support are also cached, so the Chromium typing path performs
 * no repeated DOM reads or writes.
 */
export function useComposerAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { enabled, lines = COMPOSER_VISIBLE_LINES }: ComposerAutosizeOptions,
): void {
  const metricsRef = useRef<ComposerMetrics | null>(null);
  const widthRef = useRef(0);
  const publishedMetricsRef = useRef<string | null>(null);
  const fieldSizingRef = useRef<boolean | null>(null);

  const measure = useCallback((): ComposerMetrics | null => {
    const element = ref.current;
    if (!element || typeof window === 'undefined') return null;
    if (!metricsRef.current) metricsRef.current = measureComposerMetrics(window.getComputedStyle(element));
    return metricsRef.current;
  }, [ref]);

  // Applied before paint so the row never renders at a stale height.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const metrics = measure();
    if (!metrics) return;
    syncHeight(element, metrics, lines, publishedMetricsRef, fieldSizingRef);
  }, [enabled, lines, measure, ref, value]);

  // Re-measure only when the box width changes (rotation, resize, breakpoint
  // font-size changes) — never on every keystroke.
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return undefined;
    widthRef.current = element.offsetWidth;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width === widthRef.current) return;
      widthRef.current = width;
      metricsRef.current = null;
      publishedMetricsRef.current = null;
      const metrics = measure();
      if (metrics) syncHeight(element, metrics, lines, publishedMetricsRef, fieldSizingRef);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, lines, measure, ref]);

  // A webfont swapping in changes the real line-height.
  useEffect(() => {
    if (!enabled) return undefined;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.ready) return undefined;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (cancelled) return;
      const element = ref.current;
      if (!element) return;
      metricsRef.current = null;
      publishedMetricsRef.current = null;
      const metrics = measure();
      if (metrics) syncHeight(element, metrics, lines, publishedMetricsRef, fieldSizingRef);
    });
    return () => { cancelled = true; };
  }, [enabled, lines, measure, ref]);
}
