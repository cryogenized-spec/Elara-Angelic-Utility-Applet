import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSER_VISIBLE_LINES } from './components/composer-autosize';

/**
 * The composer grid and the autosize bound are pure CSS/TS contracts. A browser
 * E2E run is the final word, but these assertions catch a regression (a
 * re-introduced Markdown column, a pixel-constant height) in unit CI.
 */
const composerCss = readFileSync(resolve(process.cwd(), 'src/app/components/composer.css'), 'utf8');
const layoutCss = readFileSync(resolve(process.cwd(), 'src/app/components/composer-layout.css'), 'utf8');
const appCss = readFileSync(resolve(process.cwd(), 'src/app/app.css'), 'utf8');

function columns(css: string, selector: string): string[] {
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return rule
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.startsWith('grid-template-columns'))
    .map((declaration) => declaration.slice(declaration.indexOf(':') + 1).trim());
}

describe('composer grid: the editor owns the free width', () => {
  const grids = [
    ...columns(composerCss, '.composer.composer'),
    ...columns(layoutCss, '.app-shell form.composer'),
    ...columns(layoutCss, '.app-shell form.composer').map(() => ''),
  ].filter(Boolean);

  it('defines the composer grid in both layout files', () => {
    expect(grids.length).toBeGreaterThan(0);
  });

  it('reserves no column for a separate Markdown control', () => {
    for (const value of grids) {
      // paperclip / editor / voice / send — four tracks, one of them flexible.
      const tracks = value.split(/\s+(?![^(]*\))/).filter(Boolean);
      expect(tracks).toHaveLength(4);
      expect(value).toContain('minmax(0');
    }
  });

  it('gives the editor track the whole flexible column', () => {
    for (const value of grids) {
      const flexible = value.split(/\s+(?![^(]*\))/).filter((track) => track.includes('minmax'));
      expect(flexible).toHaveLength(1);
      expect(flexible[0]).toMatch(/minmax\(\s*0(px)?\s*,\s*1fr\s*\)/);
    }
  });

  it('drops the old Markdown button styling entirely', () => {
    expect(composerCss).not.toMatch(/\.composer__markdown\b/);
  });
});

describe('composer autosize bound', () => {
  const textareaRule = composerCss.match(/\.composer textarea\.composer__input \{([^}]*)\}/)?.[1] ?? '';

  it('caps the editor at the shared ~10 line budget', () => {
    expect(COMPOSER_VISIBLE_LINES).toBe(10);
    expect(textareaRule).toMatch(/--composer-visible-lines:\s*10/);
    expect(textareaRule).toMatch(/max-height:\s*calc\(var\(--composer-visible-lines\) \* var\(--composer-line-height\) \+ var\(--composer-block-extra\)\)/);
  });

  it('derives the bound from the editor typography, not a pixel constant', () => {
    expect(textareaRule).toMatch(/--composer-line-height:\s*calc\(1\.35 \* 1em\)/);
    expect(textareaRule).toMatch(/min-height:\s*max\(42px, calc\(var\(--composer-line-height\) \+ var\(--composer-block-extra\)\)\)/);
    // No leftover hardcoded maximum.
    expect(composerCss).not.toMatch(/max-height:\s*132px/);
    expect(appCss).not.toMatch(/max-height:\s*132px/);
  });

  it('lets the engine size the field natively where supported and scrolls past the cap', () => {
    expect(textareaRule).toMatch(/field-sizing:\s*content/);
    expect(textareaRule).toMatch(/overflow-y:\s*auto/);
    expect(textareaRule).not.toMatch(/overflow-y:\s*hidden/);
  });

  it('grows the row with the editor instead of clipping it', () => {
    expect(layoutCss).toMatch(/grid-template-rows:\s*minmax\(42px, auto\)/);
    expect(layoutCss).toMatch(/align-items:\s*end/);
  });

  it('keeps the rail controls bottom-anchored independently of editor growth', () => {
    // Default row flow: the four children share the single row (a column-flow
    // leftover would contradict the documented single-row intent).
    expect(layoutCss).not.toMatch(/grid-auto-flow\s*:/);
    expect(composerCss).not.toMatch(/grid-auto-flow\s*:/);
    // The rail items carry an explicit bottom constraint, scoped to the
    // compact form so the expanded composer's footer is untouched.
    expect(layoutCss).toMatch(/\.app-shell form\.composer > \.composer__attachment-control,[\s\S]*?align-self:\s*end/);
    expect(layoutCss).toMatch(/\.app-shell form\.composer > \.composer__vtt-control/);
    expect(layoutCss).toMatch(/\.app-shell form\.composer > \.composer__send/);
  });

  it('bottom-anchors the expand control instead of centering it in the growing editor', () => {
    const expandRule = composerCss.match(/\.composer__expand \{([^}]*)\}/)?.[1] ?? '';
    expect(expandRule).toMatch(/bottom:\s*8px/);
    expect(expandRule).not.toMatch(/top:\s*50%/);
    expect(expandRule).not.toMatch(/translateY\(-50%\)/);
  });

  it('suppresses the platform tap highlight on composer controls without a global reset', () => {
    // Scoped suppression (the transient green flash on the send button is the
    // browser's default touch feedback, not an author style).
    expect(composerCss).toMatch(/\.composer__send[^{]*\{[^}]*-webkit-tap-highlight-color:\s*transparent/);
    expect(composerCss).toMatch(/\.composer__icon[^{]*\{[^}]*-webkit-tap-highlight-color:\s*transparent/);
    expect(composerCss).toMatch(/touch-action:\s*manipulation/);
    expect(composerCss).not.toMatch(/\*\s*\{[^}]*-webkit-tap-highlight-color/);
    // Explicit pressed affordance that never fires for disabled controls.
    expect(composerCss).toMatch(/\.composer__send:active:not\(:disabled\)[^{]*\{[^}]*transform:\s*scale\(\.96\)/);
    // Accessibility and state behaviour are preserved, not overridden.
    expect(composerCss).not.toMatch(/\.composer__send[^{]*\{[^}]*outline:\s*none/);
    expect(appCss).toMatch(/button:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--blue\)/);
    expect(appCss).toMatch(/\.composer__send:disabled\s*\{[^}]*opacity:\s*\.35/);
  });

  it('keeps the composer in flex flow and lets the conversation absorb the growth', () => {
    // A ten-line composer must never push the conversation out of the shell:
    // the composer reserves its own space (flex: 0 0 auto) and the conversation
    // is the only track allowed to shrink (flex: 1 1 auto; min-height: 0).
    expect(layoutCss).toMatch(/\.app-shell form\.composer \{[^}]*flex:\s*0 0 auto/);
    const conversation = appCss.match(/\.conversation \{([^}]*)\}/)?.[1] ?? '';
    expect(conversation).toMatch(/flex:\s*1 1 auto/);
    expect(conversation).toMatch(/min-height:\s*0/);
  });
});
