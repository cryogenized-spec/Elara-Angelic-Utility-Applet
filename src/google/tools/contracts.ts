import { z } from 'zod';

export const googleToolNameSchema = z.enum([
  'calendar.listCalendars', 'calendar.listEvents', 'calendar.getEvent', 'calendar.getSettings', 'calendar.queryFreeBusy', 'calendar.createEvent', 'calendar.updateEvent', 'calendar.deleteEvent',
  'tasks.listTaskLists', 'tasks.getTaskList', 'tasks.listTasks', 'tasks.getTask', 'tasks.createTaskList', 'tasks.updateTaskList', 'tasks.deleteTaskList', 'tasks.createTask', 'tasks.updateTask', 'tasks.moveTask', 'tasks.deleteTask', 'tasks.clearCompleted',
  'docs.getDocument', 'docs.inspectDocument', 'docs.exportDocument', 'docs.createDocument', 'docs.insertText', 'docs.appendParagraph', 'docs.replaceText', 'docs.batchUpdate',
  'document.create_pdf',
  'chat.listMessages', 'chat.getMessage', 'chat.createMessage', 'chat.updateMessage', 'chat.deleteMessage',
  'gmail.listMessages', 'gmail.getMessage', 'gmail.listThreads', 'gmail.getThread', 'gmail.listLabels', 'gmail.getLabel', 'gmail.modifyMessage', 'gmail.modifyThread', 'gmail.trashMessage', 'gmail.untrashMessage', 'gmail.trashThread', 'gmail.untrashThread', 'gmail.createLabel', 'gmail.updateLabel', 'gmail.deleteLabel', 'gmail.sendMessage', 'gmail.replyMessage',
  'drive.searchFiles', 'drive.searchLibrary', 'drive.getFile', 'drive.downloadFile', 'drive.createFile', 'drive.updateFile', 'drive.moveFile', 'drive.trashFile',
  'sheets.getSpreadsheet', 'sheets.readRange', 'sheets.exportSpreadsheet', 'sheets.createSpreadsheet', 'sheets.addSheet', 'sheets.writeRange', 'sheets.appendRows', 'sheets.updateCell', 'sheets.insertRows', 'sheets.batchUpdate',
  'roleplay_setting.list', 'roleplay_setting.inspect', 'roleplay_setting.create', 'roleplay_setting.update', 'roleplay_setting.move', 'roleplay_setting.delete',
  'memory.recall', 'memory.lookup', 'memory.save', 'memory.reconcile',
  'youtube.search',
]);

export type GoogleToolName = z.infer<typeof googleToolNameSchema>;

export const googleToolCallSchema = z.object({
  tool: googleToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

export type GoogleToolCall = z.infer<typeof googleToolCallSchema>;

export type GoogleToolRisk = 'read' | 'write' | 'destructive' | 'send';
export type GoogleToolExposure = 'gemini' | 'internal';
export type GoogleToolExecutionPlane = 'browser' | 'worker';

export type ToolActivityCategory = 'google-workspace' | 'youtube' | 'roleplay' | 'documents' | 'memory' | 'other';
export interface ToolActivityPresentation {
  readonly category: ToolActivityCategory;
  readonly categoryLabel: string;
  readonly serviceLabel?: string;
  readonly actionLabel: string;
}

export interface GoogleToolDescriptor {
  readonly name: GoogleToolName;
  readonly risk: GoogleToolRisk;
  readonly capability: string;
  /** Additional authorities that must already be effective before confirmation/handler execution. */
  readonly prerequisiteCapabilities?: readonly string[];
  readonly description: string;
  readonly exposure: GoogleToolExposure;
  readonly executionPlane?: GoogleToolExecutionPlane;
  /**
   * Narrow information-flow exception for a read whose model-facing result
   * cannot expose provider body content. The loop still requires matching
   * same-turn provenance before using this exception.
   */
  readonly taintedReadContinuation?: 'drive-search-file';
}

const WORKSPACE_SERVICE_LABELS: Readonly<Record<string, string>> = {
  calendar: 'Calendar',
  tasks: 'Tasks',
  docs: 'Docs',
  chat: 'Chat',
  gmail: 'Gmail',
  drive: 'Drive',
  sheets: 'Sheets',
};

function humanizeToolAction(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (first) => first.toUpperCase());
}

/** Presentation metadata derived from the canonical executable tool name. */
export function toolActivityPresentation(name: string): ToolActivityPresentation {
  if (name === 'youtube.search') {
    return { category: 'youtube', categoryLabel: 'YouTube', actionLabel: 'Search' };
  }
  if (name.startsWith('roleplay_setting.')) {
    return {
      category: 'roleplay',
      categoryLabel: 'Roleplay World',
      actionLabel: humanizeToolAction(name.slice('roleplay_setting.'.length)),
    };
  }
  if (name.startsWith('memory.')) {
    return {
      category: 'memory',
      categoryLabel: 'Memory',
      actionLabel: humanizeToolAction(name.slice('memory.'.length)),
    };
  }
  if (name === 'document.create_pdf') {
    return { category: 'documents', categoryLabel: 'Documents & Artifacts', actionLabel: 'Create PDF' };
  }

  const separator = name.indexOf('.');
  if (separator > 0) {
    const service = name.slice(0, separator);
    const serviceLabel = WORKSPACE_SERVICE_LABELS[service];
    if (serviceLabel) {
      return {
        category: 'google-workspace',
        categoryLabel: 'Google Workspace',
        serviceLabel,
        actionLabel: humanizeToolAction(name.slice(separator + 1)),
      };
    }
  }

  return {
    category: 'other',
    categoryLabel: 'Tools',
    actionLabel: separator >= 0 ? humanizeToolAction(name.slice(separator + 1)) : humanizeToolAction(name),
  };
}
