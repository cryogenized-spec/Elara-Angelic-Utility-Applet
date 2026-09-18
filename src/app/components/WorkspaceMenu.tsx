import { useState } from 'react';
import { Icon } from '../../ui/icons';
import type { QuickActionDescriptor, QuickActionId } from '../quick-actions/contracts';
import { shortcutsForService, type WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';

const serviceTitles: Record<QuickActionId, string> = {
  calendar: 'Calendar',
  tasks: 'Tasks',
  gmail: 'Gmail',
};

/**
 * Consolidated Workspace flyout. One panel lists the Google services; tapping a
 * service expands its saved shortcuts inline, and tapping a shortcut runs it
 * through the existing Workspace execution path.
 *
 * Semantics: this is a **disclosure popover**, not a desktop application menu.
 * The trigger owns `aria-expanded`/`aria-controls`, the panel is a labelled
 * group, each service row is a disclosure button for its shortcut group, and
 * every shortcut is an ordinary button. Tab/Shift+Tab and Enter/Space therefore
 * behave exactly as the visible interaction implies — no synthetic roving
 * tabindex or arrow-key model that touch users never see.
 *
 * The panel is mounted only while open, so a reopened flyout always starts from
 * the collapsed state (no stale expanded service).
 */
export function WorkspaceMenu({ tools, activeId, onSelect, onClose }: {
  tools: readonly QuickActionDescriptor[];
  activeId: QuickActionId | null;
  onSelect: (shortcut: WorkspaceShortcutDefinition) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<QuickActionId | null>(activeId);

  return (
    <div id="workspace-menu" className="workspace-menu" role="group" aria-label="Google Workspace services">
      <div className="workspace-menu__header">
        <span>GOOGLE SERVICES</span>
        <button type="button" aria-label="Close Workspace menu" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="workspace-menu__services">
        {tools.map((tool) => {
          const isOpen = expanded === tool.id;
          const isActive = activeId === tool.id;
          const panelId = `workspace-${tool.id}-shortcuts`;
          return (
            <div className="workspace-service" key={tool.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-label={serviceTitles[tool.id]}
                title={tool.description}
                className={`workspace-service__row${isOpen ? ' is-open' : ''}${isActive ? ' is-active' : ''}`}
                onClick={() => setExpanded((current) => (current === tool.id ? null : tool.id))}
              >
                <Icon name={tool.icon} size={17} />
                <span className="workspace-service__text">
                  <span>{serviceTitles[tool.id]}</span>
                  <small>{tool.capability}</small>
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
              {isOpen && (
                <div className="workspace-service__shortcuts" id={panelId} role="group" aria-label={`${serviceTitles[tool.id]} shortcuts`}>
                  {shortcutsForService(tool.id).map((shortcut) => (
                    <button
                      key={shortcut.id}
                      className="workspace-menu__item"
                      type="button"
                      onClick={() => onSelect(shortcut)}
                    >
                      <span>{shortcut.label}</span>
                      <small>{shortcut.description}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
