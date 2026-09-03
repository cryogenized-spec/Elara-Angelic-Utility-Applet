import type { QuickActionDescriptor, QuickActionId, QuickActionPort, QuickActionSurface } from './contracts';

export const DEFAULT_QUICK_ACTIONS: readonly QuickActionDescriptor[] = [
  {
    id: 'calendar',
    label: 'Calendar',
    icon: 'calendar',
    capability: 'calendar.events.read',
    description: 'Open the Calendar action surface.',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'tasks',
    capability: 'tasks.read',
    description: 'Open the Tasks action surface.',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    icon: 'mail',
    capability: 'gmail.read',
    description: 'Open the Gmail action surface.',
  },
];

const SURFACE_DETAILS: Record<QuickActionId, { title: string; detail: string }> = {
  calendar: {
    title: 'Calendar',
    detail: 'Calendar is wired to the application capability boundary. Connect Calendar access in Settings when the Workspace authorization layer is enabled.',
  },
  tasks: {
    title: 'Tasks',
    detail: 'Tasks is wired to the application capability boundary. Connect Tasks access in Settings when the Workspace authorization layer is enabled.',
  },
  gmail: {
    title: 'Gmail',
    detail: 'Gmail is wired to the application capability boundary. Connect Gmail access in Settings when the Workspace authorization layer is enabled.',
  },
};

export const demoQuickActionPort: QuickActionPort = {
  async execute(action): Promise<QuickActionSurface> {
    const descriptor = DEFAULT_QUICK_ACTIONS.find((item) => item.id === action);
    if (!descriptor) throw new Error(`Unknown quick action: ${action}`);
    const surface = SURFACE_DETAILS[action];
    return {
      id: action,
      title: surface.title,
      capability: descriptor.capability,
      state: 'authorization-required',
      detail: surface.detail,
    };
  },
};
