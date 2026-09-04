import { useEffect, useRef } from 'react';
import { Icon } from '../../ui/icons';
import type { QuickActionId } from '../quick-actions/contracts';
import type { WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';

const capabilityLabels: Record<QuickActionId, string> = {
  calendar: 'calendar.events.read',
  tasks: 'tasks.read',
  gmail: 'gmail.read',
};

const serviceTitles: Record<QuickActionId, string> = {
  calendar: 'Calendar',
  tasks: 'Tasks',
  gmail: 'Gmail',
};

export function WorkspaceShortcutMenu({ service, shortcuts, onSelect, onClose }: {
  service: QuickActionId;
  shortcuts: readonly WorkspaceShortcutDefinition[];
  onSelect: (shortcut: WorkspaceShortcutDefinition) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

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
    <div ref={ref} className="workspace-shortcut-menu" role="menu" aria-label={`${service} shortcuts`}>
      <section className="workspace-shortcut-menu__summary" role="region" aria-label={`${serviceTitles[service]} action surface`}>
        <div>
          <strong>{serviceTitles[service]}</strong>
          <span>Workspace shortcuts</span>
        </div>
        <span className="workspace-shortcut-menu__capability">Capability · {capabilityLabels[service]}</span>
        <button type="button" aria-label={`Close ${serviceTitles[service]} action surface`} onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </section>
      <div className="workspace-shortcut-menu__header">
        <span>CHOOSE AN ACTION</span>
        <button type="button" aria-label="Close shortcut menu" onClick={onClose}><Icon name="close" size={15} /></button>
      </div>
      <div className="workspace-shortcut-menu__items">
        {shortcuts.filter((shortcut) => shortcut.service === service).map((shortcut) => (
          <button key={shortcut.id} className="workspace-shortcut-menu__item" type="button" role="menuitem" onClick={() => onSelect(shortcut)}>
            <span>{shortcut.label}</span>
            <small>{shortcut.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
