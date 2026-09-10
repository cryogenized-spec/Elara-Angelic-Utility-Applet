import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/icons';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import type { WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';
import type { QuickActionId } from '../quick-actions/contracts';
import { WorkspaceMenu } from './WorkspaceMenu';
import { MasterPromptWarning } from './MasterPromptWarning';
import './workspace-menu.css';

export type QuickTool = typeof DEFAULT_QUICK_ACTIONS[number];

/**
 * The Workspace launcher is a single disclosure button. Calendar / Tasks /
 * Gmail never occupy visible top-rail positions: they live inside the flyout
 * that opens to the right of this trigger.
 */
export function TopToolRail({
  tools = DEFAULT_QUICK_ACTIONS,
  onAction,
  activeId = null,
  systemInstruction,
}: {
  tools?: readonly QuickTool[];
  onAction: (shortcut: WorkspaceShortcutDefinition) => void;
  activeId?: QuickActionId | null;
  systemInstruction: string;
}) {
  const [open, setOpen] = useState(false);
  const clusterRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <>
      <nav className="tool-rail tool-rail--workspace" aria-label="Quick actions">
        <div className="workspace-trigger-wrap" ref={clusterRef}>
          <button
            ref={triggerRef}
            className={`workspace-trigger${open ? ' is-active' : ''}`}
            type="button"
            aria-expanded={open}
            aria-controls={open ? 'workspace-menu' : undefined}
            title="Google Workspace shortcuts"
            onClick={() => setOpen((current) => !current)}
          >
            <span className="workspace-trigger__label">Workspace</span>
            <Icon name="chevron-right" size={16} />
          </button>
          {open && <WorkspaceMenu tools={tools} activeId={activeId} onSelect={select} onClose={() => setOpen(false)} />}
        </div>
      </nav>
      <MasterPromptWarning systemInstruction={systemInstruction} />
    </>
  );
}
