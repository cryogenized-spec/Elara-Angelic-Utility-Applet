export interface ConfirmationToolPresentation {
  readonly provider: string;
  readonly action: string;
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  calendar: 'Google Calendar',
  tasks: 'Google Tasks',
  docs: 'Google Docs',
  chat: 'Google Chat',
  gmail: 'Gmail',
  drive: 'Google Drive',
  sheets: 'Google Sheets',
  roleplay_setting: 'Roleplay World',
  memory: 'Memory',
  clickup: 'ClickUp',
});

const ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'calendar.createEvent': 'Create event',
  'calendar.updateEvent': 'Update event',
  'calendar.deleteEvent': 'Delete event',
  'tasks.createTaskList': 'Create task list',
  'tasks.updateTaskList': 'Rename task list',
  'tasks.deleteTaskList': 'Delete task list',
  'tasks.createTask': 'Create task',
  'tasks.updateTask': 'Update task',
  'tasks.moveTask': 'Move task',
  'tasks.deleteTask': 'Delete task',
  'tasks.clearCompleted': 'Clear completed tasks',
  'docs.createDocument': 'Create document',
  'docs.insertText': 'Insert text',
  'docs.appendParagraph': 'Append paragraph',
  'docs.replaceText': 'Replace text',
  'docs.batchUpdate': 'Update document',
  'chat.createMessage': 'Post message',
  'chat.updateMessage': 'Update message',
  'chat.deleteMessage': 'Delete message',
  'gmail.modifyMessage': 'Organize message',
  'gmail.modifyThread': 'Organize thread',
  'gmail.trashMessage': 'Move message to Trash',
  'gmail.untrashMessage': 'Restore message',
  'gmail.trashThread': 'Move thread to Trash',
  'gmail.untrashThread': 'Restore thread',
  'gmail.createLabel': 'Create label',
  'gmail.updateLabel': 'Rename label',
  'gmail.deleteLabel': 'Delete label',
  'gmail.sendMessage': 'Send email',
  'gmail.replyMessage': 'Send reply',
  'drive.createFile': 'Create file',
  'drive.updateFile': 'Update file',
  'drive.moveFile': 'Move file',
  'drive.trashFile': 'Move file to Trash',
  'sheets.createSpreadsheet': 'Create spreadsheet',
  'sheets.addSheet': 'Add sheet',
  'sheets.writeRange': 'Write cells',
  'sheets.appendRows': 'Append rows',
  'sheets.updateCell': 'Update cell',
  'sheets.insertRows': 'Insert rows',
  'sheets.batchUpdate': 'Update spreadsheet',
  'roleplay_setting.create': 'Create world item',
  'roleplay_setting.update': 'Update world item',
  'roleplay_setting.move': 'Move world item',
  'roleplay_setting.delete': 'Delete world item',
  'memory.save': 'Remember this',
  'memory.reconcile': 'Update memory',
  'clickup.createTask': 'Create task',
  'clickup.updateTask': 'Update task',
  'clickup.createTaskComment': 'Post comment',
  'clickup.replyToComment': 'Reply to comment',
  'clickup.setCustomField': 'Update custom field',
  'clickup.attachArtifact': 'Attach file',
});

function titleCase(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return 'Review action';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function confirmationToolPresentation(tool: string): ConfirmationToolPresentation {
  const separator = tool.indexOf('.');
  const namespace = separator >= 0 ? tool.slice(0, separator) : '';
  const operation = separator >= 0 ? tool.slice(separator + 1) : tool;
  return {
    provider: PROVIDER_LABELS[namespace] ?? 'Elara',
    action: ACTION_LABELS[tool] ?? titleCase(operation),
  };
}
