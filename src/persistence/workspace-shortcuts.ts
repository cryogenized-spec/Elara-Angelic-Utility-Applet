import type { IconName } from '../ui/icons';
import type { QuickActionId } from '../app/quick-actions/contracts';
import { DEFAULT_WORKSPACE_SHORTCUTS, type WorkspaceShortcutDefinition } from '../app/quick-actions/shortcuts';
import type { GoogleToolName } from '../google/tools/contracts';
import { deleteWorkspaceShortcut, loadWorkspaceShortcuts, saveWorkspaceShortcut } from './conversation';

export interface StoredWorkspaceShortcut {
  id: string;
  service: QuickActionId;
  label: string;
  icon: IconName;
  intent: string;
  source: 'built-in' | 'generated';
  requiredCapabilities: string[];
  generatedPlan?: string;
  referencedTools: GoogleToolName[];
  enabled: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export function storedShortcutFromDefinition(definition: WorkspaceShortcutDefinition, order: number): StoredWorkspaceShortcut {
  const now = Date.now();
  const icon: IconName = definition.service === 'calendar' ? 'calendar' : definition.service === 'tasks' ? 'tasks' : 'mail';
  return {
    id: definition.id,
    service: definition.service,
    label: definition.label,
    icon,
    intent: definition.intent,
    source: 'built-in',
    requiredCapabilities: [...definition.requiredCapabilities],
    referencedTools: [...definition.tools],
    enabled: true,
    order,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultStoredWorkspaceShortcuts(): StoredWorkspaceShortcut[] {
  return DEFAULT_WORKSPACE_SHORTCUTS.map((shortcut, index) => storedShortcutFromDefinition(shortcut, index));
}

export async function ensureWorkspaceShortcuts(): Promise<StoredWorkspaceShortcut[]> {
  const current = await loadWorkspaceShortcuts();
  if (current.length > 0) return current;
  const defaults = defaultStoredWorkspaceShortcuts();
  for (const shortcut of defaults) await saveWorkspaceShortcut(shortcut);
  return defaults;
}

export const workspaceShortcutStore = {
  list: ensureWorkspaceShortcuts,
  save: saveWorkspaceShortcut,
  delete: deleteWorkspaceShortcut,
};

export function workspaceShortcutDefinition(record: StoredWorkspaceShortcut): WorkspaceShortcutDefinition {
  const base = DEFAULT_WORKSPACE_SHORTCUTS.find((shortcut) => shortcut.id === record.id);
  return {
    id: record.id as WorkspaceShortcutDefinition['id'],
    service: record.service,
    label: record.label,
    description: base?.description ?? record.label,
    intent: record.intent,
    requiredCapabilities: [...record.requiredCapabilities],
    tools: [...record.referencedTools],
  };
}
