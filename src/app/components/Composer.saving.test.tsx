// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('locks every competing composer action while a completed response is being saved', () => {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const onFilesSelected = vi.fn();

  act(() => {
    root.render(
      <Composer
        draft="next message"
        status="saving"
        systemInstruction=""
        onDraftChange={() => undefined}
        onSend={onSend}
        onCancel={onCancel}
        onFilesSelected={onFilesSelected}
      />,
    );
  });

  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Elara"]');
  const send = container.querySelector<HTMLButtonElement>('button.composer__send');
  const tools = container.querySelector<HTMLButtonElement>('button[aria-label="Composer tools"]');
  const vtt = container.querySelector<HTMLButtonElement>('button[aria-label="VTT voice input"]');
  const expand = container.querySelector<HTMLButtonElement>('button[aria-label="Expand message editor"]');

  expect(textarea?.disabled).toBe(true);
  expect(send?.disabled).toBe(true);
  expect(send?.getAttribute('aria-label')).toBe('Saving response');
  expect(send?.classList.contains('is-cancel')).toBe(false);
  expect(tools?.disabled).toBe(true);
  expect(vtt?.disabled).toBe(true);
  expect(expand?.disabled).toBe(true);

  act(() => {
    container.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    send?.click();
  });
  expect(onSend).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  expect(onFilesSelected).not.toHaveBeenCalled();
});
