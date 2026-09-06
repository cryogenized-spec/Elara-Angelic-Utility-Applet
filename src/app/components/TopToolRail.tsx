import { useState } from 'react';
import { Icon } from '../../ui/icons';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import { shortcutsForService, type WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';
import type { QuickActionId } from '../quick-actions/contracts';
import { WorkspaceShortcutMenu } from './WorkspaceShortcutMenu';
import { MasterPromptWarning } from './MasterPromptWarning';
import './workspace-shortcut-menu.css';

export type QuickTool = typeof DEFAULT_QUICK_ACTIONS[number];

export function TopToolRail({
  tools = DEFAULT_QUICK_ACTIONS,
  onAction,
  activeId = null,
}: {
  tools?: readonly QuickTool[];
  onAction: (shortcut: WorkspaceShortcutDefinition) => void;
  activeId?: QuickActionId | null;
}) {
  const [openId, setOpenId] = useState<QuickActionId | null>(null);

  function toggle(tool: QuickTool) {
    setOpenId((current) => current === tool.id ? null : tool.id);
  }

  function select(shortcut: WorkspaceShortcutDefinition) {
    setOpenId(null);
    onAction(shortcut);
  }

  return (
    <>
      <nav className="tool-rail" aria-label="Quick actions">
        <div className="tool-rail__track">
          {tools.map((tool) => {
            const isOpen = openId === tool.id;
            const isActive = isOpen || activeId === tool.id;
            return (
              <div className="tool-pill__wrap" key={tool.id}>
                <button
                  className={`tool-pill${isActive ? ' is-active' : ''}`}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  aria-pressed={isActive}
                  title={tool.description}
                  onClick={() => toggle(tool)}
                >
                  <Icon name={tool.icon} size={17} />
                  <span>{tool.label}</span>
                </button>
                {isOpen && <WorkspaceShortcutMenu service={tool.id} shortcuts={shortcutsForService(tool.id)} onSelect={select} onClose={() => setOpenId(null)} />}
              </div>
            );
          })}
        </div>
      </nav>
      <MasterPromptWarning />
    </>
  );
}
