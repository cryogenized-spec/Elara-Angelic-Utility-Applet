import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../../ui/icons';
import type { ProviderStatus } from '../../domain/chat';
import { MarkdownReference } from './MarkdownReference';
import './composer.css';

const MAX_HEIGHT = 132;

export function Composer({ draft, status, onDraftChange, onSend, onCancel }: { draft: string; status: ProviderStatus; onDraftChange: (value: string) => void; onSend: () => void; onCancel: () => void; }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || expanded) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(MAX_HEIGHT, Math.max(42, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [draft, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const textarea = expandedTextareaRef.current;
    textarea?.focus();
    document.body.classList.add('composer-expanded-open');
    return () => document.body.classList.remove('composer-expanded-open');
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(false);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [expanded]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (status === 'streaming' || !draft.trim()) return;
    event.preventDefault();
    onSend();
  }

  function handleExpandedKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && status !== 'streaming' && draft.trim()) {
      event.preventDefault();
      onSend();
    }
  }

  if (expanded) {
    return <>
      <section className="composer-expanded" role="dialog" aria-modal="true" aria-label="Expanded message editor">
        <header className="composer-expanded__header">
          <div>
            <span className="composer-expanded__eyebrow">COMPOSE</span>
            <h2>Write to Elara</h2>
          </div>
          <button className="composer-expanded__collapse composer__icon" type="button" aria-label="Collapse message editor" onClick={() => setExpanded(false)}>
            <Icon name="collapse" size={20} />
          </button>
        </header>
        <textarea
          ref={expandedTextareaRef}
          className="composer-expanded__textarea"
          aria-label="Expanded message"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleExpandedKeyDown}
          placeholder="Write your message…"
          disabled={status === 'streaming'}
          autoFocus
        />
        <footer className="composer-expanded__footer">
          <button className="composer__icon" type="button" aria-label="Attach image or document" disabled={status === 'streaming'}>
            <Icon name="paperclip" size={20} />
          </button>
          <button className="composer__icon" type="button" aria-label="Voice input" disabled={status === 'streaming'}>
            <Icon name="mic" size={20} />
          </button>
          <div className="composer-expanded__spacer" />
          <button className="composer__icon composer__markdown" type="button" aria-label="VTT reference" aria-expanded={markdownOpen} disabled={status === 'streaming'} onClick={() => setMarkdownOpen((open) => !open)}>
            <span aria-hidden="true">VTT</span>
          </button>
          <button className="composer__send" type="button" aria-label={status === 'streaming' ? 'Cancel response' : 'Send message'} disabled={status !== 'streaming' && !draft.trim()} onClick={() => { if (status === 'streaming') onCancel(); else onSend(); }}>
            <Icon name={status === 'streaming' ? 'close' : 'send'} size={19} />
          </button>
        </footer>
      </section>
      <MarkdownReference open={markdownOpen} onClose={() => setMarkdownOpen(false)} />
    </>;
  }

  return <>
    <form className="composer" onSubmit={(event) => { event.preventDefault(); if (status === 'streaming') onCancel(); else onSend(); }}>
      <button className="composer__icon" type="button" aria-label="Attach image or document" disabled={status === 'streaming'}>
        <Icon name="paperclip" size={20} />
      </button>
      <div className="composer__input-wrap">
        <textarea ref={textareaRef} aria-label="Message Elara" value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={handleKeyDown} placeholder="Message Elara…" rows={1} disabled={status === 'streaming'} enterKeyHint="send" />
        <button className="composer__expand" type="button" aria-label="Expand message editor" onClick={() => setExpanded(true)} disabled={status === 'streaming'}>
          <Icon name="expand" size={15} />
        </button>
      </div>
      <button className="composer__icon" type="button" aria-label="Voice input" disabled={status === 'streaming'}>
        <Icon name="mic" size={20} />
      </button>
      <button className="composer__icon composer__markdown" type="button" aria-label="VTT reference" aria-expanded={markdownOpen} disabled={status === 'streaming'} onClick={() => setMarkdownOpen((open) => !open)}>
        <span aria-hidden="true">VTT</span>
      </button>
      <button className="composer__send" type="submit" aria-label={status === 'streaming' ? 'Cancel response' : 'Send message'} disabled={status !== 'streaming' && !draft.trim()}>
        <Icon name={status === 'streaming' ? 'close' : 'send'} size={19} />
      </button>
    </form>
    <MarkdownReference open={markdownOpen} onClose={() => setMarkdownOpen(false)} />
  </>;
}
