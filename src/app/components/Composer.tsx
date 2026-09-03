import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../../ui/icons';
import type { ProviderStatus } from '../../domain/chat';
import './composer.css';

const MAX_HEIGHT = 132;

export function Composer({
  draft,
  status,
  onDraftChange,
  onSend,
  onCancel,
}: {
  draft: string;
  status: ProviderStatus;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(MAX_HEIGHT, Math.max(42, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (status === 'streaming') return;
    if (!draft.trim()) return;

    event.preventDefault();
    onSend();
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (status === 'streaming') onCancel();
        else onSend();
      }}
    >
      <button className="composer__icon" type="button" aria-label="Attach image or document" disabled={status === 'streaming'}>
        <Icon name="paperclip" size={20} />
      </button>
      <textarea
        ref={textareaRef}
        aria-label="Message Elara"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message Elara…"
        rows={1}
        disabled={status === 'streaming'}
        enterKeyHint="send"
      />
      <button className="composer__icon" type="button" aria-label="Voice input" disabled={status === 'streaming'}>
        <Icon name="mic" size={20} />
      </button>
      <button
        className={`composer__send${status === 'streaming' ? ' is-cancel' : ''}`}
        type="submit"
        aria-label={status === 'streaming' ? 'Cancel response' : 'Send message'}
        disabled={status !== 'streaming' && !draft.trim()}
      >
        <Icon name={status === 'streaming' ? 'close' : 'send'} size={19} />
      </button>
    </form>
  );
}
