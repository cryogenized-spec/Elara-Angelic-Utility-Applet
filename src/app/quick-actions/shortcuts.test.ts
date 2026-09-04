import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_SHORTCUTS, shortcutsForService } from './shortcuts';

const readOnlyGoogleTools = new Set([
  'calendar.listEvents',
  'tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask',
  'gmail.listMessages', 'gmail.getMessage', 'gmail.listThreads', 'gmail.getThread', 'gmail.listLabels', 'gmail.getLabel',
]);

describe('Workspace shortcut recipes', () => {
  it('provides the expected service menus', () => {
    expect(shortcutsForService('calendar')).toHaveLength(5);
    expect(shortcutsForService('tasks')).toHaveLength(5);
    expect(shortcutsForService('gmail')).toHaveLength(4);
  });

  it('keeps every built-in shortcut read-only and capability-scoped', () => {
    for (const shortcut of DEFAULT_WORKSPACE_SHORTCUTS) {
      expect(shortcut.requiredCapabilities.length).toBeGreaterThan(0);
      expect(shortcut.tools.length).toBeGreaterThan(0);
      for (const tool of shortcut.tools) expect(readOnlyGoogleTools.has(tool)).toBe(true);
    }
  });

  it('uses stable ids and non-empty user-facing labels', () => {
    const ids = DEFAULT_WORKSPACE_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of DEFAULT_WORKSPACE_SHORTCUTS) {
      expect(shortcut.label.trim()).not.toBe('');
      expect(shortcut.intent.trim()).not.toBe('');
    }
  });
});
