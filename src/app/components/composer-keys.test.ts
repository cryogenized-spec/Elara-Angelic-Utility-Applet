import { describe, expect, it } from 'vitest';
import { composerEnterKeyHint, isComposerSendShortcut } from './composer-keys';

const enter = (overrides: Partial<Parameters<typeof isComposerSendShortcut>[0]> = {}) => ({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...overrides });

describe('composer Enter semantics (shared by compact and expanded composers)', () => {
  describe('enterToSend = true (default)', () => {
    it('plain Enter sends', () => { expect(isComposerSendShortcut(enter(), true)).toBe(true); });
    it('Shift+Enter is a newline', () => { expect(isComposerSendShortcut(enter({ shiftKey: true }), true)).toBe(false); });
    it('Ctrl/Cmd+Enter is not treated as the shortcut (left to the textarea)', () => {
      expect(isComposerSendShortcut(enter({ ctrlKey: true }), true)).toBe(false);
      expect(isComposerSendShortcut(enter({ metaKey: true }), true)).toBe(false);
    });
    it('Enter during IME composition never sends', () => { expect(isComposerSendShortcut(enter({ isComposing: true }), true)).toBe(false); });
  });

  describe('enterToSend = false', () => {
    it('plain Enter is a newline', () => { expect(isComposerSendShortcut(enter(), false)).toBe(false); });
    it('Shift+Enter is a newline', () => { expect(isComposerSendShortcut(enter({ shiftKey: true }), false)).toBe(false); });
    it('Ctrl+Enter sends', () => { expect(isComposerSendShortcut(enter({ ctrlKey: true }), false)).toBe(true); });
    it('Cmd+Enter sends', () => { expect(isComposerSendShortcut(enter({ metaKey: true }), false)).toBe(true); });
    it('Ctrl+Enter during IME composition never sends', () => { expect(isComposerSendShortcut(enter({ ctrlKey: true, isComposing: true }), false)).toBe(false); });
  });

  it('ignores non-Enter keys in both modes', () => {
    expect(isComposerSendShortcut(enter({ key: 'a' }), true)).toBe(false);
    expect(isComposerSendShortcut(enter({ key: 'a', ctrlKey: true }), false)).toBe(false);
  });

  it('enterKeyHint reflects the effective mode', () => {
    expect(composerEnterKeyHint(true)).toBe('send');
    expect(composerEnterKeyHint(false)).toBe('enter');
  });
});
