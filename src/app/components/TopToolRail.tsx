import { useState } from 'react';
import { Icon } from '../../ui/icons';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import type { WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';
import type { QuickActionId } from '../quick-actions/contracts';
import { WorkspaceMenu } from './WorkspaceMenu';
import { MasterPromptWarning } from './MasterPromptWarning';
import './workspace-menu.css';

export type QuickTool = typeof DEFAULT_QUICK_ACTIONS[number];

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

  function select(shortcut: WorkspaceShortcutDefinition) {
    setOpen(false);
    onAction(shortcut);
  }

  return (
    <>
      <nav className="tool-rail tool-rail--workspace" aria-label="Quick actions">
        <div className="workspace-trigger-wrap">
          <button
            className={`workspace-trigger${open ? ' is-active' : ''}`}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
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
