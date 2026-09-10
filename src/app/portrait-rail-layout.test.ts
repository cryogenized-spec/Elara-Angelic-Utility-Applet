import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The portrait Workspace trigger is positioned purely by CSS. Until the
// browser e2e suite runs, assert the actual rules so a regression to right
// alignment or spine overlap is caught in unit CI.
describe('portrait Workspace tool cluster placement', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/quick-action-rail.css'), 'utf8');
  const rule = css.match(/\.app-shell:has\(\.artwork-mode-portrait\) \.tool-rail--workspace \{([^}]*)\}/)?.[1] ?? '';

  it('anchors the block to the left with an auto right margin', () => {
    const margin = rule.match(/margin:\s*([^;]+);/)?.[1].trim().split(/\s+/);
    expect(margin).toBeDefined();
    const [, right, , left] = margin!;
    expect(right).toBe('auto');
    expect(left).not.toBe('auto');
  });

  it('clears the absolute left spine (12px offset + 42px button)', () => {
    const left = Number.parseInt(rule.match(/margin:\s*\S+\s+\S+\s+\S+\s+(\d+)px/)?.[1] ?? '0', 10);
    expect(left).toBeGreaterThanOrEqual(12 + 42);
  });

  it('opens the services flyout to the right of the single trigger', () => {
    const menu = readFileSync(resolve(process.cwd(), 'src/app/components/workspace-menu.css'), 'utf8');
    expect(menu).toMatch(/\.workspace-menu \{[^}]*left:\s*calc\(100% \+ 8px\);/);
  });

  it('is not overridden by the mobile margin reset (mobile-viewport.css keeps lower specificity)', () => {
    const mobile = readFileSync(resolve(process.cwd(), 'src/app/mobile-viewport.css'), 'utf8');
    expect(mobile).not.toMatch(/artwork-mode-portrait\) \.tool-rail/);
  });
});
