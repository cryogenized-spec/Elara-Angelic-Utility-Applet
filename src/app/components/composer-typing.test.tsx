// @vitest-environment jsdom
/**
 * Typing-path regression tests.
 *
 * The reported "typing lag" was caused by the draft living in the shell: every
 * keystroke re-rendered the conversation, and `react-markdown` re-parses every
 * message body on every render (it builds a fresh processor and calls
 * `parse()`/`runSync()` during render — see node_modules/react-markdown). Two
 * fixes, asserted here: the conversation surface is memoised, and each message
 * body is memoised on its text.
 */
import { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../domain/chat';
import { Composer } from './Composer';
import { ConversationSurface } from './ConversationSurface';

const markdownRenders = { count: 0 };

vi.mock('react-markdown', async () => {
  const actual = await vi.importActual<typeof import('react-markdown')>('react-markdown');
  function CountedMarkdown(props: Record<string, unknown>) {
    markdownRenders.count += 1;
    return actual.default(props as never);
  }
  return { default: CountedMarkdown, __esModule: true };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = function scrollTo() {};

let container: HTMLDivElement;
let root: Root;

function conversation(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `Message ${index} with **markdown**, a list:\n\n- one\n- two\n`,
    conversationId: 'primary',
    createdAt: Date.now() - index * 60_000,
  }) satisfies ChatMessage);
}

/** Mirrors App: memoised message list + stable regenerate callback. */
function StableHarness({ messages }: { messages: ChatMessage[] }) {
  const [draft, setDraft] = useState('');
  const visible = useMemo(() => messages.filter((message) => message.conversationId === 'primary'), [messages]);
  return <>
    <ConversationSurface key="c" messages={visible} generation={null} onRegenerate={() => {}} />
    <Composer draft={draft} status="idle" systemInstruction="" onDraftChange={setDraft} onSend={() => {}} onCancel={() => {}} />
  </>;
}

/** Worst case: the parent rebuilds the message array on every render. */
function UnstableHarness({ messages }: { messages: ChatMessage[] }) {
  const [draft, setDraft] = useState('');
  return <>
    <ConversationSurface key="c" messages={messages.filter(() => true)} generation={null} onRegenerate={() => {}} />
    <Composer draft={draft} status="idle" systemInstruction="" onDraftChange={setDraft} onSend={() => {}} onCancel={() => {}} />
  </>;
}

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function textarea(): HTMLTextAreaElement { return container.querySelector('textarea.composer__input') as HTMLTextAreaElement; }

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  markdownRenders.count = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('typing does not re-render the conversation', () => {
  it('never re-parses message bodies while typing (memoised surface)', () => {
    act(() => { root.render(<StableHarness messages={conversation(12)} />); });
    markdownRenders.count = 0;
    let text = '';
    for (let i = 0; i < 12; i += 1) {
      text += 'a';
      typeInto(textarea(), text);
    }
    expect(markdownRenders.count).toBe(0);
  });

  it('stays cheap even when the parent passes a freshly built message array', () => {
    act(() => { root.render(<UnstableHarness messages={conversation(12)} />); });
    markdownRenders.count = 0;
    let text = '';
    for (let i = 0; i < 12; i += 1) {
      text += 'b';
      typeInto(textarea(), text);
    }
    // Memoised message bodies: an ancestor re-render no longer re-parses them.
    expect(markdownRenders.count).toBe(0);
  });

  it('still re-renders when a message actually changes', () => {
    const first = conversation(4);
    act(() => { root.render(<StableHarness messages={first} />); });
    markdownRenders.count = 0;
    const updated = first.map((message) => (message.id === 'm-3' ? { ...message, text: '**changed**' } : message));
    act(() => { root.render(<StableHarness messages={updated} />); });
    expect(markdownRenders.count).toBeGreaterThan(0);
  });
});

describe('typing stays synchronous', () => {
  it('reports every keystroke immediately (no debounced input)', () => {
    const onDraftChange = vi.fn();
    act(() => {
      root.render(<Composer draft="" status="idle" systemInstruction="" onDraftChange={onDraftChange} onSend={() => {}} onCancel={() => {}} />);
    });
    typeInto(textarea(), 'h');
    typeInto(textarea(), 'he');
    typeInto(textarea(), 'hey');
    expect(onDraftChange.mock.calls.map((call) => call[0])).toEqual(['h', 'he', 'hey']);
  });
});
