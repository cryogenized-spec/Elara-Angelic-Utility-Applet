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
function sendButton(): HTMLButtonElement { return container.querySelector('.composer__send')!; }
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
    it('keeps the stop button enabled while streaming so the turn can be cancelled', () => {
      const onCancel = vi.fn();
      const onSend = vi.fn();
      act(() => {
        root.render(<Composer draft="" status="streaming" systemInstruction="" onDraftChange={() => {}} onSend={onSend} onCancel={onCancel} />);
      });
      const stop = sendButton();
      expect(stop.getAttribute('aria-label')).toBe('Cancel response');
      expect(stop.disabled).toBe(false);
      expect(stop.classList.contains('is-cancel')).toBe(true);
      act(() => { stop.click(); });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSend).not.toHaveBeenCalled();
    });
    it('disables send when idle with an empty draft and no attachments', () => {
      render({ draft: '   ', status: 'idle' });
      expect(sendButton().disabled).toBe(true);
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

describe('Composer secondary tools (paperclip menu)', () => {
  function paperclipButton(): HTMLButtonElement { return container.querySelector('button[aria-label="Composer tools"]')!; }
  function menu(): HTMLElement { return container.querySelector('.composer__attachment-menu')!; }
  function openMenu(): void { act(() => { paperclipButton().click(); }); }
  function menuItem(name: RegExp): HTMLButtonElement {
    return Array.from(menu().querySelectorAll('button')).find((button) => name.test(button.getAttribute('aria-label') ?? '')) as HTMLButtonElement;
  }

  it('does not spend editor width on a standalone Markdown button', () => {
    render();
    expect(container.querySelector('.composer__markdown')).toBeNull();
    // The Markdown reference is reachable, but only from the paperclip menu.
    expect(container.querySelector('button[aria-label="Markdown reference"]')).toBeNull();
    openMenu();
    expect(menuItem(/Markdown reference/)).toBeTruthy();
  });

  it('opens the paperclip menu as a single home for attachment and Markdown actions', () => {
    render();
    expect(menu()).toBeNull();
    openMenu();
    expect(paperclipButton().getAttribute('aria-expanded')).toBe('true');
    expect(menu().getAttribute('role')).toBe('menu');
    for (const name of [/Camera/, /Photos/, /File \/ Document/, /Markdown reference/]) {
      expect(menuItem(name), `missing action ${String(name)}`).toBeTruthy();
    }
    expect(menu().querySelectorAll('button')).toHaveLength(4);
  });

  it('gives every icon-led action an accessible name, tooltip and glyph', () => {
    render();
    openMenu();
    for (const button of Array.from(menu().querySelectorAll('button'))) {
      expect(button.getAttribute('aria-label')?.trim().length ?? 0).toBeGreaterThan(0);
      expect(button.getAttribute('title')?.trim().length ?? 0).toBeGreaterThan(0);
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('preserves the attachment sources and their file inputs', () => {
    render();
    openMenu();
    const camera = container.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    const gallery = container.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]:not([capture])')!;
    const document = container.querySelector<HTMLInputElement>('input[type="file"][accept*="application/pdf"]')!;
    expect(camera).not.toBeNull();
    expect(gallery.multiple).toBe(true);
    expect(document.multiple).toBe(true);

    const clicks: string[] = [];
    for (const [label, input] of [[/Camera/, camera], [/Photos/, gallery], [/File \/ Document/, document]] as const) {
      const spy = vi.spyOn(input, 'click').mockImplementation(() => { clicks.push(input.accept || input.capture); });
      act(() => { menuItem(label as RegExp).click(); });
      spy.mockRestore();
    }
    expect(clicks).toEqual(['image/*', 'image/*', 'application/pdf,text/plain,text/markdown,application/json,text/csv,application/javascript,text/javascript,text/css,text/html,application/xml,text/xml']);
  });

  it('opens the Markdown reference from the menu and closes the menu behind it', () => {
    render();
    openMenu();
    act(() => { menuItem(/Markdown reference/).click(); });
    expect(container.querySelector('[role="dialog"][aria-labelledby="markdown-reference-title"]')).not.toBeNull();
    expect(menu()).toBeNull();
  });

  it('closes the menu on Escape', () => {
    render();
    openMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(menu()).toBeNull();
  });

  it('closes the menu when tapping outside it', () => {
    render();
    openMenu();
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(menu()).toBeNull();
  });

  it('uses the same combined menu in the expanded composer', () => {
    render();
    openExpanded();
    const expandedRoot = container.querySelector('.composer-expanded')!;
    expect(expandedRoot.querySelector('.composer__markdown')).toBeNull();
    const trigger = expandedRoot.querySelector('button[aria-label="Composer tools"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    act(() => { trigger.click(); });
    expect(expandedRoot.querySelector('.composer__attachment-menu')).not.toBeNull();
    expect(Array.from(expandedRoot.querySelectorAll('.composer__attachment-menu button')).map((button) => button.getAttribute('aria-label')))
      .toEqual(['Camera: take a photo', 'Photos / Gallery: choose an image', 'File / Document: choose a document', 'Markdown reference']);
  });
});
