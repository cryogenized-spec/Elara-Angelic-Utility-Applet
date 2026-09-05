import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../domain/chat';
import { deleteMessage } from '../../persistence/conversation';
import { ExecutionSummary } from './ExecutionSummary';
import { Icon } from '../../ui/icons';
import { MarkdownText } from './MarkdownText';
import './conversation-surface.css';

function responseGroupFor(message: ChatMessage): string {
  return message.responseGroupId || message.id;
}

export function ConversationSurface({ messages, fontSize, onRegenerate }: { messages: ChatMessage[]; fontSize: number; onRegenerate: (messageId: string) => void }) {
  const conversationRef = useRef<HTMLElement>(null);
  const shouldStickToEndRef = useRef(true);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const seenCountsRef = useRef<Record<string, number>>({});
  function rememberScrollPosition() { const element = conversationRef.current; if (!element) return; shouldStickToEndRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160; }
  function scrollToEnd() { const element = conversationRef.current; if (!element || !shouldStickToEndRef.current) return; element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }

  const visibleMessages = useMemo(() => messages.filter((message) => !deletedIds.has(message.id)), [messages, deletedIds]);

  const grouped = useMemo(() => {
    const entries: Array<{ message: ChatMessage; variants: ChatMessage[] }> = [];
    const groups = new Map<string, ChatMessage[]>();
    for (const message of visibleMessages) {
      if (message.role !== 'assistant') {
        entries.push({ message, variants: [message] });
        continue;
      }
      const key = responseGroupFor(message);
      const variants = groups.get(key);
      if (variants) {
        variants.push(message);
        continue;
      }
      const next = [message];
      groups.set(key, next);
      entries.push({ message, variants: next });
    }
    return entries;
  }, [visibleMessages]);

  useEffect(() => {
    setSelectedVariants((current) => {
      const next = { ...current };
      for (const entry of grouped) {
        if (entry.message.role !== 'assistant') continue;
        const key = responseGroupFor(entry.message);
        const count = entry.variants.length;
        const previousCount = seenCountsRef.current[key];
        if (!(key in next) || previousCount !== count) next[key] = Math.min(next[key] ?? count - 1, count - 1);
        seenCountsRef.current[key] = count;
      }
      return next;
    });
  }, [grouped]);

  useEffect(() => { scrollToEnd(); }, [visibleMessages.length, visibleMessages.at(-1)?.text]);
  useEffect(() => { const viewport = window.visualViewport; if (!viewport) return undefined; viewport.addEventListener('resize', scrollToEnd); return () => viewport.removeEventListener('resize', scrollToEnd); }, []);

  async function handleDelete(message: ChatMessage) {
    try {
      await deleteMessage(message.id, message.conversationId ?? 'primary');
      setDeletedIds((current) => new Set(current).add(message.id));
    } catch {
      // The message may already have disappeared locally; keep the chat surface stable.
    }
  }

  if (visibleMessages.length === 0) return <section className="conversation" aria-label="Conversation"><div className="empty-state"><span className="empty-state__kicker">ELARA / READY</span><h2>What shall we work on?</h2><p style={{ fontSize: `${fontSize}px` }}>Your conversation starts here. Elara's presence stays central while utility surfaces remain out of the visible chat.</p></div></section>;

  return <section ref={conversationRef} className="conversation" aria-label="Conversation" aria-live="polite" onScroll={rememberScrollPosition}>
    <div className="conversation__stream">
      {grouped.map(({ message, variants }) => {
        if (message.role !== 'assistant') {
          return <article className="message message-user user-surface-frosted" key={message.id}>
            <header className="message-meta"><span>YOU</span><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
            <div className="message-body" style={{ fontSize: `${fontSize}px` }}><MarkdownText text={message.text || '…'} /></div>
            <div className="message-actions" aria-label="Message actions">
              <button type="button" className="message-action" aria-label="Delete message" title="Delete message" onClick={() => void handleDelete(message)}><Icon name="trash" size={15} /></button>
            </div>
          </article>;
        }
        const groupId = responseGroupFor(message);
        const selectedIndex = Math.min(Math.max(selectedVariants[groupId] ?? variants.length - 1, 0), variants.length - 1);
        const selected = variants[selectedIndex];
        const thoughtSummary = selected.providerTurn?.usage?.thoughtSummary;
        return <article className="message message-assistant assistant-glow" key={groupId}>
          <header className="message-meta"><span>ELARA</span><time dateTime={new Date(selected.createdAt).toISOString()}>{new Date(selected.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
          {thoughtSummary && selected.executionSummary && <ExecutionSummary summary={selected.executionSummary} thoughtSummary={thoughtSummary} />}
          {variants.length > 0 && <div className="response-variants" aria-label="Generated response variants">
            <button type="button" className="response-variants__button" aria-label="Previous response" disabled={selectedIndex === 0} onClick={() => setSelectedVariants((current) => ({ ...current, [groupId]: Math.max(0, selectedIndex - 1) }))}>‹</button>
            <span className="response-variants__pagination" aria-live="polite">{selectedIndex + 1}/{variants.length}</span>
            <button type="button" className="response-variants__button" aria-label="Next response" disabled={selectedIndex === variants.length - 1} onClick={() => setSelectedVariants((current) => ({ ...current, [groupId]: Math.min(variants.length - 1, selectedIndex + 1) }))}>›</button>
          </div>}
          <div className="message-body" style={{ fontSize: `${fontSize}px` }}><MarkdownText text={selected.text || '…'} /></div>
          <div className="message-actions" aria-label="Message actions">
            <button type="button" className="message-action" aria-label="Regenerate response" title="Regenerate response" onClick={() => onRegenerate(selected.id)}><Icon name="refresh" size={15} /></button>
            <button type="button" className="message-action message-action--danger" aria-label="Delete message" title="Delete message" onClick={() => void handleDelete(selected)}><Icon name="trash" size={15} /></button>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
