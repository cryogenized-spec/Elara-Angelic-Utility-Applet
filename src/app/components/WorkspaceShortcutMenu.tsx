import { useEffect, useRef } from 'react';
import { Icon } from '../../ui/icons';
import type { QuickActionId } from '../quick-actions/contracts';
import type { WorkspaceShortcutDefinition } from '../quick-actions/shortcuts';

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
      <div className="workspace-shortcut-menu__header">
        <span>WORKSPACE SHORTCUTS</span>
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
