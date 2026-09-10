// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  act(() => {
    root.render(<Composer draft="hello" status="idle" systemInstruction="" onDraftChange={() => {}} onSend={onSend} onCancel={() => {}} {...props} />);
  });
  return { onSend };
}

function keydown(target: Element, init: KeyboardEventInit & { isComposing?: boolean }): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
  if (init.isComposing) Object.defineProperty(event, 'isComposing', { value: true });
  let notPrevented = true;
  act(() => { notPrevented = target.dispatchEvent(event); });
  return notPrevented; // true → default (newline) allowed
}

function compactTextarea(): HTMLTextAreaElement { return container.querySelector('textarea[aria-label="Message Elara"]')!; }
function expandedTextarea(): HTMLTextAreaElement { return container.querySelector('textarea[aria-label="Expanded message"]')!; }
function openExpanded(): void {
  act(() => { container.querySelector<HTMLButtonElement>('button[aria-label="Expand message editor"]')!.click(); });
}

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Composer Enter behaviour', () => {
  describe('compact composer', () => {
    it('defaults to Enter = Send with enterKeyHint="send"', () => {
      const { onSend } = render();
      expect(compactTextarea().getAttribute('enterkeyhint')).toBe('send');
      expect(keydown(compactTextarea(), {})).toBe(false);
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    it('Shift+Enter inserts a newline when enabled', () => {
      const { onSend } = render({ enterToSend: true });
      expect(keydown(compactTextarea(), { shiftKey: true })).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    });
    it('Enter inserts a newline when disabled, enterKeyHint="enter"', () => {
      const { onSend } = render({ enterToSend: false });
      expect(compactTextarea().getAttribute('enterkeyhint')).toBe('enter');
      expect(keydown(compactTextarea(), {})).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    });
    it('Ctrl+Enter and Cmd+Enter send when disabled', () => {
      const { onSend } = render({ enterToSend: false });
      expect(keydown(compactTextarea(), { ctrlKey: true })).toBe(false);
      expect(keydown(compactTextarea(), { metaKey: true })).toBe(false);
      expect(onSend).toHaveBeenCalledTimes(2);
    });
    it('IME composition Enter does not send in either mode', () => {
      const a = render({ enterToSend: true });
      expect(keydown(compactTextarea(), { isComposing: true })).toBe(true);
      expect(a.onSend).not.toHaveBeenCalled();
      const b = render({ enterToSend: false });
      expect(keydown(compactTextarea(), { ctrlKey: true, isComposing: true })).toBe(true);
      expect(b.onSend).not.toHaveBeenCalled();
    });
    it('does not swallow Enter when there is nothing to send', () => {
      const { onSend } = render({ draft: '   ' });
      expect(keydown(compactTextarea(), {})).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    });
    it('does not send while streaming', () => {
      const { onSend } = render({ status: 'streaming' });
      keydown(compactTextarea(), {});
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('expanded composer uses the same preference semantics', () => {
    it('Enter sends and Shift+Enter is a newline when enabled', () => {
      const { onSend } = render({ enterToSend: true });
      openExpanded();
      expect(expandedTextarea().getAttribute('enterkeyhint')).toBe('send');
      expect(keydown(expandedTextarea(), { shiftKey: true })).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
      expect(keydown(expandedTextarea(), {})).toBe(false);
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    it('Enter is a newline and Ctrl/Cmd+Enter sends when disabled', () => {
      const { onSend } = render({ enterToSend: false });
      openExpanded();
      expect(expandedTextarea().getAttribute('enterkeyhint')).toBe('enter');
      expect(keydown(expandedTextarea(), {})).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
      expect(keydown(expandedTextarea(), { metaKey: true })).toBe(false);
      expect(keydown(expandedTextarea(), { ctrlKey: true })).toBe(false);
      expect(onSend).toHaveBeenCalledTimes(2);
    });
    it('IME composition Enter does not send', () => {
      const { onSend } = render({ enterToSend: true });
      openExpanded();
      expect(keydown(expandedTextarea(), { isComposing: true })).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
