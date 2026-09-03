import type { IconName } from '../../ui/icons';

export type QuickActionId = 'calendar' | 'tasks' | 'gmail';

export type QuickActionCapability = 'calendar.events.read' | 'tasks.read' | 'gmail.read';

export interface QuickActionDescriptor {
  readonly id: QuickActionId;
  readonly label: string;
  readonly icon: IconName;
  readonly capability: QuickActionCapability;
  readonly description: string;
}

export interface QuickActionSurface {
  readonly id: QuickActionId;
  readonly title: string;
  readonly capability: QuickActionCapability;
  readonly state: 'ready' | 'authorization-required' | 'unavailable';
  readonly detail: string;
}

export interface QuickActionPort {
  execute(action: QuickActionId): Promise<QuickActionSurface>;
}
