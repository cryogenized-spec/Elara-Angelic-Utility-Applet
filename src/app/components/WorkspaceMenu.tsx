import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/icons';
import type { QuickActionDescriptor, QuickActionId } from '../quick-actions/contracts';
import { shortcutsForService, type WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';

const serviceTitles: Record<QuickActionId, string> = {
  calendar: 'Calendar',
  tasks: 'Tasks',
  gmail: 'Gmail',
};

/**
 * Consolidated Workspace flyout. One menu lists the Google services; tapping
 * a service expands its saved shortcuts inline, and tapping a shortcut runs it
 * through the existing Workspace execution path.
 */
export function WorkspaceMenu({ tools, activeId, onSelect, onClose }: {
  tools: readonly QuickActionDescriptor[];
  activeId: QuickActionId | null;
  onSelect: (shortcut: WorkspaceShortcutDefinition) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<QuickActionId | null>(activeId);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="workspace-menu" role="menu" aria-label="Google Workspace services">
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
          return (
            <div className="workspace-service" key={tool.id}>
              <button
                type="button"
                role="menuitem"
                aria-label={serviceTitles[tool.id]}
                aria-expanded={isOpen}
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
                <div className="workspace-service__shortcuts" role="group" aria-label={`${serviceTitles[tool.id]} shortcuts`}>
                  {shortcutsForService(tool.id).map((shortcut) => (
                    <button
                      key={shortcut.id}
                      className="workspace-menu__item"
                      type="button"
                      role="menuitem"
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
