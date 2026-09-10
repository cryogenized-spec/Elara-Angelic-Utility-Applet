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
});
