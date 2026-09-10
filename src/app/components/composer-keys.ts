/**
 * One Enter-key rule shared by the compact and expanded composers.
 *
 * enterToSend = true  → Enter sends, Shift+Enter inserts a newline.
 * enterToSend = false → Enter inserts a newline, Ctrl/Cmd+Enter sends.
 *
 * Enter during IME composition is never a send. Anything that is not the
 * send shortcut is left to the textarea's native behaviour.
 */
export interface ComposerEnterKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  isComposing: boolean;
}

export function isComposerSendShortcut(event: ComposerEnterKey, enterToSend: boolean): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false;
  if (enterToSend) return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
  return event.ctrlKey || event.metaKey;
}

/** `enterKeyHint` value that matches the effective Enter behaviour. */
export function composerEnterKeyHint(enterToSend: boolean): 'send' | 'enter' {
  return enterToSend ? 'send' : 'enter';
}
