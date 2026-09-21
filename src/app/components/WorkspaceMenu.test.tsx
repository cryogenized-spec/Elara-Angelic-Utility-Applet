// @vitest-environment jsdom
/**
 * Workspace rail contract:
 *  - one trigger by default, no per-service pills in the top rail
 *  - disclosure/popover semantics (not a fake desktop application menu)
 *  - no stale expanded service when reopened
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopToolRail } from './TopToolRail';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import { shortcutsForService, type WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';
import type { GoogleOAuthStatus } from '../../google/oauth/contracts';
import { authorizeGoogleWorkspace, googleOAuthAuthority } from '../../google/oauth/authority';

vi.mock('../../google/oauth/authority', () => ({
  authorizeGoogleWorkspace: vi.fn(),
  googleOAuthAuthority: { getStatus: vi.fn() },
}));

const disconnectedGoogleStatus = {
  state: 'disconnected',
  grantedCapabilities: [],
  enabledCapabilities: [],
  grantedProviderScopes: [],
  sessionReady: false,
} satisfies GoogleOAuthStatus;

const staleGoogleStatus = {
  state: 'connected',
  grantedCapabilities: ['google.account'],
  enabledCapabilities: ['google.account'],
  grantedProviderScopes: ['https://www.googleapis.com/auth/userinfo.email'],
  sessionReady: false,
  account: { email: 'test@example.com' },
} satisfies GoogleOAuthStatus;

const onlineGoogleStatus = {
  ...staleGoogleStatus,
  sessionReady: true,
} satisfies GoogleOAuthStatus;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(): void {
  act(() => {
    root.render(<TopToolRail tools={DEFAULT_QUICK_ACTIONS} activeId={null} onAction={(shortcut) => actions.push(shortcut)} />);
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
  vi.mocked(googleOAuthAuthority).getStatus.mockReset();
  vi.mocked(googleOAuthAuthority).getStatus.mockResolvedValue(disconnectedGoogleStatus);
  vi.mocked(authorizeGoogleWorkspace).mockReset();
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

describe('Google session indicator', () => {
  it('refreshes a stale session from the Workspace trigger before opening shortcuts', async () => {
    vi.mocked(googleOAuthAuthority).getStatus.mockResolvedValue(staleGoogleStatus);
    let completeRefresh!: (status: GoogleOAuthStatus) => void;
    vi.mocked(authorizeGoogleWorkspace).mockImplementation(() => new Promise((resolve) => {
      completeRefresh = resolve;
    }));

    render();
    await act(async () => { await Promise.resolve(); });
    const indicator = container.querySelector('.workspace-trigger__google-state')!;
    expect(indicator.getAttribute('data-state')).toBe('stale');

    act(() => { trigger().click(); });
    expect(indicator.getAttribute('data-state')).toBe('refreshing');
    expect(panel()).toBeNull();

    await act(async () => { completeRefresh(onlineGoogleStatus); });
    expect(indicator.getAttribute('data-state')).toBe('online');
    expect(panel()).toBeNull();

    act(() => { trigger().click(); });
    expect(panel()).not.toBeNull();
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
