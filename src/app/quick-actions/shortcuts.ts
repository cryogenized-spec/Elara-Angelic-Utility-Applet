import type { GoogleToolName } from '../../google/tools/contracts';
import type { QuickActionId } from './contracts';

export type WorkspaceShortcutId =
  | 'calendar-current'
  | 'calendar-next-five-hours'
  | 'calendar-today'
  | 'calendar-tomorrow'
  | 'calendar-important-upcoming'
  | 'tasks-current'
  | 'tasks-due-today'
  | 'tasks-due-tomorrow'
  | 'tasks-overdue'
  | 'tasks-high-priority'
  | 'gmail-unread-summary'
  | 'gmail-important-recent'
  | 'gmail-recent-from-sender'
  | 'gmail-requiring-reply';

export interface WorkspaceShortcutDefinition {
  readonly id: WorkspaceShortcutId;
  readonly service: QuickActionId;
  readonly label: string;
  readonly description: string;
  readonly intent: string;
  readonly requiredCapabilities: readonly string[];
  readonly tools: readonly GoogleToolName[];
}

export const DEFAULT_WORKSPACE_SHORTCUTS: readonly WorkspaceShortcutDefinition[] = [
  { id: 'calendar-current', service: 'calendar', label: 'Current schedule', description: 'Show the current calendar schedule.', intent: 'Show my current calendar schedule and the next events that matter right now. Prefer a compact chronological summary.', requiredCapabilities: ['calendar.events.read'], tools: ['calendar.listEvents'] },
  { id: 'calendar-next-five-hours', service: 'calendar', label: 'Next five hours', description: 'Show calendar events in the next five hours.', intent: 'Show every calendar event occurring in the next five hours, in chronological order. Include start time, title, and useful location or meeting details when available.', requiredCapabilities: ['calendar.events.read'], tools: ['calendar.listEvents'] },
  { id: 'calendar-today', service: 'calendar', label: 'Today', description: 'Summarize today’s calendar.', intent: 'Summarize today’s calendar in chronological order. Highlight overlaps, back-to-back events, and anything starting soon.', requiredCapabilities: ['calendar.events.read'], tools: ['calendar.listEvents'] },
  { id: 'calendar-tomorrow', service: 'calendar', label: 'Tomorrow', description: 'Summarize tomorrow’s calendar.', intent: 'Summarize tomorrow’s calendar in chronological order, including start/end times and locations or meeting links when available.', requiredCapabilities: ['calendar.events.read'], tools: ['calendar.listEvents'] },
  { id: 'calendar-important-upcoming', service: 'calendar', label: 'Important upcoming', description: 'Surface important upcoming calendar events.', intent: 'Review the upcoming calendar events and surface the most important or time-sensitive items. Explain why each item is worth attention.', requiredCapabilities: ['calendar.events.read'], tools: ['calendar.listEvents'] },
  { id: 'tasks-current', service: 'tasks', label: 'Current', description: 'Show active Google Tasks.', intent: 'Show my active Google Tasks across the available task lists. Group by list and keep the result compact.', requiredCapabilities: ['tasks.read'], tools: ['tasks.listTaskLists', 'tasks.listTasks'] },
  { id: 'tasks-due-today', service: 'tasks', label: 'Due today', description: 'Show tasks due today.', intent: 'Show Google Tasks due today. Group by task list and identify anything that is already overdue or needs immediate attention.', requiredCapabilities: ['tasks.read'], tools: ['tasks.listTaskLists', 'tasks.listTasks'] },
  { id: 'tasks-due-tomorrow', service: 'tasks', label: 'Due tomorrow', description: 'Show tasks due tomorrow.', intent: 'Show Google Tasks due tomorrow, grouped by task list, with due times when present.', requiredCapabilities: ['tasks.read'], tools: ['tasks.listTaskLists', 'tasks.listTasks'] },
  { id: 'tasks-overdue', service: 'tasks', label: 'Overdue', description: 'Show overdue tasks.', intent: 'Show overdue Google Tasks only. Group by task list and prioritize the oldest or most urgent overdue items.', requiredCapabilities: ['tasks.read'], tools: ['tasks.listTaskLists', 'tasks.listTasks'] },
  { id: 'tasks-high-priority', service: 'tasks', label: 'High priority', description: 'Show high-priority tasks.', intent: 'Review my active Google Tasks and identify the highest-priority items using explicit task priority markers first, then due dates and urgency as secondary signals.', requiredCapabilities: ['tasks.read'], tools: ['tasks.listTaskLists', 'tasks.listTasks'] },
  { id: 'gmail-unread-summary', service: 'gmail', label: 'Unread summary', description: 'Summarize unread Gmail.', intent: 'Summarize my unread Gmail messages. Group by sender or topic where useful, call out anything urgent, and avoid dumping full message bodies.', requiredCapabilities: ['gmail.read'], tools: ['gmail.listMessages', 'gmail.getMessage'] },
  { id: 'gmail-important-recent', service: 'gmail', label: 'Important recent', description: 'Summarize important recent Gmail.', intent: 'Review recent important Gmail messages and summarize the items most worth my attention. Prefer concise sender, subject, and reason-for-attention summaries.', requiredCapabilities: ['gmail.read'], tools: ['gmail.listMessages', 'gmail.getMessage'] },
  { id: 'gmail-recent-from-sender', service: 'gmail', label: 'Recent from sender', description: 'Find recent Gmail from a sender.', intent: 'Find recent Gmail from a sender. Before running the search, ask me for the sender or address if it is not already present in the task context.', requiredCapabilities: ['gmail.read'], tools: ['gmail.listMessages', 'gmail.getMessage'] },
  { id: 'gmail-requiring-reply', service: 'gmail', label: 'Requiring reply', description: 'Find recent Gmail that likely needs a reply.', intent: 'Review recent Gmail and identify messages that appear to require a reply from me. Explain the reason briefly and do not send anything.', requiredCapabilities: ['gmail.read'], tools: ['gmail.listMessages', 'gmail.getMessage'] },
];

export function shortcutForId(id: WorkspaceShortcutId): WorkspaceShortcutDefinition {
  const shortcut = DEFAULT_WORKSPACE_SHORTCUTS.find((item) => item.id === id);
  if (!shortcut) throw new Error(`Unknown Workspace shortcut: ${id}`);
  return shortcut;
}

export function shortcutsForService(service: QuickActionId): readonly WorkspaceShortcutDefinition[] {
  return DEFAULT_WORKSPACE_SHORTCUTS.filter((item) => item.service === service);
}
