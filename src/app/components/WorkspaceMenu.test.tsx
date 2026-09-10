// @vitest-environment jsdom
/**
 * Workspace rail contract:
 *  - one trigger by default, no per-service pills in the top rail
 *  - the flyout opens to the right of that trigger and stays in the viewport
 *  - disclosure/popover semantics (not a fake desktop application menu)
 *  - no stale expanded service when reopened
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopToolRail } from './TopToolRail';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import { shortcutsForService, type WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(systemInstruction = 'You are Elara.'): void {
  act(() => {
    root.render(<TopToolRail tools={DEFAULT_QUICK_ACTIONS} activeId={null} systemInstruction={systemInstruction} onAction={(shortcut) => actions.push(shortcut)} />);
  });
}

const actions: WorkspaceShortcutDefinition[] = [];

function trigger(): HTMLButtonElement { return container.querySelector('.workspace-trigger')!; }
function panel(): HTMLElement | null { return container.querySelector('.workspace-menu'); }
function service(name: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('.workspace-service__row')).find((button) => button.getAttribute('aria-label') === name) as HTMLButtonElement;
}
function shortcutButtons(): HTMLButtonElement[] { return Array.from(container.querySelectorAll('.workspace-menu__item')); }

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  actions.length = 0;
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('default state', () => {
  it('shows exactly one Workspace button and no individual service controls', () => {
    render();
    const rail = container.querySelector('.tool-rail--workspace')!;
    const buttons = Array.from(rail.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Workspace');
    for (const name of ['Calendar', 'Tasks', 'Gmail']) {
      expect(container.querySelector(`[aria-label="${name}"]`)).toBeNull();
      expect(container.textContent).not.toContain(name);
    }
    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('does not keep a stale flyout open (services are mounted only while open)', () => {
    render();
    act(() => { trigger().click(); });
    expect(panel()).not.toBeNull();
    act(() => { trigger().click(); });
    expect(panel()).toBeNull();
  });
});

describe('flyout interaction', () => {
  it('lists the services vertically and expands one service at a time', () => {
    render();
    act(() => { trigger().click(); });
    for (const name of ['Calendar', 'Tasks', 'Gmail']) expect(service(name)).toBeTruthy();
    expect(shortcutButtons()).toHaveLength(0);

    act(() => { service('Calendar').click(); });
    expect(shortcutButtons()).toHaveLength(shortcutsForService('calendar').length);
    expect(service('Calendar').getAttribute('aria-expanded')).toBe('true');

    act(() => { service('Tasks').click(); });
    expect(service('Calendar').getAttribute('aria-expanded')).toBe('false');
    expect(shortcutButtons()).toHaveLength(shortcutsForService('tasks').length);
  });

  it('runs a shortcut through the existing callback and closes', () => {
    render();
    act(() => { trigger().click(); });
    act(() => { service('Gmail').click(); });
    const target = shortcutButtons().find((button) => button.textContent?.includes('Unread summary'))!;
    act(() => { target.click(); });
    expect(actions.map((shortcut) => shortcut.id)).toEqual(['gmail-unread-summary']);
    expect(panel()).toBeNull();
  });

  it('starts collapsed again when reopened (no stale expanded service)', () => {
    render();
    act(() => { trigger().click(); });
    act(() => { service('Calendar').click(); });
    expect(shortcutButtons().length).toBeGreaterThan(0);
    act(() => { trigger().click(); });
    act(() => { trigger().click(); });
    expect(shortcutButtons()).toHaveLength(0);
    expect(service('Calendar').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on an outside pointerdown', () => {
    render();
    act(() => { trigger().click(); });
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(panel()).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render();
    act(() => { trigger().click(); });
    act(() => { service('Tasks').focus(); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps every service row keyboard reachable as a real button', () => {
    render();
    act(() => { trigger().click(); });
    for (const name of ['Calendar', 'Tasks', 'Gmail']) {
      const button = service(name);
      expect(button.tagName).toBe('BUTTON');
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('type')).toBe('button');
    }
    // Enter/Space activation is native; nothing intercepts it.
    act(() => { service('Calendar').click(); });
    expect(service('Calendar').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('accessibility semantics', () => {
  it('is a disclosure popover, not an unimplemented application menu', () => {
    render();
    act(() => { trigger().click(); });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(0);

    const flyout = panel()!;
    expect(flyout.getAttribute('role')).toBe('group');
    expect(flyout.getAttribute('aria-label')).toBe('Google Workspace services');
    expect(trigger().getAttribute('aria-controls')).toBe(flyout.id);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('wires each service row to its shortcut group', () => {
    render();
    act(() => { trigger().click(); });
    act(() => { service('Calendar').click(); });
    const controls = service('Calendar').getAttribute('aria-controls')!;
    expect(controls).toBeTruthy();
    const group = container.querySelector(`#${controls}`)!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Calendar shortcuts');
    expect(group.querySelectorAll('button').length).toBe(shortcutsForService('calendar').length);
  });

  it('gives every control an accessible name', () => {
    render();
    act(() => { trigger().click(); });
    for (const name of ['Calendar', 'Tasks', 'Gmail']) expect(service(name).getAttribute('aria-label')).toBe(name);
    act(() => { service('Tasks').click(); });
    for (const button of shortcutButtons()) expect(button.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(container.querySelector('button[aria-label="Close Workspace menu"]')).not.toBeNull();
  });
});

describe('flyout geometry (CSS contract)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/components/workspace-menu.css'), 'utf8');
  const rule = css.match(/\.workspace-menu \{([^}]*)\}/)?.[1] ?? '';
  const narrow = css.match(/@media \(max-width: (\d+)px\) \{\s*\.workspace-menu \{([^}]*)\}/)?.[0] ?? '';
  /** Worst-case left edge documented in the stylesheet: 12px shell padding + 62px rail margin + ~130px trigger + 8px gap. */
  const WORST_CASE_LEFT_PX = 212;

  const clamp = (property: 'min-width' | 'max-width', viewport: number): number => {
    const declaration = rule.match(new RegExp(`${property}: min\\((\\d+)px, calc\\(100vw - (\\d+)px\\)\\)`));
    expect(declaration, `${property} clamp missing`).toBeTruthy();
    return Math.min(Number(declaration![1]), viewport - Number(declaration![2]));
  };

  it('opens to the right of the single trigger', () => {
    expect(rule).toMatch(/left:\s*calc\(100% \+ 8px\)/);
  });

  it('never lets min-width defeat the viewport clamp', () => {
    for (const width of [320, 360, 390, 412, 480, 520]) {
      expect(clamp('min-width', width)).toBeLessThanOrEqual(clamp('max-width', width));
    }
  });

  it('stays inside common Android portrait widths (360–412px)', () => {
    for (const width of [360, 375, 390, 401, 412]) {
      const panelWidth = clamp('max-width', width);
      expect(WORST_CASE_LEFT_PX + panelWidth).toBeLessThanOrEqual(width);
      // And it never gets so narrow that a service row becomes unusable.
      expect(clamp('min-width', width)).toBeGreaterThanOrEqual(120);
    }
  });

  it('reuses the narrow-width fallback below 401px', () => {
    expect(narrow).toMatch(/@media \(max-width: 400px\)/);
    expect(narrow).toMatch(/left:\s*0/);
    expect(narrow).toMatch(/top:\s*calc\(100% \+ 8px\)/);
  });

  it('bounds the height so the flyout cannot swallow the composer', () => {
    expect(rule).toMatch(/max-height:\s*min\(60vh, 440px\)/);
  });
});
