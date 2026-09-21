import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/icons';
import { authorizeGoogleWorkspace, googleOAuthAuthority } from '../../google/oauth/authority';
import type { GoogleOAuthStatus } from '../../google/oauth/contracts';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import type { WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';
import type { QuickActionId } from '../quick-actions/contracts';
import { WorkspaceMenu } from './WorkspaceMenu';
import './workspace-menu.css';

export type QuickTool = typeof DEFAULT_QUICK_ACTIONS[number];

type GoogleSessionIndicator = 'checking' | 'online' | 'stale' | 'refreshing';

function hasKnownGoogleAuthorization(status: GoogleOAuthStatus): boolean {
  return Boolean(status.account?.email)
    || status.enabledCapabilities.length > 0
    || status.grantedCapabilities.length > 0
    || status.grantedProviderScopes.length > 0;
}

function indicatorFor(status: GoogleOAuthStatus): GoogleSessionIndicator {
  return status.sessionReady ? 'online' : 'stale';
}

/**
 * The Workspace launcher is a single disclosure button rendered as the second
 * row of the shell's left control cluster, beneath the hamburger + Kanban row.
 * Calendar / Tasks / Gmail never occupy visible rail positions: they live
 * inside the flyout that opens to the right of this trigger.
 */
export function TopToolRail({
  tools = DEFAULT_QUICK_ACTIONS,
  onAction,
  activeId = null,
}: {
  tools?: readonly QuickTool[];
  onAction: (shortcut: WorkspaceShortcutDefinition) => void;
  activeId?: QuickActionId | null;
}) {
  const [open, setOpen] = useState(false);
  const [googleSession, setGoogleSession] = useState<GoogleSessionIndicator>('checking');
  const [googleHasAuthorization, setGoogleHasAuthorization] = useState(false);
  const clusterRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;

    async function synchronizeGoogleSession(): Promise<void> {
      try {
        const status = await googleOAuthAuthority.getStatus();
        if (!active) return;
        setGoogleHasAuthorization(hasKnownGoogleAuthorization(status));
        setGoogleSession(indicatorFor(status));
      } catch {
        if (active) setGoogleSession('stale');
      }
    }

    void synchronizeGoogleSession();
    const interval = window.setInterval(() => void synchronizeGoogleSession(), 60_000);
    const handleFocus = () => void synchronizeGoogleSession();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void synchronizeGoogleSession();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Dismissal lives with the trigger so a tap on the trigger itself is not
  // treated as an outside click (which would close and immediately reopen).
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent): void {
      if (!clusterRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function select(shortcut: WorkspaceShortcutDefinition) {
    setOpen(false);
    onAction(shortcut);
  }

  async function handleTriggerClick(): Promise<void> {
    if (googleSession === 'refreshing') return;

    if (googleSession === 'stale' && googleHasAuthorization) {
      setOpen(false);
      setGoogleSession('refreshing');
      try {
        const status = await authorizeGoogleWorkspace('refresh');
        setGoogleHasAuthorization(hasKnownGoogleAuthorization(status));
        setGoogleSession(indicatorFor(status));
      } catch {
        setGoogleSession('stale');
      }
      return;
    }

    setOpen((current) => !current);
  }

  return (
    <nav className="tool-rail tool-rail--workspace" aria-label="Quick actions">
      <div className="workspace-trigger-wrap" ref={clusterRef}>
        <button
          ref={triggerRef}
          className={`workspace-trigger${open ? ' is-active' : ''}`}
          type="button"
          aria-expanded={open}
          aria-controls={open ? 'workspace-menu' : undefined}
          title={googleSession === 'online'
            ? 'Google Workspace online'
            : googleSession === 'refreshing'
              ? 'Refreshing Google Workspace session'
              : 'Google Workspace session stale'}
          onClick={() => void handleTriggerClick()}
        >
          <span className="workspace-trigger__label">Workspace</span>
          <span className="workspace-trigger__meta" aria-hidden="true">
            <span className="workspace-trigger__google-state" data-state={googleSession} />
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
        {open && <WorkspaceMenu tools={tools} activeId={activeId} onSelect={select} onClose={() => setOpen(false)} />}
      </div>
    </nav>
  );
}
