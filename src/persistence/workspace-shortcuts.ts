import type { QuickActionId } from '../app/quick-actions/contracts';
import { DEFAULT_WORKSPACE_SHORTCUTS, type WorkspaceShortcutDefinition, type WorkspaceShortcutId } from '../app/quick-actions/shortcuts';
import type { GoogleToolName } from '../google/tools/contracts';

export interface StoredWorkspaceShortcut {
  id: string;
  service: QuickActionId;
  label: string;
  icon: WorkspaceShortcutDefinition['service'];
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
  return {
    id: definition.id,
    service: definition.service,
    label: definition.label,
    icon: definition.service,
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

export interface WorkspaceShortcutStore {
  list(): Promise<StoredWorkspaceShortcut[]>;
  save(shortcut: StoredWorkspaceShortcut): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryWorkspaceShortcutStore implements WorkspaceShortcutStore {
  private readonly records = new Map<string, StoredWorkspaceShortcut>();

  constructor(seed: readonly StoredWorkspaceShortcut[] = defaultStoredWorkspaceShortcuts()) {
    seed.forEach((record) => this.records.set(record.id, record));
  }

  async list() { return [...this.records.values()].sort((a, b) => a.order - b.order); }
  async save(shortcut: StoredWorkspaceShortcut) { this.records.set(shortcut.id, shortcut); }
  async delete(id: string) { this.records.delete(id); }
}

export function defaultStoredWorkspaceShortcuts(): StoredWorkspaceShortcut[] {
  return DEFAULT_WORKSPACE_SHORTCUTS.map((shortcut, index) => storedShortcutFromDefinition(shortcut, index));
}

export function workspaceShortcutDefinition(record: StoredWorkspaceShortcut): WorkspaceShortcutDefinition {
  const base = DEFAULT_WORKSPACE_SHORTCUTS.find((shortcut) => shortcut.id === record.id as WorkspaceShortcutId);
  return {
    id: record.id as WorkspaceShortcutId,
    service: record.service,
    label: record.label,
    description: base?.description ?? record.label,
    intent: record.intent,
    requiredCapabilities: [...record.requiredCapabilities],
    tools: [...record.referencedTools],
  };
}
