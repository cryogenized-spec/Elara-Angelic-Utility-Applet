import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../domain/chat';
import { ExecutionSummary } from './ExecutionSummary';
import { MarkdownText } from './MarkdownText';
import './conversation-surface.css';

export function ConversationSurface({ messages, fontSize }: { messages: ChatMessage[]; fontSize: number }) {
  const conversationRef = useRef<HTMLElement>(null);
  const shouldStickToEndRef = useRef(true);
  function rememberScrollPosition() { const element = conversationRef.current; if (!element) return; shouldStickToEndRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160; }
  function scrollToEnd() { const element = conversationRef.current; if (!element || !shouldStickToEndRef.current) return; element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); }
  useEffect(() => { scrollToEnd(); }, [messages.length, messages.at(-1)?.text]);
  useEffect(() => { const viewport = window.visualViewport; if (!viewport) return undefined; viewport.addEventListener('resize', scrollToEnd); return () => viewport.removeEventListener('resize', scrollToEnd); }, []);
  if (messages.length === 0) return <section className="conversation" aria-label="Conversation"><div className="empty-state"><span className="empty-state__kicker">ELARA / READY</span><h2>What shall we work on?</h2><p style={{ fontSize: `${fontSize}px` }}>Your conversation starts here. Elara's presence stays central while utility surfaces remain out of the visible chat.</p></div></section>;
  return <section ref={conversationRef} className="conversation" aria-label="Conversation" aria-live="polite" onScroll={rememberScrollPosition}>
    <div className="conversation__stream">
      {messages.map((message) => <article className={`message message-${message.role}${message.role === 'assistant' ? ' assistant-glow' : ' user-surface-frosted'}`} key={message.id}>
        <header className="message-meta"><span>{message.role === 'assistant' ? 'ELARA' : 'YOU'}</span><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
        {message.role === 'assistant' && message.executionSummary && <ExecutionSummary summary={message.executionSummary} />}
        <div className="message-body" style={{ fontSize: `${fontSize}px` }}><MarkdownText text={message.text || '…'} /></div>
      </article>)}
    </div>
  </section>;
}
