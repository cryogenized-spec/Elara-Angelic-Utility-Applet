import { useEffect, useState } from 'react';
import { Icon } from '../../ui/icons';
import { ensureWorkspaceShortcuts, workspaceShortcutStore, type StoredWorkspaceShortcut } from '../../persistence/workspace-shortcuts';

const serviceNames: Record<StoredWorkspaceShortcut['service'], string> = {
  calendar: 'Calendar',
  tasks: 'Tasks',
  gmail: 'Gmail',
};

export function WorkspaceShortcutSettings() {
  const [shortcuts, setShortcuts] = useState<StoredWorkspaceShortcut[]>([]);

  useEffect(() => {
    let cancelled = false;
    void ensureWorkspaceShortcuts().then((items) => { if (!cancelled) setShortcuts(items); });
    return () => { cancelled = true; };
  }, []);

  async function toggle(shortcut: StoredWorkspaceShortcut) {
    const next = { ...shortcut, enabled: !shortcut.enabled };
    setShortcuts((current) => current.map((item) => item.id === next.id ? next : item));
    try {
      await workspaceShortcutStore.save(next);
    } catch {
      setShortcuts((current) => current.map((item) => item.id === shortcut.id ? shortcut : item));
    }
  }

  return (
    <div className="workspace-shortcut-settings">
      <div className="workspace-shortcut-settings__header">
        <div><strong>Workspace shortcuts</strong><span>Saved locally in IndexedDB. Disabled shortcuts stay stored but do not execute.</span></div>
        <Icon name="shield" size={17} />
      </div>
      <div className="workspace-shortcut-settings__list">
        {shortcuts.map((shortcut) => (
          <label className="workspace-shortcut-settings__row" key={shortcut.id}>
            <span><b>{shortcut.label}</b><small>{serviceNames[shortcut.service]} · {shortcut.source === 'built-in' ? 'Built-in recipe' : 'Generated recipe'}</small></span>
            <input type="checkbox" checked={shortcut.enabled} onChange={() => void toggle(shortcut)} aria-label={`${shortcut.label} enabled`} />
          </label>
        ))}
      </div>
    </div>
  );
}
